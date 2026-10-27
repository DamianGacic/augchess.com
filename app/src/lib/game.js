// The game controller — app.js, abilities.js, the targeting files,
// vanguard.js, shields.js, ai-player.js and chat.js minus their DOM. Every
// rule lives in the shared engine; this holds the room state plus what's
// local to this phone (selection, targeting, the Vanguard plan, undo) and
// turns taps into the same actions the site sends.
//
// Screens read the live fields off `G` and re-render through useGame(),
// which ticks on every changed() — the site's renderAll/GameBridge.
import { useSyncExternalStore } from 'react';
import E from './engine.js';
import { getPref } from './prefs.js';
import * as Net from './net.js';
import { currentSession, recordLocalGame, myGamesCount, onAuthChange } from './auth.js';

export const UNIT_KEYS = ['Q', 'W', 'E', 'R'];
export const GLOBAL_KEYS = ['A', 'S', 'D', 'F'];

// Unit abilities that pick a target before anything goes to the engine.
// `targets` lists the squares a tap can land on; `resolve` turns a tapped
// square into the area/square that would be hit (null: not a target).
// Stunlock is the odd one out: its cast is pending in the engine itself
// (state.pendingStunlock, after the bishop's move), so it isn't listed here.
const TARGETED = {
  solarStrike: {
    status: '☀ Tap where to strike, then tap again to cast',
    areas: t => E.getSolarStrikeCenters(t.unitSq),
    squares: a => E.solarStrikeSquares(a.f, a.r),
    // Nearest valid center to the tap, like solarstrike.js.
    resolve: (t, sq) => {
      const { f: hf, r: hr } = E.sqToFR(sq);
      return E.getSolarStrikeCenters(t.unitSq).reduce((a, b) =>
        (Math.abs(a.f - hf) + Math.abs(a.r - hr) <= Math.abs(b.f - hf) + Math.abs(b.r - hr) ? a : b), null);
    },
    action: (t, a) => ({ type: 'castAbility', id: 'solarStrike', unitSq: t.unitSq, center: E.frToSq(a.f, a.r) }),
  },
  clubbing: {
    status: '🔨 Tap a quadrant to club, then tap again to cast',
    areas: t => E.getClubbingQuadrants(t.unitSq),
    squares: a => E.quadrantSquares(a.f, a.r),
    resolve: (t, sq) => E.getClubbingQuadrants(t.unitSq).find(({ f, r }) => E.quadrantSquares(f, r).includes(sq)) || null,
    action: (t, a) => ({ type: 'castAbility', id: 'clubbing', unitSq: t.unitSq, quadrant: E.frToSq(a.f, a.r) }),
  },
  silverBullet: single('🎯 Tap an enemy unit to strike, then tap again', t => E.getSilverBulletTargets(G.state, t.unitSq, t.color),
    (t, sq) => ({ type: 'castAbility', id: 'silverBullet', unitSq: t.unitSq, center: sq })),
  unstableFireball: single('🔥 Tap a target to fireball, then tap again', t => E.getFireballTargets(G.state, t.unitSq, t.color),
    (t, sq) => ({ type: 'castAbility', id: 'unstableFireball', unitSq: t.unitSq, center: sq })),
  unstableTeleport: single('✨ Tap a field to teleport to, then tap again', t => E.getTeleportTargets(G.state, t.color),
    (t, sq) => ({ type: 'castAbility', id: 'unstableTeleport', unitSq: t.unitSq, center: sq })),
  // Stays armed across several raises (castRaiseTheDead) until the turn ends.
  raiseTheDead: single('💀 Tap fields to raise Ghouls', t => E.getRaiseTheDeadTargets(G.state, t.color),
    (t, sq) => ({ type: 'castAbility', id: 'raiseTheDead', target: sq }), true),
};

function single(status, targets, action, keepOpen = false) {
  return {
    status,
    areas: t => targets(t).map(sq => ({ sq })),
    squares: a => [a.sq],
    resolve: (t, sq) => (targets(t).includes(sq) ? { sq } : null),
    action: (t, a) => action(t, a.sq),
    keepOpen,
  };
}

const STUNLOCK = {
  status: '⚡ Tap a quadrant to stun, then tap again',
  areas: () => E.getStunlockQuadrants(G.state.pendingStunlock.bishopSq),
  squares: a => E.quadrantSquares(a.f, a.r),
  // Of the quadrants holding the tap, the one closest to the bishop.
  resolve: (t, sq) => {
    const { f: bf, r: br } = E.sqToFR(G.state.pendingStunlock.bishopSq);
    const matching = E.getStunlockQuadrants(G.state.pendingStunlock.bishopSq).filter(({ f, r }) => E.quadrantSquares(f, r).includes(sq));
    if (!matching.length) return null;
    const dist = q => Math.abs((q.f + 0.5) - bf) + Math.abs((q.r + 0.5) - br);
    return matching.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
  },
  action: (t, a) => ({ type: 'castAbility', id: 'stunlock', center: E.frToSq(a.f, a.r) }),
};

const BOT_LINES = ['Good luck!', 'Interesting move…', 'Hmm, let me think.', 'Nice try.', 'Is that your best?', 'GG so far.'];
const AI_STEP_DELAY_MS = 450;
const AI_DRAFT_DELAY_MS = 700;

export const G = {
  state: E.createRoomState(),
  netMode: false,
  myColor: null,     // 'w' | 'b' | null (spectator, or hotseat = unrestricted)
  aiColor: null,     // the AI's color when playing it, else null
  replay: null,      // { frames, index } while stepping through a logged game
  gamesPlayed: 0,    // finished games, for unlocks (see Unlocks below)
  vsAi: false,
  colorChoice: 'w',  // the human's pick against the AI: 'w' | 'b' | 'random'
  rankedGame: false,
  lastRating: null,  // { rating, delta } for this player after a ranked game
  connection: null,  // 'online' | 'reconnecting' | 'disconnected' while netMode
  lobby: null,       // { title, status, link?, waiting } — the site's multiplayer modal
  flipped: false,
  selectedSquare: null,
  legalMoves: [],
  pendingPromotion: null, // { move, color }
  targeting: null,   // { id, color, unitSq } while picking a TARGETED ability's target
  preview: null,     // the area a first tap picked; tapping it again casts
  flash: null,       // a rejection or hint, shown in place of the status for a moment
  chat: [],          // [{ color, text }]
  vanguardPlan: [],  // [{ from, to }]
  vanguardSelected: null,
  vanguardSeenAt: null,
  undoStack: [],
  clockOffset: 0,
};

// ─── Change notification ─────────────────────────────────────────────────────
let version = 0;
const listeners = new Set();

export function useGame() {
  useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => version);
  return G;
}

// The site's renderAll: re-derive what follows from the new state, then
// let the screens re-render.
export function changed() {
  const s = G.state;
  if (s.phase === 'playing' && s.game) {
    if (G.targeting && G.targeting.id === 'raiseTheDead' && G.targeting.color !== s.game.turn()) G.targeting = null;
    if (G.targeting && s.gameOver) G.targeting = null;
    // Swift: a shot left a follow-up step pending — select that Archer.
    if (s.pendingSwiftMove && s.pendingSwiftMove.color === currentActor() && isMyTurn()) G.selectedSquare = s.pendingSwiftMove.archerSq;
    if (s.pendingShield) { G.selectedSquare = null; G.legalMoves = []; }
    if (G.selectedSquare) G.legalMoves = computeLegalMovesFor(G.selectedSquare);
    syncVanguard();
  } else {
    G.targeting = null;
  }
  if (!activeTargeting()) G.preview = null;
  watchLocalClock();
  scheduleAi();
  logLocalGame();
  noteGameEnd();
  version++;
  listeners.forEach(l => l());
}

// ─── Game log ────────────────────────────────────────────────────────────────
// Local games (vs the AI, hotseat) go into the game history from here, the
// state after every change as replay frames; the server records online ones.
// Same as the site's logLocalGame (app.js).
let localLog = { frames: [], startedAt: null, recorded: false };

function logLocalGame() {
  const s = G.state;
  if (G.netMode) return;
  if (s.phase !== 'playing' || !s.game) { localLog = { frames: [], startedAt: null, recorded: false }; return; }
  if (!localLog.frames.length) localLog.startedAt = new Date().toISOString();
  const snapshot = JSON.stringify(E.serializeState(s));
  if (localLog.frames[localLog.frames.length - 1] !== snapshot) localLog.frames.push(snapshot);
  // ponytail: one record per game — an undo past the end isn't logged again.
  if (!s.gameOver || localLog.recorded) return;
  localLog.recorded = true;
  const result = E.gameResult(s.gameOverText);
  if (!result) return;
  recordLocalGame({
    mode: G.aiColor ? 'ai' : 'local',
    human: G.aiColor ? (G.aiColor === 'w' ? 'b' : 'w') : null,
    result,
    result_text: s.gameOverText,
    white_augments: s.augments.w,
    black_augments: s.augments.b,
    minutes: s.settings.minutes,
    points: s.settings.points,
    moves: s.moveLog.length,
    frames: localLog.frames.map(f => JSON.parse(f)),
    started_at: localLog.startedAt,
  }).then(({ error }) => { if (error) console.warn('Game log: recording failed', error); });
}

// ─── Unlocks ─────────────────────────────────────────────────────────────────
// New players draft from a starter set of augments until they've finished
// E.UNLOCK_GAMES games (starterAugments, engine/draft-engine.js). Signed in,
// the count is the account's logged games; a guest's is kept on this phone.
// Same as the site's UNLOCKS section (app.js).
const GAMES_KEY = 'augchess:gamesPlayed';
const DEVICE_KEY = 'augchess:deviceId';
let gameEndNoted = false;

function readStorage(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
}

// A guest's starter set is tied to this phone rather than rerolled each launch.
function deviceId() {
  let id = readStorage(DEVICE_KEY);
  if (!id) { id = Math.random().toString(36).slice(2); writeStorage(DEVICE_KEY, id); }
  return id;
}

function refreshGamesPlayed() {
  if (!currentSession()) { G.gamesPlayed = Number(readStorage(GAMES_KEY)) || 0; changed(); return; }
  myGamesCount().then(({ data }) => {
    if (typeof data === 'number' && data !== G.gamesPlayed) { G.gamesPlayed = data; changed(); }
  });
}
let lastUserId;
onAuthChange(() => {
  const session = currentSession();
  const id = session ? session.user.id : null;
  if (id !== lastUserId) { lastUserId = id; refreshGamesPlayed(); }
});

// The augment ids this player may draft, or null once everything's unlocked.
// Guests playing on this phone (Start New Game, Play vs AI) are never capped.
export function starterSet() {
  const session = currentSession();
  if (G.gamesPlayed >= E.UNLOCK_GAMES || (!session && !G.netMode)) return null;
  return new Set(E.starterAugments(session ? session.user.id : deviceId()));
}

// A game this player took part in just ended: count it.
function noteGameEnd() {
  const s = G.state;
  const over = s.phase === 'playing' && s.gameOver && !G.replay && (!G.netMode || !!G.myColor);
  if (!over) { gameEndNoted = false; return; }
  if (gameEndNoted) return;
  gameEndNoted = true;
  if (!currentSession()) writeStorage(GAMES_KEY, String(G.gamesPlayed + 1));
  setTimeout(refreshGamesPlayed, 3000); // signed in: once the game is logged
}

let flashTimer = null;
export function flashStatus(text) {
  G.flash = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { G.flash = null; changed(); }, 1800);
  changed();
}

// ─── Dispatch ────────────────────────────────────────────────────────────────
// Who is "acting" for actions that need a color but aren't a per-seat
// network message locally (settings/newGame don't check color at all).
export function currentActor() {
  const s = G.state;
  if (s.pendingStunlock) return s.pendingStunlock.color;
  if (s.pendingShield) return s.pendingShield.color;
  if (s.phase === 'playing' && s.vanguard) return s.vanguard.color;
  if (s.phase === 'draft' && s.draftState) return s.draftState.current;
  if (s.phase === 'playing' && s.game) return s.game.turn();
  return 'w';
}

// Returns the engine's rejection reason locally (null on success).
export function dispatch(action, color = currentActor()) {
  if (G.netMode) { Net.send(action); return null; }
  pushUndoSnapshot(color);
  const wasOver = G.state.gameOver;
  const err = E.applyAction(G.state, color, action);
  if (err) {
    G.undoStack.pop();
    if (color !== G.aiColor) flashStatus(err);
    else if (G.state.gameOver !== wasOver) changed();
    return err;
  }
  changed();
  return null;
}

export function isMyTurn() {
  if (!G.netMode && !G.aiColor) return true;
  const s = G.state;
  if (!s.game || !G.myColor) return false;
  const pending = s.pendingStunlock || s.pendingShield;
  return (pending ? pending.color : s.game.turn()) === G.myColor;
}

// Whether this phone may act for `color`: anyone in hotseat, else only its seat.
export function canActFor(color) {
  return (!G.netMode && !G.aiColor) || G.myColor === color;
}

// ─── Undo (hotseat and vs-AI only) ───────────────────────────────────────────
function pushUndoSnapshot(actor) {
  if (G.netMode) return;
  const clone = JSON.parse(JSON.stringify(G.state, (k, v) => (k === 'game' ? undefined : v)));
  clone.gameFen = G.state.game ? G.state.game.fen() : null;
  clone.undoActor = actor;
  G.undoStack.push(clone);
}

export function undoMove() {
  if (G.netMode || !G.undoStack.length) return;
  let snap = G.undoStack.pop();
  // Against the AI, undo takes back its reply too.
  if (G.aiColor) {
    stopAi();
    while (snap.undoActor === G.aiColor && G.undoStack.length) snap = G.undoStack.pop();
  }
  delete snap.undoActor;
  const fen = snap.gameFen;
  delete snap.gameFen;
  G.state = snap;
  if (fen) { G.state.game = new E.Chess(); G.state.game.load(fen); }
  if (G.state.clock && G.state.clock.running) G.state.clock.since = Date.now();
  clearSelection();
  changed();
}

// ─── Starting and leaving games ──────────────────────────────────────────────
function resetLocal() {
  leaveOnlineGame();
  stopAi();
  G.state = E.createRoomState();
  G.undoStack = [];
  G.flipped = false;
  G.chat = [];
  G.lastRating = null;
  clearSelection();
}

// Home "Start New Game": two players at one phone.
export function startHotseat() {
  resetLocal();
  G.vsAi = false;
  G.aiColor = null;
  G.myColor = null;
  changed();
}

// Home "Play vs AI".
export function startVsAi() {
  resetLocal();
  G.vsAi = true;
  G.aiColor = null;
  G.myColor = null;
  changed();
}

export function setColorChoice(c) { G.colorChoice = c; changed(); }

// Settings "Start Draft". Against the AI this is where the seats get fixed.
export function startDraft() {
  if (G.vsAi) {
    const human = G.colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : G.colorChoice;
    G.myColor = human;
    G.aiColor = human === 'w' ? 'b' : 'w';
    G.flipped = human === 'b';
  }
  dispatch({ type: 'settingsStart' });
}

// "New Game" from the game screen: back to settings (the same seats).
export function newGame() {
  dispatch({ type: 'newGame' }); // harmless no-op if already mid-settings/draft
  clearSelection();
  changed();
}

export function leaveOnlineGame() {
  cancelSearch();
  if (!G.netMode) return;
  G.replay = null;
  Net.disconnect();
  G.netMode = false;
  G.myColor = null;
  G.rankedGame = false;
  G.connection = null;
  G.state = E.createRoomState();
}

// Leaving the game screen.
export function leaveGame() {
  stopAi();
  leaveOnlineGame();
  G.lobby = null;
  changed();
}

let netStateCount = 0;
function goOnline(gameId, lobby) {
  resetLocal();
  G.vsAi = false;
  G.aiColor = null;
  G.netMode = true;
  G.connection = 'disconnected';
  G.lobby = lobby;
  netStateCount = 0;
  Net.connect(gameId);
  changed();
}

Net.net.on('open', () => { G.connection = 'online'; changed(); });
Net.net.on('close', () => { if (G.netMode) { G.connection = 'disconnected'; changed(); } });
Net.net.on('reconnecting', () => { G.connection = 'reconnecting'; changed(); });
Net.net.on('joined', (color, ranked) => {
  G.myColor = color;
  G.rankedGame = ranked;
  if (color === 'b') G.flipped = true;
  if (ranked && !color && !currentSession()) G.lobby = { title: 'Ranked game', status: 'Sign in to play ranked games. You are watching as a spectator.' };
  changed();
});
Net.net.on('state', (incoming, serverNow) => {
  G.clockOffset = typeof serverNow === 'number' ? serverNow - Date.now() : 0;
  if (incoming.game) {
    const live = new E.Chess();
    live.load(incoming.game.fen);
    incoming.game = live;
  }
  G.state = incoming;
  G.myColor = Net.net.myColor;
  // The host's first state is their own join echo; a second one means the
  // opponent arrived — time to drop the "share this link" sheet.
  netStateCount++;
  if (G.lobby && G.lobby.link && netStateCount > 1) G.lobby = null;
  if (G.lobby && G.lobby.joining) G.lobby = null;
  changed();
});
Net.net.on('rejected', reason => flashStatus(reason));
Net.net.on('rating', result => { G.lastRating = result[G.myColor] || null; changed(); });
Net.net.on('chat', msg => {
  G.chat = msg.type === 'chatHistory' ? msg.messages.slice() : [...G.chat, { color: msg.color, text: msg.text }];
  changed();
});

// ─── Replay ──────────────────────────────────────────────────────────────────
// Stepping through a logged game from the History screen (the site's
// startReplay in app.js): each frame is a saved state, shown read-only like
// an online spectator's (netMode on, no seat, no server).
export function startReplay(frames) {
  stopAi();
  leaveOnlineGame();
  resetLocal();
  G.vsAi = false;
  G.aiColor = null;
  G.myColor = null;
  G.netMode = true;
  G.replay = { frames, index: 0 };
  replayStep(0);
}

export function replayStep(i) {
  const r = G.replay;
  r.index = Math.max(0, Math.min(r.frames.length - 1, i));
  const frame = JSON.parse(JSON.stringify(r.frames[r.index]));
  const live = new E.Chess();
  live.load(frame.game.fen);
  frame.game = live;
  if (frame.clock) frame.clock.running = null; // frozen at that moment
  G.state = frame;
  clearSelection();
  changed();
}

// Home "Create Game Link": a fresh room; the link is shown until someone joins.
export async function createGameLink(buildLink) {
  G.lobby = { title: 'Create Game Link', status: 'Creating your game…', waiting: true };
  changed();
  try {
    const gameId = await Net.createRoom();
    goOnline(gameId, { title: 'Share this link', status: 'Send this to your friend. You will play as White.', link: buildLink(gameId), gameId });
  } catch (e) {
    G.lobby = { title: 'Create Game Link', status: 'Could not reach the server — is it running?' };
    changed();
  }
}

// A game id from a link or typed in.
export function joinGame(gameId) {
  goOnline(gameId, { title: 'Joining game', status: 'Connecting…', waiting: true, joining: true });
}

// Home "Play Online" / "Play Ranked": wait in the server's queue, then join.
let cancelQueue = null;
let searchTimer = null;
export function findMatch(ranked) {
  resetLocal();
  const title = ranked ? 'Play Ranked' : 'Play Online';
  G.lobby = { title, status: 'Searching for an opponent…', waiting: true, searching: true };
  changed();
  cancelQueue = Net.joinQueue(ranked, {
    onQueued(msg) {
      const since = Date.now();
      const tick = () => {
        const s = Math.floor((Date.now() - since) / 1000);
        if (!G.lobby || !G.lobby.searching) return;
        G.lobby = { ...G.lobby, status: `Searching for an opponent… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` + (msg.rating ? ` · Your rating ${msg.rating}` : '') };
        changed();
      };
      tick();
      searchTimer = setInterval(tick, 1000);
    },
    onMatched(gameId) { cancelSearch(); joinGame(gameId); },
    onError(reason) { cancelSearch(); G.lobby = { title, status: reason }; changed(); },
  });
}

export function cancelSearch() {
  clearInterval(searchTimer);
  searchTimer = null;
  const cancel = cancelQueue;
  cancelQueue = null;
  if (cancel) cancel();
}

export function closeLobby() {
  cancelSearch();
  G.lobby = null;
  changed();
}

// ─── Selection and moves ─────────────────────────────────────────────────────
function computeLegalMovesFor(sq) {
  const s = G.state;
  if (s.specialSelect && s.specialSelect.square === sq) return E.generateExitMoves(s, sq);
  return E.generateMoves(s, sq);
}

function clearSelection() {
  G.selectedSquare = null;
  G.legalMoves = [];
  G.targeting = null;
  G.preview = null;
  if (G.state.specialSelect) G.state.specialSelect = null;
}

function isOwnMovable(sq) {
  const s = G.state;
  const turn = s.game.turn();
  const piece = E.pieceAt(s, sq);
  return (piece && piece.color === turn) || s.mannedTowers[sq] === turn || s.mounted[turn] === sq;
}

function selectSquare(sq) {
  if (!isOwnMovable(sq)) return;
  G.state.specialSelect = null;
  G.selectedSquare = sq;
  G.legalMoves = E.generateMoves(G.state, sq);
}

function deselect() {
  G.selectedSquare = null;
  G.legalMoves = [];
  G.state.specialSelect = null;
}

// A Ghoul that auto-charged via Breaking Rank can't move again this turn.
function isGhoulLocked(sq) {
  const s = G.state;
  const turn = s.game.turn();
  const piece = E.pieceAt(s, sq);
  return !!piece && piece.color === turn && s.ghoulBrokeRank[turn].includes(sq);
}

// The selected square is the player's own manned tower or mounted King:
// its occupant can step out (towerLeave/dismount) instead of the unit moving.
export function exitOption() {
  const s = G.state;
  const sq = G.selectedSquare;
  if (!sq || s.phase !== 'playing' || !s.game || s.gameOver || !isMyTurn()) return null;
  const turn = s.game.turn();
  if (s.mannedTowers[sq] === turn) return { sq, label: s.mannedTowerOrigin[sq] === 'b' ? 'Longbowman out' : 'Leave tower', armed: !!(s.specialSelect && s.specialSelect.square === sq) };
  if (s.mounted[turn] === sq) return { sq, label: 'Dismount', armed: !!(s.specialSelect && s.specialSelect.square === sq) };
  return null;
}

export function toggleExit() {
  const opt = exitOption();
  if (!opt) return;
  const s = G.state;
  if (opt.armed) {
    s.specialSelect = null;
    G.legalMoves = E.generateMoves(s, opt.sq);
  } else {
    s.specialSelect = { type: s.mannedTowers[opt.sq] ? 'tower' : 'mount', square: opt.sq };
    G.legalMoves = E.generateExitMoves(s, opt.sq);
  }
  changed();
}

function attemptMove(to) {
  const move = G.legalMoves.find(m => m.to === to);
  if (!move) return;
  const piece = E.pieceAt(G.state, move.from);
  const reachesPromo = piece && piece.type === 'p' &&
    ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));
  if ((move.standard && reachesPromo) || move.needsPromo) {
    if (getPref('autoQueen')) { submitMove(move, 'q'); return; }
    G.pendingPromotion = { move, color: piece.color };
    changed();
    return;
  }
  submitMove(move);
}

function submitMove(move, promotion) {
  // towerLeave/dismount share their origin square with another move set —
  // `exit` tells the engine which one was meant.
  const exit = move.special === 'towerLeave' || move.special === 'dismount';
  G.selectedSquare = null;
  G.legalMoves = [];
  dispatch({ type: 'move', from: move.from, to: move.to, promotion, exit });
  if (G.netMode) changed();
}

export function choosePromotion(piece) {
  const { move } = G.pendingPromotion;
  G.pendingPromotion = null;
  submitMove(move, piece);
}

export function cancelPromotion() {
  G.pendingPromotion = null;
  changed();
}

// ─── Targeting ───────────────────────────────────────────────────────────────
// The targeting mode a tap goes to right now, with its spec and context.
export function activeTargeting() {
  const s = G.state;
  if (s.phase !== 'playing' || !s.game || s.gameOver) return null;
  if (s.pendingStunlock && s.pendingStunlock.color === currentActor() && isMyTurn()) {
    return { spec: STUNLOCK, t: { id: 'stunlock', color: s.pendingStunlock.color } };
  }
  if (G.targeting) return { spec: TARGETED[G.targeting.id], t: G.targeting };
  return null;
}

function beginTargeting(id, unitSq, color) {
  G.targeting = { id, unitSq, color };
  G.preview = null;
}

function tapTarget(active, sq) {
  const area = active.spec.resolve(active.t, sq);
  if (!area) return;
  const same = G.preview && JSON.stringify(G.preview) === JSON.stringify(area);
  if (!same) { G.preview = area; changed(); return; }
  G.preview = null;
  if (!active.spec.keepOpen) G.targeting = null;
  dispatch(active.spec.action(active.t, area));
  if (G.netMode) changed();
}

// Squares to tint for the active targeting: every square it can reach, and
// the area a first tap picked.
export function targetingOverlay() {
  const active = activeTargeting();
  if (!active) return null;
  const targetable = new Set();
  for (const a of active.spec.areas(active.t)) active.spec.squares(a).forEach(sq => targetable.add(sq));
  const preview = new Set(G.preview ? active.spec.squares(G.preview) : []);
  return { id: active.t.id, targetable, preview };
}

// ─── Abilities ───────────────────────────────────────────────────────────────
// The color whose ability row this phone shows: its own seat, or the side
// acting in hotseat.
export function abilityColor() {
  if (G.netMode || G.aiColor) return G.myColor;
  return G.state.game ? currentActor() : null;
}

export function abilitySlots() {
  const s = G.state;
  const color = abilityColor();
  if (s.phase !== 'playing' || !s.game || s.gameOver || !color) return { color, unit: [], global: [] };
  const piece = G.selectedSquare ? E.pieceAt(s, G.selectedSquare) : null;
  const unit = piece && piece.color === color ? E.unitAbilitiesFor(s, G.selectedSquare) : [];
  return { color, unit, global: E.globalAbilitiesFor(s, color) };
}

export function isAbilityArmed(ability, key) {
  const s = G.state;
  if (ability.id === 'stunlock') return !!(s.armedAbility && s.armedAbility.key === key && s.armedAbility.unitSq === G.selectedSquare);
  return !!(G.targeting && G.targeting.id === ability.id && G.targeting.unitSq === G.selectedSquare);
}

// A tap on unit slot Q/W/E/R (tied to the selected unit): arm Stunlock,
// start/stop targeting, or cast straight away (the King's auras).
export function tapUnitAbility(key) {
  const s = G.state;
  const color = abilityColor();
  if (s.gameOver || !G.selectedSquare || !color) return;
  const piece = E.pieceAt(s, G.selectedSquare);
  if (!piece || piece.color !== color || !canActFor(color)) return;
  const ability = E.unitAbilitiesFor(s, G.selectedSquare)[UNIT_KEYS.indexOf(key)];
  if (!ability || ability.passive) return;

  if (ability.id === 'kingsLightning' || ability.id === 'ringOfFire') {
    if (color !== s.game.turn()) return;
    dispatch({ type: 'castAbility', id: ability.id, unitSq: G.selectedSquare });
    return;
  }
  if (TARGETED[ability.id]) {
    if (G.targeting && G.targeting.id === ability.id && G.targeting.unitSq === G.selectedSquare) {
      if (ability.id === 'raiseTheDead' && s.pendingRaiseTheDead) return; // mid-session: end it instead
      G.targeting = null;
    } else {
      beginTargeting(ability.id, G.selectedSquare, color);
    }
    changed();
    return;
  }
  dispatch({ type: 'armAbility', key, unitSq: G.selectedSquare });
}

// A tap on global slot A/S/D/F: casts directly (passives ignore it).
export function tapGlobalAbility(key) {
  const s = G.state;
  const color = abilityColor();
  if (!s.game || s.gameOver || !color || !canActFor(color) || color !== s.game.turn()) return;
  const ability = E.globalAbilitiesFor(s, color)[GLOBAL_KEYS.indexOf(key)];
  if (!ability || ability.passive) return;
  dispatch({ type: 'castAbility', id: ability.id });
}

// What the cancel button would undo right now (the site's Esc), or null.
export function cancelOption() {
  const s = G.state;
  if (s.phase !== 'playing' || !s.game || s.gameOver || !isMyTurn()) return null;
  if (s.pendingStunlock && s.pendingStunlock.color === currentActor()) return 'Skip Stunlock';
  if (s.pendingSwiftMove) return 'End turn';
  if (G.targeting && G.targeting.id === 'raiseTheDead') return s.pendingRaiseTheDead ? 'End turn' : 'Cancel';
  if (G.targeting) return 'Cancel';
  if (s.armedAbility) return 'Disarm';
  return null;
}

export function cancelAction() {
  const s = G.state;
  if (s.pendingStunlock || s.pendingSwiftMove) { dispatch({ type: 'cancelAbility' }); return; }
  if (G.targeting) {
    // Ending a Raise the Dead turn keeps whatever was raised.
    if (G.targeting.id === 'raiseTheDead' && s.pendingRaiseTheDead) { dispatch({ type: 'endRaiseTheDead' }); return; }
    G.targeting = null;
    changed();
    return;
  }
  if (s.armedAbility) dispatch({ type: 'cancelAbility' });
}

// ─── Bishops' Shields ────────────────────────────────────────────────────────
export function isChoosingShield() {
  const s = G.state;
  return !!(s.pendingShield && !s.pendingStunlock && !s.gameOver && isMyTurn());
}

export function keepShield() {
  if (isChoosingShield()) dispatch({ type: 'orientShield', dir: E.shieldDirAt(G.state, G.state.pendingShield.sq) });
}

// ─── Vanguard deployment ─────────────────────────────────────────────────────
// The owner plans which units go onto their gold squares, then sends the whole
// plan as one vanguardDeploy. The 30s limit counts from when this phone first
// saw it; the server resolves it itself if this phone is gone.
let vanguardKey = null;
let vanguardTicker = null;

export function vanguardPending() {
  const s = G.state;
  return s.phase === 'playing' && !!s.game && !!s.vanguard;
}

export function vanguardMine() {
  return vanguardPending() && ((!G.netMode && !G.aiColor) || G.myColor === G.state.vanguard.color);
}

export function vanguardZone() {
  return vanguardPending() ? E.VANGUARD_ZONES[G.state.vanguard.color] : [];
}

export function vanguardRemainingMs() {
  if (!vanguardPending() || G.vanguardSeenAt === null) return 0;
  return Math.max(0, G.state.vanguard.ms - (Date.now() - G.vanguardSeenAt));
}

function syncVanguard() {
  if (!vanguardPending()) {
    clearInterval(vanguardTicker); vanguardTicker = null;
    G.vanguardPlan = []; G.vanguardSelected = null; G.vanguardSeenAt = null; vanguardKey = null;
    return;
  }
  const key = G.state.vanguard.color + ':' + G.state.moveLog.length;
  if (vanguardKey !== key) { vanguardKey = key; G.vanguardSeenAt = Date.now(); G.vanguardPlan = []; G.vanguardSelected = null; }
  if (!vanguardTicker) {
    vanguardTicker = setInterval(() => {
      if (!vanguardPending()) return;
      if (vanguardRemainingMs() <= 0 && vanguardMine()) deployVanguard();
      else changed();
    }, 500);
  }
}

function vanguardTap(sq) {
  const s = G.state;
  const plannedTo = G.vanguardPlan.find(p => p.to === sq);
  const own = E.pieceAt(s, sq);
  const free = vanguardZone().includes(sq) && E.isEmpty(s, sq) && !plannedTo;
  if (plannedTo) {
    G.vanguardPlan = G.vanguardPlan.filter(p => p.to !== sq);
    G.vanguardSelected = null;
  } else if (own && own.color === s.vanguard.color) {
    G.vanguardSelected = sq;
  } else if (G.vanguardSelected && free) {
    const from = G.vanguardSelected;
    G.vanguardPlan = [...G.vanguardPlan.filter(p => p.from !== from && p.to !== sq), { from, to: sq }];
    G.vanguardSelected = null;
  } else {
    G.vanguardSelected = null;
  }
  changed();
}

export function deployVanguard() {
  if (!vanguardMine()) return;
  const placements = G.vanguardPlan.slice();
  G.vanguardPlan = [];
  G.vanguardSelected = null;
  dispatch({ type: 'vanguardDeploy', placements });
}

export function clearVanguardPlan() {
  G.vanguardPlan = [];
  G.vanguardSelected = null;
  changed();
}

// ─── The one tap handler for the board ───────────────────────────────────────
let lastTap = { sq: null, at: 0 };

export function tapSquare(sq) {
  const s = G.state;
  if (s.phase !== 'playing' || !s.game) return;
  if (vanguardPending()) { if (vanguardMine()) vanguardTap(sq); return; }
  if (s.gameOver || !isMyTurn()) return;

  const active = activeTargeting();
  if (active) { tapTarget(active, sq); return; }
  if (s.pendingStunlock) return; // the opponent's cast

  if (s.pendingShield) {
    if (!isChoosingShield()) return;
    const choice = E.shieldChoiceSquares(s.pendingShield.sq).find(c => c.sq === sq);
    const dir = sq === s.pendingShield.sq ? E.shieldDirAt(s, sq) : choice && choice.dir;
    if (dir) dispatch({ type: 'orientShield', dir });
    return;
  }
  if (s.pendingRaiseTheDead) return;

  // Double-tap your own manned tower or mounted King: step its occupant out.
  const now = Date.now();
  const doubleTap = lastTap.sq === sq && now - lastTap.at < 400;
  lastTap = { sq, at: now };
  if (doubleTap && G.selectedSquare === sq && exitOption() && !exitOption().armed) { toggleExit(); return; }

  if (G.selectedSquare) {
    if (G.legalMoves.some(m => m.to === sq) && sq !== G.selectedSquare) { attemptMove(sq); return; }
    if (isGhoulLocked(sq)) { deselect(); flashStatus("This Ghoul already broke rank — it can't move again this turn"); return; }
    if (sq !== G.selectedSquare && isOwnMovable(sq)) selectSquare(sq);
    else deselect();
    changed();
    return;
  }
  if (isGhoulLocked(sq)) { flashStatus("This Ghoul already broke rank — it can't move again this turn"); return; }
  selectSquare(sq);
  changed();
}

// ─── Forfeit and draws ───────────────────────────────────────────────────────
// Hotseat has no seat of its own: the side to move is the one forfeiting.
export function myPlayColor() {
  return G.myColor || (G.netMode ? null : G.state.game && G.state.game.turn());
}

export function canForfeit() {
  const s = G.state;
  return s.phase === 'playing' && !!s.game && !s.gameOver && !!myPlayColor();
}

export function forfeit() { dispatch({ type: 'resign' }, myPlayColor()); }

// Draws are only between two people online.
export function drawState() {
  if (!canForfeit() || !G.netMode) return null;
  const offer = G.state.drawOffer;
  if (!offer) return 'none';
  return offer === G.myColor ? 'offered' : 'received';
}

export function offerDraw() { dispatch({ type: 'offerDraw' }, G.myColor); }
export function answerDraw(accept) { dispatch({ type: 'answerDraw', accept }, G.myColor); }

// ─── Chat ────────────────────────────────────────────────────────────────────
export function canChat() {
  return (G.netMode && !!G.myColor) || (!G.netMode && !!G.aiColor);
}

export function sendChat(text) {
  text = text.trim();
  if (!text || !canChat()) return false;
  if (G.netMode) { Net.send({ type: 'chat', text }); return true; }
  G.chat = [...G.chat, { color: G.myColor, text }];
  const bot = G.aiColor;
  setTimeout(() => {
    if (G.aiColor !== bot) return;
    G.chat = [...G.chat, { color: bot, text: BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)] }];
    changed();
  }, 800);
  changed();
  return true;
}

// ─── Clock ───────────────────────────────────────────────────────────────────
// The server ends online games on time; locally the engine does, but only
// when something calls it — so while a local clock runs, check the flag.
let localClockTimer = null;
function watchLocalClock() {
  const s = G.state;
  const running = !G.netMode && s.phase === 'playing' && s.clock && s.clock.running && !s.gameOver;
  if (running && !localClockTimer) {
    localClockTimer = setInterval(() => {
      const st = G.state;
      if (!st.clock || !st.clock.running || st.gameOver) return;
      if (E.clockRemaining(st, st.clock.running, Date.now()) <= 0 && E.tickClock(st, Date.now())) changed();
    }, 250);
  } else if (!running && localClockTimer) {
    clearInterval(localClockTimer);
    localClockTimer = null;
  }
}

export function clockMs(color) {
  const s = G.state;
  const clock = s.phase === 'playing' ? s.clock : null;
  if (!clock) return s.settings.minutes * 60 * 1000;
  return E.clockRemaining(s, color, Date.now() + (G.netMode ? G.clockOffset : 0));
}

export function formatTime(ms) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ─── AI ──────────────────────────────────────────────────────────────────────
let aiTimer = null;
let aiQueue = [];
let aiRefusals = 0;

export function aiThinking() {
  return !!G.aiColor && !G.netMode && E.botActor(G.state) === G.aiColor;
}

function scheduleAi() {
  if (!aiThinking()) { aiQueue = []; return; }
  if (aiTimer) return;
  aiTimer = setTimeout(aiStep, G.state.phase === 'draft' ? AI_DRAFT_DELAY_MS : AI_STEP_DELAY_MS);
}

function aiStep() {
  aiTimer = null;
  if (!aiThinking()) { aiQueue = []; return; }
  if (!aiQueue.length) aiQueue = E.chooseBotActions(G.state, G.aiColor);
  const action = aiQueue.shift();
  if (!action) return;
  const err = dispatch(action, G.aiColor);
  if (err) {
    // The plan went stale (a die rolled differently than simulated): think
    // again, but don't spin forever on an action it keeps getting wrong.
    aiQueue = [];
    if (++aiRefusals > 3) { console.warn('AI gave up on its turn:', err); return; }
    scheduleAi();
    return;
  }
  aiRefusals = 0;
}

function stopAi() {
  clearTimeout(aiTimer);
  aiTimer = null;
  aiQueue = [];
}

// ─── Status line ─────────────────────────────────────────────────────────────
// { text, tone } — tone: 'over' | 'draw' | 'check' | 'shield' | null.
export function statusLine() {
  const s = G.state;
  if (G.flash) return { text: G.flash, tone: null };
  if (s.gameOver) {
    let text = s.gameOverText;
    if (G.lastRating) {
      const sign = G.lastRating.delta >= 0 ? '+' : '−';
      text += ` · Rating ${G.lastRating.rating} (${sign}${Math.abs(G.lastRating.delta)})`;
    }
    return { text, tone: s.gameOverText.includes('Draw') ? 'draw' : 'over' };
  }
  if (!s.game) return { text: '', tone: null };
  if (s.vanguard) return { text: `${s.vanguard.color === 'w' ? 'White' : 'Black'} is deploying their Vanguard`, tone: null };
  if (aiThinking()) return { text: `🤖 The AI (${G.aiColor === 'w' ? 'White' : 'Black'}) is thinking…`, tone: null };
  const active = activeTargeting();
  if (active) {
    if (active.t.id === 'raiseTheDead' && s.pendingRaiseTheDead) return { text: '💀 Raise more Ghouls, or end your turn', tone: null };
    return { text: G.preview ? 'Tap the highlighted area again to cast' : active.spec.status, tone: null };
  }
  if (s.pendingShield && !s.pendingStunlock) {
    return {
      text: isChoosingShield() ? '🛡 Turn your shield: tap a square next to the bishop' : `🛡 ${s.pendingShield.color === 'w' ? 'White' : 'Black'} is turning a bishop's shield`,
      tone: 'shield',
    };
  }
  if (s.pendingSwiftMove) return { text: '🏹 Swift: move the Archer, or end the turn', tone: null };
  const side = s.game.turn();
  const name = side === 'w' ? 'White' : 'Black';
  const attacked = E.isKingAttacked(s, side);
  if (E.kingThreatenedAfterPly(s, side)) {
    return { text: attacked ? `⚠ ${name} is in check!` : `⚠ The Solar Strike will expose ${name}'s King!`, tone: 'check' };
  }
  if (attacked) return { text: `${name} to move — the checking unit burns at the end of this turn`, tone: null };
  if (s.drawOffer && G.netMode) return { text: `${s.drawOffer === 'w' ? 'White' : 'Black'} offers a draw · ${name} to move`, tone: null };
  return { text: `${name} to move`, tone: null };
}

// ─── Move list and captures ──────────────────────────────────────────────────
// One group per turn, with everything that turn set off nested under it.
export function moveGroups() {
  const groups = [];
  for (const entry of G.state.moveLog || []) {
    const isEvent = entry.kind === 'event';
    if (!isEvent || !groups.length) groups.push({ turn: isEvent ? null : entry, events: [] });
    if (isEvent) groups[groups.length - 1].events.push(entry);
  }
  let plies = 0;
  return groups.map(g => {
    const num = g.turn && g.turn.color === 'w' ? `${Math.floor(plies / 2) + 1}.` : '';
    if (g.turn) plies++;
    return { ...g, num };
  });
}

// Piece glyphs each side has taken.
export function captured() {
  const s = G.state;
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
  const counts = { w: {}, b: {} };
  ['w', 'b'].forEach(c => { for (const t in start) counts[c][t] = 0; });
  const board = s.game.board();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const cell = board[r][f];
    if (cell) counts[cell.color][cell.type]++;
  }
  for (const sq in s.mannedTowers) counts[s.mannedTowers[sq]][s.mannedTowerOrigin[sq] === 'b' ? 'b' : 'p']++;
  const out = { w: [], b: [] }; // out.w: what White took
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    for (const [taker, victim] of [['w', 'b'], ['b', 'w']]) {
      const startCount = t === 'p' ? 8 * E.startingPawnRanks(s, victim).length : start[t];
      for (let i = counts[victim][t]; i < startCount; i++) out[taker].push(t);
    }
  }
  return out;
}

export { E };
