/**
 * solarstrike.js — Client-local 3×3-center targeting UI for Solar Strike.
 * Unlike Stunlock (armed before/during a move, cast resolves after it), Solar
 * Strike resolves in a single dispatch once a center square is chosen —
 * nothing is sent to the engine until then, so all of the state here
 * (pendingSolarStrike/solarStrikeTargeting/...) is purely local preview UI.
 * See engine/augments-engine.js castSolarStrike for the actual rules.
 */

// ─── Solar Strike UI-only state (never touches the server) ────────────────────
let pendingSolarStrike = null;     // { color, queenSq } — targeting a 3×3 center
let solarStrikeTargeting = false;  // true while picking the center square
let solarStrikeHoverCenter = null; // { f, r } — center currently previewed while hovering

function beginSolarStrikeTargeting(queenSq, color) {
  pendingSolarStrike = { color, queenSq };
  solarStrikeTargeting = true;
  solarStrikeHoverCenter = null;
  document.addEventListener('mousemove', onSolarStrikeMouseMove);
  document.addEventListener('touchmove', onSolarStrikeTouchMove, { passive: false });
  renderBoard();
}

function stopSolarStrikeTargeting() {
  solarStrikeTargeting = false;
  solarStrikeHoverCenter = null;
  document.removeEventListener('mousemove', onSolarStrikeMouseMove);
  document.removeEventListener('touchmove', onSolarStrikeTouchMove);
}

function onSolarStrikeMouseMove(e) {
  updateSolarStrikePreview(e.clientX, e.clientY);
}
function onSolarStrikeTouchMove(e) {
  if (e.touches.length) updateSolarStrikePreview(e.touches[0].clientX, e.touches[0].clientY);
}

function updateSolarStrikePreview(x, y) {
  if (!solarStrikeTargeting || !pendingSolarStrike) return;
  const el = document.elementFromPoint(x, y);
  const sqEl = el ? el.closest('.square') : null;
  const hoveredSq = sqEl ? sqEl.dataset.square : null;
  const validCenters = getSolarStrikeCenters(pendingSolarStrike.queenSq);
  let best = null;
  if (hoveredSq) {
    const { f: hf, r: hr } = sqToFR(hoveredSq);
    best = validCenters.reduce((a, b) => {
      const da = Math.abs(a.f - hf) + Math.abs(a.r - hr);
      const db = Math.abs(b.f - hf) + Math.abs(b.r - hr);
      return da <= db ? a : b;
    }, validCenters[0] || null);
  }
  const same = best && solarStrikeHoverCenter && best.f === solarStrikeHoverCenter.f && best.r === solarStrikeHoverCenter.r;
  if (same) return;
  solarStrikeHoverCenter = best;
  renderBoard();
}

// Cast at the given center — dispatches the actual engine action.
function applySolarStrikeToCenter(f, r) {
  const { queenSq } = pendingSolarStrike;
  stopSolarStrikeTargeting();
  pendingSolarStrike = null;
  dispatch({ type: 'castAbility', id: 'solarStrike', unitSq: queenSq, center: frToSq(f, r) });
}

// Cancel an in-progress targeting (Esc/Backspace) — nothing has been sent to
// the engine yet, so this is a pure no-op cancellation.
function cancelSolarStrikeTargeting() {
  if (!solarStrikeTargeting) return;
  pendingSolarStrike = null;
  stopSolarStrikeTargeting();
  renderBoard();
}
