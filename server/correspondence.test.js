// Self-check for correspondence games: node server/correspondence.test.js
// (stubs Supabase with an in-memory table).
'use strict';
const assert = require('assert');
const ratings = require('./ratings.js');
const { CorrespondenceStore, db } = require('./correspondence.js');

const DAY = 86400000;
const ID = '11111111-2222-3333-4444-555555555555';
const users = { tokW: 'user-w', tokB: 'user-b', tokX: 'user-x' };
ratings.enabled = true;
ratings.verifyUser = async (t) => users[t] || null;
const recorded = [];
ratings.recordGame = async (g) => { recorded.push(g); return {}; };

// The database: one game row, its moves, save_correspondence_turn's checks.
const accepted = Date.now() - 1000;
let row = {
  id: ID, status: 'active', white_id: 'user-w', black_id: 'user-b', days: 1, points: 4,
  state: null, ply: 0, accepted_at: new Date(accepted).toISOString(),
  deadline: new Date(accepted + DAY).toISOString(),
};
const moves = [];
db.game = async (id) => (id === ID ? JSON.parse(JSON.stringify(row)) : null);
db.saveTurn = async (t) => {
  if (row.status !== 'active' || t.ply !== row.ply + 1) return false;
  row = { ...row, state: t.state, ply: t.ply, deadline: t.deadline, status: t.result ? 'finished' : row.status, result: t.result };
  moves.push(t);
  return true;
};
db.dueGameIds = async (now) => (row.status === 'active' && Date.parse(row.deadline) < now ? [ID] : []);
db.playedFrames = async () => moves.map(m => m.state).filter(s => s.phase === 'playing');

const sock = () => { const ws = { OPEN: 1, readyState: 1, sent: [], send(m) { ws.sent.push(JSON.parse(m)); }, close() { ws.closed = true; } }; return ws; };
const settle = () => new Promise(r => setTimeout(r, 10));

(async () => {
  let store = new CorrespondenceStore();
  assert.strictEqual(await store.load('not-a-uuid'), null);
  let room = await store.load(ID);
  assert.strictEqual(room.state.phase, 'draft', 'an accepted game opens on the draft');
  assert.strictEqual(room.state.clock.running, 'w', "White's bank runs from acceptance");
  assert.strictEqual(await store.load(ID), room, 'loaded once, then shared');

  const w = sock(), b = sock(), x = sock();
  for (const s of [w, b, x]) assert.strictEqual(room.join(s).color, null, 'nobody is seated on connect');
  assert.strictEqual((await room.authenticate(w, 'tokW')).color, 'w');
  assert.strictEqual((await room.authenticate(b, 'tokB')).color, 'b');
  assert.strictEqual(await room.authenticate(x, 'tokX'), null, 'a third account only watches');

  room.applyAction(b, { type: 'draftPass' });
  room.applyAction(w, { type: 'newGame' });
  await settle();
  assert.strictEqual(moves.length, 0, 'refused actions are not saved');
  assert.match(w.sent.at(-1).reason, /can't be restarted/);

  room.applyAction(w, { type: 'draftPass' });
  room.applyAction(b, { type: 'draftPass' });
  room.applyAction(w, { type: 'move', from: 'e2', to: 'e4' });
  await settle();
  assert.deepStrictEqual(moves.map(m => [m.ply, m.color, m.action.type]),
    [[1, 'w', 'draftPass'], [2, 'b', 'draftPass'], [3, 'w', 'move']]);
  assert.strictEqual(moves[2].turn, 'b');
  assert.ok(moves[2].log.length >= 1, 'the move-list lines are saved with the move');

  // A restart: a fresh store reloads the saved game and play goes on.
  store = new CorrespondenceStore();
  room = await store.load(ID);
  assert.strictEqual(room.state.game.fen().split(' ')[0], 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
  const b2 = sock();
  room.join(b2);
  await room.authenticate(b2, 'tokB');
  room.applyAction(b2, { type: 'move', from: 'e7', to: 'e5' });
  await settle();
  assert.strictEqual(row.ply, 4);

  // White sits on it for more than a day: the sweep ends the game on time.
  await store.sweep(Date.now() + 2 * DAY);
  await settle();
  assert.strictEqual(row.status, 'finished');
  assert.strictEqual(row.result, 'b');
  assert.strictEqual(moves.at(-1).action.type, 'timeout');
  assert.strictEqual(moves.at(-1).color, null);
  assert.strictEqual(recorded.length, 1, 'the finished game goes into the history');
  assert.strictEqual(recorded[0].mode, 'correspondence');
  assert.ok(recorded[0].frames.length >= 2);

  // A copy that drifted out of step with the database is dropped.
  row.ply = 99; row.status = 'active';
  room.state.gameOver = false;
  room.state.gameOverText = '';
  room.state.clock.running = 'w';
  room.state.clock.since = Date.now();
  room.state.clock.w = DAY;
  room.applyAction(b2, { type: 'resign' });
  await settle();
  assert.ok(b2.closed, 'clients are disconnected so they reload the saved game');
  assert.notStrictEqual(await store.load(ID), room);

  console.log('correspondence ok');
})().catch((err) => { console.error(err); process.exit(1); });
