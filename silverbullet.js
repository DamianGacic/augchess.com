/**
 * silverbullet.js — Client-local straight/diagonal-line targeting UI for
 * Silver Bullet. Resolves in a single dispatch once a target square is
 * chosen — nothing is sent to the engine until then, so all of the state
 * here (pendingSilverBullet/silverBulletTargeting/...) is purely local
 * preview UI. See engine/augments-engine.js castSilverBullet for the
 * actual rules.
 */

// ─── Silver Bullet UI-only state (never touches the server) ───────────────────
let pendingSilverBullet = null;     // { color, kingSq } — targeting a line-of-sight strike
let silverBulletTargeting = false;  // true while picking the target square
let silverBulletHoverSq = null;     // square currently previewed while hovering

function beginSilverBulletTargeting(kingSq, color) {
  pendingSilverBullet = { color, kingSq };
  silverBulletTargeting = true;
  silverBulletHoverSq = null;
  document.addEventListener('mousemove', onSilverBulletMouseMove);
  document.addEventListener('touchmove', onSilverBulletTouchMove, { passive: false });
  renderBoard();
}

function stopSilverBulletTargeting() {
  silverBulletTargeting = false;
  silverBulletHoverSq = null;
  document.removeEventListener('mousemove', onSilverBulletMouseMove);
  document.removeEventListener('touchmove', onSilverBulletTouchMove);
}

function onSilverBulletMouseMove(e) {
  updateSilverBulletPreview(e.clientX, e.clientY);
}
function onSilverBulletTouchMove(e) {
  if (e.touches.length) updateSilverBulletPreview(e.touches[0].clientX, e.touches[0].clientY);
}

function updateSilverBulletPreview(x, y) {
  if (!silverBulletTargeting || !pendingSilverBullet) return;
  const el = document.elementFromPoint(x, y);
  const sqEl = el ? el.closest('.square') : null;
  const hoveredSq = sqEl ? sqEl.dataset.square : null;
  const validTargets = getSilverBulletTargets(state, pendingSilverBullet.kingSq, pendingSilverBullet.color);
  const best = hoveredSq && validTargets.includes(hoveredSq) ? hoveredSq : null;
  if (best === silverBulletHoverSq) return;
  silverBulletHoverSq = best;
  renderBoard();
}

// Cast at the given target square — dispatches the actual engine action.
function applySilverBulletToTarget(targetSq) {
  const { kingSq } = pendingSilverBullet;
  stopSilverBulletTargeting();
  pendingSilverBullet = null;
  dispatch({ type: 'castAbility', id: 'silverBullet', unitSq: kingSq, center: targetSq });
}

// Cancel an in-progress targeting (Esc/Backspace) — nothing has been sent to
// the engine yet, so this is a pure no-op cancellation.
function cancelSilverBulletTargeting() {
  if (!silverBulletTargeting) return;
  pendingSilverBullet = null;
  stopSilverBulletTargeting();
  renderBoard();
}
