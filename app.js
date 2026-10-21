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
  // Same for turning a bishop's shield after its move (Bishops' Shields).
  if (state.pendingShield) return state.pendingShield.color;
  // A Vanguard deployment happens before White's first turn, so it belongs
  // to its owner even when that's Black and White is "to move".
  if (state.phase === 'playing' && state.vanguard) return state.vanguard.color;
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
  const wasOver = state.gameOver;
  const err = applyAction(state, currentActor(), action);
  if (err) {
    undoStack.pop();
    console.warn('Action rejected:', err);
    // Rejected because the mover's flag had already fallen — show that.
    if (state.gameOver !== wasOver) renderAll();
    return;
  }
  renderAll();
}

function isMyTurn() {
  if (!netMode) return true;
  if (!state.game || !myColor) return false;
  // A pending Stunlock cast or shield turn still belongs to the player whose
  // move opened it, though state.game.turn() has already flipped.
  const pending = state.pendingStunlock || state.pendingShield;
  return (pending ? pending.color : state.game.turn()) === myColor;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NETWORKING — wire NetClient callbacks to state replacement + rendering
// ═══════════════════════════════════════════════════════════════════════════════
let netStateUpdateCount = 0;
NetClient.onState((incoming, serverNow) => {
  noteServerTime(serverNow);
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
  // The snapshot's times are restored as they were; time spent since then
  // isn't charged to anyone.
  if (state.clock && state.clock.running) state.clock.since = Date.now();
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
function renderAll() {
  syncClock();

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
  syncRaiseTheDeadTargeting();
  // Swift: once a shot leaves a follow-up step pending, auto-select that
  // Archer for whoever's resolving it so its (restricted) step options show
  // immediately — mirrors syncStunlockTargeting's auto-begin above.
  if (state.pendingSwiftMove && state.pendingSwiftMove.color === currentActor()) {
    selectedSquare = state.pendingSwiftMove.archerSq;
  }
  // Nothing else can be selected while a bishop's shield waits to be turned.
  if (state.pendingShield) { selectedSquare = null; legalMoves = []; }
  if (selectedSquare) legalMoves = computeLegalMovesFor(selectedSquare);
  Vanguard.sync();
  syncShieldPanel();

  renderBoard();
  renderMoveList();
  updateStatus();
  updateCaptured();
  renderActiveAugments();
}

function computeLegalMovesFor(sq) {
  if (state.specialSelect && state.specialSelect.square === sq) return generateExitMoves(state, sq);
  return generateMoves(state, sq);
}

function renderActiveAugments() {
  activeAugmentsEl.querySelectorAll('.aa-side').forEach(e => e.remove());
  let count = 0;
  ['w', 'b'].forEach(c => {
    if (!state.augments[c].length) return;
    const side = document.createElement('div');
    side.className = 'aa-side';
    side.innerHTML = `<span class="aa-side-label ${c === 'w' ? 'white' : 'black'}" title="${c === 'w' ? 'White' : 'Black'}"></span>`;
    const icons = document.createElement('div');
    icons.className = 'aa-icons';
    state.augments[c].forEach(id => {
      const aug = AUGMENTS.find(a => a.id === id);
      const item = document.createElement('div');
      item.className = 'aa-item';
      item.appendChild(augmentEmblem(aug));
      item.dataset.augId = aug.id;
      item.addEventListener('click', () => showAugmentDetail(aug));
      icons.appendChild(item);
      count++;
    });
    side.appendChild(icons);
    activeAugmentsEl.appendChild(side);
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
  // towerLeave/dismount share their origin square with an unrelated move set
  // (the manned rook sliding, or the mounted King riding) — this tells the
  // server which one the double-click-armed selection actually meant.
  const exit = move.special === 'towerLeave' || move.special === 'dismount';
  dispatch({ type: 'move', from: move.from, to: move.to, promotion: promotionChoice, exit });
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
//  FIGURE IMAGES
// ═══════════════════════════════════════════════════════════════════════════════
// Figures (Troll, Spearman, Longbowman, Archer, Ghoul, Apprentice, Guardsman /
// Kingsguard) render as a cut-out image instead of the glyph font — see
// figures/images/ and the .figure-<id> rules in style.css. Returns the CSS
// class to add (e.g. 'figure-troll') or null if this piece type/color combo
// has no custom image and should use the glyph.
function figureImageKey(state, pieceType, color) {
  if (pieceType === 'p' && figurePawnType(state, color) === 'spearman') return 'spearman';
  if (pieceType === 'p' && figurePawnType(state, color) === 'archer') return 'archer';
  if (pieceType === 'p' && figurePawnType(state, color) === 'ghoul') return 'ghoul';
  if (pieceType === 'p' && figurePawnType(state, color) === 'apprentice') return 'apprentice';
  // Kingsguard upgrades the Guardsmen in place, so it swaps their artwork too.
  if (pieceType === 'p' && figurePawnType(state, color) === 'guardsman') {
    return state.augments[color] && state.augments[color].includes('kingsguard') ? 'kingsguard' : 'guardsman';
  }
  if (pieceType === 'b' && figureBishopType(state, color) === 'longbowman') return 'longbowman';
  if (pieceType === 'r' && figureRookType(state, color) === 'troll') return 'troll';
  return null;
}

// Ghouls share one un-tinted artwork set across both colors (unlike the other
// figures, which bake a white/black edge into separate PNGs), with each of
// the GHOUL_SKIN_COUNT variants assigned per-square at game setup (see
// newGame in chess-engine.js) so a side's ghouls read as a ragtag mob rather
// than identical clones. Falls back to variant 0 if a square's assignment is
// somehow missing (e.g. a ghoul that arrived via an older/incompatible state).
function ghoulSkinFile(state, sq, color) {
  const idx = state.ghoulSkin && state.ghoulSkin[color] ? state.ghoulSkin[color][sq] : undefined;
  return `figures/images/ghoul${idx !== undefined ? idx : 0}.png`;
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

  // The side to move's King: red when it's in check, or 'check-incoming'
  // when it isn't attacked yet but this move's Solar Strike will expose it.
  // A check whose attacker is about to burn away isn't highlighted at all.
  const toMove = state.game.turn();
  const toMoveKingSq = state.mounted[toMove] || findKingSquare(state, toMove);
  const kingCheckClass = toMoveKingSq && kingThreatenedAfterPly(state, toMove)
    ? (isKingAttacked(state, toMove) ? 'in-check' : 'check-incoming')
    : null;
  const solarBurns = solarBurnsThisPly(state);

  let archerShootRange = null;
  let ghoulChargeRange = null;
  let longbowShootRange = null;
  if (selectedSquare) {
    const selPiece = pieceAt(state, selectedSquare);
    const mannedColor = state.mannedTowers[selectedSquare];
    if (mannedColor) {
      // A manned tower's board square holds the Rook underneath, not the
      // garrison — its shoot range (if any) comes from what walked in, same
      // as generateTowerShootMoves.
      if (state.mannedTowerOrigin[selectedSquare] === 'b') {
        longbowShootRange = longbowShootRangeSquares(selectedSquare, state, mannedColor);
      } else if (figurePawnType(state, mannedColor) === 'archer') {
        archerShootRange = archerShootRangeSquares(selectedSquare, mannedColor);
      }
    } else if (selPiece && selPiece.type === 'p') {
      const selFigure = figurePawnType(state, selPiece.color);
      if (selFigure === 'archer') archerShootRange = archerShootRangeSquares(selectedSquare, selPiece.color);
      else if (selFigure === 'ghoul') ghoulChargeRange = ghoulChargeSquares(state, selectedSquare, selPiece.color);
    } else if (selPiece && selPiece.type === 'b' && figureBishopType(state, selPiece.color) === 'longbowman') {
      longbowShootRange = longbowShootRangeSquares(selectedSquare, state, selPiece.color);
    }
  }

  // Lightning Aura: once armed for a color, highlight the 8 squares
  // currently touching that King — it follows the King as it moves, so this
  // is recomputed fresh every render rather than cached in state.
  const lightningZones = {};
  for (const color of ['w', 'b']) {
    if (!state.lightningActive[color]) continue;
    const kingSq = state.mounted[color] || findKingSquare(state, color);
    if (kingSq) lightningZones[color] = { kingSq, zone: kingAuraSquares(kingSq) };
  }

  // Ring of Fire: same zone highlight as Lightning Aura, but a unit standing
  // in it only dies after a SECOND consecutive turn-end check — state.fireAura
  // already tracks exactly which squares are mid-countdown (see
  // checkRingOfFire), so those get their own "about to burn" warning on top
  // of the ambient zone tint, shown before the kill actually happens.
  const fireZones = {};
  for (const color of ['w', 'b']) {
    if (!state.fireActive[color]) continue;
    const kingSq = state.mounted[color] || findKingSquare(state, color);
    if (kingSq) fireZones[color] = { kingSq, zone: kingAuraSquares(kingSq, ringOfFireRadius(state, color)) };
  }

  // Bishops' Shields: the squares around a bishop whose shield is being
  // turned, and — for the selected unit — captures a shield blocks outright
  // and shots/casts that will bounce off one.
  const shieldChoices = isChoosingShield() ? shieldChoiceSquares(state.pendingShield.sq) : null;
  const shieldBlockedTargets = selectedSquare && !state.specialSelect && anyShieldsInPlay(state)
    ? generateMoves(state, selectedSquare, { shieldBlocked: true }).map(m => m.to) : [];
  const deflectFrom = silverBulletTargeting && pendingSilverBullet ? pendingSilverBullet.kingSq
    : unstableFireballTargeting && pendingUnstableFireball ? pendingUnstableFireball.apprenticeSq
    : selectedSquare;

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

      if (kingCheckClass && sq === toMoveKingSq) sqEl.classList.add(kingCheckClass);

      if (state.stunnedSquares[sq] > 0) sqEl.classList.add('stunned');

      if (state.ghoulBrokeRank[state.game.turn()].includes(sq)) sqEl.classList.add('broke-rank');

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

      if (raiseDeadTargeting) {
        const validTargets = getRaiseTheDeadTargets(state, raiseDeadColor);
        if (validTargets.includes(sq)) sqEl.classList.add('raisedead-target');
        if (raiseDeadHoverSq === sq) sqEl.classList.add('raisedead-preview');
        sqEl.classList.add('can-move');
      }

      if (state.solarMarked[sq] > 0) {
        sqEl.classList.add('solar-marked');
        const burnsNow = solarBurns.includes(sq);
        if (burnsNow) sqEl.classList.add('solar-imminent');
        const mover = toMove === 'w' ? 'White' : 'Black', other = toMove === 'w' ? 'Black' : 'White';
        sqEl.title = burnsNow
          ? `Solar Strike: burns at the end of ${mover}'s turn`
          : `Solar Strike: burns at the end of ${other}'s next turn`;
      }
      if (state.teleportMarked[sq] > 0) sqEl.classList.add('teleport-marked');
      if (state.fireDeathMarked[sq] > 0) sqEl.classList.add('fire-death-marked');
      if (state.warmWelcomeMarked[sq] > 0) sqEl.classList.add('warm-welcome-marked');

      for (const color of ['w', 'b']) {
        const lz = lightningZones[color];
        if (!lz) continue;
        if (sq === lz.kingSq) sqEl.classList.add('lightning-king');
        else if (lz.zone.includes(sq)) sqEl.classList.add('lightning-zone');
      }

      for (const color of ['w', 'b']) {
        const fz = fireZones[color];
        if (!fz) continue;
        if (sq === fz.kingSq) sqEl.classList.add('fire-king');
        else if (fz.zone.includes(sq)) sqEl.classList.add('fire-zone');
      }
      if (state.fireAura[sq] && state.fireAura[sq].turns >= 1) sqEl.classList.add('fire-priming');

      if (shieldChoices) {
        const choice = shieldChoices.find(c => c.sq === sq);
        if (choice) {
          sqEl.classList.add('shield-choice', 'can-move');
          sqEl.dataset.shieldDir = choice.dir;
          sqEl.title = `Face the shield ${shieldDirLabel(state.pendingShield.color, choice.dir)}`;
        }
        if (sq === state.pendingShield.sq) sqEl.classList.add('shield-pending', 'can-move');
      }
      if (shieldBlockedTargets.includes(sq)) sqEl.appendChild(shieldHintEl('blocked'));
      else if (deflectFrom && (sqEl.classList.contains('legal-shoot') || sqEl.classList.contains('silverbullet-target') ||
          sqEl.classList.contains('fireball-target')) && shieldBlocks(state, deflectFrom, sq)) {
        sqEl.appendChild(shieldHintEl('deflect'));
      }

      const piece = pieceAt(state, sq);
      if (state.mannedTowers[sq]) {
        const color = state.mannedTowers[sq];
        const figureKey = figureImageKey(state, 'r', color);
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece manned-tower ' + (color === 'w' ? 'white' : 'black') + (figureKey ? ' figure-' + figureKey : '');
        if (!figureKey) pieceEl.textContent = PIECES[color + 'R'];
        pieceEl.dataset.square = sq;
        attachPieceHandlers(pieceEl, sq);

        const isBishopGarrison = state.mannedTowerOrigin[sq] === 'b';
        const badge = document.createElement('div');
        badge.className = 'tower-pawn-badge ' + (color === 'w' ? 'white' : 'black');
        badge.textContent = PIECES[color + (isBishopGarrison ? 'B' : 'P')];
        badge.title = isBishopGarrison ? 'Drag the Longbowman out of the tower' : 'Drag the pawn out of the tower';
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
        const figureKey = figureImageKey(state, piece.type, piece.color);
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece ' + (piece.color === 'w' ? 'white' : 'black') + (figureKey ? ' figure-' + figureKey : '');
        if (!figureKey) pieceEl.textContent = PIECES[piece.color + piece.type.toUpperCase()];
        if (figureKey === 'ghoul') pieceEl.style.backgroundImage = `url("${ghoulSkinFile(state, sq, piece.color)}")`;
        pieceEl.dataset.square = sq;
        if (piece.color !== state.game.turn() || state.gameOver || !isMyTurn()) pieceEl.style.cursor = 'default';
        attachPieceHandlers(pieceEl, sq);

        // One small emblem per unit ability this unit can cast right now.
        const readyAbilities = readyAbilityMarkers(state, sq);
        if (readyAbilities.length) pieceEl.appendChild(abilityReadyBadges(readyAbilities));

        // Bishops' Shields: the grey barrier on the side the shield faces.
        const shieldDir = shieldDirAt(state, sq);
        if (shieldDir) {
          const pending = !!(state.pendingShield && state.pendingShield.sq === sq);
          pieceEl.appendChild(bishopShieldEl(shieldDir, { pending, isFlipped: flipped }));
          pieceEl.title = pending ? 'Turn this bishop\'s shield' : shieldTitle(piece.color, shieldDir);
        }

        // White's freshly deployed Vanguard units sit out White's first turn.
        if (state.vanguardLocked && state.vanguardLocked.includes(sq)) {
          pieceEl.classList.add('vanguard-locked');
          pieceEl.title = 'Vanguard unit: can act from White\'s second turn';
        }

        // An Archer that just shot is drawn with an empty quiver until it
        // can shoot again (it can still move meanwhile).
        if (piece.type === 'p' && figurePawnType(state, piece.color) === 'archer' && isArcherOnCooldown(state, piece.color, sq)) {
          pieceEl.classList.add('reloading');
          pieceEl.title = 'Out of arrows — can\'t shoot this turn (can still move)';
        }

        sqEl.appendChild(pieceEl);
      }

      sqEl.addEventListener('click', onSquareClick);
      boardEl.appendChild(sqEl);
    }
  }

  Vanguard.decorate();
  BoardAnim.afterRender();
  renderAbilityBar();
}

// Stack of ability emblems in a piece's top-right corner, marking each unit
// ability it can still cast (see readyAbilityMarkers). Purely informational.
// Also used by the augment demo player.
function abilityReadyBadges(ids) {
  const wrap = document.createElement('div');
  wrap.className = 'ability-ready-badges';
  for (const id of ids) {
    const icon = document.createElement('img');
    icon.className = 'ability-ready-badge';
    icon.src = augmentIconUrl(id);
    icon.alt = '';
    icon.draggable = false;
    wrap.appendChild(icon);
  }
  return wrap;
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
  if (Vanguard.active()) return;
  if (state.gameOver || !isMyTurn() || state.pendingShield) return;
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
  if (Vanguard.onSquareClick(e.currentTarget.dataset.square)) return;
  if (state.gameOver) return;
  if (dragState) return;
  if (!isMyTurn()) return;

  const sq = e.currentTarget.dataset.square;
  const turn = state.game.turn();

  if (state.pendingStunlock && !stunlockTargeting) return;
  if (state.pendingRaiseTheDead && !raiseDeadTargeting) return;

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

  if (onShieldSquareClick(e.currentTarget)) return;

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

  if (raiseDeadTargeting) {
    const validTargets = getRaiseTheDeadTargets(state, raiseDeadColor);
    if (validTargets.includes(sq)) applyRaiseTheDeadToTarget(sq);
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

    if (isGhoulLocked(sq)) { pingLockedGhoul(sq); deselectSquare(); return; }

    const piece = pieceAt(state, sq);
    const isOwnMovable = (piece && piece.color === turn) || (state.mannedTowers[sq] === turn) || (state.mounted[turn] === sq);
    if (isOwnMovable && !(state.specialSelect && state.specialSelect.square === selectedSquare)) {
      selectSquare(sq); return;
    }
    deselectSquare();
  } else {
    if (isGhoulLocked(sq)) { pingLockedGhoul(sq); return; }
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
  const occupant = state.mannedTowers[sq]
    ? color + (state.mannedTowerOrigin[sq] === 'b' ? 'B' : 'P')
    : color + 'K';
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

// A Ghoul that auto-charged via Breaking Rank this turn can't be moved again
// until it's this color's turn again (server-enforced in findRequestedMove) —
// this mirrors that lock on the client so selection attempts get a visible
// "no" instead of silently doing nothing.
function isGhoulLocked(sq) {
  const turn = state.game.turn();
  const piece = pieceAt(state, sq);
  return !!piece && piece.color === turn && state.ghoulBrokeRank[turn].includes(sq);
}

function pingSquare(sq) {
  const sqEl = boardEl.querySelector(`.square[data-square="${sq}"]`);
  if (!sqEl) return;
  sqEl.classList.remove('ping');
  void sqEl.offsetWidth; // restart the CSS animation if it's already running
  sqEl.classList.add('ping');
  setTimeout(() => sqEl.classList.remove('ping'), 400);
}

function pingLockedGhoul(sq) {
  pingSquare(sq);
  flashStatus("This Ghoul already broke rank — it can't move again this turn");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DRAG-TO-MOVE
// ═══════════════════════════════════════════════════════════════════════════════
function onPieceMouseDown(e) {
  if (Vanguard.onPiecePress(e.currentTarget.dataset.square)) { e.preventDefault(); return; }
  if (state.gameOver) return;
  if (state.pendingStunlock || state.pendingShield) return;
  if (!isMyTurn()) return;
  const sq = e.currentTarget.dataset.square;
  const turn = state.game.turn();
  const piece = pieceAt(state, sq);
  const isOwn = (piece && piece.color === turn) || (state.mannedTowers[sq] === turn) || (state.mounted[turn] === sq);
  if (!isOwn) return;
  if (isGhoulLocked(sq)) { pingLockedGhoul(sq); return; }

  e.preventDefault();
  startDrag(sq, e.clientX, e.clientY);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function onPieceTouchStart(e) {
  if (Vanguard.onPiecePress(e.currentTarget.dataset.square)) return; // the tap's click places it
  if (state.gameOver) return;
  if (state.pendingStunlock || state.pendingShield) return;
  if (!isMyTurn()) return;
  const sq = e.currentTarget.dataset.square;
  const turn = state.game.turn();
  const piece = pieceAt(state, sq);
  const isOwn = (piece && piece.color === turn) || (state.mannedTowers[sq] === turn) || (state.mounted[turn] === sq);
  if (!isOwn) return;
  if (isGhoulLocked(sq)) { pingLockedGhoul(sq); return; }
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

  let glyph, color, badgeKey = null, figureKey = null;
  if (dragInfo && dragInfo.glyphKey) {
    glyph = PIECES[dragInfo.glyphKey];
    color = dragInfo.color;
    figureKey = figureImageKey(state, dragInfo.glyphKey[1].toLowerCase(), color);
  } else if (state.mannedTowers[sq]) {
    color = state.mannedTowers[sq];
    glyph = PIECES[color + 'R'];
    badgeKey = color + (state.mannedTowerOrigin[sq] === 'b' ? 'B' : 'P');
    figureKey = figureImageKey(state, 'r', color);
  } else {
    const piece = pieceAt(state, sq);
    color = piece.color;
    glyph = PIECES[color + piece.type.toUpperCase()];
    figureKey = figureImageKey(state, piece.type, color);
    if (state.mounted[color] === sq && piece.type === 'k') {
      glyph = PIECES[color + 'N'];
      badgeKey = color + 'K';
      figureKey = null;
    }
  }

  dragGhost.className = (color === 'w' ? 'white' : 'black') + (figureKey ? ' figure-' + figureKey : '') +
    (figureKey === 'archer' && isArcherOnCooldown(state, color, sq) ? ' reloading' : '');
  dragGhost.innerHTML = '';
  dragGhost.textContent = figureKey ? '' : glyph;
  dragGhost.style.backgroundImage = figureKey === 'ghoul' ? `url("${ghoulSkinFile(state, sq, color)}")` : '';
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
    BoardAnim.noteDrop(toSq);
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

  if (state.vanguard) {
    statusText.textContent = `${state.vanguard.color === 'w' ? 'White' : 'Black'} is deploying their Vanguard`;
    return;
  }
  if (stunlockTargeting && state.pendingStunlock) {
    statusText.textContent = '⚡ Choose a quadrant to stun (Esc to cancel)';
    return;
  }
  if (state.pendingShield && !state.pendingStunlock) {
    statusText.textContent = isChoosingShield()
      ? '🛡 Turn your shield: click a square next to the bishop'
      : `🛡 ${state.pendingShield.color === 'w' ? 'White' : 'Black'} is turning a bishop's shield`;
    statusBox.classList.add('shield');
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
  if (state.pendingSwiftMove) {
    statusText.textContent = '🏹 Swift: move the Archer, or press Esc to end the turn';
    return;
  }
  if (raiseDeadTargeting) {
    statusText.textContent = state.pendingRaiseTheDead
      ? '💀 Raise more Ghouls, or press Z to end your turn'
      : '💀 Choose fields to raise Ghouls (Esc to cancel)';
    return;
  }

  const sideToMove = state.game.turn();
  const sideName = sideToMove === 'w' ? 'White' : 'Black';
  const attacked = isKingAttacked(state, sideToMove);
  const threatened = kingThreatenedAfterPly(state, sideToMove);
  if (threatened) {
    statusText.textContent = attacked
      ? `⚠ ${sideName} is in check!`
      : `⚠ The Solar Strike will expose ${sideName}'s King!`;
    statusBox.classList.add('check');
    return;
  }
  if (attacked) {
    statusText.textContent = `${sideName} to move — the checking unit burns at the end of this turn`;
    return;
  }

  statusText.textContent = (state.game.turn() === 'w' ? 'White' : 'Black') + ' to move';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MOVE LIST
// ═══════════════════════════════════════════════════════════════════════════════
// One row per turn (the engine's `kind: 'turn'` entries), with everything
// that turn set off (`kind: 'event'`: aura kills, a Stunlock landing, …)
// nested underneath it. Entries from before the readable history existed
// have no `text`/`kind` and fall back to their compact notation as turns.
function renderMoveList() {
  moveListEl.innerHTML = '';
  const groups = [];
  for (const entry of state.moveLog) {
    const isEvent = entry.kind === 'event';
    if (!isEvent || !groups.length) groups.push({ turn: isEvent ? null : entry, events: [] });
    if (isEvent) groups[groups.length - 1].events.push(entry);
  }

  let plies = 0;
  groups.forEach((g, i) => {
    const row = document.createElement('div');
    row.className = 'move-turn' + (i === groups.length - 1 ? ' current' : '');
    if (g.turn) {
      const head = document.createElement('div');
      head.className = 'move-line';
      const num = document.createElement('span');
      num.className = 'move-num';
      num.textContent = g.turn.color === 'w' ? `${Math.floor(plies / 2) + 1}.` : '';
      const side = document.createElement('span');
      side.className = 'move-side ' + (g.turn.color === 'w' ? 'white' : 'black');
      const text = document.createElement('span');
      text.className = 'move-text';
      text.textContent = g.turn.text || g.turn.san;
      head.append(num, side, text);
      row.appendChild(head);
      plies++;
    }
    for (const e of g.events) {
      const ev = document.createElement('div');
      ev.className = 'move-event' + (e.san === '#' ? ' move-result' : '');
      ev.textContent = e.text || e.san;
      row.appendChild(ev);
    }
    moveListEl.appendChild(row);
  });
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
  for (const sq in state.mannedTowers) {
    const garrisonType = state.mannedTowerOrigin[sq] === 'b' ? 'b' : 'p';
    counts[state.mannedTowers[sq]][garrisonType]++;
  }

  const capturedByW = [];
  const capturedByB = [];
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    // Legion starts a side with a second row of pawns.
    const startB = t === 'p' ? 8 * startingPawnRanks(state, 'b').length : start[t];
    const startW = t === 'p' ? 8 * startingPawnRanks(state, 'w').length : start[t];
    const missingB = Math.max(0, startB - counts.b[t]);
    const missingW = Math.max(0, startW - counts.w[t]);
    for (let i = 0; i < missingB; i++) capturedByW.push(PIECES['b' + t.toUpperCase()]);
    for (let i = 0; i < missingW; i++) capturedByB.push(PIECES['w' + t.toUpperCase()]);
  }
  capturedWhite.textContent = capturedByW.join('');
  capturedBlack.textContent = capturedByB.join('');
}
