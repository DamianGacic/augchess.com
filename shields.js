/**
 * shields.js — Client-side drawing and input for Bishops' Shields. The rules
 * (which strikes a shield stops, when a shield has to be turned) live in
 * engine/chess-engine.js and engine/augments-engine.js (orientShield); this
 * file draws the grey shield bar on each shielded bishop, the "blocked" /
 * "deflected" hints, and the end-of-turn "turn your shield" step: the 8
 * squares around the bishop become choices, hovering one swings the shield
 * there, clicking one dispatches orientShield.
 *
 * Also used by the augment demo player (bishopShieldEl, shieldHintEl).
 */

// Screen angle of each shield direction with White at the bottom.
const SHIELD_ANGLES = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };

function shieldAngle(dir, isFlipped) {
  return SHIELD_ANGLES[dir] + (isFlipped ? 180 : 0);
}

function setShieldDir(el, dir, angle) {
  el.classList.toggle('diagonal', dir.length === 2);
  el.style.setProperty('--shield-angle', angle + 'deg');
  el.dataset.angle = angle;
}

// The grey barrier drawn over a shielded bishop, on the side it faces.
function bishopShieldEl(dir, { pending = false, isFlipped = false } = {}) {
  const el = document.createElement('div');
  el.className = 'bishop-shield' + (pending ? ' pending' : '');
  el.innerHTML = '<span class="bishop-shield-bar"></span>';
  setShieldDir(el, dir, shieldAngle(dir, isFlipped));
  return el;
}

// Small shield badge in a square's corner: 'blocked' (a capture the shield
// stops) or 'deflect' (a shot that will bounce off).
function shieldHintEl(kind) {
  const el = document.createElement('span');
  el.className = 'shield-hint ' + kind;
  el.title = kind === 'blocked'
    ? 'Blocked: this bishop\'s shield faces you'
    : 'Its shield faces you: the shot will bounce off';
  return el;
}

function shieldTitle(color, dir) {
  return `Shield faces ${shieldDirLabel(color, dir)}: attacks from that side are blocked`;
}

// Whether this client is the one who has to turn a shield right now.
function isChoosingShield() {
  return !!(state.pendingShield && !state.pendingStunlock && !state.gameOver && isMyTurn());
}

// ─── Hover preview ───────────────────────────────────────────────────────────
function pendingShieldEl() {
  return state.pendingShield
    ? boardEl.querySelector(`.square[data-square="${state.pendingShield.sq}"] .bishop-shield`)
    : null;
}

// Swings the pending shield to `dir` (the short way round).
function previewShield(dir, hoverSq) {
  const el = pendingShieldEl();
  if (el) {
    const current = Number(el.dataset.angle) || 0;
    const target = shieldAngle(dir, flipped);
    const delta = ((target - current) % 360 + 540) % 360 - 180;
    setShieldDir(el, dir, current + delta);
  }
  boardEl.querySelectorAll('.square.shield-choice-hover').forEach(sq => sq.classList.remove('shield-choice-hover'));
  if (hoverSq) {
    const sqEl = boardEl.querySelector(`.square[data-square="${hoverSq}"]`);
    if (sqEl) sqEl.classList.add('shield-choice-hover');
  }
}

function onShieldHover(e) {
  if (!isChoosingShield()) return;
  const sqEl = e.target.closest && e.target.closest('.square');
  const dir = sqEl && sqEl.dataset.shieldDir;
  if (dir) previewShield(dir, sqEl.dataset.square);
  else previewShield(shieldDirAt(state, state.pendingShield.sq), null);
}

document.addEventListener('DOMContentLoaded', () => {
  boardEl.addEventListener('mouseover', onShieldHover);
  boardEl.addEventListener('mouseleave', () => {
    if (isChoosingShield()) previewShield(shieldDirAt(state, state.pendingShield.sq), null);
  });
});

// A click while a shield waits to be turned: a neighbouring square faces it
// that way, the bishop itself keeps its current direction. Returns true if
// the click belonged to the shield step (handled or ignored).
function onShieldSquareClick(sqEl) {
  if (!state.pendingShield) return false;
  if (!isChoosingShield()) return true;
  const sq = sqEl.dataset.square;
  const dir = sq === state.pendingShield.sq ? shieldDirAt(state, sq) : sqEl.dataset.shieldDir;
  if (dir) dispatch({ type: 'orientShield', dir });
  else pingSquare(state.pendingShield.sq);
  return true;
}

// ─── Instruction panel above the board ───────────────────────────────────────
let shieldPanel = null;

function syncShieldPanel() {
  const show = state.phase === 'playing' && !!state.pendingShield && !state.pendingStunlock && !state.gameOver;
  if (!show) {
    if (shieldPanel) { shieldPanel.remove(); shieldPanel = null; }
    return;
  }
  const { color, sq } = state.pendingShield;
  const mine = isChoosingShield();
  if (!shieldPanel) {
    shieldPanel = document.createElement('div');
    shieldPanel.className = 'shield-panel';
    shieldPanel.innerHTML = `
      <img class="emblem vg-emblem" src="${augmentIconUrl('bishopsShields')}" alt="">
      <div class="vg-titles">
        <div class="vg-title"></div>
        <div class="vg-sub"></div>
      </div>
      <button type="button" class="btn btn-secondary shield-keep"></button>`;
    shieldPanel.querySelector('.shield-keep').addEventListener('click', () => {
      if (isChoosingShield()) dispatch({ type: 'orientShield', dir: shieldDirAt(state, state.pendingShield.sq) });
    });
    document.querySelector('.board-wrapper').appendChild(shieldPanel);
  }
  const dir = shieldDirAt(state, sq);
  shieldPanel.classList.toggle('waiting', !mine);
  shieldPanel.querySelector('.vg-title').textContent = mine ? 'Turn your shield' : 'Shield';
  shieldPanel.querySelector('.vg-sub').textContent = mine
    ? `Click a square next to the ${sq} bishop: its shield will face that way.`
    : `${color === 'w' ? 'White' : 'Black'} is turning the ${sq} bishop's shield…`;
  shieldPanel.querySelector('.shield-keep').textContent = `Keep ${dir ? shieldDirLabel(color, dir) : ''}`;
}
