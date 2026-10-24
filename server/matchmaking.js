/**
 * server/matchmaking.js — The "Play Online" / "Play Ranked" queues, over
 * `/ws/queue`. A client sends {type:'queue', mode:'casual'|'ranked',
 * accessToken?} and waits; when paired, both get {type:'matched', gameId}
 * and join that room like any game link. Closing the socket leaves the queue.
 *   casual  first come, first served; no account needed
 *   ranked  signed-in accounts only, paired by closest rating within a
 *           window that widens the longer someone waits, so two players far
 *           apart still meet eventually when nobody else is around
 * Server -> client otherwise: {type:'queued', rating?}, {type:'queueError', reason}.
 *
 * ponytail: in-memory, single process (like RoomStore); a shared queue is
 * needed once this runs on more than one instance.
 */
'use strict';

const ratings = require('./ratings.js');

// Rating gap accepted for a player who has waited `ms`: ±100 at once,
// +100 more every 10s (so ±400 after 30s).
const BASE_WINDOW = 100;
const WINDOW_GROWTH_PER_10S = 100;
const RANKED_SWEEP_MS = 2000;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function ratingWindow(entry, now) {
  return BASE_WINDOW + WINDOW_GROWTH_PER_10S * Math.floor((now - entry.since) / 10000);
}

class Matchmaker {
  constructor(store) {
    this.store = store;
    this.casual = [];  // [ws]
    this.ranked = [];  // [{ ws, userId, rating, since }], oldest first
    setInterval(() => this.matchRanked(), RANKED_SWEEP_MS).unref();
  }

  async add(ws, msg) {
    this.remove(ws);
    if (msg.mode === 'ranked') return this.addRanked(ws, msg.accessToken);

    const opponent = this.casual.shift();
    if (opponent) this.start([opponent, ws], false);
    else { this.casual.push(ws); send(ws, { type: 'queued' }); }
  }

  async addRanked(ws, accessToken) {
    if (!ratings.enabled) return send(ws, { type: 'queueError', reason: 'Ranked games are not set up on this server' });
    const userId = await ratings.verifyUser(accessToken);
    if (!userId) return send(ws, { type: 'queueError', reason: 'Sign in to play ranked games' });
    let rating;
    try { rating = await ratings.getRating(userId); } catch (err) {
      console.error('matchmaking: getRating failed', err);
      return send(ws, { type: 'queueError', reason: 'Could not load your rating — try again' });
    }
    if (ws.readyState !== ws.OPEN) return;
    // The same account searching from a second tab replaces the first.
    for (const old of this.ranked.filter(e => e.userId === userId)) {
      send(old.ws, { type: 'queueError', reason: 'You started searching in another tab' });
      this.remove(old.ws);
    }
    this.ranked.push({ ws, userId, rating, since: Date.now() });
    send(ws, { type: 'queued', rating });
    this.matchRanked();
  }

  remove(ws) {
    this.casual = this.casual.filter(s => s !== ws);
    this.ranked = this.ranked.filter(e => e.ws !== ws);
  }

  // Longest waiter first: pair them with the closest-rated player inside the
  // longer waiter's window.
  matchRanked() {
    const now = Date.now();
    for (let i = 0; i < this.ranked.length; i++) {
      const a = this.ranked[i];
      let best = null;
      for (const b of this.ranked.slice(i + 1)) {
        const gap = Math.abs(a.rating - b.rating);
        if (gap <= ratingWindow(a, now) && (!best || gap < Math.abs(a.rating - best.rating))) best = b;
      }
      if (best) {
        this.remove(a.ws);
        this.remove(best.ws);
        this.start([a, best], true);
        i = -1; // the list changed; start over
      }
    }
  }

  // Ranked colors are random and reserved per account (rooms.js authenticate);
  // casual players just take seats in the order they connect.
  start(players, ranked) {
    const room = this.store.create({ ranked });
    if (ranked) {
      const [w, b] = Math.random() < 0.5 ? players : [players[1], players[0]];
      room.reserved = { w: w.userId, b: b.userId };
    }
    for (const p of players) send(p.ws || p, { type: 'matched', gameId: room.id });
  }
}

module.exports = { Matchmaker, ratingWindow };
