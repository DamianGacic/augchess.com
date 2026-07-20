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
  }

  broadcast() {
    const payload = JSON.stringify({ type: 'state', state: engine.serializeState(this.state) });
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
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'state', state: engine.serializeState(this.state) }));
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
    let error;
    try {
      error = engine.applyAction(this.state, meta.color, action);
    } catch (err) {
      console.error(`[room ${this.id}] engine error handling`, action, err);
      this.sendRejection(ws, 'Server error processing that action');
      return;
    }
    if (error) this.sendRejection(ws, error);
    else this.broadcast();
  }
}

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
