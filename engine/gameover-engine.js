/**
 * engine/gameover-engine.js — Game-over evaluation: checkmate, stalemate,
 * king capture. State-threaded port of gameOver.js (which was already 100%
 * DOM-free — this file's logic is unchanged, only the global reads/writes
 * became explicit `state.` access).
 * Depends on: engine/chess-engine.js.
 */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const chessEngine = isNode ? require('./chess-engine.js') : root;
  const { pieceAt, frToSq, sqToFR, findKingSquare, isKingAttacked, has,
    figurePawnType, anyFigurePawnsInPlay, figureRookType, anyFigureRooksInPlay,
    figureBishopType, anyFigureBishopsInPlay, squareAttackedBy,
    snapshotState, restoreSnapshot } = chessEngine;

  function evaluateGameOver(state) {
    const wK = state.mounted.w || findKingSquare(state, 'w');
    const bK = state.mounted.b || findKingSquare(state, 'b');

    if (!wK) { state.gameOver = true; state.gameOverText = '♛ Black wins — King captured!'; return; }
    if (!bK) { state.gameOver = true; state.gameOverText = '♛ White wins — King captured!'; return; }

    const hasActiveStun = Object.keys(state.stunnedSquares).some(sq => state.stunnedSquares[sq] > 0);

    if (!state.mounted.w && !state.mounted.b && !hasActiveStun && !anyFigurePawnsInPlay(state) && !anyFigureRooksInPlay(state) && !anyFigureBishopsInPlay(state)) {
      if (state.game.in_checkmate()) {
        const winner = state.game.turn() === 'w' ? 'Black' : 'White';
        state.gameOver = true; state.gameOverText = `♛ ${winner} wins by checkmate!`;
        return;
      }
      if (state.game.in_stalemate()) { state.gameOver = true; state.gameOverText = 'Draw — Stalemate'; return; }
      if (state.game.insufficient_material()) { state.gameOver = true; state.gameOverText = 'Draw — Insufficient Material'; return; }
      state.gameOver = false; state.gameOverText = ''; return;
    }

    let sideToMove, inCheck, canMove;
    try {
      sideToMove = state.game.turn();
      inCheck = isKingAttacked(state, sideToMove);
      canMove = sideToMoveHasSafeMove(state, sideToMove);
    } catch (err) {
      console.error('evaluateGameOver (mounted/stunned) failed:', err);
      state.gameOver = false; state.gameOverText = ''; return;
    }
    if (!canMove) {
      if (inCheck) {
        const winner = sideToMove === 'w' ? 'Black' : 'White';
        state.gameOver = true; state.gameOverText = `♛ ${winner} wins by checkmate!`;
      } else {
        state.gameOver = true; state.gameOverText = 'Draw — Stalemate';
      }
      return;
    }
    state.gameOver = false; state.gameOverText = '';
  }

  function sideToMoveHasSafeMove(state, color) {
    const board = state.game.board();
    const myPieces = [];
    for (let br = 0; br < 8; br++) {
      for (let bf = 0; bf < 8; bf++) {
        const cell = board[br][bf];
        if (!cell || cell.color !== color) continue;
        const sq = frToSq(bf, 7 - br);
        if (state.stunnedSquares[sq] > 0) continue;
        myPieces.push({ sq, type: cell.type, f: bf, r: 7 - br });
      }
    }
    for (const p of myPieces) {
      for (const c of pseudoMovesFor(state, color, p)) {
        if (trySafeMove(state, color, p.sq, c)) return true;
      }
    }
    return false;
  }

  function pseudoMovesFor(state, color, p) {
    const moves = [];
    const { f, r, type, sq } = p;
    const onBoard = (tf, tr) => tf >= 0 && tf <= 7 && tr >= 0 && tr <= 7;
    const occ = (tf, tr) => !!pieceAt(state, frToSq(tf, tr));
    const occByEnemy = (tf, tr) => { const t = pieceAt(state, frToSq(tf, tr)); return t && t.color !== color; };
    const promoRank = color === 'w' ? 7 : 0;

    if (type === 'k' && state.mounted[color] === sq) {
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
        const figure = figurePawnType(state, color);

        if (figure === 'apprentice') {
          for (const df of [-1, 0, 1]) {
            const tf = f + df, tr = r + dir;
            if (onBoard(tf, tr) && !occ(tf, tr)) pushPawn(moves, tf, tr, promoRank);
          }
          if (r === startRank && !occ(f, r + dir) && !occ(f, r + 2 * dir)) {
            moves.push({ to: frToSq(f, r + 2 * dir), kind: 'plain' });
          }
          if (has(state, color, 'leaping') && onBoard(f, r + 2 * dir) && !occ(f, r + 2 * dir)) {
            moves.push({ to: frToSq(f, r + 2 * dir), kind: 'plain' });
          }
          break;
        }
        if (figure === 'archer') {
          for (const df of [-1, 0, 1]) {
            const tf = f + df, tr = r + dir;
            if (onBoard(tf, tr) && !occ(tf, tr)) pushPawn(moves, tf, tr, promoRank);
          }
          for (const df of [-1, 0, 1]) {
            const tf = f + df, tr = r + 2 * dir;
            if (onBoard(tf, tr) && occByEnemy(tf, tr)) moves.push({ to: frToSq(tf, tr), kind: 'shoot' });
          }
          break;
        }
        if (figure === 'ghoul') {
          const gDirs = has(state, color, 'deviant') ? [0, -1, 1] : [0];
          for (const gdf of gDirs) {
            const tf1 = f + gdf, tr1 = r + dir;
            if (onBoard(tf1, tr1)) {
              if (!occ(tf1, tr1)) {
                pushPawn(moves, tf1, tr1, promoRank);
                if (r === startRank && !occ(f + 2 * gdf, r + 2 * dir)) {
                  moves.push({ to: frToSq(f + 2 * gdf, r + 2 * dir), kind: 'plain' });
                }
              } else if (occByEnemy(tf1, tr1)) {
                pushPawn(moves, tf1, tr1, promoRank);
              }
            }
            const tf2 = f + 2 * gdf, tr2 = r + 2 * dir;
            const chargeClear = has(state, color, 'leaping') || !occ(tf1, tr1);
            if (onBoard(tf2, tr2) && occByEnemy(tf2, tr2) && chargeClear) pushPawn(moves, tf2, tr2, promoRank);
            if (has(state, color, 'leaping') && onBoard(tf2, tr2) && !occ(tf2, tr2)) {
              moves.push({ to: frToSq(tf2, tr2), kind: 'plain' });
            }
          }
          break;
        }
        if (figure === 'spearman') {
          const tf = f, tr = r + dir;
          if (onBoard(tf, tr)) {
            if (!occ(tf, tr)) {
              pushPawn(moves, tf, tr, promoRank);
              if (r === startRank && !occ(f, r + 2 * dir)) {
                moves.push({ to: frToSq(f, r + 2 * dir), kind: 'plain' });
              }
            } else if (occByEnemy(tf, tr)) {
              pushPawn(moves, tf, tr, promoRank);
            }
          }
          break;
        }
        if (figure === 'guardsman') {
          for (let df = -1; df <= 1; df++) for (let dr2 = -1; dr2 <= 1; dr2++) {
            if (!df && !dr2) continue;
            const tf = f + df, tr = r + dr2;
            if (onBoard(tf, tr) && !occ(tf, tr)) pushPawn(moves, tf, tr, promoRank);
          }
          if (r === startRank && !occ(f, r + dir) && !occ(f, r + 2 * dir)) {
            moves.push({ to: frToSq(f, r + 2 * dir), kind: 'plain' });
          }
          for (const df of [-1, 1]) {
            const tf = f + df, tr = r + dir;
            if (onBoard(tf, tr) && occByEnemy(tf, tr)) pushPawn(moves, tf, tr, promoRank);
          }
          if (has(state, color, 'leaping') && onBoard(f, r + 2 * dir) && !occ(f, r + 2 * dir)) {
            moves.push({ to: frToSq(f, r + 2 * dir), kind: 'plain' });
          }
          break;
        }

        if (onBoard(f, r + dir) && !occ(f, r + dir)) {
          pushPawn(moves, f, r + dir, promoRank);
          if (r === startRank && !occ(f, r + 2 * dir)) moves.push({ to: frToSq(f, r + 2 * dir), kind: 'plain' });
        }
        for (const df of [-1, 1]) {
          const tf = f + df, tr = r + dir;
          if (onBoard(tf, tr) && occByEnemy(tf, tr)) pushPawn(moves, tf, tr, promoRank);
        }
        if (has(state, color, 'leaping') && onBoard(f, r + 2 * dir) && !occ(f, r + 2 * dir)) pushPawn(moves, f, r + 2 * dir, promoRank);
        const epTarget = state.game.fen().split(' ')[3];
        if (epTarget !== '-') {
          const { f: ef, r: er } = sqToFR(epTarget);
          if (er === r + dir && Math.abs(ef - f) === 1) moves.push({ to: epTarget, kind: 'ep' });
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
        const isTroll = type === 'r' && figureRookType(state, color);
        if (type === 'b' && figureBishopType(state, color) === 'longbowman') {
          for (let df = -1; df <= 1; df++) for (let dr2 = -1; dr2 <= 1; dr2++) {
            if (!df && !dr2) continue;
            const tf = f + df, tr = r + dr2;
            if (onBoard(tf, tr) && !occ(tf, tr)) moves.push({ to: frToSq(tf, tr), kind: 'plain' });
          }
          for (let df = -1; df <= 1; df++) for (let dr2 = -1; dr2 <= 1; dr2++) {
            if (!df && !dr2) continue;
            const tf = f + 2 * df, tr = r + 2 * dr2;
            if (onBoard(tf, tr) && occByEnemy(tf, tr)) moves.push({ to: frToSq(tf, tr), kind: 'shoot' });
          }
          break;
        }
        const dirs = [];
        if (type === 'b' || type === 'q') dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
        if (type === 'r' || type === 'q') dirs.push([1,0],[-1,0],[0,1],[0,-1]);
        for (const [df, dr] of dirs) {
          let tf = f + df, tr = r + dr;
          while (onBoard(tf, tr)) {
            if (!occ(tf, tr)) moves.push({ to: frToSq(tf, tr), kind: 'plain' });
            else { if (!isTroll && occByEnemy(tf, tr)) moves.push({ to: frToSq(tf, tr), kind: 'plain' }); break; }
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
        if (has(state, color, 'mounting')) {
          for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
            if (!df && !dr) continue;
            const tf = f + df, tr = r + dr;
            if (!onBoard(tf, tr)) continue;
            const t = pieceAt(state, frToSq(tf, tr));
            if (t && t.color === color && t.type === 'n') moves.push({ to: frToSq(tf, tr), kind: 'mount' });
          }
        }
        const rank = color === 'w' ? '1' : '8';
        if (sq === 'e' + rank && state.mounted[color] !== sq) {
          const rights = state.game.fen().split(' ')[2];
          const enemy = color === 'w' ? 'b' : 'w';
          const kSq = pieceAt(state, 'h' + rank), qSq = pieceAt(state, 'a' + rank);
          const kRight = color === 'w' ? 'K' : 'k', qRight = color === 'w' ? 'Q' : 'q';
          if (rights.includes(kRight) && kSq && kSq.type === 'r' && kSq.color === color &&
              !occ(f + 1, r) && !occ(f + 2, r) &&
              !squareAttackedBy(state, sq, enemy) && !squareAttackedBy(state, 'f' + rank, enemy) && !squareAttackedBy(state, 'g' + rank, enemy)) {
            moves.push({ to: 'g' + rank, kind: 'castleK' });
          }
          if (rights.includes(qRight) && qSq && qSq.type === 'r' && qSq.color === color &&
              !occ(f - 1, r) && !occ(f - 2, r) && !occ(f - 3, r) &&
              !squareAttackedBy(state, sq, enemy) && !squareAttackedBy(state, 'd' + rank, enemy) && !squareAttackedBy(state, 'c' + rank, enemy)) {
            moves.push({ to: 'c' + rank, kind: 'castleQ' });
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

  function trySafeMove(state, color, from, candidate) {
    const snap = snapshotState(state);
    try {
      const to = candidate.to;
      if (state.mannedTowers[to]) delete state.mannedTowers[to];
      switch (candidate.kind) {
        case 'ride': {
          if (pieceAt(state, to)) state.game.remove(to);
          state.game.remove(from);
          state.game.put({ type: 'k', color }, to);
          state.mounted[color] = to;
          break;
        }
        case 'dismount': {
          state.game.remove(from);
          state.game.put({ type: 'n', color }, from);
          state.game.put({ type: 'k', color }, to);
          state.mounted[color] = null;
          break;
        }
        case 'mount': {
          state.game.remove(from);
          state.game.remove(to);
          state.game.put({ type: 'k', color }, to);
          state.mounted[color] = to;
          break;
        }
        case 'shoot': {
          if (pieceAt(state, to)) state.game.remove(to);
          break;
        }
        case 'ep': {
          const capSq = frToSq(sqToFR(to).f, sqToFR(from).r);
          if (pieceAt(state, capSq)) state.game.remove(capSq);
          state.game.remove(from);
          state.game.put({ type: 'p', color }, to);
          break;
        }
        case 'castleK':
        case 'castleQ': {
          const rank = color === 'w' ? '1' : '8';
          const rookFrom = (candidate.kind === 'castleK' ? 'h' : 'a') + rank;
          const rookTo = (candidate.kind === 'castleK' ? 'f' : 'd') + rank;
          state.game.remove(from);
          state.game.remove(rookFrom);
          state.game.put({ type: 'k', color }, to);
          state.game.put({ type: 'r', color }, rookTo);
          break;
        }
        default: {
          if (pieceAt(state, to)) state.game.remove(to);
          const moving = pieceAt(state, from);
          const placeType = candidate.promotion ? candidate.promotion : (moving ? moving.type : 'p');
          state.game.remove(from);
          state.game.put({ type: placeType, color }, to);
          if (state.mannedTowers[from]) { const c = state.mannedTowers[from]; delete state.mannedTowers[from]; state.mannedTowers[to] = c; }
          break;
        }
      }
      return !isKingAttacked(state, color);
    } catch (err) {
      return false;
    } finally {
      restoreSnapshot(state, snap);
    }
  }

  const exportsObj = { evaluateGameOver, sideToMoveHasSafeMove, pseudoMovesFor };

  if (isNode) module.exports = exportsObj;
  else Object.assign(root, exportsObj);
})(typeof window !== 'undefined' ? window : globalThis);
