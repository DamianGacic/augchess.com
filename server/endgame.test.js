// Self-check for forfeits and agreed draws: node server/endgame.test.js
'use strict';
const assert = require('assert');
const engine = require('../engine/index.js');
const chessEngine = require('../engine/chess-engine.js');
const clockEngine = require('../engine/clock-engine.js');

function liveGame() {
  const state = engine.createRoomState();
  state.phase = 'playing';
  chessEngine.newGame(state);
  clockEngine.initClock(state);
  return state;
}

let s = liveGame();
assert.strictEqual(engine.applyAction(s, 'w', { type: 'resign' }), null);
assert.ok(s.gameOver && /^🏳 Black wins/.test(s.gameOverText), s.gameOverText);
assert.strictEqual(engine.applyAction(s, 'b', { type: 'move', from: 'e7', to: 'e5' }), 'Game is over');
assert.strictEqual(engine.applyAction(s, 'b', { type: 'resign' }), 'Game is over');

s = liveGame();
assert.strictEqual(engine.applyAction(s, 'w', { type: 'answerDraw', accept: true }), 'No draw offer to answer');
assert.strictEqual(engine.applyAction(s, 'w', { type: 'offerDraw' }), null);
assert.strictEqual(engine.applyAction(s, 'w', { type: 'answerDraw', accept: true }), 'No draw offer to answer', "can't accept your own offer");
assert.strictEqual(engine.applyAction(s, 'b', { type: 'answerDraw', accept: false }), null);
assert.ok(!s.drawOffer && !s.gameOver, 'declined');
engine.applyAction(s, 'w', { type: 'offerDraw' });
assert.strictEqual(engine.applyAction(s, 'w', { type: 'move', from: 'e2', to: 'e4' }), null);
assert.strictEqual(s.drawOffer, 'w', 'offer survives the offerer moving');
assert.strictEqual(engine.applyAction(s, 'b', { type: 'move', from: 'e7', to: 'e5' }), null);
assert.strictEqual(s.drawOffer, null, 'opponent moving instead lapses it');
engine.applyAction(s, 'b', { type: 'offerDraw' });
assert.strictEqual(engine.applyAction(s, 'w', { type: 'answerDraw', accept: true }), null);
assert.ok(s.gameOver && /^Draw/.test(s.gameOverText), 'agreed draw reads as a draw for ranked scoring');
console.log('endgame ok');
