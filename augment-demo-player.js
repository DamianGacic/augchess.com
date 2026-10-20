/**
 * augment-demo-player.js — Plays the frames built by augment-demos.js on a
 * miniature copy of the real board, and shows them in two places:
 *   - a hover popover for anything tagged data-aug-id (draft cards, the
 *     Augments page, the home page strip, in-game augment icons, ability
 *     slots), auto-playing on a loop;
 *   - the augment detail modal, with step/pause controls (the touch path,
 *     since touch screens have no hover).
 *
 * Squares and pieces reuse the real board's classes (.square, .piece,
 * .figure-*, overlay classes) inside a container that sets --board-size, so
 * the demo looks exactly like a game. Moves animate FLIP-style: each frame
 * is rebuilt in place, then moved pieces are offset back to where they were
 * and transitioned home.
 *
 * Depends on: augment-demos.js (getAugmentDemo), data.js (AUGMENTS, PIECES,
 * augmentIconUrl), views.js helpers at call time (kindTag, costBadge,
 * requiresTag).
 */

const DEMO_FILES = 'abcdefgh';

function demoSquareXY(sq) {
  return { x: DEMO_FILES.indexOf(sq[0]), y: 8 - +sq[1] };
}

function demoReadingTime(caption) {
  return Math.min(7500, Math.max(2300, 1100 + caption.length * 42));
}

// How long a frame stays up. A caption that carries on into the next frame
// (an aim frame before its move) only holds briefly, so the action starts
// quickly; the frame where a caption ends holds whatever reading time is
// still owed (`shownMs` = how long the caption has already been up).
const DEMO_CYCLE_STEP = 480;
const DEMO_EFFECT_CLASSES = ['fire-zone', 'fire-king', 'lightning-zone', 'lightning-king', 'solar-marked', 'stunned',
  'broke-rank', 'teleport-marked'];

function demoFrameDuration(frame, next, shownMs) {
  if (frame.kind === 'quick') return 1100;
  // A targeting frame first sweeps through its alternatives.
  const cycleMs = frame.targetCycle ? frame.targetCycle.sets.length * DEMO_CYCLE_STEP + 450 : 0;
  if (next && next.kind !== 'quick' && next.caption === frame.caption) return Math.max(1400, cycleMs);
  const text = frame.caption + (frame.after ? ' ' + frame.after : '');
  return Math.max(frame.banner ? 2600 : 1700, demoReadingTime(text) - shownMs);
}

// ─── Piece elements (mirrors the piece markup in renderBoard) ───────────────
function buildDemoPiece(p) {
  const el = document.createElement('div');
  const colorCls = p.color === 'w' ? 'white' : 'black';
  if (p.tower) {
    el.className = `piece manned-tower ${colorCls}` + (p.fig ? ` figure-${p.fig}` : '');
    if (!p.fig) el.textContent = PIECES[p.color + 'R'];
    const badge = document.createElement('div');
    badge.className = `tower-pawn-badge ${colorCls}`;
    badge.textContent = PIECES[p.color + (p.tower === 'b' ? 'B' : 'P')];
    el.appendChild(badge);
    return el;
  }
  if (p.mounted) {
    el.className = `piece mounted ${colorCls}`;
    el.textContent = PIECES[p.color + 'N'];
    const badge = document.createElement('div');
    badge.className = `mount-king-badge ${colorCls}`;
    badge.textContent = PIECES[p.color + 'K'];
    el.appendChild(badge);
    return el;
  }
  el.className = `piece ${colorCls}` + (p.fig ? ` figure-${p.fig}` : '');
  if (!p.fig) el.textContent = PIECES[p.color + p.type.toUpperCase()];
  if (p.fig === 'ghoul') el.style.backgroundImage = `url("figures/images/ghoul${p.skin || 0}.png")`;
  if (p.badges.includes('stun')) {
    const b = document.createElement('div');
    b.className = 'stunlock-charge-badge';
    b.textContent = '⚡';
    el.appendChild(b);
  }
  if (p.badges.includes('teleport')) {
    const b = document.createElement('div');
    b.className = 'teleport-ready-badge';
    el.appendChild(b);
  }
  if (p.badges.includes('cooldown')) el.classList.add('reloading');
  return el;
}

// ─── Player ─────────────────────────────────────────────────────────────────
class AugmentDemoPlayer {
  constructor(container, { controls = false } = {}) {
    this.root = document.createElement('div');
    this.root.className = 'demo';
    this.root.innerHTML = `
      <div class="demo-board-wrap">
        <div class="demo-board"></div>
        <svg class="demo-fx" viewBox="0 0 8 8" preserveAspectRatio="none" aria-hidden="true"></svg>
        <div class="demo-banner hidden"></div>
      </div>
      <div class="demo-caption">
        <span class="demo-side"></span>
        <p class="demo-text"></p>
      </div>
      <div class="demo-footer">
        <div class="demo-progress"></div>
        ${controls ? `<div class="demo-controls">
          <button type="button" class="demo-btn" data-act="prev" aria-label="Previous step">‹</button>
          <button type="button" class="demo-btn" data-act="toggle" aria-label="Pause">❚❚</button>
          <button type="button" class="demo-btn" data-act="next" aria-label="Next step">›</button>
        </div>` : ''}
      </div>`;
    container.appendChild(this.root);
    this.boardWrap = this.root.querySelector('.demo-board-wrap');
    this.board = this.root.querySelector('.demo-board');
    this.fxLayer = this.root.querySelector('.demo-fx');
    this.banner = this.root.querySelector('.demo-banner');
    this.sideEl = this.root.querySelector('.demo-side');
    this.textEl = this.root.querySelector('.demo-text');
    this.progressEl = this.root.querySelector('.demo-progress');
    this.frames = [];
    this.index = 0;
    this.timer = null;
    this.playing = false;

    if (controls) {
      this.root.querySelector('.demo-controls').addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]');
        if (!act) return;
        if (act.dataset.act === 'toggle') this.playing ? this.pause() : this.play();
        else this.step(act.dataset.act === 'next' ? 1 : -1);
      });
    }
  }

  load(frames) {
    this.stop();
    this.frames = frames || [];
    // One progress pip per new caption ("beat"), not per frame.
    this.beats = [];
    this.frames.forEach((f, i) => {
      if (f.kind === 'quick') return;
      const prev = this.frames[i - 1];
      if (!prev || prev.caption !== f.caption || prev.kind === 'quick') this.beats.push(i);
    });
    this.progressEl.innerHTML = this.beats.map(() => '<span class="demo-pip"></span>').join('');
    // Reserve room for the longest caption so the popover doesn't jump in
    // size as captions change.
    const caption = this.root.querySelector('.demo-caption');
    caption.style.minHeight = '';
    let tallest = 0;
    for (const f of this.frames) {
      this.setCaptionText(f.caption, f.after);
      tallest = Math.max(tallest, caption.offsetHeight);
    }
    if (tallest) caption.style.minHeight = `${tallest}px`;
    this.index = 0;
    this.render(0, false);
  }

  setCaptionText(caption, after) {
    this.textEl.textContent = caption;
    if (after) {
      const span = document.createElement('span');
      span.className = 'demo-after';
      span.textContent = ' ' + after;
      this.textEl.appendChild(span);
    }
  }

  play() {
    this.playing = true;
    this.root.classList.remove('paused');
    this.updateToggle();
    this.schedule();
  }

  pause() {
    this.playing = false;
    this.root.classList.add('paused');
    clearTimeout(this.timer);
    this.updateToggle();
  }

  stop() {
    this.playing = false;
    clearTimeout(this.timer);
    clearInterval(this.cycleTimer);
  }

  updateToggle() {
    const btn = this.root.querySelector('[data-act="toggle"]');
    if (btn) {
      btn.textContent = this.playing ? '❚❚' : '▶';
      btn.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
    }
  }

  schedule() {
    clearTimeout(this.timer);
    if (!this.playing || !this.frames.length) return;
    const frame = this.frames[this.index];
    const wait = demoFrameDuration(frame, this.frames[this.index + 1], Date.now() - this.captionShownAt);
    this.timer = setTimeout(() => {
      if (this.index < this.frames.length - 1) {
        this.render(this.index + 1, true);
      } else {
        // Loop: brief fade, then restart from the opening position.
        this.boardWrap.classList.add('demo-resetting');
        this.timer = setTimeout(() => {
          this.boardWrap.classList.remove('demo-resetting');
          this.render(0, false);
          this.schedule();
        }, 450);
        return;
      }
      this.schedule();
    }, wait);
  }

  step(delta) {
    this.pause();
    const target = Math.max(0, Math.min(this.frames.length - 1, this.index + delta));
    this.render(target, delta === 1);
  }

  render(index, animate) {
    const frame = this.frames[index];
    if (!frame) return;
    const prevFrame = this.frames[this.index];
    this.index = index;
    const size = this.board.clientWidth || 256;
    const cell = size / 8;

    // Squares — same structure and classes as renderBoard.
    this.board.innerHTML = '';
    const squareEls = {};
    for (let r = 8; r >= 1; r--) {
      for (let f = 0; f < 8; f++) {
        const sq = DEMO_FILES[f] + r;
        const el = document.createElement('div');
        el.className = 'square ' + ((f + r) % 2 === 1 ? 'light' : 'dark');
        const classes = frame.squares[sq] || [];
        classes.forEach(c => el.classList.add(c));
        // An effect zone that just appeared (fire, lightning, sun marks,
        // chains…) flashes in rather than popping silently.
        if (animate && prevFrame) {
          const before = prevFrame.squares[sq] || [];
          if (classes.some(c => DEMO_EFFECT_CLASSES.includes(c) && !before.includes(c))) el.classList.add('demo-new');
        }
        if (f === 0) el.insertAdjacentHTML('beforeend', `<span class="rank-label">${r}</span>`);
        if (r === 1) el.insertAdjacentHTML('beforeend', `<span class="file-label">${DEMO_FILES[f]}</span>`);
        this.board.appendChild(el);
        squareEls[sq] = el;
      }
    }

    const offset = (fromSq, toSq) => {
      const a = demoSquareXY(fromSq), b = demoSquareXY(toSq);
      return `translate(${(a.x - b.x) * cell}px, ${(a.y - b.y) * cell}px)`;
    };
    const movers = [];

    for (const p of frame.pieces) {
      const el = buildDemoPiece(p);
      squareEls[p.sq].appendChild(el);
      if (!animate) continue;
      if (p.from) {
        el.style.transform = offset(p.from, p.sq);
        el.classList.add('demo-moving');
        movers.push(el);
      } else if (p.spawnFrom) {
        // Stepping out of a tower / off a knight: slides out of the host.
        el.style.transform = offset(p.spawnFrom, p.sq);
        el.classList.add('demo-moving');
        movers.push(el);
      } else if (p.spawn) {
        el.classList.add('demo-spawn-' + p.spawn);
      }
    }

    if (animate) {
      for (const r of frame.removed) {
        const ghost = buildDemoPiece(r);
        ghost.classList.add('demo-ghost', 'demo-out-' + r.style);
        squareEls[r.sq].appendChild(ghost);
        if (r.into) {
          const a = demoSquareXY(r.sq), b = demoSquareXY(r.into);
          ghost.style.setProperty('--dx', `${(b.x - a.x) * cell}px`);
          ghost.style.setProperty('--dy', `${(b.y - a.y) * cell}px`);
          ghost.classList.add('demo-into');
        }
      }
      // Commit the offsets, then let them transition back to zero.
      void this.board.offsetWidth;
      movers.forEach(el => { el.style.transform = ''; });
    }

    this.renderFx(animate ? frame.fx : []);

    this.banner.classList.toggle('hidden', !frame.banner);
    if (frame.banner) this.banner.textContent = frame.banner;

    const sideName = frame.side === 'w' ? 'White' : 'Black';
    this.sideEl.textContent = sideName;
    this.sideEl.className = 'demo-side ' + (frame.side === 'w' ? 'white' : 'black');
    if (!prevFrame || prevFrame.caption !== frame.caption || index === 0 || !animate) {
      this.captionShownAt = Date.now();
      this.setCaptionText(frame.caption, frame.after);
      this.textEl.classList.remove('demo-text-in');
      void this.textEl.offsetWidth;
      this.textEl.classList.add('demo-text-in');
    } else if (frame.after && !prevFrame.after) {
      // Same step, its result just landed: append the follow-up text.
      this.setCaptionText(frame.caption, frame.after);
    }

    this.runTargetCycle(frame, squareEls);
    this.textEl.classList.toggle('demo-text-quick', frame.kind === 'quick');

    const beat = this.beats.filter(b => b <= index).length - 1;
    this.progressEl.querySelectorAll('.demo-pip').forEach((pip, i) => {
      pip.classList.toggle('done', i < beat);
      pip.classList.toggle('current', i === beat);
    });
  }

  // Targeting frames sweep the preview highlight across a few other valid
  // choices before settling on the one actually cast.
  runTargetCycle(frame, squareEls) {
    clearInterval(this.cycleTimer);
    if (!frame.targetCycle) return;
    const { cls, sets } = frame.targetCycle;
    const show = (squares) => {
      Object.values(squareEls).forEach(el => el.classList.remove(cls));
      squares.forEach(sq => squareEls[sq] && squareEls[sq].classList.add(cls));
    };
    let i = 0;
    show(sets[0]);
    if (sets.length < 2) return;
    this.cycleTimer = setInterval(() => {
      i++;
      show(sets[i]);
      if (i >= sets.length - 1) clearInterval(this.cycleTimer);
    }, DEMO_CYCLE_STEP);
  }

  // Projectile streaks for shots (arrows, fireball, silver bullet), drawn
  // in board units over the squares.
  renderFx(fx) {
    this.fxLayer.innerHTML = '';
    for (const e of fx || []) {
      const a = demoSquareXY(e.from), b = demoSquareXY(e.to);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x + 0.5); line.setAttribute('y1', a.y + 0.5);
      line.setAttribute('x2', b.x + 0.5); line.setAttribute('y2', b.y + 0.5);
      line.setAttribute('class', 'demo-fx-line demo-fx-' + e.kind);
      line.setAttribute('pathLength', '1');
      this.fxLayer.appendChild(line);
      const burst = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      burst.setAttribute('cx', b.x + 0.5); burst.setAttribute('cy', b.y + 0.5); burst.setAttribute('r', '0.42');
      burst.setAttribute('class', 'demo-fx-burst demo-fx-' + e.kind);
      this.fxLayer.appendChild(burst);
    }
  }
}

// ─── Hover popover + skill-tree branches ────────────────────────────────────
// Hovering an augment shows its popover; an augment with extensions also
// grows a branch out from under its card, with the extensions hanging off a
// horizontal rail. The branch is a real hover target, so a player can move
// down from an augment onto its extensions and read each one's popover too.
const AugmentDemoPopover = (() => {
  let el = null, player = null, currentId = null, showTimer = null, anchor = null;
  let branch = null, branchOwner = null;
  let mouse = null; // last known cursor position — the popover is placed around it
  const SHOW_DELAY = 120;
  // Cards that sprout a branch (the draft grid, the Augments page, the home
  // page strip) — small icons elsewhere just get the popover.
  const BRANCHING = '.augment-card, .augment-card-upright, .marquee-item';

  function build() {
    el = document.createElement('div');
    el.className = 'aug-popover';
    el.setAttribute('role', 'tooltip');
    el.innerHTML = `
      <div class="aug-pop-head">
        <img class="emblem aug-pop-emblem" alt="">
        <div class="aug-pop-titles">
          <div class="aug-pop-name"></div>
          <div class="aug-pop-meta"></div>
        </div>
      </div>
      <div class="aug-pop-body">
        <div class="aug-pop-demo"></div>
        <div class="aug-pop-rules">
          <div class="aug-pop-label">How it works</div>
          <p class="aug-pop-desc"></p>
        </div>
      </div>`;
    document.body.appendChild(el);
    player = new AugmentDemoPlayer(el.querySelector('.aug-pop-demo'));
  }

  function fill(aug) {
    el.querySelector('.aug-pop-emblem').src = augmentIconUrl(aug.id);
    el.querySelector('.aug-pop-name').textContent = aug.name;
    const meta = el.querySelector('.aug-pop-meta');
    meta.innerHTML = '';
    meta.appendChild(kindTag(aug));
    meta.appendChild(costBadge(aug.cost));
    if (aug.requires) meta.appendChild(requiresTag(aug));
    el.querySelector('.aug-pop-desc').textContent = aug.desc;
  }

  // ── Branches ──────────────────────────────────────────────────────────
  function showBranch(card) {
    if (branchOwner === card) return;
    hideBranch();
    const aug = AUGMENTS.find(a => a.id === card.dataset.augId);
    const children = aug ? AUGMENTS.filter(a => a.requires === aug.id) : [];
    if (!children.length) return;

    branch = document.createElement('div');
    branch.className = 'aug-branch';
    branch.innerHTML = '<svg class="aug-branch-lines" aria-hidden="true"></svg><div class="aug-branch-row"></div>';
    const row = branch.querySelector('.aug-branch-row');
    children.forEach((c, i) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'aug-branch-node';
      node.dataset.augId = c.id;
      node.style.setProperty('--i', i);
      node.appendChild(emblemImg(augmentIconUrl(c.id), c.name));
      node.insertAdjacentHTML('beforeend', `<span class="abn-name"></span><span class="abn-cost">${c.cost}</span>`);
      node.querySelector('.abn-name').textContent = c.name;
      node.addEventListener('click', () => { hideAll(); showAugmentDetail(c); });
      row.appendChild(node);
    });
    document.body.appendChild(branch);
    branchOwner = card;
    // Hold the home-page strip still while its branch is open.
    const strip = card.closest('.augment-marquee');
    if (strip) strip.classList.add('held');
    placeBranch(card);
  }

  // Hangs the branch directly under the card (or above it, mirrored, when
  // there's no room below), centred on it and kept on screen, then draws the
  // connectors: trunk from the card's centre, a horizontal rail, and a drop
  // to every extension.
  function placeBranch(card) {
    const c = card.getBoundingClientRect();
    const w = branch.offsetWidth, h = branch.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight, pad = 8;
    const up = c.bottom + h > vh - pad && c.top - h >= pad;
    branch.classList.toggle('up', up);
    const left = Math.min(Math.max(pad, c.left + c.width / 2 - w / 2), vw - w - pad);
    branch.style.left = `${Math.round(left)}px`;
    branch.style.top = `${Math.round(up ? c.top - h : c.bottom)}px`;

    const lines = branch.querySelector('.aug-branch-lines');
    const LINK = 26; // connector band height (see .aug-branch padding)
    const trunkX = Math.min(Math.max(2, c.left + c.width / 2 - left), w - 2);
    const centers = [...branch.querySelectorAll('.aug-branch-node')]
      .map(n => n.offsetLeft + n.offsetWidth / 2);
    const railY = LINK / 2;
    const y = (v) => (up ? h - v : v); // mirror the connectors when hanging above
    const minX = Math.min(trunkX, ...centers), maxX = Math.max(trunkX, ...centers);
    lines.setAttribute('viewBox', `0 0 ${w} ${h}`);
    lines.innerHTML =
      `<path class="abl-trunk" pathLength="1" d="M${trunkX} ${y(0)} V${y(railY)}"/>` +
      `<path class="abl-rail" pathLength="1" d="M${trunkX} ${y(railY)} H${minX} M${trunkX} ${y(railY)} H${maxX}"/>` +
      centers.map((x, i) => `<path class="abl-drop" style="--i:${i}" pathLength="1" d="M${x} ${y(railY)} V${y(LINK)}"/>`).join('');
  }

  function hideBranch() {
    document.querySelectorAll('.augment-marquee.held').forEach(s => s.classList.remove('held'));
    if (branch) branch.remove();
    branch = null;
    branchOwner = null;
  }

  // ── Popover ───────────────────────────────────────────────────────────
  function overlaps(a, b) {
    return a.left < b.right && a.left + a.width > b.left && a.top < b.bottom && a.top + a.height > b.top;
  }

  // Placed around the cursor, never under it: above it if there's room,
  // otherwise to its right, then its left — and clear of an open branch so
  // its extensions stay reachable. Only when the screen is too small for all
  // of that does it go below (or, failing that, as close as fits).
  function position() {
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight, gap = 16, pad = 10;
    let m = mouse;
    if (!m) {
      const r = anchor.getBoundingClientRect();
      m = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    const clampX = x => Math.min(Math.max(pad, x), vw - w - pad);
    const clampY = y => Math.max(pad, Math.min(y, vh - h - pad));
    const avoid = branch ? branch.getBoundingClientRect() : null;
    const candidates = [
      { left: clampX(m.x - w / 2), top: m.y - gap - h, fits: m.y - gap - h >= pad && w <= vw - 2 * pad },
      { left: m.x + gap, top: clampY(m.y - h / 2), fits: m.x + gap + w <= vw - pad && h <= vh - 2 * pad },
      { left: m.x - gap - w, top: clampY(m.y - h / 2), fits: m.x - gap - w >= pad && h <= vh - 2 * pad },
    ];
    if (avoid) {
      // Hovering inside a branch: clear the whole row, still above the cursor
      // where possible.
      candidates.push(
        { left: clampX(m.x - w / 2), top: avoid.top - gap - h, fits: avoid.top - gap - h >= pad && w <= vw - 2 * pad },
        { left: clampX(m.x - w / 2), top: avoid.bottom + gap, fits: avoid.bottom + gap + h <= vh - pad && w <= vw - 2 * pad },
      );
    }
    candidates.push({ left: clampX(m.x - w / 2), top: m.y + gap, fits: m.y + gap + h <= vh - pad && w <= vw - 2 * pad });
    const clear = c => !avoid || !overlaps({ left: c.left, top: c.top, width: w, height: h }, avoid);
    const pick = candidates.find(c => c.fits && clear(c)) || candidates.find(c => c.fits)
      || { left: clampX(m.x - w / 2), top: clampY(m.y - gap - h) };
    el.style.left = `${Math.round(pick.left)}px`;
    el.style.top = `${Math.round(pick.top)}px`;
  }

  function show(target) {
    const augId = target.dataset.augId;
    const aug = AUGMENTS.find(a => a.id === augId);
    if (!aug) return;
    let frames;
    try {
      frames = getAugmentDemo(augId);
    } catch (err) {
      console.error(`Augment demo "${augId}" failed:`, err);
      frames = null;
    }
    if (!el) build();
    anchor = target;
    fill(aug);
    el.classList.toggle('no-demo', !frames);
    if (frames && currentId !== augId) player.load(frames);
    else if (frames) player.render(0, false);
    currentId = augId;
    position();
    el.classList.add('visible');
    if (frames) player.play();
  }

  function hidePopover() {
    clearTimeout(showTimer);
    anchor = null;
    if (!el) return;
    el.classList.remove('visible');
    player.stop();
  }

  function hideAll() {
    hidePopover();
    hideBranch();
  }

  // Hover only in practice: a touch tap's emulated mouseover is followed at
  // once by mousedown, which cancels the pending show (touch devices get the
  // demo in the detail modal instead).
  function init() {
    document.addEventListener('mousemove', (e) => { mouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
    document.addEventListener('mouseover', (e) => {
      mouse = { x: e.clientX, y: e.clientY };
      const inBranch = e.target.closest('.aug-branch');
      const target = e.target.closest('[data-aug-id]');
      // Crossing the connector band between a card and its extensions.
      if (inBranch && !target) return;
      if (target === anchor) return;
      if (!target || target.closest('.aug-popover, #augment-detail-modal')) { hideAll(); return; }

      hidePopover();
      if (!inBranch) {
        if (target.matches(BRANCHING)) showBranch(target);
        else hideBranch();
      }
      anchor = target;
      showTimer = setTimeout(() => { if (anchor === target) show(target); }, SHOW_DELAY);
    });
    document.addEventListener('mouseleave', hideAll);
    window.addEventListener('scroll', hideAll, true);
    // Clicking (a draft pick, opening the detail modal) changes what's under
    // the cursor — get out of the way.
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.aug-branch')) hideAll();
    }, true);
  }

  return { init, hide: hideAll };
})();

// ─── Detail modal player ────────────────────────────────────────────────────
let detailDemoPlayer = null;

function showAugmentDemoInDetail(augId) {
  const host = document.getElementById('detail-demo');
  if (!host) return;
  let frames = null;
  try { frames = getAugmentDemo(augId); } catch (err) { console.error(`Augment demo "${augId}" failed:`, err); }
  host.classList.toggle('hidden', !frames);
  if (!frames) return;
  if (!detailDemoPlayer) detailDemoPlayer = new AugmentDemoPlayer(host, { controls: true });
  detailDemoPlayer.load(frames);
  detailDemoPlayer.play();
}

function stopAugmentDemoInDetail() {
  if (detailDemoPlayer) detailDemoPlayer.stop();
}

document.addEventListener('DOMContentLoaded', AugmentDemoPopover.init);
