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
 * Correspondence games (state.settings.days set) use the same clock as a
 * time bank of `days` per side: it starts with the draft rather than on
 * turn 2, and whoever has to act next (draft pick, Patchy Lines, Vanguard,
 * move) is the one spending time. See syncCorrespondenceClock.
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

  const DAY_MS = 24 * 60 * 60 * 1000;

  function isCorrespondence(state) {
    return !!(state.settings && state.settings.days);
  }

  // Each side's full allowance at the start of a game.
  function startingMs(state) {
    return isCorrespondence(state) ? state.settings.days * DAY_MS : state.settings.minutes * 60 * 1000;
  }

  // A correspondence game's bank already started with the draft: the board
  // being set up keeps it as it is.
  function initClock(state) {
    if (isCorrespondence(state) && state.clock) return;
    const ms = startingMs(state);
    state.clock = { w: ms, b: ms, running: null, since: null };
    state.timeForfeit = null;
  }

  // Correspondence: who has to do something before the game can go on, and
  // so whose bank is running. (Mid-turn holds — a pending Stunlock target,
  // Swift step, shield — keep the player who moved, via switchClockTurn
  // only switching once a turn settles.)
  function correspondenceActor(state) {
    if (state.gameOver) return null;
    if (state.phase === 'draft') return state.draftState ? state.draftState.current : null;
    if (state.phase !== 'playing' || !state.game) return null;
    if (state.patchy) return state.patchy.color;
    if (state.vanguard) return state.vanguard.color;
    return state.game.turn();
  }

  // Called after a draft action or a Patchy Lines / Vanguard window closing:
  // the bank of whoever acts next starts running. The previous runner was
  // already charged up to `now` (applyAction ticks the clock first).
  function syncCorrespondenceClock(state, now) {
    if (!isCorrespondence(state) || !state.clock) return;
    state.clock.running = correspondenceActor(state);
    state.clock.since = now;
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
    // A correspondence bank can run out mid-draft, before there is a board
    // (or a move list) to end the game on: set the board up with what each
    // side owns so far, and end it there.
    if (state.phase === 'draft') {
      state.augments = { w: [...state.draftState.owned.w], b: [...state.draftState.owned.b] };
      state.phase = 'playing';
      chessEngine.newGame(state);
    }
    state.patchy = null;
    state.vanguard = null;
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
    if (!isCorrespondence(state) && (state.turnNumber || 0) < CLOCK_START_TURN) return;
    clock.running = state.game.turn();
    clock.since = now;
  }

  const exportsObj = {
    DAY_MS, isCorrespondence, startingMs, initClock, clockRemaining, tickClock, switchClockTurn,
    correspondenceActor, syncCorrespondenceClock,
  };

  if (isNode) {
    module.exports = exportsObj;
  } else {
    Object.assign(root, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
