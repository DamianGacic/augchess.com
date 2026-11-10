/**
 * server/correspondence.js — Correspondence games: slow, turn-based games
 * between two signed-in players that live in the database rather than in
 * this process (supabase/migrations/0011_correspondence.sql).
 *
 * A game is loaded into an ordinary GameRoom (same protocol, same engine,
 * same client game screen, at /ws/corr/<id>) whenever someone opens it, and
 * every action that changes it is saved straight back, with the action
 * itself logged in correspondence_moves. So a restart, or nobody looking at
 * the game for a day, loses nothing: the next visitor reloads it.
 *
 * Time: each side's bank (settings.days) is the engine's own clock (see
 * engine/clock-engine.js). Nothing here sets a timer for it: sweep() asks
 * the database every SWEEP_MS which games are past their deadline and ends
 * those on time, loaded or not.
 *
 * Browsers start, accept and list games through Supabase RPCs directly; this
 * file only plays them. Off (every game fails to load) unless SUPABASE_URL
 * and SUPABASE_SERVICE_ROLE_KEY are set, like ranked play.
 */
'use strict';

const engine = require('../engine/index.js');
const { gameResult } = require('../engine/gameover-engine.js');
const { GameRoom } = require('./rooms.js');
const ratings = require('./ratings.js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SWEEP_MS = 30 * 1000;
const IDLE_MS = 10 * 60 * 1000; // a loaded game nobody is connected to is dropped after this

// Actions that would reset or re-time the game: a correspondence game is
// set up once, by accept_correspondence_game, and never restarted.
const REFUSED = { newGame: "A correspondence game can't be restarted", settingsUpdate: 'Settings are fixed for a correspondence game', settingsStart: 'The draft has already started' };

// ─── Database (service role) ────────────────────────────────────────────────
async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${path.split('?')[0]} ${res.status}: ${await res.text()}`);
  return res.json();
}

const db = {
  async game(id) {
    const [row] = await rest(`correspondence_games?id=eq.${id}&select=*`);
    return row || null;
  },
  saveTurn(t) {
    return rest('rpc/save_correspondence_turn', { method: 'POST', body: JSON.stringify({ t }) });
  },
  async dueGameIds(now) {
    const rows = await rest(`correspondence_games?status=eq.active&deadline=lt.${encodeURIComponent(new Date(now).toISOString())}&select=id&limit=100`);
    return rows.map(r => r.id);
  },
  async playedFrames(id) {
    const rows = await rest(`correspondence_moves?game_id=eq.${id}&select=state&order=ply`);
    return rows.map(r => r.state).filter(s => s.phase === 'playing');
  },
};

// ─── Room ───────────────────────────────────────────────────────────────────
class CorrespondenceRoom extends GameRoom {
  constructor(row) {
    super(`corr/${row.id}`);
    this.gameId = row.id;
    this.correspondence = true;
    this.accountSeats = true;
    this.signInReason = 'Sign in to play correspondence games';
    this.reserved = { w: row.white_id, b: row.black_id };
    this.ply = row.ply;
    this.acceptedAt = row.accepted_at;
    this.state = row.state ? engine.restoreState(row.state) : newDraft(row);
    this.recorded = row.status === 'finished';
    this.saving = Promise.resolve();
    this.lastUsed = Date.now();
    this.onBroken = () => {};
  }

  applyAction(ws, action) {
    this.lastUsed = Date.now();
    if (action && REFUSED[action.type]) { this.sendRejection(ws, REFUSED[action.type]); return; }
    const before = this.snapshot();
    const logLength = this.logLength();
    super.applyAction(ws, action);
    if (this.snapshot() !== before) this.persist(ws.augchess && ws.augchess.color, action, logLength);
  }

  // Sweep: the side to act has run out of time.
  expire(now) {
    const logLength = this.logLength();
    if (!engine.tickClock(this.state, now)) return;
    this.broadcast();
    this.persist(null, { type: 'timeout' }, logLength);
  }

  // What counts as a change worth saving. The clock is left out: every
  // action, even a refused one, first charges the running side up to now,
  // which re-bases the clock without changing it.
  snapshot() {
    return JSON.stringify(engine.serializeState(this.state), (key, value) => (key === 'clock' ? undefined : value));
  }
  logLength() { return this.state.moveLog ? this.state.moveLog.length : 0; }
  idle(now) { return !this.seats.w?.socket && !this.seats.b?.socket && !this.spectators.size && now - this.lastUsed > IDLE_MS; }

  // Saves are chained so they land in order. A save that fails or is refused
  // means this copy no longer matches the database: drop it and disconnect
  // everyone, whose clients reconnect and get the saved game back.
  persist(color, action, logLength) {
    const state = engine.serializeState(this.state);
    const clock = this.state.clock;
    const running = clock && clock.running;
    const over = !!this.state.gameOver;
    const turn = {
      game_id: this.gameId,
      ply: ++this.ply,
      color: color || null,
      action,
      log: (this.state.moveLog || []).slice(logLength),
      state,
      white_ms_left: clock ? Math.round(clock.w) : null,
      black_ms_left: clock ? Math.round(clock.b) : null,
      turn: running || null,
      turn_started_at: running ? new Date(clock.since).toISOString() : null,
      deadline: running ? new Date(clock.since + clock[running]).toISOString() : null,
      result: over ? (gameResult(this.state.gameOverText) || 'draw') : null,
      result_text: over ? this.state.gameOverText : null,
    };
    this.saving = this.saving
      .then(() => db.saveTurn(turn))
      .then((saved) => {
        if (!saved) throw new Error(`ply ${turn.ply} refused (out of step with the database)`);
        if (over && !this.recorded) {
          this.recorded = true;
          return this.recordFinished(turn);
        }
      })
      .catch((err) => {
        console.error(`[corr ${this.gameId}] save failed`, err);
        this.break();
      });
  }

  // The finished game goes into the shared game history, with every played
  // state as its replay.
  async recordFinished(turn) {
    const frames = await db.playedFrames(this.gameId);
    const { state } = this;
    await ratings.recordGame({
      mode: 'correspondence',
      room_id: this.id,
      ranked: false,
      white_id: this.reserved.w,
      black_id: this.reserved.b,
      result: turn.result,
      result_text: turn.result_text,
      white_augments: state.augments.w,
      black_augments: state.augments.b,
      minutes: state.settings.days * 24 * 60,
      points: state.settings.points,
      moves: (state.moveLog || []).length,
      frames,
      started_at: this.acceptedAt,
    });
  }

  break() {
    if (this.broken) return;
    this.broken = true;
    this.onBroken();
    for (const sock of [this.seats.w?.socket, this.seats.b?.socket, ...this.spectators]) {
      if (sock) sock.close(1011, 'Game reloading');
    }
  }

  // Finished games are written in persist(); in-process clock and setup
  // timers would be lost on a restart and run for days — sweep() does time.
  recordResult() {}
  watchClock() {}
  watchVanguard() {}
  watchPatchy() {}
}

// An accepted game nobody has opened yet: the draft, timed from acceptance.
function newDraft(row) {
  const state = engine.createRoomState();
  state.settings.days = row.days;
  state.settings.points = row.points;
  engine.applyAction(state, 'w', { type: 'settingsStart' }, Date.parse(row.accepted_at));
  return state;
}

// ─── Store ──────────────────────────────────────────────────────────────────
class CorrespondenceStore {
  constructor() {
    this.rooms = new Map();
    this.loading = new Map();
  }

  // The loaded room for an active or finished game, or null (no such game,
  // not accepted yet, cancelled, or no database configured).
  load(id) {
    if (!ratings.enabled || !UUID.test(id)) return Promise.resolve(null);
    if (this.rooms.has(id)) return Promise.resolve(this.rooms.get(id));
    if (!this.loading.has(id)) {
      const pending = db.game(id).then((row) => {
        if (!row || !['active', 'finished'].includes(row.status)) return null;
        const room = new CorrespondenceRoom(row);
        room.onBroken = () => { if (this.rooms.get(id) === room) this.rooms.delete(id); };
        this.rooms.set(id, room);
        return room;
      }).finally(() => this.loading.delete(id));
      this.loading.set(id, pending);
    }
    return this.loading.get(id);
  }

  async sweep(now = Date.now()) {
    for (const id of await db.dueGameIds(now)) {
      try {
        const room = await this.load(id);
        if (room) room.expire(now);
      } catch (err) {
        console.error(`[corr ${id}] timeout check failed`, err);
      }
    }
    for (const [id, room] of this.rooms) {
      if (room.idle(now)) this.rooms.delete(id);
    }
  }

  start() {
    if (!ratings.enabled) return;
    const timer = setInterval(() => this.sweep().catch(err => console.error('correspondence sweep failed', err)), SWEEP_MS);
    timer.unref();
  }
}

module.exports = { CorrespondenceStore, CorrespondenceRoom, newDraft, db };
