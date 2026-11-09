/**
 * patchy.js — The Patchy Lines arranging phase on the client: before
 * anything else happens, the owner (who started a few pawn-type units short)
 * slides the rest side to side along their row(s) to choose where the gaps
 * go, then sends the whole arrangement as one patchyArrange action
 * (engine/augments-engine.js validates and applies it). The plan stays local
 * until then, so the opponent only sees the result.
 *
 * The 10s limit is counted locally from when this client first saw the
 * pending arrangement; when it runs out the current plan is sent. The server
 * has its own backstop (rooms.js watchPatchy) in case this client is gone.
 *
 * Same shape as vanguard.js. Depends on: app.js (state, dispatch, netMode,
 * aiColor, myColor, renderBoard, boardEl, flipped), engine globals
 * (startingPawnRanks, pieceAt, unitName, pluralUnit), augment-demo-player.js
 * (buildDemoPiece), augment-demos.js (snapshotBoardPieces).
 */

const Patchy = (() => {
  let pos = {};           // origin square → planned square, for units that moved
  let selected = null;    // origin square of the unit being moved
  let pressFrom = null;   // origin a mouse press started on (drag-to-place)
  let seenAt = null;      // when this client first saw the pending arrangement
  let seenKey = null;
  let ticker = null;
  let panel = null;

  function pending() {
    return state.phase === 'playing' && !!state.game && !!state.patchy;
  }

  // Whether this client is the one arranging (always, in hotseat).
  function mine() {
    return pending() && ((!netMode && !aiColor) || myColor === state.patchy.color);
  }

  function color() { return state.patchy.color; }

  function ranks() {
    return pending() ? startingPawnRanks(state, color()) : [];
  }

  function zone() {
    return ranks().flatMap(rank => 'abcdefgh'.split('').map(file => file + rank));
  }

  function remainingMs() {
    if (!pending() || seenAt === null) return 0;
    return Math.max(0, state.patchy.ms - (Date.now() - seenAt));
  }

  // A unit of the owner's that starts in the line (an arrangeable origin).
  function lineUnit(sq) {
    const p = pieceAt(state, sq);
    return !!p && p.color === color() && p.type === 'p' && ranks().includes(sq[1]);
  }

  // The origin of the unit planned to stand on `sq`, or null.
  function occupant(sq) {
    for (const from in pos) if (pos[from] === sq) return from;
    return lineUnit(sq) && !(sq in pos) ? sq : null;
  }

  // Whether `sq` will be free once the plan applies (and is in the line).
  function freeInPlan(sq) {
    if (!zone().includes(sq) || occupant(sq)) return false;
    const p = pieceAt(state, sq);
    return !p || (lineUnit(sq) && sq in pos);
  }

  function canGo(from, sq) {
    return !!from && sq[1] === from[1] && freeInPlan(sq);
  }

  function gapCount() {
    return zone().filter(sq => !occupant(sq)).length;
  }

  // ── Planning ─────────────────────────────────────────────────────────────
  function place(from, to) {
    if (to === from) delete pos[from];
    else pos[from] = to;
    selected = null;
  }

  function handleSquare(sq) {
    const unit = occupant(sq);
    if (unit) selected = unit;                         // pick a unit (or pick another)
    else if (canGo(selected, sq)) place(selected, sq); // slide it along its row
    else selected = null;
  }

  // Returns true if the click was a Patchy-phase click (handled or ignored).
  function onSquareClick(sq) {
    if (!pending()) return false;
    if (mine()) { handleSquare(sq); pressFrom = null; refresh(); }
    return true;
  }

  // A press on a unit marks it; releasing over a free square on its row
  // moves it there, so drag-and-drop works alongside click-click. No
  // re-render here (it would swallow the click that follows a plain press).
  function onPiecePress(sq) {
    if (!pending()) return false;
    const unit = mine() && occupant(sq);
    if (unit) { selected = unit; pressFrom = unit; }
    return true;
  }

  function onRelease(e) {
    if (!pressFrom) return;
    const from = pressFrom;
    pressFrom = null;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const sqEl = el && el.closest('#board .square');
    const sq = sqEl && sqEl.dataset.square;
    if (!sq || occupant(sq) === from) return; // a plain click — onSquareClick follows
    if (canGo(from, sq)) { place(from, sq); refresh(); }
  }

  function send() {
    if (!mine()) return;
    const moves = Object.keys(pos).map(from => ({ from, to: pos[from] }));
    pos = {};
    selected = null;
    dispatch({ type: 'patchyArrange', moves });
  }

  // ── Board decoration (runs after every renderBoard) ──────────────────────
  function decorate() {
    if (!pending()) return;
    const isMine = mine();
    const sqEl = sq => boardEl.querySelector(`.square[data-square="${sq}"]`);
    for (const sq of zone()) {
      const el = sqEl(sq);
      if (!el) continue;
      el.classList.add('patchy-zone');
      if (isMine && !occupant(sq)) el.classList.add('patchy-gap');
      if (isMine && canGo(selected, sq)) el.classList.add('patchy-target');
    }
    if (!isMine) return;
    if (selected) {
      const el = sqEl(pos[selected] || selected);
      if (el) el.classList.add('selected');
    }
    const pieces = snapshotBoardPieces(state);
    for (const from in pos) {
      const fromEl = sqEl(from);
      const pieceEl = fromEl && fromEl.querySelector('.piece');
      if (pieceEl) pieceEl.classList.add('vg-origin');
      const toEl = sqEl(pos[from]);
      const unit = pieces.find(u => u.sq === from);
      if (toEl && unit) {
        const ghost = buildDemoPiece(unit, { isFlipped: flipped });
        ghost.classList.add('vg-ghost');
        toEl.appendChild(ghost);
      }
    }
  }

  // ── Panel ────────────────────────────────────────────────────────────────
  function buildPanel() {
    panel = document.createElement('div');
    // Shares the Vanguard panel's look and spot, right above the board.
    panel.className = 'vanguard-panel patchy-panel';
    panel.innerHTML = `
      <img class="emblem vg-emblem" src="augments/icons/patchyLines.svg" alt="">
      <div class="vg-titles">
        <div class="vg-title">Patchy Lines</div>
        <div class="vg-sub"></div>
      </div>
      <span class="vg-count"></span>
      <button type="button" class="btn btn-secondary vg-clear">Reset</button>
      <button type="button" class="btn btn-primary vg-deploy">Ready</button>
      <div class="vg-timer">
        <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="vg-ring-bg" cx="20" cy="20" r="17"/><circle class="vg-ring" cx="20" cy="20" r="17" pathLength="100"/></svg>
        <span class="vg-secs"></span>
      </div>`;
    panel.querySelector('.vg-deploy').addEventListener('click', send);
    panel.querySelector('.vg-clear').addEventListener('click', () => { pos = {}; selected = null; refresh(); });
    document.querySelector('.board-wrapper').appendChild(panel);
  }

  function updatePanel() {
    if (!panel) buildPanel();
    const isMine = mine();
    const who = color() === 'w' ? 'White' : 'Black';
    const unit = unitName(state, color(), 'p');
    panel.classList.toggle('waiting', !isMine);
    panel.querySelector('.vg-sub').textContent = isMine
      ? (selected ? 'Now click a free square on its row' : `Slide your ${pluralUnit(unit)} to choose where the gaps go`)
      : `${who} is arranging their Patchy Lines…`;
    const moved = Object.keys(pos).length;
    panel.querySelector('.vg-count').textContent = `${gapCount()} gaps · ${moved} moved`;
    const ms = remainingMs();
    panel.querySelector('.vg-secs').textContent = Math.ceil(ms / 1000);
    panel.querySelector('.vg-ring').style.strokeDashoffset = String(100 - (ms / state.patchy.ms) * 100);
    panel.classList.toggle('urgent', ms <= 3000);
  }

  function tick() {
    if (!pending()) return;
    updatePanel();
    if (remainingMs() <= 0 && mine()) send();
  }

  function refresh() {
    renderBoard();
    if (pending()) updatePanel();
  }

  // Called from renderAll: starts/stops the phase as state changes.
  function sync() {
    if (!pending()) {
      if (panel) { panel.remove(); panel = null; }
      clearInterval(ticker); ticker = null;
      pos = {}; selected = null; seenAt = null; seenKey = null;
      return;
    }
    const key = color() + ':' + state.moveLog.length;
    if (seenKey !== key) { seenKey = key; seenAt = Date.now(); pos = {}; selected = null; }
    if (!ticker) ticker = setInterval(tick, 200);
    updatePanel();
  }

  document.addEventListener('mouseup', onRelease);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && mine() && !/INPUT|TEXTAREA/.test((e.target && e.target.tagName) || '')) send();
  });

  return { sync, decorate, onSquareClick, onPiecePress, active: pending };
})();
