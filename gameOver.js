/**
 * gameOver.js — Game-over evaluation: checkmate, stalemate, king capture.
 * Includes a fully self-contained brute-force mate search for when a king is
 * mounted (chess.js check detection is unreliable in that case).
 * Depends on: game, mounted, stunnedSquares, mannedTowers, augments (has()),
 *             pieceAt(), frToSq(), sqToFR(), isKingAttacked(),
 *             captureState(), restoreState() — all defined in app.js.
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  GAME OVER EVALUATION
// ═══════════════════════════════════════════════════════════════════════════════
function evaluateGameOver() {
  const wK = mounted.w || findKingSquare('w');
  const bK = mounted.b || findKingSquare('b');

  if (!wK) { gameOver = true; gameOverText = '♛ Black wins — King captured!'; return; }
  if (!bK) { gameOver = true; gameOverText = '♛ White wins — King captured!'; return; }

  // chess.js's in_checkmate / in_stalemate have no concept of stunned squares.
  // If any squares are currently stunned the fast-path would incorrectly treat
  // those frozen pieces as available defenders, so we must fall through to the
  // brute-force search that skips them.  The same applies when a king is mounted.
  const hasActiveStun = Object.keys(stunnedSquares).some(sq => stunnedSquares[sq] > 0);

  if (!mounted.w && !mounted.b && !hasActiveStun) {
    if (game.in_checkmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      gameOver = true; gameOverText = `♛ ${winner} wins by checkmate!`;
      return;
    }
    if (game.in_stalemate()) { gameOver = true; gameOverText = 'Draw — Stalemate'; return; }
    if (game.insufficient_material()) { gameOver = true; gameOverText = 'Draw — Insufficient Material'; return; }
    gameOver = false; gameOverText = ''; return;
  }

  // A king is mounted OR squares are stunned — use our own brute-force search
  // instead of chess.js, which is unaware of both of those conditions.
  let sideToMove, inCheck, canMove;
  try {
    sideToMove = game.turn();
    inCheck = isKingAttacked(sideToMove);
    canMove = sideToMoveHasSafeMove(sideToMove);
  } catch (err) {
    console.error('evaluateGameOver (mounted/stunned) failed:', err);
    gameOver = false; gameOverText = ''; return;
  }
  if (!canMove) {
    if (inCheck) {
      const winner = sideToMove === 'w' ? 'Black' : 'White';
      gameOver = true; gameOverText = `♛ ${winner} wins by checkmate!`;
    } else {
      gameOver = true; gameOverText = 'Draw — Stalemate';
    }
    return;
  }
  gameOver = false; gameOverText = '';
}

// ─────────────────────────────────────────────────────────────────────────────
//  FULLY SELF-CONTAINED MATE/STALEMATE SEARCH (mounted-aware)
// ─────────────────────────────────────────────────────────────────────────────
function sideToMoveHasSafeMove(color) {
  const board = game.board();
  const myPieces = [];
  for (let br = 0; br < 8; br++) {
    for (let bf = 0; bf < 8; bf++) {
      const cell = board[br][bf];
      if (!cell || cell.color !== color) continue;
      const sq = frToSq(bf, 7 - br);
      if (stunnedSquares[sq] > 0) continue;
      myPieces.push({ sq, type: cell.type, f: bf, r: 7 - br });
    }
  }
  for (const p of myPieces) {
    for (const c of pseudoMovesFor(color, p)) {
      if (trySafeMove(color, p.sq, c)) return true;
    }
  }
  return false;
}

// Geometric pseudo-move generation (self-check NOT filtered here).
function pseudoMovesFor(color, p) {
  const moves = [];
  const { f, r, type, sq } = p;
  const onBoard = (tf, tr) => tf >= 0 && tf <= 7 && tr >= 0 && tr <= 7;
  const occ = (tf, tr) => !!pieceAt(frToSq(tf, tr));
  const occByEnemy = (tf, tr) => { const t = pieceAt(frToSq(tf, tr)); return t && t.color !== color; };
  const promoRank = color === 'w' ? 7 : 0;

  if (type === 'k' && mounted[color] === sq) {
    const KN = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
    for (const [df, dr] of KN) {
      const tf = f + df, tr = r + dr;
      if (onBoard(tf, tr) && (!occ(tf, tr) || occByEnemy(tf, tr))) moves.push({ to: frToSq(tf, tr), kind: 'ride' });
    }
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      const tf = f + df, tr = r + dr;
      if (onBoard(tf, tr) && !occ(tf, tr)) moves.push({ to: frToSq(tf, tr), kind: 'dismount' });
    }
    return moves;
  }

  switch (type) {
    case 'p': {
      const dir = color === 'w' ? 1 : -1;
      const startRank = color === 'w' ? 1 : 6;
      if (onBoard(f, r + dir) && !occ(f, r + dir)) {
        pushPawn(moves, f, r + dir, promoRank);
        if (r === startRank && !occ(f, r + 2 * dir)) moves.push({ to: frToSq(f, r + 2 * dir), kind: 'plain' });
      }
      for (const df of [-1, 1]) {
        const tf = f + df, tr = r + dir;
        if (onBoard(tf, tr) && occByEnemy(tf, tr)) pushPawn(moves, tf, tr, promoRank);
      }
      if (has(color, 'leaping') && onBoard(f, r + 2 * dir) && !occ(f, r + 2 * dir)) pushPawn(moves, f, r + 2 * dir, promoRank);
      if (has(color, 'kingspawns')) {
        for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
          if (!df && !dr) continue;
          const tf = f + df, tr = r + dr;
          if (onBoard(tf, tr) && !occ(tf, tr)) pushPawn(moves, tf, tr, promoRank);
        }
      }
      break;
    }
    case 'n': {
      const KN = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
      for (const [df, dr] of KN) {
        const tf = f + df, tr = r + dr;
        if (onBoard(tf, tr) && (!occ(tf, tr) || occByEnemy(tf, tr))) moves.push({ to: frToSq(tf, tr), kind: 'plain' });
      }
      break;
    }
    case 'b': case 'r': case 'q': {
      const dirs = [];
      if (type === 'b' || type === 'q') dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
      if (type === 'r' || type === 'q') dirs.push([1,0],[-1,0],[0,1],[0,-1]);
      for (const [df, dr] of dirs) {
        let tf = f + df, tr = r + dr;
        while (onBoard(tf, tr)) {
          if (!occ(tf, tr)) moves.push({ to: frToSq(tf, tr), kind: 'plain' });
          else { if (occByEnemy(tf, tr)) moves.push({ to: frToSq(tf, tr), kind: 'plain' }); break; }
          tf += df; tr += dr;
        }
      }
      break;
    }
    case 'k': {
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
        if (!df && !dr) continue;
        const tf = f + df, tr = r + dr;
        if (onBoard(tf, tr) && (!occ(tf, tr) || occByEnemy(tf, tr))) moves.push({ to: frToSq(tf, tr), kind: 'plain' });
      }
      if (has(color, 'mounting')) {
        for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
          if (!df && !dr) continue;
          const tf = f + df, tr = r + dr;
          if (!onBoard(tf, tr)) continue;
          const t = pieceAt(frToSq(tf, tr));
          if (t && t.color === color && t.type === 'n') moves.push({ to: frToSq(tf, tr), kind: 'mount' });
        }
      }
      break;
    }
  }
  return moves;
}

function pushPawn(moves, tf, tr, promoRank) {
  if (tr === promoRank) moves.push({ to: frToSq(tf, tr), kind: 'plain', promotion: 'q' });
  else moves.push({ to: frToSq(tf, tr), kind: 'plain' });
}

// Simulate one candidate, test king safety, then ALWAYS restore the position.
function trySafeMove(color, from, candidate) {
  const snap = captureState();
  try {
    const to = candidate.to;
    if (mannedTowers[to]) delete mannedTowers[to];
    switch (candidate.kind) {
      case 'ride': {
        if (pieceAt(to)) game.remove(to);
        game.remove(from);
        game.put({ type: 'k', color }, to);
        mounted[color] = to;
        break;
      }
      case 'dismount': {
        game.remove(from);
        game.put({ type: 'n', color }, from);
        game.put({ type: 'k', color }, to);
        mounted[color] = null;
        break;
      }
      case 'mount': {
        game.remove(from);
        game.remove(to);
        game.put({ type: 'k', color }, to);
        mounted[color] = to;
        break;
      }
      default: {
        if (pieceAt(to)) game.remove(to);
        const moving = pieceAt(from);
        const placeType = candidate.promotion ? candidate.promotion : (moving ? moving.type : 'p');
        game.remove(from);
        game.put({ type: placeType, color }, to);
        if (mannedTowers[from]) { const c = mannedTowers[from]; delete mannedTowers[from]; mannedTowers[to] = c; }
        break;
      }
    }
    return !isKingAttacked(color);
  } catch (err) {
    return false;
  } finally {
    restoreState(snap);
  }
}
