/**
 * stunlock.js — All state and logic for the Stunlock augment.
 * Depends on: game state and helpers defined in app.js.
 */

// ─── Stunlock State ───────────────────────────────────────────────────────────
let stunlockCharges = { w: {}, b: {} }; // { [sq]: true } — bishops that still have their charge
let stunnedSquares = {};                 // { [sq]: turnsRemaining } — squares currently stunned
let pendingStunlock = null;              // { color, bishopSq } — waiting for player to cast or skip
let stunlockTargeting = false;           // true while player is picking the quadrant target
let stunlockHoverQuad = null;            // { f, r } — quadrant currently previewed while hovering

// ─── Stunlock Functions ───────────────────────────────────────────────────────

function tickStunCounters() {
  for (const sq of Object.keys(stunnedSquares)) {
    stunnedSquares[sq]--;
    if (stunnedSquares[sq] <= 0) delete stunnedSquares[sq];
  }
}

// Returns all valid quadrant top-left (f,r) pairs reachable from the bishop.
function getStunlockQuadrants(bishopSq) {
  const { f: bf, r: br } = sqToFR(bishopSq);
  const results = [];
  for (let f = Math.max(0, bf - 2); f <= Math.min(6, bf + 1); f++) {
    for (let r = Math.max(0, br - 2); r <= Math.min(6, br + 1); r++) {
      if (f + 1 >= bf - 1 && f <= bf + 1 && r + 1 >= br - 1 && r <= br + 1) {
        results.push({ f, r });
      }
    }
  }
  return results;
}

// Returns the up-to-4 squares of quadrant with top-left (f,r).
function quadrantSquares(f, r) {
  return [frToSq(f,r), frToSq(f+1,r), frToSq(f,r+1), frToSq(f+1,r+1)].filter(Boolean);
}

// Apply the stunlock to the quadrant whose top-left is (f, r).
function applyStunlockToQuadrant(f, r) {
  const { color, bishopSq } = pendingStunlock;
  delete stunlockCharges[color][bishopSq];
  quadrantSquares(f, r).forEach(sq => { stunnedSquares[sq] = 2; });
  moveLog.push({ san: '⚡' + frToSq(f, r), color });
  pendingStunlock = null;
  stunlockTargeting = false;
  hideStunlockPanel();
  evaluateGameOver();
  renderBoard();
  renderMoveList();
  updateStatus();
  updateCaptured();
  if (gameOver) stopClock();
}

function showStunlockPanel() {
  let panel = document.getElementById('stunlock-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'stunlock-panel';
    panel.className = 'stunlock-panel';
    const moveListContainer = document.querySelector('.move-list-container');
    moveListContainer.parentNode.insertBefore(panel, moveListContainer);
  }
  panel.innerHTML = `
    <div class="stunlock-panel-title">⚡ Stunlock Ready</div>
    <div class="stunlock-panel-hint" id="stunlock-hint">Your bishop can cast Stunlock.</div>
    <div class="stunlock-panel-buttons">
      <button class="btn btn-primary" id="btn-stunlock-cast">Cast Stunlock</button>
      <button class="btn btn-secondary" id="btn-stunlock-skip">End Turn</button>
    </div>`;
  panel.classList.remove('hidden');
  document.getElementById('btn-stunlock-cast').addEventListener('click', onStunlockCast);
  document.getElementById('btn-stunlock-skip').addEventListener('click', onStunlockSkip);
}

function hideStunlockPanel() {
  const panel = document.getElementById('stunlock-panel');
  if (panel) panel.classList.add('hidden');
  stunlockTargeting = false;
  stunlockHoverQuad = null;
  document.removeEventListener('mousemove', onStunlockMouseMove);
  document.removeEventListener('touchmove', onStunlockTouchMove);
}

function onStunlockCast() {
  if (!pendingStunlock) return;
  stunlockTargeting = true;
  stunlockHoverQuad = null;
  const hint = document.getElementById('stunlock-hint');
  if (hint) hint.textContent = 'Hover to preview a quadrant, then click to stun it.';
  renderBoard();
  document.addEventListener('mousemove', onStunlockMouseMove);
  document.addEventListener('touchmove', onStunlockTouchMove, { passive: false });
}

function onStunlockMouseMove(e) {
  updateStunlockPreview(e.clientX, e.clientY);
}
function onStunlockTouchMove(e) {
  if (e.touches.length) updateStunlockPreview(e.touches[0].clientX, e.touches[0].clientY);
}

function updateStunlockPreview(x, y) {
  if (!stunlockTargeting || !pendingStunlock) return;
  const el = document.elementFromPoint(x, y);
  const sqEl = el ? el.closest('.square') : null;
  const hoveredSq = sqEl ? sqEl.dataset.square : null;
  const validQuads = getStunlockQuadrants(pendingStunlock.bishopSq);
  let best = null;
  if (hoveredSq) {
    const matching = validQuads.filter(({ f, r }) => quadrantSquares(f, r).includes(hoveredSq));
    if (matching.length > 0) {
      const { f: bf, r: br } = sqToFR(pendingStunlock.bishopSq);
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

function onStunlockSkip() {
  if (!pendingStunlock) return;
  pendingStunlock = null;
  stunlockTargeting = false;
  hideStunlockPanel();
  evaluateGameOver();
  renderBoard();
  renderMoveList();
  updateStatus();
  updateCaptured();
  if (gameOver) stopClock();
}
