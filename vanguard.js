/**
 * vanguard.js — The Vanguard deployment phase on the client: before White's
 * first turn, the Vanguard owner plans which units go onto which of their
 * gold Vanguard squares, then sends the whole plan as one vanguardDeploy
 * action (engine/augments-engine.js validates and applies it). The plan
 * stays local until then, so the opponent only sees the result — the units
 * all marching out at once (see the 'vanguard' event in board-anim.js).
 *
 * The 30s limit is counted locally from when this client first saw the
 * pending deployment; when it runs out the current plan deploys. The server
 * has its own backstop (rooms.js watchVanguard) in case this client is gone.
 *
 * Depends on: app.js (state, dispatch, netMode, myColor, renderBoard,
 * boardEl), engine globals (VANGUARD_ZONES, pieceAt, isEmpty),
 * augment-demo-player.js (buildDemoPiece), augment-demos.js
 * (snapshotBoardPieces).
 */

const Vanguard = (() => {
  let plan = [];          // [{ from, to }]
  let selected = null;    // square of the unit being placed
  let pressFrom = null;   // square a mouse press started on (drag-to-place)
  let seenAt = null;      // when this client first saw the pending deployment
  let seenKey = null;
  let ticker = null;
  let panel = null;

  function pending() {
    return state.phase === 'playing' && !!state.game && !!state.vanguard;
  }

  // Whether this client is the one deploying (always, in hotseat).
  function mine() {
    return pending() && (!netMode || myColor === state.vanguard.color);
  }

  function zone() {
    return pending() ? VANGUARD_ZONES[state.vanguard.color] : [];
  }

  function remainingMs() {
    if (!pending() || seenAt === null) return 0;
    return Math.max(0, state.vanguard.ms - (Date.now() - seenAt));
  }

  function plannedTo(sq) { return plan.find(p => p.to === sq); }
  function plannedFrom(sq) { return plan.find(p => p.from === sq); }

  function ownUnit(sq) {
    const p = pieceAt(state, sq);
    return p && p.color === state.vanguard.color;
  }

  function freeTarget(sq) {
    return zone().includes(sq) && isEmpty(state, sq) && !plannedTo(sq);
  }

  // ── Planning ─────────────────────────────────────────────────────────────
  function place(from, to) {
    plan = plan.filter(p => p.from !== from && p.to !== to);
    plan.push({ from, to });
    selected = null;
  }

  function handleSquare(sq) {
    if (plannedTo(sq)) {                               // click a ghost: take it back
      plan = plan.filter(p => p.to !== sq);
      selected = null;
    } else if (ownUnit(sq)) {                          // pick a unit (or pick another)
      selected = sq;
    } else if (selected && freeTarget(sq)) {           // put it on a gold square
      place(selected, sq);
    } else {
      selected = null;
    }
  }

  // Returns true if the click was a Vanguard-phase click (handled or ignored).
  function onSquareClick(sq) {
    if (!pending()) return false;
    if (mine()) { handleSquare(sq); pressFrom = null; refresh(); }
    return true;
  }

  // A press on a unit marks it; releasing over a gold square places it, so
  // drag-and-drop works alongside click-click. No re-render here: replacing
  // the pressed element would swallow the click that follows a plain press.
  function onPiecePress(sq) {
    if (!pending()) return false;
    if (mine() && ownUnit(sq) && !plannedTo(sq)) {
      selected = sq;
      pressFrom = sq;
    }
    return true;
  }

  function onRelease(e) {
    if (!pressFrom) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const sqEl = el && el.closest('#board .square');
    const sq = sqEl && sqEl.dataset.square;
    if (sq === pressFrom) return; // a plain click — onSquareClick follows and handles it
    if (sq && freeTarget(sq)) {
      place(pressFrom, sq);
      pressFrom = null;
      refresh();
    } else {
      pressFrom = null;
    }
  }

  function deploy() {
    if (!mine()) return;
    const placements = plan.slice();
    plan = [];
    selected = null;
    dispatch({ type: 'vanguardDeploy', placements });
  }

  // ── Board decoration (runs after every renderBoard) ──────────────────────
  function decorate() {
    if (!pending()) return;
    const isMine = mine();
    for (const sq of zone()) {
      const el = boardEl.querySelector(`.square[data-square="${sq}"]`);
      if (!el) continue;
      el.classList.add('vanguard-zone');
      if (isMine && selected && freeTarget(sq)) el.classList.add('vanguard-target');
    }
    if (!isMine) return;
    if (selected) {
      const el = boardEl.querySelector(`.square[data-square="${selected}"]`);
      if (el) el.classList.add('selected');
    }
    const pieces = snapshotBoardPieces(state);
    plan.forEach(p => {
      const fromSq = boardEl.querySelector(`.square[data-square="${p.from}"]`);
      if (fromSq) {
        fromSq.classList.add('vg-from');
        const fromEl = fromSq.querySelector('.piece');
        if (fromEl) fromEl.classList.add('vg-origin');
      }
      const toEl = boardEl.querySelector(`.square[data-square="${p.to}"]`);
      const unit = pieces.find(u => u.sq === p.from);
      if (toEl && unit) {
        toEl.classList.add('vg-planned');
        const ghost = buildDemoPiece(unit);
        ghost.classList.add('vg-ghost');
        ghost.title = 'Click to take back';
        toEl.appendChild(ghost);
      }
    });
    drawArrows();
  }

  // Gold arrows from each planned unit to its Vanguard square, drawn in an
  // overlay next to the board (flip-proof: measured from the squares).
  function drawArrows() {
    const wrap = boardEl.parentElement;
    let svg = wrap.querySelector('.vg-arrows');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'vg-arrows');
      svg.innerHTML = '<defs><marker id="vg-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#ffd877"/></marker></defs><g></g>';
      wrap.appendChild(svg);
    }
    const g = svg.querySelector('g');
    g.innerHTML = '';
    if (!mine()) return;
    const box = wrap.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    const center = sq => {
      const r = boardEl.querySelector(`.square[data-square="${sq}"]`).getBoundingClientRect();
      return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, s: r.width };
    };
    for (const p of plan) {
      const a = center(p.from), b = center(p.to);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const trim = b.s * 0.32; // stop short of the ghost
      const ex = b.x - (b.x - a.x) / len * trim, ey = b.y - (b.y - a.y) / len * trim;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
      line.setAttribute('x2', ex); line.setAttribute('y2', ey);
      line.setAttribute('marker-end', 'url(#vg-head)');
      g.appendChild(line);
    }
  }

  function clearArrows() {
    const svg = document.querySelector('.board-wrapper .vg-arrows');
    if (svg) svg.remove();
  }

  // ── Panel ────────────────────────────────────────────────────────────────
  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'vanguard-panel';
    // One row right above the board (over the top player bar while the
    // deployment lasts), so neither player can miss it.
    panel.innerHTML = `
      <img class="emblem vg-emblem" src="augments/icons/vanguard.svg" alt="">
      <div class="vg-titles">
        <div class="vg-title">Vanguard</div>
        <div class="vg-sub"></div>
      </div>
      <span class="vg-count"></span>
      <button type="button" class="btn btn-secondary vg-clear">Clear</button>
      <button type="button" class="btn btn-primary vg-deploy">Deploy</button>
      <div class="vg-timer">
        <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="vg-ring-bg" cx="20" cy="20" r="17"/><circle class="vg-ring" cx="20" cy="20" r="17" pathLength="100"/></svg>
        <span class="vg-secs"></span>
      </div>`;
    panel.querySelector('.vg-deploy').addEventListener('click', deploy);
    panel.querySelector('.vg-clear').addEventListener('click', () => { plan = []; selected = null; refresh(); });
    document.querySelector('.board-wrapper').appendChild(panel);
  }

  function updatePanel() {
    if (!panel) buildPanel();
    const isMine = mine();
    const who = state.vanguard.color === 'w' ? 'White' : 'Black';
    panel.classList.toggle('waiting', !isMine);
    panel.querySelector('.vg-sub').textContent = isMine
      ? (selected ? 'Now click a gold square' : 'Click a unit, then a gold square')
      : `${who} is deploying their Vanguard…`;
    panel.querySelector('.vg-count').textContent = `${plan.length}/${zone().length} placed`;
    const ms = remainingMs();
    panel.querySelector('.vg-secs').textContent = Math.ceil(ms / 1000);
    panel.querySelector('.vg-ring').style.strokeDashoffset = String(100 - (ms / state.vanguard.ms) * 100);
    panel.classList.toggle('urgent', ms <= 5000);
  }

  function tick() {
    if (!pending()) return;
    updatePanel();
    if (remainingMs() <= 0 && mine()) deploy();
  }

  function refresh() {
    renderBoard();
    if (pending()) updatePanel();
  }

  // Called from renderAll: starts/stops the phase as state changes.
  function sync() {
    if (!pending()) {
      if (panel) { panel.remove(); panel = null; }
      clearArrows();
      clearInterval(ticker); ticker = null;
      plan = []; selected = null; seenAt = null; seenKey = null;
      return;
    }
    const key = state.vanguard.color + ':' + state.moveLog.length;
    if (seenKey !== key) { seenKey = key; seenAt = Date.now(); plan = []; selected = null; }
    if (!ticker) ticker = setInterval(tick, 200);
    updatePanel();
  }

  document.addEventListener('mouseup', onRelease);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && mine() && !/INPUT|TEXTAREA/.test((e.target && e.target.tagName) || '')) deploy();
  });

  return { sync, decorate, onSquareClick, onPiecePress, active: pending };
})();
