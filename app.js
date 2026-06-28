/**
 * app.js — AugChess core: game state, move generation, check detection,
 *           state snapshots/undo, move execution, board rendering, input handling.
 *
 * Relies on (loaded before this file in index.html):
 *   chess.js    — Chess() engine
 *   data.js     — PIECES, PIECE_VALUES, AUGMENTS, FIGURES, TOWER_SQUARES, etc.
 *   stunlock.js — stunlock state vars + all stunlock functions
 *   gameOver.js — evaluateGameOver() and helpers
 *   draft.js    — startAugmentDraft(), draftPass(), draftStart(), draftState
 *   clock.js    — clock state vars + clock functions
 *   views.js    — showView(), page renders, initNavigation(), initApp()
 */

let game = new Chess();
let flipped = false;
let selectedSquare = null;
let legalMoves = [];          // array of move objects (standard + special)
let lastMove = null;
let pendingPromotion = null;
let dragState = null;

// Augment runtime state
let augments = { w: [], b: [] };       // owned augment ids
let mannedTowers = {};                  // squareId -> color (pawn inside tower)
let mounted = { w: null, b: null };     // squareId of mounted king, or null
let specialSelect = null;               // { type:'tower'|'mount', square } when awaiting exit step
let moveLog = [];                        // array of SAN-like strings
let snapshots = [];                      // undo stack
let gameOver = false;
let gameOverText = '';

let lastClickSquare = null;
let lastClickTime = 0;

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

document.getElementById('btn-new-game').addEventListener('click', () => startAugmentDraft());
document.getElementById('btn-flip').addEventListener('click', () => { flipped = !flipped; renderBoard(); });
document.getElementById('btn-undo').addEventListener('click', undoMove);

document.querySelectorAll('.tc-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tc-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedMinutes = parseInt(btn.dataset.minutes);
    startAugmentDraft();
  });
});


function has(color, augId) {
  return augments[color] && augments[color].includes(augId);
}


function newGame() {
  game = new Chess();
  selectedSquare = null;
  legalMoves = [];
  lastMove = null;
  pendingPromotion = null;
  dragState = null;
  mannedTowers = {};
  mounted = { w: null, b: null };
  specialSelect = null;
  moveLog = [];
  snapshots = [];
  gameOver = false;
  gameOverText = '';

  // Stunlock reset
  stunlockCharges = { w: {}, b: {} };
  stunnedSquares = {};
  pendingStunlock = null;
  stunlockTargeting = false;
  // Seed charges: each bishop starting square gets a charge if owner has stunlock
  if (has('w', 'stunlock')) { stunlockCharges.w = { c1: true, f1: true }; }
  if (has('b', 'stunlock')) { stunlockCharges.b = { c8: true, f8: true }; }
  hideStunlockPanel();

  stopClock();
  clockStarted = false;
  timeWhite = selectedMinutes * 60;
  timeBlack = selectedMinutes * 60;
  renderClocks();
  clockWhiteEl.classList.remove('active', 'low-time');
  clockBlackEl.classList.remove('active', 'low-time');

  renderBoard();
  renderMoveList();
  updateStatus();
  updateCaptured();
  renderActiveAugments();
}

function renderActiveAugments() {
  // wipe all but header
  activeAugmentsEl.querySelectorAll('.aa-item').forEach(e => e.remove());
  let count = 0;
  ['w', 'b'].forEach(c => {
    augments[c].forEach(id => {
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
//  SQUARE / COORDINATE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function sqToFR(sq) {
  return { f: FILES.indexOf(sq[0]), r: parseInt(sq[1]) - 1 }; // r=0 is rank1
}
function frToSq(f, r) {
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return FILES[f] + (r + 1);
}
function isEmpty(sq) {
  return !game.get(sq) && !mannedTowers[sq];
}
function pieceAt(sq) {
  return game.get(sq);
}


function generateMoves(sq) {
  const turn = game.turn();
  if (gameOver) return [];

  // If awaiting a special exit step (tower leave / dismount), only those moves
  if (specialSelect && specialSelect.square === sq) {
    return generateExitMoves(sq);
  }

  const piece = pieceAt(sq);
  if (!piece || piece.color !== turn) return [];

  // Stunned pieces cannot move
  if (stunnedSquares[sq] > 0) return [];

  let moves = [];

  // Mounted king moves like a knight
  if (mounted[turn] === sq && piece.type === 'k') {
    moves = generateMountedKingMoves(sq, turn);
    return filterIntoCheck(moves, turn);
  }

  // Standard legal moves from chess.js
  const std = game.moves({ square: sq, verbose: true }).map(m => ({
    from: m.from, to: m.to, promotion: m.promotion, captured: m.captured, standard: true,
  }));
  moves.push(...std);

  // Augment additions for pawns
  if (piece.type === 'p') {
    if (has(turn, 'leaping')) moves.push(...generateLeapingMoves(sq, turn));
    if (has(turn, 'kingspawns')) moves.push(...generateKingsPawnMoves(sq, turn));
    if (has(turn, 'watchtowers')) moves.push(...generateTowerEntryMoves(sq, turn));
  }

  // Mounting: king moving onto an allied knight
  if (piece.type === 'k' && has(turn, 'mounting')) {
    moves.push(...generateMountMoves(sq, turn));
  }

  // Deduplicate by to-square preferring standard captures
  moves = dedupeMoves(moves);

  // All non-standard moves must not leave own king in check
  return filterIntoCheck(moves, turn);
}

function dedupeMoves(moves) {
  const map = new Map();
  for (const m of moves) {
    // Tower entry / mount are distinct intents — never collapse them into a
    // same-square standard move, so re-entering a tower always stays available.
    const key = (m.special === 'towerEnter' || m.special === 'mount')
      ? m.special + ':' + m.to
      : m.to + (m.promotion || '');
    if (!map.has(key)) map.set(key, m);
    else {
      // prefer standard moves over other special moves on the same square
      const existing = map.get(key);
      if (!existing.standard && m.standard) map.set(key, m);
    }
  }
  return Array.from(map.values());
}


// ── Leaping Pawns ──────────────────────────────────────────────────────────────
function generateLeapingMoves(sq, color) {
  const { f, r } = sqToFR(sq);
  const dir = color === 'w' ? 1 : -1;
  const target = frToSq(f, r + 2 * dir);
  const res = [];
  if (target && isEmpty(target)) {
    // destination empty; jumping over anything is allowed; no capture
    const isPromo = (color === 'w' && target[1] === '8') || (color === 'b' && target[1] === '1');
    res.push({ from: sq, to: target, special: 'leap', promotion: isPromo ? 'q' : undefined, needsPromo: isPromo });
  }
  return res;
}

// ── King's Pawns ───────────────────────────────────────────────────────────────
function generateKingsPawnMoves(sq, color) {
  const { f, r } = sqToFR(sq);
  const res = [];
  // 8 directions, single step, only onto empty squares (captures stay normal)
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const target = frToSq(f + df, r + dr);
      if (target && isEmpty(target)) {
        const isPromo = (color === 'w' && target[1] === '8') || (color === 'b' && target[1] === '1');
        res.push({ from: sq, to: target, special: 'kingstep', promotion: isPromo ? 'q' : undefined, needsPromo: isPromo });
      }
    }
  }
  return res;
}

// ── Watchtowers: entry ───────────────────────────────────────────────────────────
// A pawn boards an adjacent allied rook with a 1-step move from any direction.
// The rook may be anywhere on the board (it is not restricted to its starting corner).
function generateTowerEntryMoves(sq, color) {
  const { f, r } = sqToFR(sq);
  const res = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const target = frToSq(f + df, r + dr);
      if (!target) continue;
      if (mannedTowers[target]) continue; // already manned
      const tp = pieceAt(target);
      if (!tp || tp.color !== color || tp.type !== 'r') continue;
      res.push({ from: sq, to: target, special: 'towerEnter' });
    }
  }
  return res;
}


// ── Mounting: king onto allied knight ────────────────────────────────────────────
function generateMountMoves(sq, color) {
  const { f, r } = sqToFR(sq);
  const res = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const target = frToSq(f + df, r + dr);
      if (!target) continue;
      const tp = pieceAt(target);
      if (tp && tp.color === color && tp.type === 'n') {
        res.push({ from: sq, to: target, special: 'mount' });
      }
    }
  }
  return res;
}

// ── Mounted king moves (knight pattern) ──────────────────────────────────────────
function generateMountedKingMoves(sq, color) {
  const { f, r } = sqToFR(sq);
  const deltas = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
  const res = [];
  for (const [df, dr] of deltas) {
    const target = frToSq(f + df, r + dr);
    if (!target) continue;
    if (isEmpty(target)) {
      res.push({ from: sq, to: target, special: 'mountedMove' });
    } else {
      const tp = pieceAt(target);
      if (tp && tp.color !== color) {
        res.push({ from: sq, to: target, special: 'mountedMove', captured: tp.type });
      }
    }
  }
  return res;
}

// ── Exit moves (tower leave / dismount): single king-step to free field ──────────
function generateExitMoves(sq) {
  const { f, r } = sqToFR(sq);
  const res = [];
  // Determine the exit type. While a special exit is being armed by the player
  // `specialSelect` tells us; otherwise (e.g. during game-over evaluation) infer
  // it from the board state so we never dereference a null `specialSelect`.
  const type = (specialSelect && specialSelect.square === sq)
    ? specialSelect.type
    : (mannedTowers[sq] ? 'tower' : 'mount');
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const target = frToSq(f + df, r + dr);
      if (target && isEmpty(target)) {
        res.push({ from: sq, to: target, special: type === 'tower' ? 'towerLeave' : 'dismount' });
      }
    }
  }
  return filterIntoCheck(res, game.turn());
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CHECK DETECTION FOR SPECIAL MOVES
// ═══════════════════════════════════════════════════════════════════════════════
// Apply a move to a cloned board state and test if own king is attacked.
function filterIntoCheck(moves, color) {
  // Normally chess.js has already filtered standard moves so they can't leave
  // the king in check. But once ANY king is mounted, chess.js's check detection
  // is unreliable — it doesn't know a mounted king moves/attacks like a knight,
  // so it can both under-report check (enemy mounted king giving a knight-check)
  // and mis-judge which moves are safe. In that case we must re-validate every
  // move (standard included) with our own mounted-aware isKingAttacked.
  const mountedInPlay = !!(mounted.w || mounted.b);
  return moves.filter(m => {
    if (m.standard && !mountedInPlay) return true; // chess.js already filtered these
    const snap = captureState();
    try {
      applyMoveToState(m, color, true);
      const inCheck = isKingAttacked(color);
      return !inCheck;
    } finally {
      restoreState(snap);
    }
  });
}

// Determine if `color`'s king is attacked, accounting for mounted king position.
function isKingAttacked(color) {
  // Build a FEN where it's the OPPONENT to move, then use chess.js in_check.
  // Simpler: scan opponent attacks manually using chess.js by setting turn.
  const kingSq = mounted[color] || findKingSquare(color);
  if (!kingSq) return false;
  return squareAttackedBy(kingSq, color === 'w' ? 'b' : 'w');
}

// Is `sq` attacked by any piece of `byColor`? Uses chess.js board scan.
function squareAttackedBy(sq, byColor) {
  const board = game.board();
  const { f: tf, r: tr } = sqToFR(sq);

  for (let br = 0; br < 8; br++) {
    for (let bf = 0; bf < 8; bf++) {
      const cell = board[br][bf];
      if (!cell || cell.color !== byColor) continue;
      const pf = bf;
      const pr = 7 - br; // board[0] is rank8
      const psq = frToSq(pf, pr);
      // A mounted king attacks like a knight
      if (mounted[byColor] === psq && cell.type === 'k') {
        if (knightAttacks(pf, pr, tf, tr)) return true;
        continue;
      }
      if (attacksSquare(cell.type, cell.color, pf, pr, tf, tr)) return true;
    }
  }
  return false;
}

function knightAttacks(pf, pr, tf, tr) {
  const df = Math.abs(pf - tf), dr = Math.abs(pr - tr);
  return (df === 1 && dr === 2) || (df === 2 && dr === 1);
}

function attacksSquare(type, color, pf, pr, tf, tr) {
  const df = tf - pf, dr = tr - pr;
  const adf = Math.abs(df), adr = Math.abs(dr);
  switch (type) {
    case 'p': {
      const dir = color === 'w' ? 1 : -1;
      return dr === dir && adf === 1;
    }
    case 'n': return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    case 'k': return adf <= 1 && adr <= 1 && (adf + adr > 0);
    case 'b': return adf === adr && adf > 0 && clearPath(pf, pr, tf, tr);
    case 'r': return ((df === 0) !== (dr === 0)) && clearPath(pf, pr, tf, tr);
    case 'q': return ((adf === adr && adf > 0) || ((df === 0) !== (dr === 0))) && clearPath(pf, pr, tf, tr);
  }
  return false;
}

function clearPath(pf, pr, tf, tr) {
  const sf = Math.sign(tf - pf), sr = Math.sign(tr - pr);
  let cf = pf + sf, cr = pr + sr;
  while (cf !== tf || cr !== tr) {
    const sq = frToSq(cf, cr);
    if (pieceAt(sq) || mannedTowers[sq]) return false;
    cf += sf; cr += sr;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STATE SNAPSHOT (for special-move check testing & undo)
// ═══════════════════════════════════════════════════════════════════════════════
function captureState() {
  return {
    fen: game.fen(),
    mannedTowers: { ...mannedTowers },
    mounted: { ...mounted },
    lastMove: lastMove ? { ...lastMove } : null,
    moveLogLen: moveLog.length,
    specialSelect: specialSelect ? { ...specialSelect } : null,
    gameOver, gameOverText,
    stunlockCharges: { w: { ...stunlockCharges.w }, b: { ...stunlockCharges.b } },
    stunnedSquares: { ...stunnedSquares },
    pendingStunlock: pendingStunlock ? { ...pendingStunlock } : null,
    stunlockTargeting,
  };
}

function restoreState(snap) {
  game.load(snap.fen);
  mannedTowers = { ...snap.mannedTowers };
  mounted = { ...snap.mounted };
  lastMove = snap.lastMove ? { ...snap.lastMove } : null;
  moveLog.length = snap.moveLogLen;
  specialSelect = snap.specialSelect ? { ...snap.specialSelect } : null;
  gameOver = snap.gameOver;
  gameOverText = snap.gameOverText;
  if (snap.stunlockCharges) {
    stunlockCharges = { w: { ...snap.stunlockCharges.w }, b: { ...snap.stunlockCharges.b } };
  }
  stunnedSquares = snap.stunnedSquares ? { ...snap.stunnedSquares } : {};
  pendingStunlock = snap.pendingStunlock ? { ...snap.pendingStunlock } : null;
  stunlockTargeting = snap.stunlockTargeting || false;
}

// Build a new FEN with modified board + flipped turn (for special moves).
// If stripCastleColor is 'w' or 'b', remove that color's castling rights
// (used when a king is moved by a special move so chess.js stays consistent).
function flipTurnFen(stripCastleColor) {
  const parts = game.fen().split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-'; // clear en-passant

  if (stripCastleColor) {
    let castle = parts[2] === '-' ? '' : parts[2];
    if (stripCastleColor === 'w') castle = castle.replace(/[KQ]/g, '');
    else castle = castle.replace(/[kq]/g, '');
    parts[2] = castle || '-';
  }

  // increment fullmove if it becomes white's turn
  if (parts[1] === 'w') parts[5] = String(parseInt(parts[5]) + 1);
  return parts.join(' ');
}


// ═══════════════════════════════════════════════════════════════════════════════
//  MOVE EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════
// applyMoveToState mutates game/mannedTowers/mounted. testOnly skips turn-dependent FEN normalization details that don't matter for check tests.
function applyMoveToState(m, color, testOnly) {
  if (m.standard) {
    // Capturing a manned tower kills BOTH the rook and the garrisoned pawn.
    // chess.js removes the rook; we must also clear the ghost pawn so the
    // capturing piece cleanly occupies the square.
    if (mannedTowers[m.to]) delete mannedTowers[m.to];
    const mv = { from: m.from, to: m.to };
    if (m.promotion) mv.promotion = m.promotion;
    game.move(mv);
    // If the moved piece was a garrisoned tower (rook), the pawn rides along.
    if (mannedTowers[m.from]) {
      const c = mannedTowers[m.from];
      delete mannedTowers[m.from];
      mannedTowers[m.to] = c;
    }
    return;
  }



  // A special move that lands on a manned tower also wipes the ghost pawn so
  // both the rook and garrisoned pawn die together.
  if (mannedTowers[m.to]) delete mannedTowers[m.to];

  // Special moves manipulate the board directly.
  switch (m.special) {
    case 'leap':
    case 'kingstep': {

      const piece = pieceAt(m.from);
      game.remove(m.from);
      const placeType = m.promotion ? m.promotion : piece.type;
      game.put({ type: placeType, color }, m.to);
      break;
    }
    case 'towerEnter': {
      game.remove(m.from);       // remove the pawn; the rook already occupies m.to
      mannedTowers[m.to] = color;
      break;
    }
    case 'towerLeave': {
      delete mannedTowers[m.from];      // tower (rook) stays; pawn steps out
      game.put({ type: 'p', color }, m.to);
      break;
    }

    case 'mount': {
      // king moves onto knight; knight is absorbed, king occupies it, mounted
      game.remove(m.from);  // remove king from old square
      game.remove(m.to);    // remove the knight
      game.put({ type: 'k', color }, m.to);
      mounted[color] = m.to;
      break;
    }
    case 'mountedMove': {
      if (m.captured) game.remove(m.to);
      game.remove(m.from);
      game.put({ type: 'k', color }, m.to);
      mounted[color] = m.to;
      break;
    }
    case 'dismount': {
      // king steps off to a free field; the knight it was riding is restored
      // to the square the king vacated (the mount square), so the knight survives.
      game.remove(m.from);
      game.put({ type: 'n', color }, m.from);  // knight dismounts, stays behind
      game.put({ type: 'k', color }, m.to);
      mounted[color] = null;
      break;
    }

  }

  // King-involving special moves invalidate that color's castling rights.
  const kingMoved = (m.special === 'mount' || m.special === 'mountedMove' || m.special === 'dismount');
  // Flip turn via FEN (chess.js board now reflects the move)
  game.load(flipTurnFen(kingMoved ? color : null));
}


function getMoveAt(toSq) {
  return legalMoves.find(m => m.to === toSq);
}

function attemptMove(from, to) {
  const move = legalMoves.find(m => m.to === to);
  if (!move) return;

  // Promotion handling — both standard and special leaping/kingstep promotions
  const piece = pieceAt(from);
  const reachesPromo = piece && piece.type === 'p' &&
    ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));

  if (move.standard && reachesPromo) {
    pendingPromotion = { from, to, move };
    showPromotionModal(piece.color);
    return;
  }
  if (move.needsPromo) {
    pendingPromotion = { from, to, move };
    showPromotionModal(piece.color);
    return;
  }

  executeMove(move);
}

function executeMove(move, promotionChoice) {
  // Push undo snapshot BEFORE applying
  snapshots.push(captureState());

  const color = game.turn();
  const fromPiece = pieceAt(move.from);

  // Special "towerEnter" / "mount" don't end the turn-of-special-action selection;
  // they ARE full moves that pass the turn.
  const m = { ...move };
  if (promotionChoice) m.promotion = promotionChoice;

  // Detect capture for logging (standard handled by chess.js)
  let capturedPiece = null;
  if (m.standard) {
    capturedPiece = pieceAt(m.to);
  } else if (m.captured) {
    capturedPiece = { type: m.captured };
  }

  applyMoveToState(m, color, false);

  // Decrement stun counters (each individual move counts as one "turn")
  tickStunCounters();

  // Track bishop moves for stunlock charge transfer
  let bishopStunlockPending = false;
  if (fromPiece && fromPiece.type === 'b' && has(color, 'stunlock')) {
    const hadCharge = stunlockCharges[color][m.from];
    delete stunlockCharges[color][m.from];
    if (hadCharge) {
      stunlockCharges[color][m.to] = true;
      pendingStunlock = { color, bishopSq: m.to };
      bishopStunlockPending = true;
    }
  }

  // Record SAN-ish log entry
  moveLog.push({ san: describeMove(m, fromPiece, color), color });

  lastMove = { from: m.from, to: m.to };
  selectedSquare = null;
  legalMoves = [];
  specialSelect = null;

  // Clocks
  if (!clockStarted) { clockStarted = true; startClock(); }
  switchClock();

  // If a stunlock decision is pending, pause turn and show panel
  if (bishopStunlockPending) {
    renderBoard();
    renderMoveList();
    updateStatus();
    updateCaptured();
    showStunlockPanel();
    return;
  }

  // Check game-over conditions (incl. mounted-king capture / checkmate)
  evaluateGameOver();

  renderBoard();
  renderMoveList();
  updateStatus();
  updateCaptured();

  if (gameOver) stopClock();
}

function describeMove(m, piece, color) {
  if (m.special === 'towerEnter') return '⌂' + m.to;
  if (m.special === 'towerLeave') return m.to + '↑';
  if (m.special === 'mount') return 'K♞' + m.to;
  if (m.special === 'dismount') return 'K↓' + m.to;
  if (m.special === 'mountedMove') return '♞' + m.to;
  const p = piece && piece.type !== 'p' ? piece.type.toUpperCase() : '';
  const cap = m.captured ? 'x' : '';
  return p + cap + m.to;
}

function renderBoard() {
  boardEl.innerHTML = '';
  const files = ['a','b','c','d','e','f','g','h'];
  const ranks = ['8','7','6','5','4','3','2','1'];
  const displayRanks = flipped ? [...ranks].reverse() : ranks;
  const displayFiles = flipped ? [...files].reverse() : files;

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const rank = displayRanks[r];
      const file = displayFiles[f];
      const sq = file + rank;

      const isLight = (files.indexOf(file) + parseInt(rank)) % 2 === 1;
      const sqEl = document.createElement('div');
      sqEl.className = 'square ' + (isLight ? 'light' : 'dark');
      sqEl.dataset.square = sq;

      // Tower terrain marker (only relevant if either side has watchtowers)
      if (ALL_TOWERS.includes(sq) && (has('w', 'watchtowers') || has('b', 'watchtowers'))) {
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

      if (lastMove && (sq === lastMove.from || sq === lastMove.to)) sqEl.classList.add('last-move');
      if (selectedSquare === sq) sqEl.classList.add('selected');

      const lm = legalMoves.find(m => m.to === sq);
      if (lm) {
        const isCapture = (pieceAt(sq) && pieceAt(sq).color !== game.turn()) || lm.captured;
        sqEl.classList.add(isCapture ? 'legal-capture' : 'legal-move');
        sqEl.classList.add('can-move');
      }

      // In-check highlight (standard only)
      if (!mounted.w && !mounted.b && game.in_check()) {
        const kingSquare = findKingSquare(game.turn());
        if (kingSquare === sq) sqEl.classList.add('in-check');
      }

      // Stunlock: mark currently stunned squares
      if (stunnedSquares[sq] > 0) {
        sqEl.classList.add('stunned');
      }

      // Stunlock targeting mode: highlight selectable quadrant squares
      if (stunlockTargeting && pendingStunlock) {
        const validQuads = getStunlockQuadrants(pendingStunlock.bishopSq);
        const isTargetable = validQuads.some(({ f: qf, r: qr }) =>
          quadrantSquares(qf, qr).includes(sq)
        );
        if (isTargetable) sqEl.classList.add('stunlock-target');
        // Restore preview highlight for the currently hovered quad after a re-render
        if (stunlockHoverQuad && quadrantSquares(stunlockHoverQuad.f, stunlockHoverQuad.r).includes(sq)) {
          sqEl.classList.add('stunlock-preview');
        }
        sqEl.classList.add('can-move');
      }

      // Render piece (or manned tower marker)
      const piece = pieceAt(sq);
      if (mannedTowers[sq]) {
        const color = mannedTowers[sq];
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece manned-tower ' + (color === 'w' ? 'white' : 'black');
        pieceEl.textContent = PIECES[color + 'R']; // tower (rook) glyph — grabbing it moves the whole tower
        pieceEl.dataset.square = sq;
        attachPieceHandlers(pieceEl, sq);

        // Separate pawn badge — its own grab target to move the pawn OUT of the tower.
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
      } else if (piece && mounted[piece.color] === sq && piece.type === 'k') {
        // Mounted king: shown as the KNIGHT (its mount) with a small king badge.
        const color = piece.color;
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece mounted ' + (color === 'w' ? 'white' : 'black');
        pieceEl.textContent = PIECES[color + 'N']; // knight glyph — grabbing it moves like a knight
        pieceEl.dataset.square = sq;
        if (color !== game.turn() || gameOver) pieceEl.style.cursor = 'default';
        attachPieceHandlers(pieceEl, sq);

        // Small king badge — its own grab target to dismount.
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

        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece ' + (piece.color === 'w' ? 'white' : 'black');
        pieceEl.textContent = PIECES[piece.color + piece.type.toUpperCase()];
        pieceEl.dataset.square = sq;
        if (piece.color !== game.turn() || gameOver) pieceEl.style.cursor = 'default';
        attachPieceHandlers(pieceEl, sq);
        sqEl.appendChild(pieceEl);
      }


      sqEl.addEventListener('click', onSquareClick);
      boardEl.appendChild(sqEl);
    }
  }
}

function attachPieceHandlers(pieceEl, sq) {
  pieceEl.addEventListener('mousedown', onPieceMouseDown);
  pieceEl.addEventListener('touchstart', onPieceTouchStart, { passive: false });
  pieceEl.addEventListener('dblclick', onPieceDblClick);
}

function findKingSquare(color) {
  const board = game.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (cell && cell.type === 'k' && cell.color === color) {
        return 'abcdefgh'[f] + (8 - r);
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DOUBLE-CLICK (tower leave / dismount activation)
// ═══════════════════════════════════════════════════════════════════════════════
function onPieceDblClick(e) {
  if (gameOver) return;
  const sq = e.currentTarget.dataset.square;
  const turn = game.turn();

  // Manned tower belonging to current player -> arm leave
  if (mannedTowers[sq] === turn) {
    specialSelect = { type: 'tower', square: sq };
    selectedSquare = sq;
    legalMoves = generateExitMoves(sq);
    renderBoard();
    return;
  }
  // Mounted king of current player -> arm dismount
  if (mounted[turn] === sq) {
    specialSelect = { type: 'mount', square: sq };
    selectedSquare = sq;
    legalMoves = generateExitMoves(sq);
    renderBoard();
    return;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLICK-TO-MOVE
// ═══════════════════════════════════════════════════════════════════════════════
function onSquareClick(e) {
  if (gameOver) return;
  if (dragState) return;

  const sq = e.currentTarget.dataset.square;
  const turn = game.turn();

  // While a stunlock decision is pending and NOT targeting, block all board interaction
  if (pendingStunlock && !stunlockTargeting) return;

  // Stunlock targeting: confirm the currently-previewed quadrant on click
  if (stunlockTargeting && pendingStunlock) {
    // Prefer the quad already highlighted by the hover preview; fall back to
    // computing the closest quad to the clicked square if hover is unavailable.
    if (stunlockHoverQuad) {
      applyStunlockToQuadrant(stunlockHoverQuad.f, stunlockHoverQuad.r);
    } else {
      const validQuads = getStunlockQuadrants(pendingStunlock.bishopSq);
      const matching = validQuads.filter(({ f, r }) => quadrantSquares(f, r).includes(sq));
      if (matching.length > 0) {
        const { f: bf, r: br } = sqToFR(pendingStunlock.bishopSq);
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

  // If we have an armed special (tower-leave / dismount) and click a valid exit, do it.
  if (specialSelect && specialSelect.square === selectedSquare) {
    const move = legalMoves.find(m => m.to === sq);
    if (move) { attemptMove(selectedSquare, sq); return; }
  }

  // (The garrison pawn is moved out via its own badge handler, not by clicking
  //  the tower square — clicking/grabbing the tower moves the rook normally.)

  // Mounted king of current player: first click selects (shows knight moves);

  // double-click arms dismount.
  if (mounted[turn] === sq) {
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

    // Clicking own movable piece reselects
    const piece = pieceAt(sq);
    const isOwnMovable = (piece && piece.color === turn) || (mannedTowers[sq] === turn) || (mounted[turn] === sq);
    if (isOwnMovable && !(specialSelect && specialSelect.square === selectedSquare)) {

      selectSquare(sq); return;
    }
    deselectSquare();
  } else {
    selectSquare(sq);
  }
}


// Arm a tower-leave or dismount: highlight exit squares for the next click.
function armSpecialExit(sq, turn) {
  if (mannedTowers[sq] === turn) {
    specialSelect = { type: 'tower', square: sq };
  } else if (mounted[turn] === sq) {
    specialSelect = { type: 'mount', square: sq };
  } else {
    return;
  }
  selectedSquare = sq;
  legalMoves = generateExitMoves(sq);
  renderBoard();
}

// Arm a tower-leave / dismount AND immediately begin dragging the pawn/king out,
// so leaving feels exactly like any normal grab-and-drag move.
function beginBadgeDrag(sq, color, x, y, isTouch) {
  if (gameOver || color !== game.turn()) return;
  armSpecialExit(sq, color);
  // Dragging the BADGE moves the occupant OUT of the square (the pawn leaving the
  // tower, or the king dismounting). The drag visual must therefore show that
  // occupant — not the rook/knight that stays behind.
  const occupant = mannedTowers[sq] ? color + 'P' : color + 'K';
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

  const turn = game.turn();
  const piece = pieceAt(sq);
  const isOwn = (piece && piece.color === turn) || (mannedTowers[sq] === turn) || (mounted[turn] === sq);
  if (!isOwn) return;

  specialSelect = null;
  selectedSquare = sq;
  legalMoves = generateMoves(sq);
  renderBoard();
}

function deselectSquare() {
  selectedSquare = null;
  legalMoves = [];
  specialSelect = null;
  renderBoard();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DRAG-TO-MOVE
// ═══════════════════════════════════════════════════════════════════════════════
function onPieceMouseDown(e) {
  if (gameOver) return;
  if (pendingStunlock) return; // block dragging while stunlock decision is pending
  const sq = e.currentTarget.dataset.square;
  const turn = game.turn();
  const piece = pieceAt(sq);
  const isOwn = (piece && piece.color === turn) || (mannedTowers[sq] === turn) || (mounted[turn] === sq);
  if (!isOwn) return;

  e.preventDefault();
  startDrag(sq, e.clientX, e.clientY);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function onPieceTouchStart(e) {
  if (gameOver) return;
  if (pendingStunlock) return; // block dragging while stunlock decision is pending
  const sq = e.currentTarget.dataset.square;
  const turn = game.turn();
  const piece = pieceAt(sq);
  const isOwn = (piece && piece.color === turn) || (mannedTowers[sq] === turn) || (mounted[turn] === sq);
  if (!isOwn) return;
  e.preventDefault();
  const touch = e.touches[0];

  startDrag(sq, touch.clientX, touch.clientY);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
}


// dragInfo (optional): { glyphKey, color, fromBadge } — used when dragging the
// occupant OUT of a shared square (pawn leaving a tower, king dismounting). In
// that case the ghost must show the OCCUPANT, and only the occupant's badge —
// not the whole rook/knight stack — should fade out.
function startDrag(sq, x, y, dragInfo) {
  // Preserve an armed special-select if dragging that same piece
  if (!(specialSelect && specialSelect.square === sq)) {
    selectSquare(sq);
  } else {
    selectedSquare = sq;
    legalMoves = generateExitMoves(sq);
    renderBoard();
  }
  if (legalMoves.length === 0 && !specialSelect) { /* still allow drag visual */ }

  dragState = { fromSquare: sq, fromBadge: !!(dragInfo && dragInfo.fromBadge) };

  // Decide what the drag ghost should show — the piece(s) actually moving,
  // never the one being left behind.
  //   • Dragging a badge OUT (dismount / tower-leave): show the solo occupant.
  //   • Dragging the whole stack (rook tower / mounted knight): show the host
  //     glyph WITH the occupant nestled inside, mirroring the board so both
  //     pieces are seen travelling together.
  let glyph, color, badgeKey = null;
  if (dragInfo && dragInfo.glyphKey) {
    glyph = PIECES[dragInfo.glyphKey];
    color = dragInfo.color;
  } else if (mannedTowers[sq]) {
    // Grabbing the whole tower moves the rook AND the garrisoned pawn together.
    color = mannedTowers[sq];
    glyph = PIECES[color + 'R'];
    badgeKey = color + 'P';
  } else {
    const piece = pieceAt(sq);
    color = piece.color;
    glyph = PIECES[color + piece.type.toUpperCase()];
    // A mounted king travels as the knight carrying the king inside it.
    if (mounted[color] === sq && piece.type === 'k') {
      glyph = PIECES[color + 'N'];
      badgeKey = color + 'K';
    }
  }

  dragGhost.className = color === 'w' ? 'white' : 'black';
  dragGhost.innerHTML = '';
  dragGhost.textContent = glyph;
  if (badgeKey) {
    dragGhost.classList.add('has-occupant');
    const ghostBadge = document.createElement('span');
    ghostBadge.className = 'ghost-badge ' + (color === 'w' ? 'white' : 'black');
    ghostBadge.textContent = PIECES[badgeKey];
    dragGhost.appendChild(ghostBadge);
  }
  dragGhost.style.display = 'block';
  moveDragGhost(x, y);


  // Fade out the piece being moved. When dragging a badge occupant out, fade
  // only that badge so the rook/knight that stays behind remains fully visible.
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
  // keep selection (and any armed special) instead of clearing on a missed drag
  renderBoard();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PROMOTION MODAL
// ═══════════════════════════════════════════════════════════════════════════════
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
        executeMove(pendingPromotion.move, p);
        pendingPromotion = null;
      }
    });
    promotionPieces.appendChild(btn);
  });
  promotionModal.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STATUS
// ═══════════════════════════════════════════════════════════════════════════════
function updateStatus() {
  statusBox.className = 'status-box';

  if (gameOver) {
    statusText.textContent = gameOverText;
    if (gameOverText.includes('Draw')) statusBox.classList.add('draw');
    else statusBox.classList.add('checkmate');
    return;
  }

  // In-check warning — covers both the standard board and a mounted king
  // (whose attacked state chess.js can't see, so we test it ourselves).
  const sideToMove = game.turn();
  const isChecked = (!mounted.w && !mounted.b)
    ? game.in_check()
    : isKingAttacked(sideToMove);
  if (isChecked) {
    const inCheck = sideToMove === 'w' ? 'White' : 'Black';
    statusText.textContent = `⚠ ${inCheck} is in check!`;
    statusBox.classList.add('check');
    return;
  }


  statusText.textContent = (game.turn() === 'w' ? 'White' : 'Black') + ' to move';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MOVE LIST
// ═══════════════════════════════════════════════════════════════════════════════
function renderMoveList() {
  moveListEl.innerHTML = '';
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
  // Reconstruct from standard chess.js history plus our special captures is hard;
  // instead count material difference from the current board.
  const counts = { w: {}, b: {} };
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
  const board = game.board();
  ['w', 'b'].forEach(c => { for (const t in start) counts[c][t] = 0; });
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const cell = board[r][f];
    if (cell) counts[cell.color][cell.type]++;
  }
  // manned tower pawns are off-board but still alive
  for (const sq in mannedTowers) counts[mannedTowers[sq]].p++;

  const capturedByW = []; // black pieces missing
  const capturedByB = []; // white pieces missing
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    const missingB = Math.max(0, start[t] - counts.b[t]);
    const missingW = Math.max(0, start[t] - counts.w[t]);
    for (let i = 0; i < missingB; i++) capturedByW.push(PIECES['b' + t.toUpperCase()]);
    for (let i = 0; i < missingW; i++) capturedByB.push(PIECES['w' + t.toUpperCase()]);
  }
  capturedWhite.textContent = capturedByW.join('');
  capturedBlack.textContent = capturedByB.join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  UNDO
// ═══════════════════════════════════════════════════════════════════════════════
function undoMove() {
  if (snapshots.length === 0) return;
  const snap = snapshots.pop();
  restoreState(snap);
  selectedSquare = null;
  legalMoves = [];
  specialSelect = null;
  // Hide stunlock panel after undo (state restored from snapshot)
  hideStunlockPanel();
  // Sync panel visibility: if restored state has pendingStunlock, show it
  if (pendingStunlock) showStunlockPanel();
  renderBoard();
  renderMoveList();
  updateStatus();
  updateCaptured();
  updateClockStyles();
}

