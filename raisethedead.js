/**
 * raisethedead.js — Client-side targeting UI for Raise the Dead. Unlike
 * every other ability, this one can resolve multiple times in a row before
 * the turn actually ends: pressing R begins local targeting immediately
 * (same as Clubbing/Silver Bullet — no arming round trip needed), but once
 * the first square is raised, state.pendingRaiseTheDead (server-authoritative,
 * mirroring state.pendingStunlock) is what keeps the session alive across
 * further raises — see syncRaiseTheDeadTargeting, called every render.
 *
 * The King never moves for this cast, so state.game.turn() stays put for
 * the whole sequence — the turn only actually flips once the graveyard or
 * the valid-target list runs dry, or the player ends it early with Z (see
 * onRaiseTheDeadEndTurn). No currentActor() special-case is needed the way
 * Stunlock needs one, since nothing here happens after state.game.turn()
 * has already moved on.
 */

// ─── Raise the Dead UI-only state (color/kingSq are local; the session
// itself, once at least one raise has happened, is server-authoritative
// via state.pendingRaiseTheDead) ────────────────────────────────────────
let raiseDeadTargeting = false;
let raiseDeadColor = null;
let raiseDeadKingSq = null;
let raiseDeadHoverSq = null;

function beginRaiseTheDeadTargeting(kingSq, color) {
  raiseDeadTargeting = true;
  raiseDeadColor = color;
  raiseDeadKingSq = kingSq;
  raiseDeadHoverSq = null;
  document.addEventListener('mousemove', onRaiseTheDeadMouseMove);
  document.addEventListener('touchmove', onRaiseTheDeadTouchMove, { passive: false });
  renderBoard();
}

function stopRaiseTheDeadTargeting() {
  raiseDeadTargeting = false;
  raiseDeadColor = null;
  raiseDeadKingSq = null;
  raiseDeadHoverSq = null;
  document.removeEventListener('mousemove', onRaiseTheDeadMouseMove);
  document.removeEventListener('touchmove', onRaiseTheDeadTouchMove);
}

// Called every render (see app.js renderAll). The session ends the moment
// state.game.turn() no longer matches the color that was raising Ghouls —
// the only two ways that can happen are auto-exhaustion or Z, both of which
// flip the turn server-side (see finishRaiseTheDeadTurn).
function syncRaiseTheDeadTargeting() {
  if (raiseDeadTargeting && raiseDeadColor !== state.game.turn()) {
    stopRaiseTheDeadTargeting();
  }
}

function onRaiseTheDeadMouseMove(e) {
  updateRaiseTheDeadPreview(e.clientX, e.clientY);
}
function onRaiseTheDeadTouchMove(e) {
  if (e.touches.length) updateRaiseTheDeadPreview(e.touches[0].clientX, e.touches[0].clientY);
}

function updateRaiseTheDeadPreview(x, y) {
  if (!raiseDeadTargeting) return;
  const el = document.elementFromPoint(x, y);
  const sqEl = el ? el.closest('.square') : null;
  const hoveredSq = sqEl ? sqEl.dataset.square : null;
  const validTargets = getRaiseTheDeadTargets(state, raiseDeadColor);
  const best = hoveredSq && validTargets.includes(hoveredSq) ? hoveredSq : null;
  if (best === raiseDeadHoverSq) return;
  raiseDeadHoverSq = best;
  renderBoard();
}

// Raise one Ghoul at the given square — dispatches the cast. Deliberately
// doesn't stop targeting itself: syncRaiseTheDeadTargeting() (next render)
// decides whether another raise is still possible from the state that
// comes back.
function applyRaiseTheDeadToTarget(sq) {
  dispatch({ type: 'castAbility', id: 'raiseTheDead', target: sq });
}

// Z: end the turn early, keeping whatever's been raised so far. If nothing
// has been raised yet (nothing sent to the engine, state.pendingRaiseTheDead
// still unset), this is a free local cancel instead — same "nothing
// committed yet" shape as every other ability's Escape/Backspace cancel.
function onRaiseTheDeadEndTurn() {
  if (!raiseDeadTargeting) return;
  if (state.pendingRaiseTheDead) {
    dispatch({ type: 'endRaiseTheDead' });
  } else {
    stopRaiseTheDeadTargeting();
    renderBoard();
  }
}

// Cancel (Esc/Backspace) — only free before anything's been raised. Once
// state.pendingRaiseTheDead exists, cancelling for free would silently
// erase Ghouls already placed back on the board, so this intentionally
// does nothing at that point — Z (onRaiseTheDeadEndTurn) is the only way
// to end the turn once at least one has been raised.
function cancelRaiseTheDeadTargeting() {
  if (!raiseDeadTargeting || state.pendingRaiseTheDead) return;
  stopRaiseTheDeadTargeting();
  renderBoard();
}
