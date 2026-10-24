/**
 * board-anim.js — Short animations for every turn on the real board.
 *
 * renderBoard() rebuilds the board from state; afterwards BoardAnim.afterRender
 * compares the new position with the previous one (the same piece tracking
 * the augment demos use — snapshotBoardPieces/trackBoardPieces in
 * augment-demos.js) and animates the difference:
 *   - normal turns stay quick (~0.15–0.25s): a slide, a capture fading out;
 *   - shots streak across, and the bigger abilities get one signature effect
 *     (0.5–1s), read off the new move-log entries.
 * Works the same for hotseat and online play, since it only looks at state.
 * Effects live in an overlay next to #board, so a re-render mid-animation
 * (selecting a piece, a clock tick) doesn't cut them off.
 *
 * Depends on: augment-demos.js (snapshotBoardPieces, trackBoardPieces),
 * augment-demo-player.js (buildDemoPiece), engine globals (kingAuraSquares,
 * ringOfFireRadius, findKingSquare, solarStrikeSquares, quadrantSquares,
 * sqToFR), app.js (state, boardEl).
 */

const BoardAnim = (() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let prev = null;       // { pieces, logLen, lastMove } from the last render
  let counter = { n: 0 };
  let dropTarget = null; // square a piece was just dragged onto — it shouldn't slide there

  function overlay() {
    let fx = document.getElementById('board-fx');
    if (!fx) {
      fx = document.createElement('div');
      fx.id = 'board-fx';
      boardEl.parentElement.appendChild(fx);
    }
    return fx;
  }

  function squareEl(sq) {
    return boardEl.querySelector(`.square[data-square="${sq}"]`);
  }

  // A square's box relative to the board wrapper (flip-proof: reads the DOM).
  function squareBox(sq) {
    const el = squareEl(sq);
    if (!el) return null;
    const r = el.getBoundingClientRect(), w = boardEl.parentElement.getBoundingClientRect();
    return { x: r.left - w.left, y: r.top - w.top, size: r.width };
  }

  function addFx(el, ms) {
    overlay().appendChild(el);
    setTimeout(() => el.remove(), ms);
    return el;
  }

  function chebyshev(a, b) {
    const A = sqToFR(a), B = sqToFR(b);
    return Math.max(Math.abs(A.f - B.f), Math.abs(A.r - B.r));
  }

  // ── Building blocks ──────────────────────────────────────────────────────
  // Coloured flash over squares, rippling outward from `origin`.
  function ripple(squares, origin, color, { step = 60, dur = 450 } = {}) {
    let longest = 0;
    for (const sq of squares) {
      const box = squareBox(sq);
      if (!box) continue;
      const delay = origin ? chebyshev(origin, sq) * step : 0;
      longest = Math.max(longest, delay);
      const cell = document.createElement('div');
      cell.className = 'ba-cell';
      Object.assign(cell.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.size}px`, height: `${box.size}px`,
        animationDelay: `${delay}ms`, animationDuration: `${dur}ms` });
      cell.style.setProperty('--ba-color', color);
      addFx(cell, delay + dur + 50);
    }
    return longest + dur;
  }

  // Expanding ring centred on a square (aura casts).
  function shockwave(center, radiusSquares, color, dur) {
    const box = squareBox(center);
    if (!box) return;
    const ring = document.createElement('div');
    ring.className = 'ba-wave';
    const size = (radiusSquares * 2 + 1) * box.size;
    Object.assign(ring.style, {
      left: `${box.x + box.size / 2 - size / 2}px`, top: `${box.y + box.size / 2 - size / 2}px`,
      width: `${size}px`, height: `${size}px`, animationDuration: `${dur}ms`,
    });
    ring.style.setProperty('--ba-color', color);
    addFx(ring, dur + 50);
  }

  // A projectile streak from one square to another.
  function streak(from, to, kind) {
    const a = squareBox(from), b = squareBox(to);
    if (!a || !b) return;
    const ax = a.x + a.size / 2, ay = a.y + a.size / 2, bx = b.x + b.size / 2, by = b.y + b.size / 2;
    const len = Math.hypot(bx - ax, by - ay);
    const line = document.createElement('div');
    line.className = 'ba-streak ba-streak-' + kind;
    Object.assign(line.style, {
      left: `${ax}px`, top: `${ay}px`, width: `${len}px`,
      transform: `rotate(${Math.atan2(by - ay, bx - ax)}rad)`,
    });
    addFx(line, 400);
  }

  // The departing copy sits inside its own square, beneath whatever piece is
  // arriving there (a capture's attacker slides in over the fading victim).
  function ghost(p, style, into, dur) {
    const sqEl = squareEl(p.sq), box = squareBox(p.sq);
    if (!sqEl || !box) return;
    const wrap = document.createElement('div');
    wrap.className = 'ba-ghost ba-out-' + style;
    wrap.style.animationDuration = `${dur}ms`;
    if (into) {
      const t = squareBox(into);
      if (t) { wrap.style.setProperty('--dx', `${t.x - box.x}px`); wrap.style.setProperty('--dy', `${t.y - box.y}px`); }
    }
    wrap.appendChild(buildDemoPiece(p, { isFlipped: flipped }));
    sqEl.appendChild(wrap);
    setTimeout(() => wrap.remove(), dur + 50);
  }

  // ── Reading what happened ────────────────────────────────────────────────
  // New move-log entries → effects. See the san strings each engine path
  // pushes (describeMove, cast* in augments-engine.js, the check* auras).
  function readEvents(entries) {
    const events = [];
    for (const { san, color } of entries) {
      const sqs = san.match(/[a-h][1-8]/g) || [];
      if (san.startsWith('🌩 ')) events.push({ kind: 'lightning', color });
      else if (san.startsWith('🔥 ')) events.push({ kind: 'fire', color });
      else if (san.startsWith('⏫') || san.startsWith('⏩')) events.push({ kind: 'march' });
      else if (san.startsWith('☀')) events.push({ kind: 'solar', center: sqs[0] });
      else if (san.startsWith('⚡')) events.push({ kind: 'stun', corner: sqs[0] });
      else if (san.startsWith('🔨')) events.push({ kind: 'club', corner: sqs[0] });
      else if (san.startsWith('🎯')) events.push({ kind: 'shot', from: sqs[0], to: sqs[1], style: 'bullet' });
      else if (san.startsWith('🔥') && sqs.length === 2) events.push({ kind: 'shot', from: sqs[0], to: sqs[1], style: 'fireball' });
      else if (san.startsWith('✨')) events.push({ kind: 'teleport' });
      else if (san.startsWith('💀')) events.push({ kind: 'raise' });
      else if (san.startsWith('⇒')) events.push({ kind: 'arrow', to: sqs[0] });
      else if (san.includes('↓') || san.includes('↑')) events.push({ kind: 'exit' });
      else if (san.startsWith('⚔')) {
        const pairs = san.slice(1).split(',').filter(Boolean).map(s => ({ from: s.slice(0, 2), to: s.slice(2, 4) }));
        events.push({ kind: 'vanguard', color, pairs });
      }
    }
    return events;
  }

  // ── Main entry ───────────────────────────────────────────────────────────
  function afterRender() {
    if (!state.game || state.phase !== 'playing') { prev = null; return; }
    const pieces = snapshotBoardPieces(state);
    const logLen = state.moveLog.length;
    const lastMove = state.lastMove ? state.lastMove.from + state.lastMove.to : null;

    // Same turn (just a re-render, e.g. a selection) → carry ids over quietly.
    // A shorter log means undo or a new game → start fresh.
    if (!prev || logLen <= prev.logLen) {
      if (prev && logLen === prev.logLen) trackBoardPieces(prev.pieces, pieces, {}, state, counter);
      else pieces.forEach(p => { p.id = ++counter.n; });
      prev = { pieces, logLen, lastMove, gameOver: state.gameOver };
      return;
    }

    const events = readEvents(state.moveLog.slice(prev.logLen));
    const has = kind => events.find(e => e.kind === kind);
    const hint = has('vanguard') ? { pairs: has('vanguard').pairs }
      : has('teleport') ? { blink: true }
      : has('raise') ? { raise: true }
      : (lastMove && lastMove !== prev.lastMove)
        ? { from: state.lastMove.from, to: state.lastMove.to, exit: !!has('exit') }
        : {};
    const removed = trackBoardPieces(prev.pieces, pieces, hint, state, counter);
    const before = prev;
    prev = { pieces, logLen, lastMove, gameOver: state.gameOver };
    // Reduced motion, or a reconnect catching up on several turns at once.
    if (reduceMotion.matches || !Settings.get('animations') || logLen - before.logLen > 6) { dropTarget = null; return; }
    play(pieces, removed, events, hint, before);
    dropTarget = null;
  }

  function play(pieces, removed, events, hint, before) {
    const moving = pieces.filter(p => p.from);
    const vanguard = events.find(e => e.kind === 'vanguard');
    const march = !vanguard && (events.some(e => e.kind === 'march') || moving.length > 2);
    // A Vanguard deployment: every unit marches out together, a bit slower.
    const slideMs = vanguard ? 650 : march ? 300 : 180;

    // Slides (FLIP: the piece is already on its new square — start it at
    // the old one and let it glide home).
    moving.forEach((p, i) => {
      const el = squareEl(p.sq) && squareEl(p.sq).querySelector('.piece');
      const from = squareBox(p.from), to = squareBox(p.sq);
      if (!el || !from || !to) return;
      if (p.sq === dropTarget) { el.classList.add('ba-settle'); return; } // dragged there already
      el.style.transition = 'none';
      el.style.transform = `translate(${from.x - to.x}px, ${from.y - to.y}px)`;
      el.style.zIndex = '7';
      void el.offsetWidth;
      el.style.transition = `transform ${slideMs}ms cubic-bezier(0.25, 0.8, 0.3, 1) ${march ? (i % 8) * 25 : 0}ms`;
      if (vanguard) el.classList.add('ba-vanguard');
      el.style.transform = '';
      setTimeout(() => { el.style.transition = ''; el.style.zIndex = ''; el.classList.remove('ba-vanguard'); }, slideMs + 250);
    });

    // Arrivals that aren't slides.
    pieces.filter(p => p.spawn).forEach(p => {
      const el = squareEl(p.sq) && squareEl(p.sq).querySelector('.piece');
      if (!el) return;
      if (p.spawnFrom) {
        const from = squareBox(p.spawnFrom), to = squareBox(p.sq);
        el.style.transition = 'none';
        el.style.transform = `translate(${from.x - to.x}px, ${from.y - to.y}px)`;
        void el.offsetWidth;
        el.style.transition = 'transform 180ms ease-out';
        el.style.transform = '';
      } else {
        el.classList.add('ba-in-' + p.spawn);
      }
    });

    // Departures: captured units flash out where they stood, a unit walking
    // into a tower / onto its knight melts into it.
    removed.forEach(r => {
      const dur = r.style === 'burn' || r.style === 'zap' ? 420 : r.style === 'blink' ? 320 : r.style === 'merge' ? 200 : 260;
      ghost(r, r.style, r.into, dur);
    });

    // Signature effects for the bigger moments.
    for (const e of events) {
      if (e.kind === 'arrow') {
        const shooter = state.lastMove && state.lastMove.to === e.to ? state.lastMove.from : null;
        if (shooter) streak(shooter, e.to, 'arrow');
      } else if (e.kind === 'shot') {
        streak(e.from, e.to, e.style);
      } else if (e.kind === 'vanguard') {
        ripple(VANGUARD_ZONES[e.color], null, 'rgba(242, 195, 91, 0.7)', { dur: 750 });
        const banner = document.createElement('div');
        banner.className = 'ba-banner';
        banner.textContent = e.pairs.length ? 'Vanguard' : 'Vanguard holds';
        addFx(banner, 1500);
      } else if (e.kind === 'lightning' || e.kind === 'fire') {
        const king = state.mounted[e.color] || findKingSquare(state, e.color);
        if (!king) continue;
        const radius = e.kind === 'fire' ? ringOfFireRadius(state, e.color) : 1;
        const color = e.kind === 'fire' ? 'rgba(255, 112, 40, 0.9)' : 'rgba(255, 235, 59, 0.95)';
        const dur = e.kind === 'fire' ? (radius > 1 ? 1000 : 800) : 700;
        shockwave(king, radius, color, dur);
        ripple(kingAuraSquares(king, radius), king, color, { step: radius > 1 ? 110 : 90, dur: 500 });
      } else if (e.kind === 'solar') {
        const { f, r } = sqToFR(e.center);
        ripple(solarStrikeSquares(f, r), e.center, 'rgba(255, 196, 0, 0.85)', { step: 80, dur: 520 });
      } else if (e.kind === 'stun') {
        const { f, r } = sqToFR(e.corner);
        ripple(quadrantSquares(f, r), null, 'rgba(171, 71, 188, 0.85)', { dur: 480 });
      } else if (e.kind === 'club') {
        const { f, r } = sqToFR(e.corner);
        ripple(quadrantSquares(f, r), null, 'rgba(255, 255, 255, 0.85)', { dur: 300 });
        boardEl.classList.remove('ba-jolt');
        void boardEl.offsetWidth;
        boardEl.classList.add('ba-jolt');
      }
    }

    // Solar Strike detonating, Ring of Fire burning: those deaths already
    // flash out as 'burn' ghosts — add a short glow on their squares.
    const burned = removed.filter(r => r.style === 'burn').map(r => r.sq);
    if (burned.length && !events.some(e => e.kind === 'shot')) ripple(burned, null, 'rgba(255, 112, 40, 0.8)', { dur: 420 });

    // King on the enemy back row (Coronation) or a capture ending the game.
    if (state.gameOver && !before.gameOver) {
      ['w', 'b'].forEach(c => {
        const k = state.mounted[c] || findKingSquare(state, c);
        if (k && state.gameOverText.includes(c === 'w' ? 'White wins' : 'Black wins')) {
          shockwave(k, 1, 'rgba(242, 195, 91, 0.95)', 900);
        }
      });
    }
  }

  function noteDrop(sq) {
    dropTarget = sq;
  }

  return { afterRender, noteDrop };
})();
