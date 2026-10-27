// Self-check for ranked rooms + matchmaking: node server/ranked.test.js (stubs Supabase).
'use strict';
const assert = require('assert');
const ratings = require('./ratings.js');
const { GameRoom, RoomStore } = require('./rooms.js');
const { Matchmaker, ratingWindow } = require('./matchmaking.js');

const users = { tokA: 'user-a', tokB: 'user-b' };
ratings.verifyUser = async (t) => users[t] || null;
const recorded = [];
ratings.recordGame = async (g) => { recorded.push([g.white_id, g.black_id, g.result]); return { w: { rating: 1220, delta: 20 }, b: { rating: 1180, delta: -20 } }; };

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
  room.state.moveLog = [];
  room.state.gameOver = true;
  room.state.gameOverText = '♛ Black wins by checkmate!';
  room.broadcast();
  room.broadcast();
  await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(recorded, [['user-a', 'user-b', 'b']], 'recorded exactly once, Black won');
  assert.ok(b.sent.some(m => m.type === 'rating' && m.b.delta === -20), 'players get the new ratings');

  room.state.gameOver = false; room.broadcast(); // next game starts
  room.state.gameOver = true; room.state.gameOverText = 'Draw — Stalemate'; room.broadcast();
  await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(recorded[1], ['user-a', 'user-b', 'draw'], 'a rematch is rated too');

  const casual = new GameRoom('c');
  const cw = sock();
  assert.strictEqual(casual.join(cw).color, 'w', 'casual rooms seat on connect as before');
  casual.join(sock());
  assert.strictEqual(await casual.authenticate(cw, 'tokA'), null, 'casual auth never moves a seat');
  casual.state.phase = 'playing';
  casual.state.moveLog = [];
  casual.broadcast(); casual.broadcast();
  casual.state.turnNumber = 2; casual.broadcast();
  assert.strictEqual(casual.frames.length, 2, 'one frame per change, repeats skipped');
  casual.state.gameOver = true; casual.state.gameOverText = '🏳 White wins — Black forfeited!'; casual.broadcast();
  await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(recorded[2], ['user-a', null, 'w'], 'casual games go into the history, guests as null');
  console.log('ranked rooms ok');

  // ─── Matchmaking ───
  ratings.enabled = true; // Matchmaker reads this property, so the stub can flip it
  const ratingOf = { u1: 1200, u2: 1900, u3: 1250 };
  ratings.verifyUser = async (t) => t;
  ratings.getRating = async (id) => ratingOf[id];
  ratings.gamesPlayed = async (id) => (id === 'newbie' ? 3 : 10);
  const store = new RoomStore();
  const mm = new Matchmaker(store);
  const last = (ws) => ws.sent.at(-1);

  const c1 = sock(), c2 = sock();
  await mm.add(c1, { mode: 'casual' });
  assert.strictEqual(last(c1).type, 'queued', 'alone in casual: keeps searching');
  await mm.add(c2, { mode: 'casual' });
  assert.strictEqual(last(c1).type, 'matched');
  assert.strictEqual(last(c1).gameId, last(c2).gameId, 'casual: first come, first served');
  assert.strictEqual(store.get(last(c1).gameId).ranked, false);

  const r1 = sock(), r2 = sock(), r3 = sock(), anon = sock();
  await mm.add(anon, { mode: 'ranked' });
  assert.strictEqual(last(anon).type, 'queueError', 'ranked needs an account');
  const newbie = sock();
  ratingOf.newbie = 1200;
  await mm.add(newbie, { mode: 'ranked', accessToken: 'newbie' });
  assert.ok(last(newbie).type === 'queueError' && /3/.test(last(newbie).reason), 'ranked needs UNLOCK_GAMES games first');
  await mm.add(r1, { mode: 'ranked', accessToken: 'u1' });
  await mm.add(r2, { mode: 'ranked', accessToken: 'u2' });
  assert.strictEqual(last(r1).type, 'queued', '700 apart: not matched right away');
  await mm.add(r3, { mode: 'ranked', accessToken: 'u3' });
  assert.strictEqual(last(r1).type, 'matched', '1200 meets 1250');
  assert.strictEqual(last(r3).gameId, last(r1).gameId);
  const matched = store.get(last(r1).gameId);
  assert.ok(matched.ranked);
  assert.deepStrictEqual(Object.values(matched.reserved).sort(), ['u1', 'u3'], 'seats reserved for the matched pair');
  assert.strictEqual(await matched.authenticate(sock(), 'u2'), null, 'nobody else can take a reserved seat');

  mm.ranked[0].since -= 60000; // u2 has now waited a minute: window ±700
  assert.ok(ratingWindow(mm.ranked[0], Date.now()) >= 700);
  const r4 = sock();
  ratingOf.u4 = 1250;
  await mm.add(r4, { mode: 'ranked', accessToken: 'u4' });
  assert.strictEqual(last(r2).type, 'matched', 'a long wait widens the window');

  const t1 = sock(), t2 = sock();
  await mm.add(t1, { mode: 'ranked', accessToken: 'u1' });
  await mm.add(t2, { mode: 'ranked', accessToken: 'u1' });
  assert.strictEqual(last(t1).type, 'queueError', 'a second tab replaces the first');
  assert.strictEqual(mm.ranked.length, 1, 'and never plays itself');
  console.log('matchmaking ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
