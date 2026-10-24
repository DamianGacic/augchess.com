// Self-check for ranked rooms: node server/ranked.test.js (stubs Supabase).
'use strict';
const assert = require('assert');
const ratings = require('./ratings.js');
const { GameRoom } = require('./rooms.js');

const users = { tokA: 'user-a', tokB: 'user-b' };
ratings.verifyUser = async (t) => users[t] || null;
const recorded = [];
ratings.recordRatedGame = async (w, b, s) => { recorded.push([w, b, s]); return { w: { rating: 1220, delta: 20 }, b: { rating: 1180, delta: -20 } }; };

const sock = () => { const ws = { OPEN: 1, readyState: 1, sent: [], send(m) { ws.sent.push(JSON.parse(m)); } }; return ws; };

(async () => {
  const room = new GameRoom('t', { ranked: true });
  const a = sock(), b = sock(), guest = sock(), a2 = sock();
  assert.deepStrictEqual(room.join(a), { color: null, token: null }, 'ranked rooms seat nobody on connect');
  room.join(b); room.join(guest); room.join(a2);

  assert.strictEqual((await room.authenticate(a, 'tokA')).color, 'w');
  assert.strictEqual(await room.authenticate(guest, 'bogus'), null);
  assert.strictEqual(guest.sent.at(-1).type, 'actionRejected', 'bad token is told to sign in');
  assert.strictEqual((await room.authenticate(a2, 'tokA')).color, 'w', 'same account reclaims its seat, never takes both');
  assert.strictEqual((await room.authenticate(b, 'tokB')).color, 'b');

  room.state.phase = 'playing';
  room.state.gameOver = true;
  room.state.gameOverText = '♛ Black wins by checkmate!';
  room.broadcast();
  room.broadcast();
  await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(recorded, [['user-a', 'user-b', 0]], 'recorded exactly once, Black won');
  assert.ok(b.sent.some(m => m.type === 'rating' && m.b.delta === -20), 'players get the new ratings');

  room.state.gameOver = false; room.broadcast(); // next game starts
  room.state.gameOver = true; room.state.gameOverText = 'Draw — Stalemate'; room.broadcast();
  await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(recorded[1], ['user-a', 'user-b', 0.5], 'a rematch is rated too');

  const casual = new GameRoom('c');
  assert.strictEqual(casual.join(sock()).color, 'w', 'casual rooms seat on connect as before');
  console.log('ranked rooms ok');
})().catch((e) => { console.error(e); process.exit(1); });
