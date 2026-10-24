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

class GameRoom {
  constructor(id) {
    this.id = id;
    this.state = engine.createRoomState();
    this.seats = { w: null, b: null }; // { socket, token } | null
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
    const payload = JSON.stringify({ type: 'chat', ...msg });
    for (const sock of [this.seats.w && this.seats.w.socket, this.seats.b && this.seats.b.socket, ...this.spectators]) {
      if (sock && sock.readyState === sock.OPEN) sock.send(payload);
    }
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
  }

  sendState(ws) {
    if (ws.readyState === ws.OPEN) ws.send(this.statePayload());
  }

  sendRejection(ws, reason) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'actionRejected', reason }));
  }

  // First connection to a fresh room is White, second is Black, everyone
  // after that is a read-only spectator. Returns the assignment.
  join(ws) {
    for (const color of ['w', 'b']) {
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

  create() {
    let id;
    do { id = crypto.randomBytes(6).toString('hex'); } while (this.rooms.has(id));
    const room = new GameRoom(id);
    this.rooms.set(id, room);
    return room;
  }

  get(id) {
    return this.rooms.get(id);
  }
}

module.exports = { RoomStore, GameRoom };
