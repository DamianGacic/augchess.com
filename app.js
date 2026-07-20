/**
 * app.js — AugChess client: rendering, input handling, and the dispatch bridge
 * to the shared engine. All game logic (move generation, check detection,
 * move execution, game-over) lives in engine/*.js and is reused verbatim here
 * — this file never re-implements any of it.
 *
 * Two play modes share one code path:
 *   - Hotseat (local, no server): dispatch() applies actions directly against
 *     the local `state` via engine.applyAction, exactly like the server does.
 *   - Networked (server-authoritative): dispatch() sends the action over
 *     NetClient; `state` is only ever replaced wholesale by the server's next
 *     broadcast — this client never mutates it directly.
 * Either way, rendering code only ever reads `state` — it doesn't know or
 * care which mode produced it.
 *
 * Relies on (loaded before this file in index.html):
 *   chess.js, data.js, engine/draft-engine.js, engine/chess-engine.js,
 *   engine/gameover-engine.js, engine/augments-engine.js, engine/index.js,
 *   netclient.js, stunlock.js, abilities.js, draft.js, clock.js, views.js
 */

// ─── Play mode ────────────────────────────────────────────────────────────────
let netMode = false;   // true once connected to a server room
let myColor = null;    // 'w' | 'b' | null (spectator, or hotseat = unrestricted)

// ─── Shared game/draft state (see engine/draft-engine.js createRoomState) ─────
let state = createRoomState();

// ─── Pure client-local UI state — never touches the server ────────────────────
let flipped = false;
let selectedSquare = null;
let legalMoves = [];          // array of move objects (standard + special)
let pendingPromotion = null;
let dragState = null;
let lastClickSquare = null;
let lastClickTime = 0;
let undoStack = [];           // hotseat only

const boardEl         = document.getElementById('board');
const statusText      = document.getElementById('status-text');
const statusBox       = document.getElementById('status-box');
const moveListEl      = document.getElementById('move-list');
const capturedWhite   = document.getElementById('captured-by-white');
const capturedBlack   = document.getElementById('captured-by-black');
const promotionModal  = document.getElementById('promotion-modal');
const promotionPieces = document.getElementById('promotion-pieces');
const clockWhiteEl    = document.getElementById('clock-white');
const clockBlackEl    = document.getElementById('clock-black');
const activeAugmentsEl= document.getElementById('active-augments');

const dragGhost = document.createElement('div');
dragGhost.id = 'drag-ghost';
document.body.appendChild(dragGhost);

document.getElementById('btn-new-game').addEventListener('click', () => {
  dispatch({ type: 'newGame' }); // harmless no-op if already mid-settings/draft
  showGameSettings();
});
document.getElementById('btn-flip').addEventListener('click', () => { flipped = !flipped; renderBoard(); });
document.getElementById('btn-undo').addEventListener('click', undoMove);
document.getElementById('btn-undo').classList.toggle('hidden', netMode);

// ═══════════════════════════════════════════════════════════════════════════════
//  DISPATCH — the single bridge between a user action and the shared engine
// ═══════════════════════════════════════════════════════════════════════════════
// Who is "acting" for actions that need a color but aren't a per-seat network
// message locally (settings/newGame don't check color at all).
function currentActor() {
  // A Stunlock cast/cancel happens AFTER its bishop's move already flipped
  // state.game.turn() to the opponent — the caster is whoever armed it, not
  // whoever is "to move" right now.
  if (state.pendingStunlock) return state.pendingStunlock.color;
  if (state.phase === 'draft' && state.draftState) return state.draftState.current;
  if (state.phase === 'playing' && state.game) return state.game.turn();
  return 'w';
}

function dispatch(action) {
  if (netMode) {
    NetClient.send(action);
    return;
  }
  pushUndoSnapshot();
  const err = applyAction(state, currentActor(), action);
  if (err) { undoStack.pop(); console.warn('Action rejected:', err); return; }
  renderAll();
}

function isMyTurn() {
  if (!netMode) return true;
  return !!(state.game && myColor && state.game.turn() === myColor);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NETWORKING — wire NetClient callbacks to state replacement + rendering
// ═══════════════════════════════════════════════════════════════════════════════
let netStateUpdateCount = 0;
NetClient.onState((incoming) => {
  state = incoming;
  if (state.game) {
    const liveGame = new Chess();
    liveGame.load(state.game.fen);
    state.game = liveGame;
  }
  myColor = NetClient.myColor;
  updateMpBadge();
  // The host's first state message is just their own join echo; a SECOND one
  // means someone else's connection changed the room — that's the signal to
  // stop showing "share this link" and reveal the game underneath.
  netStateUpdateCount++;
  if (netStateUpdateCount > 1 && mpModal && !mpModal.classList.contains('hidden')) {
    mpModal.classList.add('hidden');
    showView('game');
  }
  renderAll();
});

NetClient.onRejected((reason) => {
  console.warn('Action rejected:', reason);
  flashStatus(reason);
});

// Fires the instant color/token are actually known (right after the
// server's {type:'joined'} reply) — NOT the same moment as onOpen, which
// fires on the raw WebSocket handshake, strictly before that reply can have
// arrived. Anything that needs myColor immediately (board flip) belongs
// here, not in an onOpen handler.
NetClient.onJoined((joinedColor) => {
  myColor = joinedColor;
  if (joinedColor === 'b') flipped = true;
  updateMpBadge();
});

NetClient.onOpen(() => {
  netMode = true;
  reconnecting = false;
  document.getElementById('btn-undo').classList.add('hidden');
  updateMpBadge();
});

NetClient.onClose(() => {
  updateMpBadge();
});

let reconnecting = false;
NetClient.onReconnecting((attempt) => {
  reconnecting = true;
  updateMpBadge();
});

function flashStatus(text) {
  const prev = statusText.textContent;
  statusText.textContent = text;
  setTimeout(() => { if (state.phase === 'playing') updateStatus(); else statusText.textContent = prev; }, 1500);
}

function updateMpBadge() {
  const badge = document.getElementById('mp-badge');
  if (!badge) return;
  if (netMode && NetClient.active) {
    reconnecting = false;
    const colorLabel = myColor === 'w' ? 'White' : myColor === 'b' ? 'Black' : 'Spectator';
    badge.textContent = `🟢 Online · You are ${colorLabel}`;
    badge.classList.remove('hidden');
  } else if (netMode && reconnecting) {
    badge.textContent = '🟡 Reconnecting…';
    badge.classList.remove('hidden');
  } else if (netMode) {
    badge.textContent = '🔴 Disconnected';
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// Called by views.js "Create Game Link" button.
async function createGameLink() {
  showMpModal('Create Game Link', 'Generating your game link…', false, true);
  const gameId = await NetClient.createRoom();
  const url = buildGameUrl(gameId);
  // Runs on every (re)connect, including automatic reconnects after a
  // dropped connection — cheap to re-show since it's a no-op once the host
  // has already moved past this modal (see the netStateUpdateCount guard in
  // the shared onState handler above).
  NetClient.onOpen(() => {
    netMode = true;
    reconnecting = false;
    document.getElementById('btn-undo').classList.add('hidden');
    updateMpBadge();
    document.getElementById('mp-link-input').value = url;
    showMpModal('Share this link', 'Send this link to your friend. You will play as White.', true, true);
  });
  NetClient.connect(gameId);
}

// Called on page load when the URL has ?game=<id> — auto-join as guest/spectator.
function joinGameFromUrl(gameId) {
  showMpModal('Joining Game', 'Connecting…', false, true);
  NetClient.onOpen(() => {
    netMode = true;
    reconnecting = false;
    document.getElementById('btn-undo').classList.add('hidden');
    updateMpBadge();
    document.getElementById('mp-modal').classList.add('hidden');
    showView('game');
  });
  NetClient.connect(gameId);
}

// ─── Multiplayer modal (unchanged UI from the old multiplayer.js) ────────────
let mpModal = null, mpStatusEl = null, mpLinkInput = null, mpCopyBtn = null, mpCloseBtn = null;
function buildMpModal() {
  if (mpModal) return;
  mpModal = document.createElement('div');
  mpModal.id = 'mp-modal';
  mpModal.className = 'modal hidden';
  mpModal.innerHTML = `
    <div class="modal-content mp-modal-content">
      <h3 id="mp-modal-title">Multiplayer</h3>
      <p id="mp-status" class="mp-status"></p>
      <div id="mp-link-row" class="mp-link-row hidden">
        <input id="mp-link-input" class="mp-link-input" type="text" readonly />
        <button id="mp-copy-btn" class="btn btn-secondary mp-copy-btn">Copy</button>
      </div>
      <div id="mp-spinner" class="mp-spinner hidden">
        <div class="mp-dot"></div><div class="mp-dot"></div><div class="mp-dot"></div>
      </div>
      <button id="mp-close-btn" class="btn btn-secondary" style="margin-top:16px">Close</button>
    </div>`;
  document.body.appendChild(mpModal);
  mpStatusEl  = document.getElementById('mp-status');
  mpLinkInput = document.getElementById('mp-link-input');
  mpCopyBtn   = document.getElementById('mp-copy-btn');
  mpCloseBtn  = document.getElementById('mp-close-btn');
  mpCopyBtn.addEventListener('click', () => {
    mpLinkInput.select();
    navigator.clipboard.writeText(mpLinkInput.value).then(() => {
      mpCopyBtn.textContent = 'Copied!';
      setTimeout(() => { mpCopyBtn.textContent = 'Copy'; }, 2000);
    }).catch(() => {
      document.execCommand('copy');
      mpCopyBtn.textContent = 'Copied!';
      setTimeout(() => { mpCopyBtn.textContent = 'Copy'; }, 2000);
    });
  });
  mpCloseBtn.addEventListener('click', () => mpModal.classList.add('hidden'));
  mpModal.addEventListener('click', (e) => { if (e.target === mpModal) mpModal.classList.add('hidden'); });
}
function showMpModal(title, status, showLink, showSpinner) {
  buildMpModal();
  document.getElementById('mp-modal-title').textContent = title;
  mpStatusEl.textContent = status;
  document.getElementById('mp-link-row').classList.toggle('hidden', !showLink);
  document.getElementById('mp-spinner').classList.toggle('hidden', !showSpinner);
  mpModal.classList.remove('hidden');
}
document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('header');
  if (header) {
    const badge = document.createElement('div');
    badge.id = 'mp-badge';
    badge.className = 'mp-badge hidden';
    header.appendChild(badge);
  }
  const gameId = getGameIdFromUrl();
  if (gameId) setTimeout(() => joinGameFromUrl(gameId), 300);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  UNDO (hotseat only — networked play has no client-side undo)
// ═══════════════════════════════════════════════════════════════════════════════
function pushUndoSnapshot() {
  if (netMode) return;
  const clone = JSON.parse(JSON.stringify(state, (k, v) => (k === 'game' ? undefined : v)));
  clone.gameFen = state.game ? state.game.fen() : null;
  undoStack.push(clone);
}

function undoMove() {
  if (netMode || undoStack.length === 0) return;
  const snap = undoStack.pop();
  const fen = snap.gameFen;
  delete snap.gameFen;
  state = snap;
  if (fen) { state.game = new Chess(); state.game.load(fen); }
  selectedSquare = null;
  legalMoves = [];
  stopStunlockTargeting();
  if (state.pendingStunlock) beginStunlockTargeting();
  renderAll();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RENDER DISPATCH — derives modal/view visibility from state.phase, then
//  renders whatever's relevant for the current phase.
// ═══════════════════════════════════════════════════════════════════════════════
let lastRenderedPhase = null;

function renderAll() {
  const enteringPlaying = state.phase === 'playing' && lastRenderedPhase !== 'playing';
  lastRenderedPhase = state.phase;
  if (enteringPlaying) resetClockForNewGame();

  if (state.phase === 'settings') {
    settingsModal.classList.remove('hidden');
    augmentModal.classList.add('hidden');
    syncSettingsUI();
    return;
  }
  if (state.phase === 'draft') {
    settingsModal.classList.add('hidden');
    augmentModal.classList.remove('hidden');
    renderDraft();
    return;
  }
  // 'playing' — covers both an ongoing game and a finished one (state.gameOver).
  settingsModal.classList.add('hidden');
  augmentModal.classList.add('hidden');
  syncStunlockTargeting();
  if (selectedSquare) legalMoves = computeLegalMovesFor(selectedSquare);
  if (!clockStarted && state.moveLog.length >= 2) { clockStarted = true; startClock(); }
  switchClock();

  renderBoard();
  renderMoveList();
  updateStatus();
  updateCaptured();
  renderActiveAugments();
  if (state.gameOver) stopClock();
}

function computeLegalMovesFor(sq) {
  if (state.specialSelect && state.specialSelect.square === sq) return generateExitMoves(state, sq);
  return generateMoves(state, sq);
}

function renderActiveAugments() {
  activeAugmentsEl.querySelectorAll('.aa-item').forEach(e => e.remove());
  let count = 0;
  ['w', 'b'].forEach(c => {
    state.augments[c].forEach(id => {
      const aug = AUGMENTS.find(a => a.id === id);
      const item = document.createElement('div');
      item.className = 'aa-item';
      item.innerHTML = `<span class="aa-dot ${c === 'w' ? 'white' : 'black'}"></span>${aug.name}`;
      item.title = aug.desc;
      activeAugmentsEl.appendChild(item);
      count++;
    });
  });
  activeAugmentsEl.classList.toggle('has-items', count > 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MOVE SUBMISSION
// ═══════════════════════════════════════════════════════════════════════════════
function attemptMove(from, to) {
  const move = legalMoves.find(m => m.to === to);
  if (!move) return;

  const piece = pieceAt(state, from);
  const reachesPromo = piece && piece.type === 'p' &&
    ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));

  if ((move.standard && reachesPromo) || move.needsPromo) {
    pendingPromotion = { from, to, move };
    showPromotionModal(piece.color);
    return;
  }
  submitMove(move);
}

function submitMove(move, promotionChoice) {
  dispatch({ type: 'move', from: move.from, to: move.to, promotion: promotionChoice });
  selectedSquare = null;
  legalMoves = [];
  if (!netMode) return; // hotseat: dispatch() already re-rendered via engine.applyAction
}

function showPromotionModal(color) {
  promotionPieces.innerHTML = '';
  ['q', 'r', 'b', 'n'].forEach(p => {
    const btn = document.createElement('div');
    btn.className = 'promotion-piece';
    btn.title = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[p];
    btn.textContent = PIECES[color + p.toUpperCase()];
    btn.style.color = color === 'w' ? '#d0d0d0' : '#2e2e2e';
    btn.addEventListener('click', () => {
      promotionModal.classList.add('hidden');
      if (pendingPromotion) {
        submitMove(pendingPromotion.move, p);
        pendingPromotion = null;
      }
    });
    promotionPieces.appendChild(btn);
  });
  promotionModal.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RENDER BOARD
// ═══════════════════════════════════════════════════════════════════════════════
function renderBoard() {
  const gameLayout = document.querySelector('.game-layout');
  if (gameLayout) gameLayout.classList.toggle('flipped', flipped);

  boardEl.innerHTML = '';
  const files = ['a','b','c','d','e','f','g','h'];
  const ranks = ['8','7','6','5','4','3','2','1'];
  const displayRanks = flipped ? [...ranks].reverse() : ranks;
  const displayFiles = flipped ? [...files].reverse() : files;

  let archerShootRange = null;
  let ghoulChargeRange = null;
  let longbowShootRange = null;
  if (selectedSquare) {
    const selPiece = pieceAt(state, selectedSquare);
    if (selPiece && selPiece.type === 'p') {
      const selFigure = figurePawnType(state, selPiece.color);
      if (selFigure === 'archer') archerShootRange = archerShootRangeSquares(selectedSquare, selPiece.color);
      else if (selFigure === 'ghoul') ghoulChargeRange = ghoulChargeSquares(state, selectedSquare, selPiece.color);
    } else if (selPiece && selPiece.type === 'b' && figureBishopType(state, selPiece.color) === 'longbowman') {
      longbowShootRange = longbowShootRangeSquares(selectedSquare);
    }
  }

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const rank = displayRanks[r];
      const file = displayFiles[f];
      const sq = file + rank;

      const isLight = (files.indexOf(file) + parseInt(rank)) % 2 === 1;
      const sqEl = document.createElement('div');
      sqEl.className = 'square ' + (isLight ? 'light' : 'dark');
      sqEl.dataset.square = sq;

      if (ALL_TOWERS.includes(sq) && (has(state, 'w', 'watchtowers') || has(state, 'b', 'watchtowers'))) {
        sqEl.classList.add('tower');
      }

      if (f === 0) {
        const label = document.createElement('span');
        label.className = 'rank-label';
        label.textContent = rank;
        sqEl.appendChild(label);
      }
      if (r === 7) {
        const label = document.createElement('span');
        label.className = 'file-label';
        label.textContent = file;
        sqEl.appendChild(label);
      }

      if (state.lastMove && (sq === state.lastMove.from || sq === state.lastMove.to)) sqEl.classList.add('last-move');
      if (selectedSquare === sq) sqEl.classList.add('selected');

      const lm = legalMoves.find(m => m.to === sq);
      if (lm) {
        if (lm.special === 'archerShoot' || lm.special === 'longbowmanShoot') {
          sqEl.classList.add('legal-shoot');
        } else if (lm.special === 'ghoulCharge' || lm.special === 'ghoulDiagCharge') {
          sqEl.classList.add('legal-claw');
        } else {
          const isCapture = (pieceAt(state, sq) && pieceAt(state, sq).color !== state.game.turn()) || lm.captured;
          sqEl.classList.add(isCapture ? 'legal-capture' : 'legal-move');
        }
        sqEl.classList.add('can-move');
      }
      if (archerShootRange && archerShootRange.includes(sq) && !(lm && lm.special === 'archerShoot')) {
        sqEl.classList.add('shoot-range-preview');
      }
      if (longbowShootRange && longbowShootRange.includes(sq) && !(lm && lm.special === 'longbowmanShoot')) {
        sqEl.classList.add('shoot-range-preview');
      }
      if (ghoulChargeRange && ghoulChargeRange.includes(sq) &&
          !(lm && (lm.special === 'ghoulCharge' || lm.special === 'ghoulDiagCharge'))) {
        sqEl.classList.add('claw-range-preview');
      }

      if (!state.mounted.w && !state.mounted.b && !anyFigurePawnsInPlay(state) && !anyFigureRooksInPlay(state) && !anyFigureBishopsInPlay(state) && state.game.in_check()) {
        const kingSquare = findKingSquare(state, state.game.turn());
        if (kingSquare === sq) sqEl.classList.add('in-check');
      }

      if (state.stunnedSquares[sq] > 0) sqEl.classList.add('stunned');

      if (stunlockTargeting && state.pendingStunlock) {
        const validQuads = getStunlockQuadrants(state.pendingStunlock.bishopSq);
        const isTargetable = validQuads.some(({ f: qf, r: qr }) => quadrantSquares(qf, qr).includes(sq));
        if (isTargetable) sqEl.classList.add('stunlock-target');
        if (stunlockHoverQuad && quadrantSquares(stunlockHoverQuad.f, stunlockHoverQuad.r).includes(sq)) {
          sqEl.classList.add('stunlock-preview');
        }
        sqEl.classList.add('can-move');
      }

      if (solarStrikeTargeting && pendingSolarStrike) {
        const validCenters = getSolarStrikeCenters(pendingSolarStrike.queenSq);
        const isTargetable = validCenters.some(({ f: cf, r: cr }) => solarStrikeSquares(cf, cr).includes(sq));
        if (isTargetable) sqEl.classList.add('solarstrike-target');
        if (solarStrikeHoverCenter && solarStrikeSquares(solarStrikeHoverCenter.f, solarStrikeHoverCenter.r).includes(sq)) {
          sqEl.classList.add('solarstrike-preview');
        }
        sqEl.classList.add('can-move');
      }

      if (clubbingTargeting && pendingClubbing) {
        const validQuads = getClubbingQuadrants(pendingClubbing.trollSq);
        const isTargetable = validQuads.some(({ f: qf, r: qr }) => quadrantSquares(qf, qr).includes(sq));
        if (isTargetable) sqEl.classList.add('clubbing-target');
        if (clubbingHoverQuad && quadrantSquares(clubbingHoverQuad.f, clubbingHoverQuad.r).includes(sq)) {
          sqEl.classList.add('clubbing-preview');
        }
        sqEl.classList.add('can-move');
      }

      if (silverBulletTargeting && pendingSilverBullet) {
        const validTargets = getSilverBulletTargets(state, pendingSilverBullet.kingSq, pendingSilverBullet.color);
        if (validTargets.includes(sq)) sqEl.classList.add('silverbullet-target');
        if (silverBulletHoverSq === sq) sqEl.classList.add('silverbullet-preview');
        sqEl.classList.add('can-move');
      }

      if (unstableFireballTargeting && pendingUnstableFireball) {
        const validTargets = getFireballTargets(state, pendingUnstableFireball.apprenticeSq, pendingUnstableFireball.color);
        if (validTargets.includes(sq)) sqEl.classList.add('fireball-target');
        if (unstableFireballHoverSq === sq) sqEl.classList.add('fireball-preview');
        sqEl.classList.add('can-move');
      }

      if (unstableTeleportTargeting && pendingUnstableTeleport) {
        const validTargets = getTeleportTargets(state, pendingUnstableTeleport.color);
        if (validTargets.includes(sq)) sqEl.classList.add('teleport-target');
        if (unstableTeleportHoverSq === sq) sqEl.classList.add('teleport-preview');
        sqEl.classList.add('can-move');
      }

      if (state.solarMarked[sq] > 0) sqEl.classList.add('solar-marked');
      if (state.teleportMarked[sq] > 0) sqEl.classList.add('teleport-marked');
      if (state.fireDeathMarked[sq] > 0) sqEl.classList.add('fire-death-marked');

      const piece = pieceAt(state, sq);
      if (state.mannedTowers[sq]) {
        const color = state.mannedTowers[sq];
        const isTroll = figureRookType(state, color) === 'troll';
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece manned-tower ' + (color === 'w' ? 'white' : 'black') + (isTroll ? ' figure-troll' : '');
        if (!isTroll) pieceEl.textContent = PIECES[color + 'R'];
        pieceEl.dataset.square = sq;
        attachPieceHandlers(pieceEl, sq);

        const badge = document.createElement('div');
        badge.className = 'tower-pawn-badge ' + (color === 'w' ? 'white' : 'black');
        badge.textContent = PIECES[color + 'P'];
        badge.title = 'Drag the pawn out of the tower';
        badge.addEventListener('mousedown', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          beginBadgeDrag(sq, color, ev.clientX, ev.clientY, false);
        });
        badge.addEventListener('touchstart', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          const t = ev.touches[0];
          beginBadgeDrag(sq, color, t.clientX, t.clientY, true);
        }, { passive: false });
        badge.addEventListener('click', (ev) => ev.stopPropagation());
        pieceEl.appendChild(badge);

        sqEl.appendChild(pieceEl);
      } else if (piece && state.mounted[piece.color] === sq && piece.type === 'k') {
        const color = piece.color;
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece mounted ' + (color === 'w' ? 'white' : 'black');
        pieceEl.textContent = PIECES[color + 'N'];
        pieceEl.dataset.square = sq;
        if (color !== state.game.turn() || state.gameOver || !isMyTurn()) pieceEl.style.cursor = 'default';
        attachPieceHandlers(pieceEl, sq);

        const kbadge = document.createElement('div');
        kbadge.className = 'mount-king-badge ' + (color === 'w' ? 'white' : 'black');
        kbadge.textContent = PIECES[color + 'K'];
        kbadge.title = 'Drag the king off the knight to dismount';
        kbadge.addEventListener('mousedown', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          beginBadgeDrag(sq, color, ev.clientX, ev.clientY, false);
        });
        kbadge.addEventListener('touchstart', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          const t = ev.touches[0];
          beginBadgeDrag(sq, color, t.clientX, t.clientY, true);
        }, { passive: false });
        kbadge.addEventListener('click', (ev) => ev.stopPropagation());
        pieceEl.appendChild(kbadge);

        sqEl.appendChild(pieceEl);
      } else if (piece) {
        const isTroll = piece.type === 'r' && figureRookType(state, piece.color) === 'troll';
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece ' + (piece.color === 'w' ? 'white' : 'black') + (isTroll ? ' figure-troll' : '');
        if (!isTroll) pieceEl.textContent = PIECES[piece.color + piece.type.toUpperCase()];
        pieceEl.dataset.square = sq;
        if (piece.color !== state.game.turn() || state.gameOver || !isMyTurn()) pieceEl.style.cursor = 'default';
        attachPieceHandlers(pieceEl, sq);

        if (piece.type === 'b' && has(state, piece.color, 'stunlock') && state.stunlockCharges[piece.color][sq]) {
          const charge = document.createElement('div');
          charge.className = 'stunlock-charge-badge';
          charge.textContent = '⚡';
          charge.title = 'Stunlock ready (select this bishop, then Q)';
          pieceEl.appendChild(charge);
        }

        if (piece.type === 'p' && figurePawnType(state, piece.color) === 'apprentice' &&
            has(state, piece.color, 'unstableTeleport') && !state.apprenticeTeleportUsed[piece.color][sq]) {
          const teleportBadge = document.createElement('div');
          teleportBadge.className = 'teleport-ready-badge';
          teleportBadge.title = 'Unstable Teleport ready (select this Apprentice, then its ability slot)';
          pieceEl.appendChild(teleportBadge);
        }

        if (piece.type === 'p' && figurePawnType(state, piece.color) === 'spearman') {
          const spearBadge = document.createElement('div');
          spearBadge.className = 'figure-badge figure-badge-spear';
          spearBadge.title = 'Spearman';
          pieceEl.appendChild(spearBadge);
        }

        if ((piece.type === 'p' && figurePawnType(state, piece.color) === 'archer') ||
            (piece.type === 'b' && figureBishopType(state, piece.color) === 'longbowman')) {
          const bowBadge = document.createElement('div');
          bowBadge.className = 'figure-badge figure-badge-bow';
          bowBadge.title = piece.type === 'p' ? 'Archer' : 'Longbowman';
          pieceEl.appendChild(bowBadge);
        }

        sqEl.appendChild(pieceEl);
      }

      sqEl.addEventListener('click', onSquareClick);
      boardEl.appendChild(sqEl);
    }
  }

  renderAbilityBar();
}

function attachPieceHandlers(pieceEl, sq) {
  pieceEl.addEventListener('mousedown', onPieceMouseDown);
  pieceEl.addEventListener('touchstart', onPieceTouchStart, { passive: false });
  pieceEl.addEventListener('dblclick', onPieceDblClick);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DOUBLE-CLICK (tower leave / dismount activation)
// ═══════════════════════════════════════════════════════════════════════════════
function onPieceDblClick(e) {
  if (state.gameOver || !isMyTurn()) return;
  const sq = e.currentTarget.dataset.square;
  const turn = state.game.turn();

  if (state.mannedTowers[sq] === turn) {
    state.specialSelect = { type: 'tower', square: sq };
    selectedSquare = sq;
    legalMoves = generateExitMoves(state, sq);
    renderBoard();
    return;
  }
  if (state.mounted[turn] === sq) {
    state.specialSelect = { type: 'mount', square: sq };
    selectedSquare = sq;
    legalMoves = generateExitMoves(state, sq);
    renderBoard();
    return;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLICK-TO-MOVE
// ═══════════════════════════════════════════════════════════════════════════════
function onSquareClick(e) {
  if (state.gameOver) return;
  if (dragState) return;
  if (!isMyTurn()) return;

  const sq = e.currentTarget.dataset.square;
  const turn = state.game.turn();

  if (state.pendingStunlock && !stunlockTargeting) return;

  if (stunlockTargeting && state.pendingStunlock) {
    if (stunlockHoverQuad) {
      applyStunlockToQuadrant(stunlockHoverQuad.f, stunlockHoverQuad.r);
    } else {
      const validQuads = getStunlockQuadrants(state.pendingStunlock.bishopSq);
      const matching = validQuads.filter(({ f, r }) => quadrantSquares(f, r).includes(sq));
      if (matching.length > 0) {
        const { f: bf, r: br } = sqToFR(state.pendingStunlock.bishopSq);
        const best = matching.reduce((a, b) => {
          const da = Math.abs((a.f + 0.5) - bf) + Math.abs((a.r + 0.5) - br);
          const db = Math.abs((b.f + 0.5) - bf) + Math.abs((b.r + 0.5) - br);
          return da <= db ? a : b;
        });
        applyStunlockToQuadrant(best.f, best.r);
      }
    }
    return;
  }

  if (solarStrikeTargeting && pendingSolarStrike) {
    if (solarStrikeHoverCenter) {
      applySolarStrikeToCenter(solarStrikeHoverCenter.f, solarStrikeHoverCenter.r);
    } else {
      const validCenters = getSolarStrikeCenters(pendingSolarStrike.queenSq);
      const { f: hf, r: hr } = sqToFR(sq);
      const best = validCenters.reduce((a, b) => {
        const da = Math.abs(a.f - hf) + Math.abs(a.r - hr);
        const db = Math.abs(b.f - hf) + Math.abs(b.r - hr);
        return da <= db ? a : b;
      }, validCenters[0] || null);
      if (best) applySolarStrikeToCenter(best.f, best.r);
    }
    return;
  }

  if (clubbingTargeting && pendingClubbing) {
    if (clubbingHoverQuad) {
      applyClubbingToQuadrant(clubbingHoverQuad.f, clubbingHoverQuad.r);
    } else {
      const validQuads = getClubbingQuadrants(pendingClubbing.trollSq);
      const matching = validQuads.find(({ f, r }) => quadrantSquares(f, r).includes(sq));
      if (matching) applyClubbingToQuadrant(matching.f, matching.r);
    }
    return;
  }

  if (silverBulletTargeting && pendingSilverBullet) {
    const validTargets = getSilverBulletTargets(state, pendingSilverBullet.kingSq, pendingSilverBullet.color);
    if (validTargets.includes(sq)) applySilverBulletToTarget(sq);
    return;
  }

  if (unstableFireballTargeting && pendingUnstableFireball) {
    const validTargets = getFireballTargets(state, pendingUnstableFireball.apprenticeSq, pendingUnstableFireball.color);
    if (validTargets.includes(sq)) applyUnstableFireballToTarget(sq);
    return;
  }

  if (unstableTeleportTargeting && pendingUnstableTeleport) {
    const validTargets = getTeleportTargets(state, pendingUnstableTeleport.color);
    if (validTargets.includes(sq)) applyUnstableTeleportToTarget(sq);
    return;
  }

  if (state.specialSelect && state.specialSelect.square === selectedSquare) {
    const move = legalMoves.find(m => m.to === sq);
    if (move) { attemptMove(selectedSquare, sq); return; }
  }

  if (state.mounted[turn] === sq) {
    const now = Date.now();
    if (lastClickSquare === sq && (now - lastClickTime) < 500) {
      lastClickSquare = null; lastClickTime = 0;
      armSpecialExit(sq, turn);
      return;
    }
    lastClickSquare = sq; lastClickTime = now;
  }

  if (selectedSquare) {
    const move = legalMoves.find(m => m.to === sq);
    if (move) { attemptMove(selectedSquare, sq); return; }

    const piece = pieceAt(state, sq);
    const isOwnMovable = (piece && piece.color === turn) || (state.mannedTowers[sq] === turn) || (state.mounted[turn] === sq);
    if (isOwnMovable && !(state.specialSelect && state.specialSelect.square === selectedSquare)) {
      selectSquare(sq); return;
    }
    deselectSquare();
  } else {
    selectSquare(sq);
  }
}

function armSpecialExit(sq, turn) {
  if (state.mannedTowers[sq] === turn) {
    state.specialSelect = { type: 'tower', square: sq };
  } else if (state.mounted[turn] === sq) {
    state.specialSelect = { type: 'mount', square: sq };
  } else {
    return;
  }
  selectedSquare = sq;
  legalMoves = generateExitMoves(state, sq);
  renderBoard();
}

function beginBadgeDrag(sq, color, x, y, isTouch) {
  if (state.gameOver || color !== state.game.turn() || !isMyTurn()) return;
  armSpecialExit(sq, color);
  const occupant = state.mannedTowers[sq] ? color + 'P' : color + 'K';
  startDrag(sq, x, y, { glyphKey: occupant, color, fromBadge: true });
  if (isTouch) {
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  } else {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }
}

function selectSquare(sq) {
  const turn = state.game.turn();
  const piece = pieceAt(state, sq);
  const isOwn = (piece && piece.color === turn) || (state.mannedTowers[sq] === turn) || (state.mounted[turn] === sq);
  if (!isOwn) return;

  state.specialSelect = null;
  selectedSquare = sq;
  legalMoves = generateMoves(state, sq);
  renderBoard();
}

function deselectSquare() {
  selectedSquare = null;
  legalMoves = [];
  state.specialSelect = null;
  renderBoard();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DRAG-TO-MOVE
// ═══════════════════════════════════════════════════════════════════════════════
function onPieceMouseDown(e) {
  if (state.gameOver) return;
  if (state.pendingStunlock) return;
  if (!isMyTurn()) return;
  const sq = e.currentTarget.dataset.square;
  const turn = state.game.turn();
  const piece = pieceAt(state, sq);
  const isOwn = (piece && piece.color === turn) || (state.mannedTowers[sq] === turn) || (state.mounted[turn] === sq);
  if (!isOwn) return;

  e.preventDefault();
  startDrag(sq, e.clientX, e.clientY);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function onPieceTouchStart(e) {
  if (state.gameOver) return;
  if (state.pendingStunlock) return;
  if (!isMyTurn()) return;
  const sq = e.currentTarget.dataset.square;
  const turn = state.game.turn();
  const piece = pieceAt(state, sq);
  const isOwn = (piece && piece.color === turn) || (state.mannedTowers[sq] === turn) || (state.mounted[turn] === sq);
  if (!isOwn) return;
  e.preventDefault();
  const touch = e.touches[0];

  startDrag(sq, touch.clientX, touch.clientY);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
}

function startDrag(sq, x, y, dragInfo) {
  if (!(state.specialSelect && state.specialSelect.square === sq)) {
    selectSquare(sq);
  } else {
    selectedSquare = sq;
    legalMoves = generateExitMoves(state, sq);
    renderBoard();
  }
  if (legalMoves.length === 0 && !state.specialSelect) { /* still allow drag visual */ }

  dragState = { fromSquare: sq, fromBadge: !!(dragInfo && dragInfo.fromBadge) };

  let glyph, color, badgeKey = null, isTroll = false;
  if (dragInfo && dragInfo.glyphKey) {
    glyph = PIECES[dragInfo.glyphKey];
    color = dragInfo.color;
    isTroll = dragInfo.glyphKey[1] === 'R' && figureRookType(state, color) === 'troll';
  } else if (state.mannedTowers[sq]) {
    color = state.mannedTowers[sq];
    glyph = PIECES[color + 'R'];
    badgeKey = color + 'P';
    isTroll = figureRookType(state, color) === 'troll';
  } else {
    const piece = pieceAt(state, sq);
    color = piece.color;
    glyph = PIECES[color + piece.type.toUpperCase()];
    isTroll = piece.type === 'r' && figureRookType(state, color) === 'troll';
    if (state.mounted[color] === sq && piece.type === 'k') {
      glyph = PIECES[color + 'N'];
      badgeKey = color + 'K';
      isTroll = false;
    }
  }

  dragGhost.className = (color === 'w' ? 'white' : 'black') + (isTroll ? ' figure-troll' : '');
  dragGhost.innerHTML = '';
  dragGhost.textContent = isTroll ? '' : glyph;
  if (badgeKey) {
    dragGhost.classList.add('has-occupant');
    const ghostBadge = document.createElement('span');
    ghostBadge.className = 'ghost-badge ' + (color === 'w' ? 'white' : 'black');
    ghostBadge.textContent = PIECES[badgeKey];
    dragGhost.appendChild(ghostBadge);
  }
  dragGhost.style.display = 'block';
  moveDragGhost(x, y);

  const pieceEl = boardEl.querySelector(`.piece[data-square="${sq}"]`);
  if (pieceEl) {
    if (dragState.fromBadge) {
      const badge = pieceEl.querySelector('.tower-pawn-badge, .mount-king-badge');
      if (badge) badge.classList.add('dragging');
    } else {
      pieceEl.classList.add('dragging');
    }
  }
}

function moveDragGhost(x, y) {
  dragGhost.style.left = x + 'px';
  dragGhost.style.top  = y + 'px';
}

function onMouseMove(e) { if (dragState) moveDragGhost(e.clientX, e.clientY); }
function onTouchMove(e) {
  if (!dragState) return;
  e.preventDefault();
  moveDragGhost(e.touches[0].clientX, e.touches[0].clientY);
}

function onMouseUp(e) {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  endDrag(e.clientX, e.clientY);
}

function onTouchEnd(e) {
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onTouchEnd);
  endDrag(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
}

function endDrag(x, y) {
  dragGhost.style.display = 'none';
  if (!dragState) return;
  const fromSq = dragState.fromSquare;
  dragState = null;

  const el = document.elementFromPoint(x, y);
  const sqEl = el ? el.closest('.square') : null;
  const toSq = sqEl ? sqEl.dataset.square : null;

  if (toSq && toSq !== fromSq && legalMoves.find(m => m.to === toSq)) {
    attemptMove(fromSq, toSq);
    return;
  }
  renderBoard();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STATUS
// ═══════════════════════════════════════════════════════════════════════════════
function updateStatus() {
  statusBox.className = 'status-box';

  if (state.gameOver) {
    statusText.textContent = state.gameOverText;
    if (state.gameOverText.includes('Draw')) statusBox.classList.add('draw');
    else statusBox.classList.add('checkmate');
    return;
  }

  if (stunlockTargeting && state.pendingStunlock) {
    statusText.textContent = '⚡ Choose a quadrant to stun (Esc to cancel)';
    return;
  }
  if (solarStrikeTargeting && pendingSolarStrike) {
    statusText.textContent = '☀ Choose a center to strike (Esc to cancel)';
    return;
  }
  if (clubbingTargeting && pendingClubbing) {
    statusText.textContent = '🔨 Choose a quadrant to club (Esc to cancel)';
    return;
  }
  if (silverBulletTargeting && pendingSilverBullet) {
    statusText.textContent = '🎯 Choose an enemy unit to strike (Esc to cancel)';
    return;
  }
  if (unstableFireballTargeting && pendingUnstableFireball) {
    statusText.textContent = '🔥 Choose a target to fireball (Esc to cancel)';
    return;
  }
  if (unstableTeleportTargeting && pendingUnstableTeleport) {
    statusText.textContent = '✨ Choose a field to teleport to (Esc to cancel)';
    return;
  }

  const sideToMove = state.game.turn();
  const isChecked = (!state.mounted.w && !state.mounted.b && !anyFigurePawnsInPlay(state) && !anyFigureRooksInPlay(state) && !anyFigureBishopsInPlay(state))
    ? state.game.in_check()
    : isKingAttacked(state, sideToMove);
  if (isChecked) {
    const inCheck = sideToMove === 'w' ? 'White' : 'Black';
    statusText.textContent = `⚠ ${inCheck} is in check!`;
    statusBox.classList.add('check');
    return;
  }

  statusText.textContent = (state.game.turn() === 'w' ? 'White' : 'Black') + ' to move';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MOVE LIST
// ═══════════════════════════════════════════════════════════════════════════════
function renderMoveList() {
  moveListEl.innerHTML = '';
  const moveLog = state.moveLog;
  for (let i = 0; i < moveLog.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';

    const numEl = document.createElement('span');
    numEl.className = 'move-num';
    numEl.textContent = (i / 2 + 1) + '.';
    row.appendChild(numEl);

    const whiteEl = document.createElement('span');
    whiteEl.className = 'move-san' + (i === moveLog.length - 1 ? ' current' : '');
    whiteEl.textContent = moveLog[i] ? moveLog[i].san : '';
    row.appendChild(whiteEl);

    const blackEl = document.createElement('span');
    blackEl.className = 'move-san' + (i + 1 === moveLog.length - 1 ? ' current' : '');
    if (moveLog[i + 1]) blackEl.textContent = moveLog[i + 1].san;
    row.appendChild(blackEl);

    moveListEl.appendChild(row);
  }
  moveListEl.scrollTop = moveListEl.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CAPTURED PIECES
// ═══════════════════════════════════════════════════════════════════════════════
function updateCaptured() {
  const counts = { w: {}, b: {} };
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
  const board = state.game.board();
  ['w', 'b'].forEach(c => { for (const t in start) counts[c][t] = 0; });
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const cell = board[r][f];
    if (cell) counts[cell.color][cell.type]++;
  }
  for (const sq in state.mannedTowers) counts[state.mannedTowers[sq]].p++;

  const capturedByW = [];
  const capturedByB = [];
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    const missingB = Math.max(0, start[t] - counts.b[t]);
    const missingW = Math.max(0, start[t] - counts.w[t]);
    for (let i = 0; i < missingB; i++) capturedByW.push(PIECES['b' + t.toUpperCase()]);
    for (let i = 0; i < missingW; i++) capturedByB.push(PIECES['w' + t.toUpperCase()]);
  }
  capturedWhite.textContent = capturedByW.join('');
  capturedBlack.textContent = capturedByB.join('');
}
