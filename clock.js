/**
 * clock.js — Chess clock state and all timer functions.
 * Depends on: DOM refs (clockWhiteEl, clockBlackEl, statusText, statusBox),
 *             game state (game, gameOver, gameOverText) defined in app.js.
 */

// ─── Clock State ──────────────────────────────────────────────────────────────
let selectedMinutes = 3;
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

function startClock() {
  stopClock();
  clockInterval = setInterval(() => {
    const turn = game.turn();
    if (turn === 'w') timeWhite = Math.max(0, timeWhite - 1);
    else timeBlack = Math.max(0, timeBlack - 1);

    renderClocks();
    updateClockStyles();

    if (timeWhite === 0 || timeBlack === 0) {
      stopClock();
      const winner = timeWhite === 0 ? 'Black' : 'White';
      gameOver = true;
      gameOverText = `⏱ ${winner} wins on time!`;
      statusText.textContent = gameOverText;
      statusBox.className = 'status-box checkmate';
    }
  }, 1000);
}

function stopClock() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
}

function switchClock() { updateClockStyles(); }

function updateClockStyles() {
  const turn = game.turn();
  const LOW_TIME = 30;
  clockWhiteEl.classList.toggle('active', turn === 'w' && clockStarted && !gameOver);
  clockBlackEl.classList.toggle('active', turn === 'b' && clockStarted && !gameOver);
  clockWhiteEl.classList.toggle('low-time', timeWhite <= LOW_TIME && timeWhite > 0);
  clockBlackEl.classList.toggle('low-time', timeBlack <= LOW_TIME && timeBlack > 0);
}
