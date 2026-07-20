/**
 * clock.js — Client-local chess clock. Purely cosmetic: each browser ticks
 * its own display down independently between server state updates, the same
 * way the plan's server-side clock enforcement was scoped out of this pass
 * (see the plan's "Explicitly deferred" section) — a flag-fall shown here is
 * a local-only guess, not authoritative, until the server tracks time itself.
 * Depends on: `state` (app.js), DOM refs (clockWhiteEl, clockBlackEl,
 * statusText, statusBox — app.js).
 */

// ─── Clock State ──────────────────────────────────────────────────────────────
let timeWhite = 0;
let timeBlack = 0;
let clockInterval = null;
let clockStarted = false;

// ─── Clock Functions ──────────────────────────────────────────────────────────
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderClocks() {
  clockWhiteEl.textContent = formatTime(timeWhite);
  clockBlackEl.textContent = formatTime(timeBlack);
}

function resetClockForNewGame() {
  stopClock();
  clockStarted = false;
  timeWhite = state.settings.minutes * 60;
  timeBlack = state.settings.minutes * 60;
  renderClocks();
  clockWhiteEl.classList.remove('active', 'low-time');
  clockBlackEl.classList.remove('active', 'low-time');
}

function startClock() {
  stopClock();
  clockInterval = setInterval(() => {
    const turn = state.game.turn();
    if (turn === 'w') timeWhite = Math.max(0, timeWhite - 1);
    else timeBlack = Math.max(0, timeBlack - 1);

    renderClocks();
    updateClockStyles();

    if (timeWhite === 0 || timeBlack === 0) {
      stopClock();
      const winner = timeWhite === 0 ? 'Black' : 'White';
      // Local-only flag-fall guess (see file header) — not written to `state`,
      // since only the server (networked) / engine.applyAction (hotseat) may
      // ever mutate real game state.
      statusText.textContent = `⏱ ${winner} wins on time!`;
      statusBox.className = 'status-box checkmate';
    }
  }, 1000);
}

function stopClock() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
}

function switchClock() { updateClockStyles(); }

function updateClockStyles() {
  if (!state.game) return;
  const turn = state.game.turn();
  const LOW_TIME = 30;
  clockWhiteEl.classList.toggle('active', turn === 'w' && clockStarted && !state.gameOver);
  clockBlackEl.classList.toggle('active', turn === 'b' && clockStarted && !state.gameOver);
  clockWhiteEl.classList.toggle('low-time', timeWhite <= LOW_TIME && timeWhite > 0);
  clockBlackEl.classList.toggle('low-time', timeBlack <= LOW_TIME && timeBlack > 0);
}
