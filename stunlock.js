/**
 * stunlock.js — Client-local quadrant-targeting UI for Stunlock. The actual
 * cast (validation + applying the freeze) happens in engine/augments-engine.js,
 * server-side for networked play or via dispatch() locally for hotseat — this
 * file only lets the player preview/pick a quadrant, then dispatches the cast.
 */

// ─── Stunlock UI-only state (never touches the server) ────────────────────────
let stunlockTargeting = false;   // true while player is picking the quadrant target
let stunlockHoverQuad = null;    // { f, r } — quadrant currently previewed while hovering

// Called by app.js's NetClient.onState/renderAll whenever a fresh state shows
// a pending cast that this client isn't already targeting for (e.g. right
// after our own armed bishop's move lands).
function syncStunlockTargeting() {
  if (state.pendingStunlock && state.pendingStunlock.color === currentActor() && !stunlockTargeting) {
    beginStunlockTargeting();
  } else if (!state.pendingStunlock && stunlockTargeting) {
    stopStunlockTargeting();
  }
}

function beginStunlockTargeting() {
  stunlockTargeting = true;
  stunlockHoverQuad = null;
  document.addEventListener('mousemove', onStunlockMouseMove);
  document.addEventListener('touchmove', onStunlockTouchMove, { passive: false });
}

function stopStunlockTargeting() {
  stunlockTargeting = false;
  stunlockHoverQuad = null;
  document.removeEventListener('mousemove', onStunlockMouseMove);
  document.removeEventListener('touchmove', onStunlockTouchMove);
}

// Apply the stunlock to the quadrant whose top-left is (f, r).
function applyStunlockToQuadrant(f, r) {
  stopStunlockTargeting();
  dispatch({ type: 'castAbility', id: 'stunlock', center: frToSq(f, r) });
}

function onStunlockMouseMove(e) {
  updateStunlockPreview(e.clientX, e.clientY);
}
function onStunlockTouchMove(e) {
  if (e.touches.length) updateStunlockPreview(e.touches[0].clientX, e.touches[0].clientY);
}

function updateStunlockPreview(x, y) {
  if (!stunlockTargeting || !state.pendingStunlock) return;
  const el = document.elementFromPoint(x, y);
  const sqEl = el ? el.closest('.square') : null;
  const hoveredSq = sqEl ? sqEl.dataset.square : null;
  const validQuads = getStunlockQuadrants(state.pendingStunlock.bishopSq);
  let best = null;
  if (hoveredSq) {
    const matching = validQuads.filter(({ f, r }) => quadrantSquares(f, r).includes(hoveredSq));
    if (matching.length > 0) {
      const { f: bf, r: br } = sqToFR(state.pendingStunlock.bishopSq);
      best = matching.reduce((a, b) => {
        const da = Math.abs((a.f + 0.5) - bf) + Math.abs((a.r + 0.5) - br);
        const db = Math.abs((b.f + 0.5) - bf) + Math.abs((b.r + 0.5) - br);
        return da <= db ? a : b;
      });
    }
  }
  const sameQuad = best && stunlockHoverQuad &&
    best.f === stunlockHoverQuad.f && best.r === stunlockHoverQuad.r;
  if (sameQuad) return;
  if (!best && !stunlockHoverQuad) return;
  if (stunlockHoverQuad) {
    quadrantSquares(stunlockHoverQuad.f, stunlockHoverQuad.r).forEach(sq => {
      const el = boardEl.querySelector(`.square[data-square="${sq}"]`);
      if (el) el.classList.remove('stunlock-preview');
    });
  }
  stunlockHoverQuad = best;
  if (stunlockHoverQuad) {
    quadrantSquares(stunlockHoverQuad.f, stunlockHoverQuad.r).forEach(sq => {
      const el = boardEl.querySelector(`.square[data-square="${sq}"]`);
      if (el) el.classList.add('stunlock-preview');
    });
  }
}

// Cancel an in-progress cast (Esc/Backspace) — the move that armed it already
// happened server-side; canceling just leaves it un-cast (no quadrant chosen).
function onStunlockSkip() {
  if (!state.pendingStunlock) return;
  stopStunlockTargeting();
  dispatch({ type: 'cancelAbility' });
}
