/**
 * clubbing.js — Client-local quadrant-targeting UI for the Troll's Clubbing
 * ability. Same single-dispatch shape as Solar Strike (no arming step — see
 * solarstrike.js's file header) but targets a 2×2 quadrant, aimed the same
 * sliding way as Stunlock, that lies orthogonally next to the Troll's own
 * square — never one containing that square, never a diagonal one. See
 * engine/augments-engine.js getClubbingQuadrants/castClubbing for the
 * actual rules.
 */

// ─── Clubbing UI-only state (never touches the server) ─────────────────────
let pendingClubbing = null;   // { color, trollSq }
let clubbingTargeting = false;
let clubbingHoverQuad = null; // { f, r } — quadrant corner currently previewed while hovering

function beginClubbingTargeting(trollSq, color) {
  pendingClubbing = { color, trollSq };
  clubbingTargeting = true;
  clubbingHoverQuad = null;
  document.addEventListener('mousemove', onClubbingMouseMove);
  document.addEventListener('touchmove', onClubbingTouchMove, { passive: false });
  renderBoard();
}

function stopClubbingTargeting() {
  clubbingTargeting = false;
  clubbingHoverQuad = null;
  document.removeEventListener('mousemove', onClubbingMouseMove);
  document.removeEventListener('touchmove', onClubbingTouchMove);
}

function onClubbingMouseMove(e) {
  updateClubbingPreview(e.clientX, e.clientY);
}
function onClubbingTouchMove(e) {
  if (e.touches.length) updateClubbingPreview(e.touches[0].clientX, e.touches[0].clientY);
}

function updateClubbingPreview(x, y) {
  if (!clubbingTargeting || !pendingClubbing) return;
  const el = document.elementFromPoint(x, y);
  const sqEl = el ? el.closest('.square') : null;
  const hoveredSq = sqEl ? sqEl.dataset.square : null;
  const validQuads = getClubbingQuadrants(pendingClubbing.trollSq);
  let best = null;
  if (hoveredSq) {
    best = validQuads.find(({ f, r }) => quadrantSquares(f, r).includes(hoveredSq)) || null;
  }
  const same = best && clubbingHoverQuad && best.f === clubbingHoverQuad.f && best.r === clubbingHoverQuad.r;
  if (same) return;
  clubbingHoverQuad = best;
  renderBoard();
}

// Cast at the given quadrant corner — dispatches the actual engine action.
function applyClubbingToQuadrant(f, r) {
  const { trollSq } = pendingClubbing;
  stopClubbingTargeting();
  pendingClubbing = null;
  dispatch({ type: 'castAbility', id: 'clubbing', unitSq: trollSq, quadrant: frToSq(f, r) });
}

// Cancel an in-progress targeting (Esc/Backspace) — nothing has been sent to
// the engine yet, so this is a pure no-op cancellation.
function cancelClubbingTargeting() {
  if (!clubbingTargeting) return;
  pendingClubbing = null;
  stopClubbingTargeting();
  renderBoard();
}
