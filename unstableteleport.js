/**
 * unstableteleport.js — Client-local free-square targeting UI for Unstable
 * Teleport. Resolves in a single dispatch once the target square is chosen —
 * nothing is sent to the engine until then, so all of the state here
 * (pendingUnstableTeleport/unstableTeleportTargeting/...) is purely local
 * preview UI. See engine/augments-engine.js castUnstableTeleport for the
 * actual rules (including the random outcome).
 */

// ─── Unstable Teleport UI-only state (never touches the server) ───────────────
let pendingUnstableTeleport = null;     // { color, apprenticeSq } — targeting a teleport
let unstableTeleportTargeting = false;  // true while picking the target square
let unstableTeleportHoverSq = null;     // square currently previewed while hovering

function beginUnstableTeleportTargeting(apprenticeSq, color) {
  pendingUnstableTeleport = { color, apprenticeSq };
  unstableTeleportTargeting = true;
  unstableTeleportHoverSq = null;
  document.addEventListener('mousemove', onUnstableTeleportMouseMove);
  document.addEventListener('touchmove', onUnstableTeleportTouchMove, { passive: false });
  renderBoard();
}

function stopUnstableTeleportTargeting() {
  unstableTeleportTargeting = false;
  unstableTeleportHoverSq = null;
  document.removeEventListener('mousemove', onUnstableTeleportMouseMove);
  document.removeEventListener('touchmove', onUnstableTeleportTouchMove);
}

function onUnstableTeleportMouseMove(e) {
  updateUnstableTeleportPreview(e.clientX, e.clientY);
}
function onUnstableTeleportTouchMove(e) {
  if (e.touches.length) updateUnstableTeleportPreview(e.touches[0].clientX, e.touches[0].clientY);
}

function updateUnstableTeleportPreview(x, y) {
  if (!unstableTeleportTargeting || !pendingUnstableTeleport) return;
  const el = document.elementFromPoint(x, y);
  const sqEl = el ? el.closest('.square') : null;
  const hoveredSq = sqEl ? sqEl.dataset.square : null;
  const validTargets = getTeleportTargets(state, pendingUnstableTeleport.color);
  const best = hoveredSq && validTargets.includes(hoveredSq) ? hoveredSq : null;
  if (best === unstableTeleportHoverSq) return;
  unstableTeleportHoverSq = best;
  renderBoard();
}

// Cast at the given target square — dispatches the actual engine action.
function applyUnstableTeleportToTarget(targetSq) {
  const { apprenticeSq } = pendingUnstableTeleport;
  stopUnstableTeleportTargeting();
  pendingUnstableTeleport = null;
  dispatch({ type: 'castAbility', id: 'unstableTeleport', unitSq: apprenticeSq, center: targetSq });
}

// Cancel an in-progress targeting (Esc/Backspace) — nothing has been sent to
// the engine yet, so this is a pure no-op cancellation.
function cancelUnstableTeleportTargeting() {
  if (!unstableTeleportTargeting) return;
  pendingUnstableTeleport = null;
  stopUnstableTeleportTargeting();
  renderBoard();
}
