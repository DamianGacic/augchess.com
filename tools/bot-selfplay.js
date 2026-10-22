#!/usr/bin/env node
/**
 * tools/bot-selfplay.js — Plays bot-vs-bot games through the real engine,
 * each with its own random draft, and fails on any action the engine
 * refuses, any exception, or a game that stalls. Run after changing the
 * bot or the rules:
 *   node tools/bot-selfplay.js [games=10] [points=14] [maxTurns=120]
 * Force a draft with DRAFT_W / DRAFT_B (comma-separated augment ids, picked
 * in order, then the side passes), e.g. DRAFT_W=solarStrike DRAFT_B=trolls.
 */

const engine = require('../engine/index.js');
const { botActor, chooseBotActions, evaluateForBot } = require('../engine/bot-engine.js');

const games = Number(process.argv[2] || 10);
const points = Number(process.argv[3] || 14);
const maxTurns = Number(process.argv[4] || 120);

let failures = 0;
const results = {};
let slowest = { ms: 0 };

for (let g = 1; g <= games; g++) {
  const state = engine.createRoomState();
  engine.applyAction(state, 'w', { type: 'settingsUpdate', minutes: 45, points });
  engine.applyAction(state, 'w', { type: 'settingsStart' });
  let error = null, decisions = 0;
  const forced = { w: process.env.DRAFT_W, b: process.env.DRAFT_B };
  if (forced.w !== undefined || forced.b !== undefined) {
    const queue = { w: (forced.w || '').split(',').filter(Boolean), b: (forced.b || '').split(',').filter(Boolean) };
    while (state.phase === 'draft') {
      const c = state.draftState.current;
      const id = queue[c].shift();
      const err = engine.applyAction(state, c, id ? { type: 'draftPick', augId: id } : { type: 'draftPass' });
      if (err) { error = `forced draft ${c} ${id}: ${err}`; break; }
    }
  }
  const used = new Set();
  try {
    while (!error && decisions < maxTurns * 4) {
      const color = botActor(state);
      if (!color) break;
      if (state.phase === 'playing' && (state.turnNumber || 0) >= maxTurns) break;
      const t0 = Date.now();
      const actions = chooseBotActions(state, color, { budgetMs: 1500 });
      const ms = Date.now() - t0;
      if (ms > slowest.ms) slowest = { ms, game: g, turn: state.turnNumber, actions };
      if (!actions.length) { error = `no actions for ${color}`; break; }
      for (const a of actions) {
        const err = engine.applyAction(state, color, a);
        if (err) { error = `${color} ${JSON.stringify(a)} refused: ${err}`; break; }
        if (a.type === 'castAbility' || a.type === 'armAbility') used.add(a.id || 'arm');
      }
      if (error) break;
      decisions++;
    }
  } catch (e) {
    error = 'exception: ' + (e.stack || e).toString().split('\n').slice(0, 4).join(' | ');
  }
  // A side should never get two turns in a row (follow-ups like a Swift
  // step are logged as events, not turns).
  const turns = (state.moveLog || []).filter(e => e.kind === 'turn');
  const twice = turns.findIndex((e, i) => i > 0 && e.color === turns[i - 1].color);
  if (!error && twice > 0) error = `${turns[twice].color} moved twice in a row: "${turns[twice - 1].text}" then "${turns[twice].text}"`;
  const outcome = state.gameOver ? state.gameOverText
    : `unfinished after ${state.turnNumber} turns (material for White ${state.game ? evaluateForBot(state, 'w').toFixed(1) : '?'})`;
  { const k = outcome.replace(/ [—(].*/, ''); results[k] = (results[k] || 0) + 1; }
  console.log(`${error ? '✗' : '✓'} game ${g}: W[${state.augments.w.join(',')}] B[${state.augments.b.join(',')}]`);
  console.log(`    ${outcome}; abilities used: ${[...used].join(', ') || 'none'}`);
  if (error) { console.log('    ' + error); failures++; }
  if (process.env.LOG) (state.moveLog || []).forEach(e => console.log(`      ${e.color || ' '} ${e.text}`));
}

console.log('\nOutcomes:', results);
console.log(`Slowest decision: ${slowest.ms} ms (game ${slowest.game}, turn ${slowest.turn}) ${JSON.stringify(slowest.actions)}`);
console.log(failures ? `\n${failures} game(s) failed.` : '\nAll games ran clean.');
process.exit(failures ? 1 : 0);
