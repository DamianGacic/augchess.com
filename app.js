/**
 * AugChess — Lichess-inspired local chess app with Augments
 * Uses chess.js for base game logic, plus a custom move layer for augments.
 */

// ─── Piece Unicode Map ────────────────────────────────────────────────────────
const PIECES = {
  wK: '♚', wQ: '♛', wR: '♜', wB: '♝', wN: '♞', wP: '♟',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// ─── Augment Definitions ──────────────────────────────────────────────────────
const AUGMENT_DESCRIPTION_PATH = 'augments/descriptions';

const AUGMENT_IMAGE_PATH = 'augments/images';

// ─── Figure Definitions ───────────────────────────────────────────────────────
const FIGURE_IMAGE_PATH = 'figures/images';

// piece types in display order (pawns first, king last)
const FIGURE_TYPE_ORDER = ['p', 'n', 'b', 'r', 'q', 'k'];
const FIGURE_TYPE_NAMES = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

const FIGURES = [
  // Pawns
  { id: 'archer',      name: 'Archer',      replaces: 'p', image: null, desc: 'A nimble archer who can strike from a distance. Details coming soon.' },
  // Knights
  { id: 'cavalry',     name: 'Cavalry',     replaces: 'n', image: null, desc: 'A mounted warrior who charges across the field. Details coming soon.' },
  // Bishops
  { id: 'longbowman',  name: 'Longbowman',  replaces: 'b', image: null, desc: 'A skilled longbowman who commands the diagonals. Details coming soon.' },
  // Rooks
  { id: 'troll',       name: 'Troll',       replaces: 'r', image: null, desc: 'A hulking troll who dominates the ranks and files. Details coming soon.' },
  // Queens
  { id: 'sorceress',   name: 'Sorceress',   replaces: 'q', image: null, desc: 'A powerful sorceress who bends the rules of movement. Details coming soon.' },
  // Kings
  { id: 'warlord',     name: 'Warlord',     replaces: 'k', image: null, desc: 'A fearless warlord who leads from the front. Details coming soon.' },
];

const AUGMENTS = [
  { id: 'leaping',     name: 'Leaping Pawns', cost: 1, desc: 'Loading description...' },
  { id: 'watchtowers', name: 'Watchtowers',  cost: 1, desc: 'Loading description...' },
  { id: 'kingspawns',  name: "King's Pawns", cost: 2, desc: 'Loading description...' },
  { id: 'mounting',    name: 'Mounting',     cost: 2, desc: 'Loading description...', image: 'mounting.jpg' },
];

function augmentDescriptionUrl(id) {
  return `${AUGMENT_DESCRIPTION_PATH}/${id}.txt`;
}

async function loadAugmentDescriptions() {
  await Promise.all(AUGMENTS.map(async aug => {
    try {
      const response = await fetch(augmentDescriptionUrl(aug.id));
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      aug.desc = (await response.text()).trim();
    } catch (err) {
      console.warn(`Could not load augment description for ${aug.id}:`, err);
      aug.desc = aug.desc || 'Description unavailable.';
    }
  }));
}


const TOWER_SQUARES = { w: ['a1', 'h1'], b: ['a8', 'h8'] };
const ALL_TOWERS = ['a1', 'h1', 'a8', 'h8'];

// ─── State ────────────────────────────────────────────────────────────────────
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

// Manual double-click tracking (native dblclick is unreliable because we
// re-render the board between the two clicks, destroying the element).
let lastClickSquare = null;
let lastClickTime = 0;

// Augment draft state — declared here (before init runs startAugmentDraft)
let draftState = null; // { points:{w,b}, current:'w'|'b', owned:{w:[],b:[]}, passed:{w,b} }



// ─── Clock State ──────────────────────────────────────────────────────────────
let selectedMinutes = 3;
let timeWhite = 0;
let timeBlack = 0;
let clockInterval = null;
let clockStarted = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
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

// Augment modal refs
const augmentModal    = document.getElementById('augment-modal');
const augmentListEl   = document.getElementById('augment-list');
const augmentTurnText = document.getElementById('augment-turn-text');
const apWhiteEl       = document.getElementById('ap-white');
const apBlackEl       = document.getElementById('ap-black');
const apBoxWhite      = document.getElementById('augment-points-white');
const apBoxBlack      = document.getElementById('augment-points-black');
const btnAugmentPass  = document.getElementById('btn-augment-pass');
const btnAugmentStart = document.getElementById('btn-augment-start');

// View refs
const homeView        = document.getElementById('home-view');
const gameView        = document.getElementById('game-view');
const augmentsView    = document.getElementById('augments-view');

// Navigation refs
const navHomeBtn      = document.getElementById('nav-home');
const navGameBtn      = document.getElementById('nav-game');
const navAugmentsBtn  = document.getElementById('nav-augments');
const startGameBtn    = document.getElementById('start-game-btn');

// Augment detail modal refs
const augmentDetailModal = document.getElementById('augment-detail-modal');
const detailTitle        = document.getElementById('detail-title');
const detailCost         = document.getElementById('detail-cost');
const detailDescription  = document.getElementById('detail-description');
const closeDetailBtn     = document.getElementById('close-detail-btn');

// Drag ghost
const dragGhost = document.createElement('div');
dragGhost.id = 'drag-ghost';
document.body.appendChild(dragGhost);

// ─── Init ─────────────────────────────────────────────────────────────────────
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

btnAugmentPass.addEventListener('click', draftPass);
btnAugmentStart.addEventListener('click', draftStart);

// ═══════════════════════════════════════════════════════════════════════════════
//  AUGMENT DRAFT
// ═══════════════════════════════════════════════════════════════════════════════
function startAugmentDraft() {

  draftState = {
    points: { w: 2, b: 2 },
    current: 'w',
    owned: { w: [], b: [] },
    passed: { w: false, b: false },
  };
  augmentModal.classList.remove('hidden');
  btnAugmentStart.classList.add('hidden');
  btnAugmentPass.classList.remove('hidden');
  renderDraft();
}

function renderDraft() {
  const ds = draftState;
  apWhiteEl.textContent = ds.points.w;
  apBlackEl.textContent = ds.points.b;
  apBoxWhite.classList.toggle('active', ds.current === 'w');
  apBoxBlack.classList.toggle('active', ds.current === 'b');

  const who = ds.current === 'w' ? 'White' : 'Black';
  augmentTurnText.textContent = `${who}, choose an augment (or pass)`;

  augmentListEl.innerHTML = '';
  AUGMENTS.forEach(aug => {
    const card = document.createElement('button');
    card.className = 'augment-card cost-' + aug.cost;

    const ownerW = ds.owned.w.includes(aug.id);
    const ownerB = ds.owned.b.includes(aug.id);
    const ownedByCurrent = ds.owned[ds.current].includes(aug.id);
    const affordable = ds.points[ds.current] >= aug.cost;
    const disabled = ownedByCurrent || !affordable;

    if (disabled) card.classList.add('disabled');

    let owners = '';
    if (ownerW) owners += '<span class="ac-owner white">W</span>';
    if (ownerB) owners += '<span class="ac-owner black">B</span>';

    card.innerHTML = `
      <div class="ac-cost">${aug.cost}</div>
      <div class="ac-body">
        <div class="ac-name">${aug.name} ${owners}</div>
        <div class="ac-desc">${aug.desc}</div>
      </div>`;
    card.title = aug.desc;

    if (!disabled) {
      card.addEventListener('click', () => draftPick(aug.id));
    }
    augmentListEl.appendChild(card);
  });
}

function draftPick(augId) {
  const ds = draftState;
  const aug = AUGMENTS.find(a => a.id === augId);
  if (!aug) return;
  if (ds.owned[ds.current].includes(augId)) return;
  if (ds.points[ds.current] < aug.cost) return;

  ds.points[ds.current] -= aug.cost;
  ds.owned[ds.current].push(augId);
  ds.passed[ds.current] = false;

  advanceDraft();
}

function draftPass() {
  const ds = draftState;
  ds.passed[ds.current] = true;
  advanceDraft();
}

function advanceDraft() {
  const ds = draftState;

  // A player is "done" if they passed or cannot afford anything left to buy
  const canBuy = (c) => AUGMENTS.some(a => !ds.owned[c].includes(a.id) && ds.points[c] >= a.cost);
  const doneW = ds.passed.w || !canBuy('w');
  const doneB = ds.passed.b || !canBuy('b');

  if (doneW && doneB) {
    finishDraft();
    return;
  }

  // Switch turn to the other player if they're not done; else stay
  const other = ds.current === 'w' ? 'b' : 'w';
  const otherDone = other === 'w' ? doneW : doneB;
  if (!otherDone) {
    ds.current = other;
  }
  renderDraft();
}

function finishDraft() {
  btnAugmentPass.classList.add('hidden');
  btnAugmentStart.classList.remove('hidden');
  augmentTurnText.textContent = 'Draft complete! Ready to play.';
  augmentListEl.innerHTML = '';
  ['w', 'b'].forEach(c => {
    draftState.owned[c].forEach(id => {
      const aug = AUGMENTS.find(a => a.id === id);
      const card = document.createElement('div');
      card.className = 'augment-card cost-' + aug.cost;
      card.innerHTML = `
        <div class="ac-cost">${aug.cost}</div>
        <div class="ac-body">
          <div class="ac-name">${aug.name} <span class="ac-owner ${c === 'w' ? 'white' : 'black'}">${c === 'w' ? 'W' : 'B'}</span></div>
          <div class="ac-desc">${aug.desc}</div>
        </div>`;
      augmentListEl.appendChild(card);
    });
  });
  if (draftState.owned.w.length === 0 && draftState.owned.b.length === 0) {
    augmentTurnText.textContent = 'No augments selected. Standard chess!';
  }
}

function draftStart() {
  augments = { w: [...draftState.owned.w], b: [...draftState.owned.b] };
  augmentModal.classList.add('hidden');
  newGame();
}

function has(color, augId) {
  return augments[color] && augments[color].includes(augId);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NEW GAME
// ═══════════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════════
//  CUSTOM MOVE GENERATION
// ═══════════════════════════════════════════════════════════════════════════════
// Returns array of move objects: { from, to, special?, promotion?, captured? }
function generateMoves(sq) {
  const turn = game.turn();
  if (gameOver) return [];

  // If awaiting a special exit step (tower leave / dismount), only those moves
  if (specialSelect && specialSelect.square === sq) {
    return generateExitMoves(sq);
  }

  const piece = pieceAt(sq);
  if (!piece || piece.color !== turn) return [];

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
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const target = frToSq(f + df, r + dr);
      if (target && isEmpty(target)) {
        res.push({ from: sq, to: target, special: specialSelect.type === 'tower' ? 'towerLeave' : 'dismount' });
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
  return moves.filter(m => {
    if (m.standard) return true; // chess.js already filtered these
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

  // Record SAN-ish log entry
  moveLog.push({ san: describeMove(m, fromPiece, color), color });

  lastMove = { from: m.from, to: m.to };
  selectedSquare = null;
  legalMoves = [];
  specialSelect = null;

  // Clocks
  if (!clockStarted) { clockStarted = true; startClock(); }
  switchClock();

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

// ═══════════════════════════════════════════════════════════════════════════════
//  GAME OVER EVALUATION
// ═══════════════════════════════════════════════════════════════════════════════
function evaluateGameOver() {
  // A king might be missing if captured by a special move (mounted-king capture
  // or a mounted king itself capturing the enemy king via knight move).
  const wK = mounted.w || findKingSquare('w');
  const bK = mounted.b || findKingSquare('b');

  if (!wK) { gameOver = true; gameOverText = '♛ Black wins — King captured!'; return; }
  if (!bK) { gameOver = true; gameOverText = '♛ White wins — King captured!'; return; }

  // Standard checkmate/stalemate only reliable when no mounted king is in play
  // and chess.js board is consistent.
  if (!mounted.w && !mounted.b) {
    if (game.in_checkmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      gameOver = true; gameOverText = `♛ ${winner} wins by checkmate!`;
      return;
    }
    if (game.in_stalemate()) { gameOver = true; gameOverText = 'Draw — Stalemate'; return; }
    if (game.insufficient_material()) { gameOver = true; gameOverText = 'Draw — Insufficient Material'; return; }
    gameOver = false;
    gameOverText = '';
    return;
  }

  // Special case for mounted kings - check if the mounted king can escape check
  if (mounted.w || mounted.b) {
    const sideToMove = game.turn();
    const kingSq = mounted[sideToMove];
    
    if (kingSq) {
      // Check if king is in check
      const inCheck = isKingAttacked(sideToMove);
      
      if (inCheck) {
        // King is in check, check if it can escape
        let canEscape = false;
        
        // Check knight moves
        const knightMoves = generateMountedKingMoves(kingSq, sideToMove);
        const safeKnightMoves = filterIntoCheck(knightMoves, sideToMove);
        if (safeKnightMoves.length > 0) canEscape = true;
        
        // Check dismount moves if not already can escape
        if (!canEscape) {
          const dismountMoves = generateExitMoves(kingSq);
          if (dismountMoves.length > 0) canEscape = true;
        }
        
        // Check if any other pieces can block or capture the attacking piece
        if (!canEscape) {
          const otherPiecesCanMove = hasAnyLegalMove(sideToMove);
          if (!otherPiecesCanMove) {
            // No escape and no other pieces can help - checkmate
            const winner = sideToMove === 'w' ? 'Black' : 'White';
            gameOver = true; 
            gameOverText = `♛ ${winner} wins by checkmate!`;
            return;
          }
        }
      }
    }
  }
  
  // A king is mounted — chess.js's own checkmate/stalemate detection can't be
  // trusted (it doesn't know the king rides a knight and moves like one). We
  // evaluate it ourselves: the side to move is mated if its (mounted) king is
  // attacked and it has NO legal move that escapes; stalemated if not attacked
  // but it has no legal move at all.
  const sideToMove = game.turn();
  const inCheck = isKingAttacked(sideToMove);
  const canMove = hasAnyLegalMove(sideToMove);
  if (!canMove) {
    if (inCheck) {
      const winner = sideToMove === 'w' ? 'Black' : 'White';
      gameOver = true; gameOverText = `♛ ${winner} wins by checkmate!`;
    } else {
      gameOver = true; gameOverText = 'Draw — Stalemate';
    }
    return;
  }
  gameOver = false;
  gameOverText = '';
}

// Does `color` (which must be the side to move) have at least one legal move?
// Considers all of its pieces — standard moves, augment moves, and the mounted
// king's knight-pattern moves — and relies on the existing check-filtering so
// only moves that leave the king safe are counted.
function hasAnyLegalMove(color) {
  // generateMoves bails out when gameOver is set; temporarily clear it so we
  // can probe the position cleanly during evaluation.
  const wasGameOver = gameOver;
  gameOver = false;
  try {
    const board = game.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = board[r][f];
        if (!cell || cell.color !== color) continue;
        const sq = 'abcdefgh'[f] + (8 - r);
        if (generateMoves(sq).length > 0) return true;
      }
    }
    return false;
  } finally {
    gameOver = wasGameOver;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
//  CLOCK
// ═══════════════════════════════════════════════════════════════════════════════
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderClocks() {
  clockWhiteEl.textContent = formatTime(timeWhite);
  clockBlackEl.textContent = formatTime(timeBlack);
}

function startClock() {
  stopClock();
  clockInterval = setInterval(() => {
    const turn = game.turn();
    if (turn === 'w') timeWhite = Math.max(0, timeWhite - 1);
    else timeBlack = Math.max(0, timeBlack - 1);

    renderClocks();
    updateClockStyles();

    if (timeWhite === 0 || timeBlack === 0) {
      stopClock();
      const winner = timeWhite === 0 ? 'Black' : 'White';
      gameOver = true;
      gameOverText = `⏱ ${winner} wins on time!`;
      statusText.textContent = gameOverText;
      statusBox.className = 'status-box checkmate';
    }
  }, 1000);
}

function stopClock() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
}

function switchClock() { updateClockStyles(); }

function updateClockStyles() {
  const turn = game.turn();
  const LOW_TIME = 30;
  clockWhiteEl.classList.toggle('active', turn === 'w' && clockStarted && !gameOver);
  clockBlackEl.classList.toggle('active', turn === 'b' && clockStarted && !gameOver);
  clockWhiteEl.classList.toggle('low-time', timeWhite <= LOW_TIME && timeWhite > 0);
  clockBlackEl.classList.toggle('low-time', timeBlack <= LOW_TIME && timeBlack > 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOARD RENDERING
// ═══════════════════════════════════════════════════════════════════════════════
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
  // recompute lastMove from snapshot already stored
  renderBoard();
  renderMoveList();
  updateStatus();
  updateCaptured();
  updateClockStyles();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NAVIGATION AND VIEWS
// ═══════════════════════════════════════════════════════════════════════════════

// Show a specific view and update navigation
function showView(viewName) {
  homeView.classList.add('hidden');
  gameView.classList.add('hidden');
  augmentsView.classList.add('hidden');
  document.getElementById('figures-view').classList.add('hidden');

  if (viewName === 'home') {
    homeView.classList.remove('hidden');
  } else if (viewName === 'game') {
    gameView.classList.remove('hidden');
  } else if (viewName === 'augments') {
    augmentsView.classList.remove('hidden');
    renderAugmentsPage();
  } else if (viewName === 'figures') {
    document.getElementById('figures-view').classList.remove('hidden');
    renderFiguresPage();
  }

  navHomeBtn.classList.toggle('active', viewName === 'home');
  navGameBtn.classList.toggle('active', viewName === 'game');
  navAugmentsBtn.classList.toggle('active', viewName === 'augments');
  document.getElementById('nav-figures').classList.toggle('active', viewName === 'figures');
}

// Render the augments page with cards organized by cost
function renderAugmentsPage() {
  const container = document.getElementById('augments-container');
  container.innerHTML = '';
  
  // Group augments by cost
  const augmentsByCost = {};
  AUGMENTS.forEach(aug => {
    if (!augmentsByCost[aug.cost]) {
      augmentsByCost[aug.cost] = [];
    }
    augmentsByCost[aug.cost].push(aug);
  });
  
  // Create sections for each cost
  [1, 2].forEach(cost => {
    if (augmentsByCost[cost] && augmentsByCost[cost].length > 0) {
      const section = document.createElement('div');
      section.className = 'augments-by-cost';
      
      const title = document.createElement('h2');
      title.textContent = `Cost ${cost} Augments`;
      section.appendChild(title);
      
      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'augment-cards';
      
      augmentsByCost[cost].forEach(aug => {
        const card = document.createElement('div');
        card.className = `augment-card-upright cost-${aug.cost}`;
        card.dataset.id = aug.id;
        
        const header = document.createElement('div');
        header.className = 'ac-header';
        
        const costEl = document.createElement('div');
        costEl.className = 'ac-cost';
        costEl.textContent = aug.cost;
        
        const nameEl = document.createElement('div');
        nameEl.className = 'ac-name';
        nameEl.textContent = aug.name;
        
        header.appendChild(costEl);
        header.appendChild(nameEl);
        card.appendChild(header);

        if (aug.image) {
          const imgEl = document.createElement('img');
          imgEl.className = 'ac-image';
          imgEl.src = `${AUGMENT_IMAGE_PATH}/${aug.image}`;
          imgEl.alt = aug.name;
          card.appendChild(imgEl);
        }

        const descEl = document.createElement('div');
        descEl.className = 'ac-desc';
        descEl.textContent = aug.desc;
        card.appendChild(descEl);
        
        card.addEventListener('click', () => {
          showAugmentDetail(aug);
        });
        
        cardsContainer.appendChild(card);
      });
      
      section.appendChild(cardsContainer);
      container.appendChild(section);
    }
  });
}


// Show augment detail modal
function showAugmentDetail(augment) {
  detailTitle.textContent = augment.name;
  detailCost.textContent = `Cost: ${augment.cost}`;
  detailDescription.textContent = augment.desc;
  augmentDetailModal.classList.remove('hidden');
}

// Close augment detail modal
function closeAugmentDetail() {
  augmentDetailModal.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FIGURES PAGE
// ═══════════════════════════════════════════════════════════════════════════════
function renderFiguresPage() {
  const container = document.getElementById('figures-container');
  container.innerHTML = '';

  FIGURE_TYPE_ORDER.forEach(type => {
    const figures = FIGURES.filter(f => f.replaces === type);
    if (figures.length === 0) return;

    const section = document.createElement('div');
    section.className = 'augments-by-cost';

    const title = document.createElement('h2');
    title.textContent = FIGURE_TYPE_NAMES[type] + ' Figures';
    section.appendChild(title);

    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'augment-cards';

    figures.forEach(fig => {
      const card = document.createElement('div');
      card.className = 'augment-card-upright';
      card.dataset.id = fig.id;

      const header = document.createElement('div');
      header.className = 'ac-header';

      const typeEl = document.createElement('div');
      typeEl.className = 'ac-cost';
      typeEl.textContent = FIGURE_TYPE_NAMES[fig.replaces][0]; // first letter e.g. "P"

      const nameEl = document.createElement('div');
      nameEl.className = 'ac-name';
      nameEl.textContent = fig.name;

      header.appendChild(typeEl);
      header.appendChild(nameEl);
      card.appendChild(header);

      if (fig.image) {
        const imgEl = document.createElement('img');
        imgEl.className = 'ac-image';
        imgEl.src = `${FIGURE_IMAGE_PATH}/${fig.image}`;
        imgEl.alt = fig.name;
        card.appendChild(imgEl);
      }

      const descEl = document.createElement('div');
      descEl.className = 'ac-desc';
      descEl.textContent = fig.desc;
      card.appendChild(descEl);

      card.addEventListener('click', () => showFigureDetail(fig));
      cardsContainer.appendChild(card);
    });

    section.appendChild(cardsContainer);
    container.appendChild(section);
  });
}

function showFigureDetail(fig) {
  const modal = document.getElementById('figure-detail-modal');
  document.getElementById('figure-detail-title').textContent = fig.name;
  document.getElementById('figure-detail-type').textContent = `Replaces: ${FIGURE_TYPE_NAMES[fig.replaces]}`;
  const imgEl = document.getElementById('figure-detail-img');
  if (fig.image) {
    imgEl.src = `${FIGURE_IMAGE_PATH}/${fig.image}`;
    imgEl.alt = fig.name;
    imgEl.style.display = 'block';
  } else {
    imgEl.style.display = 'none';
  }
  document.getElementById('figure-detail-description').textContent = fig.desc;
  modal.classList.remove('hidden');
}

// Initialize navigation event listeners
function initNavigation() {
  // Navigation buttons
  navHomeBtn.addEventListener('click', () => showView('home'));
  navGameBtn.addEventListener('click', () => showView('game'));
  navAugmentsBtn.addEventListener('click', () => showView('augments'));
  document.getElementById('nav-figures').addEventListener('click', () => showView('figures'));
  
  // Start game button on homepage
  startGameBtn.addEventListener('click', () => {
    showView('game');
    startAugmentDraft();
  });
  
  // Close detail modal button
  closeDetailBtn.addEventListener('click', closeAugmentDetail);
  
  // Close modal when clicking outside content
  augmentDetailModal.addEventListener('click', (e) => {
    if (e.target === augmentDetailModal) {
      closeAugmentDetail();
    }
  });

  // Figure detail modal
  document.getElementById('close-figure-detail-btn').addEventListener('click', () => {
    document.getElementById('figure-detail-modal').classList.add('hidden');
  });
  document.getElementById('figure-detail-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('figure-detail-modal')) {
      document.getElementById('figure-detail-modal').classList.add('hidden');
    }
  });
}

// Initialize the app
async function initApp() {
  await loadAugmentDescriptions();
  initNavigation();
  showView('home'); // Start on homepage instead of game
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);
