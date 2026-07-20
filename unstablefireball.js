/**
 * unstablefireball.js — Client-local single-target line-of-sight targeting UI
 * for Unstable Fireball. Resolves in a single dispatch once the target
 * square is chosen — nothing is sent to the engine until then, so all of the
 * state here (pendingUnstableFireball/unstableFireballTargeting/...) is
 * purely local preview UI. See engine/augments-engine.js castUnstableFireball
 * for the actual rules (including the random outcome).
 */

// ─── Unstable Fireball UI-only state (never touches the server) ───────────────
let pendingUnstableFireball = null;     // { color, apprenticeSq } — targeting a strike 2 squares ahead
let unstableFireballTargeting = false;  // true while picking the target square
let unstableFireballHoverSq = null;     // square currently previewed while hovering

function beginUnstableFireballTargeting(apprenticeSq, color) {
  pendingUnstableFireball = { color, apprenticeSq };
  unstableFireballTargeting = true;
  unstableFireballHoverSq = null;
  document.addEventListener('mousemove', onUnstableFireballMouseMove);
  document.addEventListener('touchmove', onUnstableFireballTouchMove, { passive: false });
  renderBoard();
}

function stopUnstableFireballTargeting() {
  unstableFireballTargeting = false;
  unstableFireballHoverSq = null;
  document.removeEventListener('mousemove', onUnstableFireballMouseMove);
  document.removeEventListener('touchmove', onUnstableFireballTouchMove);
}

function onUnstableFireballMouseMove(e) {
  updateUnstableFireballPreview(e.clientX, e.clientY);
}
function onUnstableFireballTouchMove(e) {
  if (e.touches.length) updateUnstableFireballPreview(e.touches[0].clientX, e.touches[0].clientY);
}

function updateUnstableFireballPreview(x, y) {
  if (!unstableFireballTargeting || !pendingUnstableFireball) return;
  const el = document.elementFromPoint(x, y);
  const sqEl = el ? el.closest('.square') : null;
  const hoveredSq = sqEl ? sqEl.dataset.square : null;
  const validTargets = getFireballTargets(state, pendingUnstableFireball.apprenticeSq, pendingUnstableFireball.color);
  const best = hoveredSq && validTargets.includes(hoveredSq) ? hoveredSq : null;
  if (best === unstableFireballHoverSq) return;
  unstableFireballHoverSq = best;
  renderBoard();
}

// Cast at the given target square — dispatches the actual engine action.
function applyUnstableFireballToTarget(targetSq) {
  const { apprenticeSq } = pendingUnstableFireball;
  stopUnstableFireballTargeting();
  pendingUnstableFireball = null;
  dispatch({ type: 'castAbility', id: 'unstableFireball', unitSq: apprenticeSq, center: targetSq });
}

// Cancel an in-progress targeting (Esc/Backspace) — nothing has been sent to
// the engine yet, so this is a pure no-op cancellation.
function cancelUnstableFireballTargeting() {
  if (!unstableFireballTargeting) return;
  pendingUnstableFireball = null;
  stopUnstableFireballTargeting();
  renderBoard();
}
