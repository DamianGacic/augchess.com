/**
 * clock.js — Chess clock display. The clock itself lives in room state
 * (`state.clock`, see engine/clock-engine.js): the server enforces it for
 * networked games and the engine's applyAction does for hotseat. This file
 * only draws it, computing the running side's time from timestamps so a
 * throttled background tab or a page reload never shows the wrong time.
 * Depends on: `state`, `netMode`, `renderAll` (app.js), DOM refs
 * (clockWhiteEl, clockBlackEl — app.js), clockRemaining/tickClock
 * (engine/clock-engine.js).
 */

// ─── Clock State ──────────────────────────────────────────────────────────────
// Server time minus local time, from the last networked state message —
// state.clock's timestamps are the server's. Always 0 in hotseat.
let clockOffset = 0;
let clockDisplayTimer = null;
const LOW_TIME_MS = 30 * 1000;

// ─── Clock Functions ──────────────────────────────────────────────────────────
function noteServerTime(serverNow) {
  clockOffset = typeof serverNow === 'number' ? serverNow - Date.now() : 0;
}

function formatTime(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderClocks() {
  const clock = state.phase === 'playing' ? state.clock : null;
  const now = Date.now() + (netMode ? clockOffset : 0);

  // Hotseat: this browser is the authority, so it calls the flag itself.
  // (Networked: the server does, and its state message ends the game here.)
  if (!netMode && clock && clock.running && !state.gameOver &&
      clockRemaining(state, clock.running, now) <= 0 && tickClock(state, now)) {
    renderAll();
    return;
  }

  ['w', 'b'].forEach(color => {
    const el = color === 'w' ? clockWhiteEl : clockBlackEl;
    const ms = clock ? clockRemaining(state, color, now) : state.settings.minutes * 60 * 1000;
    el.textContent = formatTime(ms);
    el.classList.toggle('active', !!clock && clock.running === color && !state.gameOver);
    el.classList.toggle('low-time', !!clock && ms <= LOW_TIME_MS && ms > 0);
  });
}

// Called on every render: redraw now, and keep redrawing only while some
// side's time is actually running.
function syncClock() {
  renderClocks();
  const clock = state.phase === 'playing' ? state.clock : null;
  const running = !!(clock && clock.running && !state.gameOver);
  if (running && !clockDisplayTimer) clockDisplayTimer = setInterval(renderClocks, 200);
  if (!running && clockDisplayTimer) { clearInterval(clockDisplayTimer); clockDisplayTimer = null; }
}
