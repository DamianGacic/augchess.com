/**
 * engine/clock-engine.js — The authoritative game clock. Lives in room state
 * (`state.clock`) so the server enforces it for networked play and the
 * browser's own applyAction enforces it for hotseat — the display in
 * clock.js only ever reads it.
 *
 * state.clock = {
 *   w, b:     ms each side had left as of `since`,
 *   running:  'w' | 'b' | null — whose time is currently being spent,
 *   since:    epoch ms the running side's time was last charged up to,
 * }
 *
 * Time is charged from timestamps rather than counted in ticks, so a
 * throttled/backgrounded tab, a page reload or a slow network can't change
 * how much time anyone has. The running side only switches when a turn
 * genuinely settles (afterTurnSettles in engine/index.js), so a turn held
 * open by a pending Stunlock target, Swift step or Raise the Dead session
 * keeps charging the player who is still resolving it.
 *
 * Same dual browser-<script>/Node-require shape as the other engine files.
 * Depends on: engine/chess-engine.js.
 */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const chessEngine = isNode ? require('./chess-engine.js') : root;

  // Clocks start once both players have had their first turn (an opening
  // Vanguard deployment doesn't count — it happens on free time).
  const CLOCK_START_TURN = 2;

  function initClock(state) {
    const ms = state.settings.minutes * 60 * 1000;
    state.clock = { w: ms, b: ms, running: null, since: null };
    state.timeForfeit = null;
  }

  // Ms `color` has left at `now` (only the running side is actually ticking).
  function clockRemaining(state, color, now) {
    const clock = state.clock;
    if (!clock) return 0;
    if (clock.running !== color) return clock[color];
    return Math.max(0, clock[color] - (now - clock.since));
  }

  // Charges the running side for time spent up to `now`. If that runs it
  // out, the game ends on time right here. Returns true only when this call
  // is what ended the game.
  function tickClock(state, now) {
    const clock = state.clock;
    if (!clock || !clock.running || state.gameOver) return false;
    const color = clock.running;
    clock[color] = clockRemaining(state, color, now);
    clock.since = now;
    if (clock[color] > 0) return false;
    clock.running = null;
    flagFall(state, color);
    return true;
  }

  function flagFall(state, loser) {
    const winner = loser === 'w' ? 'Black' : 'White';
    state.gameOver = true;
    state.gameOverText = `⏱ ${winner} wins on time!`;
    // Sticky marker: evaluateGameOver must never re-open a game lost on time.
    state.timeForfeit = loser;
    chessEngine.logEntry(state, null, '#', `${winner} wins on time!`, 'event');
  }

  // Called as a turn settles: the side now to move starts spending time
  // (or the clock stops for good, if that turn ended the game).
  function switchClockTurn(state, now) {
    const clock = state.clock;
    if (!clock) return;
    if (state.gameOver) { clock.running = null; return; }
    if ((state.turnNumber || 0) < CLOCK_START_TURN) return;
    clock.running = state.game.turn();
    clock.since = now;
  }

  const exportsObj = { initClock, clockRemaining, tickClock, switchClockTurn };

  if (isNode) {
    module.exports = exportsObj;
  } else {
    Object.assign(root, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
