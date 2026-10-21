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
  const { pieceAt, frToSq, sqToFR, findKingSquare, isKingAttacked, isCheckDoomedByFire, has,
    figurePawnType, anyFigurePawnsInPlay, figureRookType, anyFigureRooksInPlay,
    figureBishopType, anyFigureBishopsInPlay, squareAttackedBy,
    generateMoves, generateExitMoves, needsManualCheck, kingThreatenedAfterPly } = chessEngine;

  function evaluateGameOver(state) {
    const wK = state.mounted.w || findKingSquare(state, 'w');
    const bK = state.mounted.b || findKingSquare(state, 'b');

    if (!wK) { state.gameOver = true; state.gameOverText = '♛ Black wins — King captured!'; return; }
    if (!bK) { state.gameOver = true; state.gameOverText = '♛ White wins — King captured!'; return; }

    // Coronation: an instant win the moment that color's King is sitting on
    // the opponent's back rank, however it got there (a plain King step, or
    // riding in as a mounted knight per the Mounting augment — wK/bK above
    // already resolve to the mounted square when applicable). Checked ahead
    // of checkmate/stalemate since reaching the back rank ends the game
    // outright, with no regard for whose move is next.
    if (has(state, 'w', 'coronation') && wK[1] === '8') {
      state.gameOver = true; state.gameOverText = '👑 White wins — King reached the enemy back rank!'; return;
    }
    if (has(state, 'b', 'coronation') && bK[1] === '1') {
      state.gameOver = true; state.gameOverText = '👑 Black wins — King reached the enemy back rank!'; return;
    }

    const hasActiveStun = Object.keys(state.stunnedSquares).some(sq => state.stunnedSquares[sq] > 0);

    // Bumped to the manual path below whenever chess.js can't judge this
    // position on its own (see needsManualCheck) — e.g. a check doomed to
    // burn away in Ring of Fire, or a Solar Strike about to open a line onto
    // the King, which its in_checkmate() has no notion of.
    if (!hasActiveStun && !needsManualCheck(state, state.game.turn())) {
      // chess.js knows only moves — a safe ability (e.g. Advance pushing a
      // pawn in front of the King) still gets the player out.
      const noMoves = state.game.in_checkmate() || state.game.in_stalemate();
      if (noMoves && sideToMoveHasSafeAbility(state, state.game.turn())) {
        state.gameOver = false; state.gameOverText = ''; return;
      }
      if (state.game.in_checkmate()) {
        const winner = state.game.turn() === 'w' ? 'Black' : 'White';
        state.gameOver = true; state.gameOverText = `♛ ${winner} wins by checkmate!`;
        return;
      }
      if (state.game.in_stalemate()) { state.gameOver = true; state.gameOverText = 'Draw — Stalemate'; return; }
      if (state.game.insufficient_material()) { state.gameOver = true; state.gameOverText = 'Draw — Insufficient Material'; return; }
      state.gameOver = false; state.gameOverText = ''; return;
    }

    let sideToMove, inCheck, exposedByStrike, canMove;
    try {
      sideToMove = state.game.turn();
      inCheck = kingThreatenedAfterPly(state, sideToMove);
      exposedByStrike = inCheck && !isKingAttacked(state, sideToMove);
      canMove = sideToMoveHasSafeMove(state, sideToMove);
    } catch (err) {
      console.error('evaluateGameOver (manual path) failed:', err);
      state.gameOver = false; state.gameOverText = ''; return;
    }
    if (!canMove) {
      if (inCheck) {
        const winner = sideToMove === 'w' ? 'Black' : 'White';
        const loser = sideToMove === 'w' ? 'White' : 'Black';
        state.gameOver = true;
        state.gameOverText = exposedByStrike
          ? `♛ ${winner} wins by checkmate — the Solar Strike leaves ${loser}'s King defenceless!`
          : `♛ ${winner} wins by checkmate!`;
      } else {
        state.gameOver = true; state.gameOverText = 'Draw — Stalemate';
      }
      return;
    }
    state.gameOver = false; state.gameOverText = '';
  }

  // A legal move, or failing that a turn-ending ability that leaves the King
  // safe (Advance, Silver Bullet, a Troll's club, …) — the same rules the
  // server accepts actions by, so game-over can never disagree with what a
  // player is actually allowed to do.
  function sideToMoveHasSafeMove(state, color) {
    return sideToMoveHasLegalMove(state, color) || sideToMoveHasSafeAbility(state, color);
  }

  function sideToMoveHasSafeAbility(state, color) {
    const augmentsEngine = isNode ? require('./augments-engine.js') : root;
    const wasOver = state.gameOver;
    state.gameOver = false; // casts are refused once the game is over
    try {
      return augmentsEngine.turnEndingAbilityActions(state, color)
        .some(action => !augmentsEngine.abilityKingSafetyError(state, color, action));
    } finally {
      state.gameOver = wasOver;
    }
  }

  // Uses the exact generator the server validates moves with (incl. tower
  // exits and dismounts).
  function sideToMoveHasLegalMove(state, color) {
    const board = state.game.board();
    const wasOver = state.gameOver;
    state.gameOver = false; // generateMoves returns nothing once the game is over
    try {
      for (let br = 0; br < 8; br++) {
        for (let bf = 0; bf < 8; bf++) {
          const cell = board[br][bf];
          if (!cell || cell.color !== color) continue;
          const sq = frToSq(bf, 7 - br);
          if (generateMoves(state, sq).length) return true;
          if ((state.mannedTowers[sq] === color || state.mounted[color] === sq) && generateExitMoves(state, sq).length) return true;
        }
      }
      return false;
    } finally {
      state.gameOver = wasOver;
    }
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
          for (const [df, dr2] of chessEngine.archerStepOffsets(state, color)) {
            const tf = f + df, tr = r + dr2;
            if (onBoard(tf, tr) && !occ(tf, tr)) pushPawn(moves, tf, tr, promoRank);
          }
          if (!chessEngine.isArcherOnCooldown(state, color, sq)) {
            for (const df of [-1, 0, 1]) {
              const tf = f + df, tr = r + 2 * dir;
              if (onBoard(tf, tr) && occByEnemy(tf, tr)) moves.push({ to: frToSq(tf, tr), kind: 'shoot' });
            }
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

  const exportsObj = { evaluateGameOver, sideToMoveHasSafeMove, pseudoMovesFor };

  if (isNode) module.exports = exportsObj;
  else Object.assign(root, exportsObj);
})(typeof window !== 'undefined' ? window : globalThis);
