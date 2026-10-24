/**
 * server/rooms.js — In-memory room store + the per-room orchestration that
 * turns incoming client actions into engine calls and broadcasts the result.
 *
 * Storage is deliberately behind RoomStore's tiny get/create interface so a
 * later swap to something shared (Redis, etc. — needed once this runs on more
 * than one process) doesn't touch the protocol or the engine.
 */
'use strict';

const crypto = require('crypto');
const engine = require('../engine/index.js');
const ratings = require('./ratings.js');

// Ranked result from the game-over text (the engine keeps no structured
// winner): 1 = White won, 0 = Black won, 0.5 = draw, null = unrecognized.
// ponytail: parses gameOverText, like app.js's 'Draw' check; add a
// state.winner to the engine if the wording ever stops following this.
function whiteScore(text) {
  if (/White wins/.test(text)) return 1;
  if (/Black wins/.test(text)) return 0;
  if (/^Draw/.test(text)) return 0.5;
  return null;
}

class GameRoom {
  // ranked: seats go only to signed-in players (claimed via authenticate),
  // and the finished game's result updates both players' ratings.
  constructor(id, { ranked = false } = {}) {
    this.id = id;
    this.ranked = ranked;
    this.rated = false; // the current game's result has been recorded
    this.state = engine.createRoomState();
    this.seats = { w: null, b: null }; // { socket, token, userId? } | null
    this.spectators = new Set();
    this.chat = []; // [{ color, text, at }], newest last, capped at CHAT_HISTORY
  }

  // Chat lives beside the game, not in engine state: a seated player's line
  // goes to everyone in the room (spectators read along but can't post).
  addChat(ws, text) {
    const meta = ws.augchess;
    if (!meta || !meta.color || typeof text !== 'string') return;
    text = text.trim().slice(0, CHAT_MAX_LENGTH);
    if (!text) return;
    const msg = { color: meta.color, text, at: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    this.send({ type: 'chat', ...msg });
  }

  // The whole backlog, sent on (re)join so a reloaded tab sees the conversation.
  sendChatHistory(ws) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'chatHistory', messages: this.chat }));
  }

  // Every state message carries the server's time so clients can show the
  // running clock against it rather than their own (possibly skewed) clock.
  statePayload() {
    return JSON.stringify({ type: 'state', state: engine.serializeState(this.state), now: Date.now() });
  }

  broadcast() {
    const payload = this.statePayload();
    for (const color of ['w', 'b']) {
      const seat = this.seats[color];
      if (seat && seat.socket && seat.socket.readyState === seat.socket.OPEN) {
        seat.socket.send(payload);
      }
    }
    for (const ws of this.spectators) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
    // Every state change goes out through here, so this is the one place a
    // ranked game can be seen ending (move, flag fall, Vanguard timeout).
    this.recordResult();
  }

  send(payload) {
    const json = JSON.stringify(payload);
    for (const sock of [this.seats.w && this.seats.w.socket, this.seats.b && this.seats.b.socket, ...this.spectators]) {
      if (sock && sock.readyState === sock.OPEN) sock.send(json);
    }
  }

  recordResult() {
    if (!this.state.gameOver) { this.rated = false; return; } // a new game is under way
    if (!this.ranked || this.rated || this.state.phase !== 'playing') return;
    const score = whiteScore(this.state.gameOverText);
    const w = this.seats.w && this.seats.w.userId;
    const b = this.seats.b && this.seats.b.userId;
    if (score === null || !w || !b) return;
    this.rated = true; // set before the await: never record one game twice
    ratings.recordRatedGame(w, b, score)
      .then(result => this.send({ type: 'rating', ...result }))
      .catch(err => console.error(`[room ${this.id}] recording rated game failed`, err));
  }

  sendState(ws) {
    if (ws.readyState === ws.OPEN) ws.send(this.statePayload());
  }

  sendRejection(ws, reason) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'actionRejected', reason }));
  }

  // First connection to a fresh room is White, second is Black, everyone
  // after that is a read-only spectator. Returns the assignment.
  // In a ranked room everyone starts out spectating; authenticate() seats them.
  join(ws) {
    for (const color of this.ranked ? [] : ['w', 'b']) {
      if (!this.seats[color]) {
        const token = crypto.randomBytes(16).toString('hex');
        this.seats[color] = { socket: ws, token };
        ws.augchess = { color, token };
        return { color, token };
      }
    }
    this.spectators.add(ws);
    ws.augchess = { color: null, token: null };
    return { color: null, token: null };
  }

  // A dropped player's seat stays reserved (state lives on the server, not on
  // the socket) — reconnecting with the same color+token reclaims it instead
  // of the reconnecting client becoming a new spectator.
  reconnect(ws, color, token) {
    const seat = this.seats[color === 'w' || color === 'b' ? color : null];
    if (!seat || seat.token !== token) return false;
    seat.socket = ws;
    ws.augchess = { color, token };
    return true;
  }

  // A ranked room's player proves who they are with their Supabase access
  // token; the first two different accounts get White then Black, and the
  // same account coming back (new tab, lost reconnect token) gets its seat
  // back. Resolves to the new assignment, or null if nothing changed.
  async authenticate(ws, accessToken) {
    if (!this.ranked || (ws.augchess && ws.augchess.color)) return null;
    const userId = await ratings.verifyUser(accessToken);
    if (!userId) { this.sendRejection(ws, 'Sign in to play ranked games'); return null; }
    if (ws.readyState !== ws.OPEN) return null;
    let color = ['w', 'b'].find(c => this.seats[c] && this.seats[c].userId === userId);
    if (color) {
      this.seats[color].socket = ws;
    } else {
      color = ['w', 'b'].find(c => !this.seats[c]);
      if (!color) return null; // both seats taken: stay a spectator
      this.seats[color] = { socket: ws, token: crypto.randomBytes(16).toString('hex'), userId };
    }
    this.spectators.delete(ws);
    const { token } = this.seats[color];
    ws.augchess = { color, token };
    return { color, token };
  }

  leave(ws) {
    this.spectators.delete(ws);
    for (const color of ['w', 'b']) {
      if (this.seats[color] && this.seats[color].socket === ws) this.seats[color].socket = null;
    }
  }

  // Dispatches one client action through the engine and broadcasts the
  // result, or sends a rejection back to just the sender if it was illegal.
  applyAction(ws, action) {
    const meta = ws.augchess;
    if (!meta || !meta.color) return; // spectators can't act; silently ignore
    if (!action || typeof action.type !== 'string') return;
    if (this.ranked && action.type === 'newGame' && this.state.phase === 'playing' && !this.state.gameOver) {
      this.sendRejection(ws, "A ranked game can't be restarted until it's over");
      return;
    }

    // A bug in one room's action handling must never take the whole process
    // (and every other room's players) down with it.
    const wasOver = this.state.gameOver;
    let error;
    try {
      error = engine.applyAction(this.state, meta.color, action);
    } catch (err) {
      console.error(`[room ${this.id}] engine error handling`, action, err);
      this.sendRejection(ws, 'Server error processing that action');
      return;
    }
    if (error) {
      this.sendRejection(ws, error);
      // A rejected action can still have changed what everyone sees: it
      // arrived after the sender's flag fell, which ended the game.
      if (this.state.gameOver !== wasOver) this.broadcast();
    } else {
      this.broadcast();
      this.watchVanguard();
    }
    this.watchClock();
  }

  // Ends the game on time the moment the running side's clock runs out,
  // whether or not that player ever sends anything again (closed tab,
  // dropped connection, just sitting there).
  watchClock() {
    clearTimeout(this.clockTimer);
    this.clockTimer = null;
    const clock = this.state.clock;
    if (!clock || !clock.running || this.state.gameOver) return;
    const left = engine.clockRemaining(this.state, clock.running, Date.now());
    this.clockTimer = setTimeout(() => {
      this.clockTimer = null;
      try {
        if (engine.tickClock(this.state, Date.now())) this.broadcast();
        else this.watchClock(); // fired a hair early — wait out the rest
      } catch (err) {
        console.error(`[room ${this.id}] clock timeout failed`, err);
      }
    }, left + CLOCK_GRACE_MS);
  }

  // The Vanguard owner's client deploys when its 30s run out; this is the
  // backstop if it never does (disconnected, tab closed) — after the time
  // plus a grace period the deployment resolves with nothing moved, so the
  // game can't hang waiting for it.
  watchVanguard() {
    const pending = this.state.vanguard;
    if (!pending) { clearTimeout(this.vanguardTimer); this.vanguardTimer = null; return; }
    if (this.vanguardTimer) return;
    this.vanguardTimer = setTimeout(() => {
      this.vanguardTimer = null;
      if (this.state.vanguard !== pending) return;
      try {
        if (!engine.applyAction(this.state, pending.color, { type: 'vanguardDeploy', placements: [] })) this.broadcast();
        this.watchClock();
      } catch (err) {
        console.error(`[room ${this.id}] vanguard timeout failed`, err);
      }
    }, pending.ms + VANGUARD_GRACE_MS);
  }
}

// Extra time the server waits past the Vanguard limit for the owner's own
// (client-timed) deployment to arrive before resolving it itself.
const VANGUARD_GRACE_MS = 5000;

// ponytail: no rate limit — the length and history caps bound memory, a
// spammer only annoys their own opponent. Add per-seat throttling if needed.
const CHAT_MAX_LENGTH = 300;
const CHAT_HISTORY = 100;

// setTimeout can fire a few ms before its deadline; this keeps the clock
// watcher from waking just short of the flag and having to re-arm.
const CLOCK_GRACE_MS = 20;

class RoomStore {
  constructor() {
    this.rooms = new Map();
  }

  create(options) {
    let id;
    do { id = crypto.randomBytes(6).toString('hex'); } while (this.rooms.has(id));
    const room = new GameRoom(id, options);
    this.rooms.set(id, room);
    return room;
  }

  get(id) {
    return this.rooms.get(id);
  }
}

module.exports = { RoomStore, GameRoom };
