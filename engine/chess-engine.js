/**
 * engine/chess-engine.js — The core game engine: move generation, check
 * detection, move execution, game-over-adjacent bookkeeping (Breaking Rank).
 * Pure, state-threaded port of app.js's non-DOM logic. Same dual
 * browser-<script>/Node-require shape as the other engine files — this is
 * THE authority on the server, and also loaded client-side for instant
 * legal-move highlighting/hover previews (the server still validates every
 * committed move independently).
 *
 * Depends on: chess.js (Chess constructor), data.js (AUGMENTS/FIGURES not
 * needed here directly).
 */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Chess = isNode ? require('../chess.js').Chess : root.Chess;

  // ═══════════════════════════════════════════════════════════════════════
  //  GAME SETUP
  // ═══════════════════════════════════════════════════════════════════════
  // Called once the draft finishes (state.augments already set by
  // draft-engine's finishDraft) — initializes everything needed to actually
  // play. Safe to call again for "New Game" within an existing room.
  function newGame(state) {
    state.game = new Chess();
    state.mannedTowers = {};
    state.mounted = { w: null, b: null };
    state.specialSelect = null;
    state.moveLog = [];
    state.gameOver = false;
    state.gameOverText = '';
    state.ghoulJustMoved = { w: [], b: [] }; // arrays (not Set) — this gets JSON-broadcast
    state.ghoulBrokeRank = { w: [], b: [] }; // squares of Ghouls that broke rank this turn — can't be moved again until it's this color's turn again

    state.stunlockCharges = { w: {}, b: {} };
    state.stunnedSquares = {};
    state.pendingStunlock = null;
    state.stunlockTargeting = false;
    if (has(state, 'w', 'stunlock')) state.stunlockCharges.w = { c1: true, f1: true };
    if (has(state, 'b', 'stunlock')) state.stunlockCharges.b = { c8: true, f8: true };

    state.solarMarked = {};
    state.pendingSolarStrike = null;
    state.solarStrikeCastThisTurn = false;

    state.armedAbility = null; // { id, unitSq, key }

    state.advanceUsed = { w: false, b: false };

    state.silverBulletUsed = { w: false, b: false };

    state.lightningActive = { w: false, b: false };

    state.fireActive = { w: false, b: false };
    state.fireAura = {};

    // Unstable Teleport: each individual Apprentice may only ever cast it
    // once, so this tracks *which square currently holds an Apprentice that
    // has already used it* (not a per-color used-once flag) — applyMoveToState
    // carries the entry forward whenever that specific Apprentice makes a
    // normal move, and drops it if the square is vacated any other way (e.g.
    // captured), so a later, unrelated Apprentice arriving on that square
    // doesn't inherit a stale "already used" flag.
    state.apprenticeTeleportUsed = { w: {}, b: {} };
    // Small blue "a teleport just happened here" indicator — ticks down like
    // stunnedSquares/solarMarked (see tickTeleportMarks), set to 2 so it
    // survives the immediate afterTurnSettles() from the cast itself and is
    // only cleared after the opponent's following turn completes.
    state.teleportMarked = {};

    // Small fire icon left for one turn on any square where a unit died to
    // Unstable Fireball, Ring of Fire, or Solar Strike — ticks down the same
    // way as teleportMarked (see tickFireDeathMarks). Purely a "something
    // burned here" indicator, distinct from those abilities' own
    // targeting/aim overlays (fireball-target, solarstrike-target, ...).
    state.fireDeathMarked = {};

    state.lastMove = null;
  }

  function has(state, color, augId) {
    return state.augments[color] && state.augments[color].includes(augId);
  }

  function figurePawnType(state, color) {
    if (has(state, color, 'apprentices')) return 'apprentice';
    if (has(state, color, 'archers')) return 'archer';
    if (has(state, color, 'ghouls')) return 'ghoul';
    if (has(state, color, 'guardsmen')) return 'guardsman';
    if (has(state, color, 'spearmen')) return 'spearman';
    return null;
  }

  function anyFigurePawnsInPlay(state) {
    return figurePawnType(state, 'w') !== null || figurePawnType(state, 'b') !== null;
  }

  function figureRookType(state, color) {
    if (has(state, color, 'trolls')) return 'troll';
    return null;
  }

  function anyFigureRooksInPlay(state) {
    return figureRookType(state, 'w') !== null || figureRookType(state, 'b') !== null;
  }

  function figureBishopType(state, color) {
    if (has(state, color, 'longbowmen')) return 'longbowman';
    return null;
  }

  function anyFigureBishopsInPlay(state) {
    return figureBishopType(state, 'w') !== null || figureBishopType(state, 'b') !== null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  SQUARE / COORDINATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════
  const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  function sqToFR(sq) {
    return { f: FILES.indexOf(sq[0]), r: parseInt(sq[1]) - 1 };
  }
  function frToSq(f, r) {
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return FILES[f] + (r + 1);
  }
  function isEmpty(state, sq) {
    return !state.game.get(sq) && !state.mannedTowers[sq];
  }
  function pieceAt(state, sq) {
    return state.game.get(sq);
  }

  function findKingSquare(state, color) {
    const board = state.game.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = board[r][f];
        if (cell && cell.type === 'k' && cell.color === color) return 'abcdefgh'[f] + (8 - r);
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  MOVE GENERATION
  // ═══════════════════════════════════════════════════════════════════════
  function generateMoves(state, sq) {
    const turn = state.game.turn();
    if (state.gameOver) return [];

    if (state.specialSelect && state.specialSelect.square === sq) {
      return generateExitMoves(state, sq);
    }

    const piece = pieceAt(state, sq);
    if (!piece || piece.color !== turn) return [];
    if (state.stunnedSquares[sq] > 0) return [];

    let moves = [];

    if (state.mounted[turn] === sq && piece.type === 'k') {
      moves = generateMountedKingMoves(state, sq, turn);
      return filterIntoCheck(state, moves, turn);
    }

    const figure = piece.type === 'p' ? figurePawnType(state, turn) : null;
    const rookFigure = piece.type === 'r' ? figureRookType(state, turn) : null;
    const bishopFigure = piece.type === 'b' ? figureBishopType(state, turn) : null;
    const needsManualCheck = !!(state.mounted.w || state.mounted.b) || anyFigurePawnsInPlay(state) || anyFigureRooksInPlay(state) || anyFigureBishopsInPlay(state);

    if (figure) {
      moves.push(...generateFigurePawnMoves(state, sq, turn, figure));
      if (figure !== 'archer' && has(state, turn, 'leaping')) moves.push(...generateLeapingMoves(state, sq, turn));
    } else if (rookFigure) {
      moves.push(...generateTrollMoves(state, sq, turn));
    } else if (bishopFigure) {
      moves.push(...generateLongbowmanMoves(state, sq, turn));
    } else if (needsManualCheck) {
      moves.push(...generatePseudoStandardMoves(state, sq, turn, piece));
      if (piece.type === 'p' && has(state, turn, 'leaping')) moves.push(...generateLeapingMoves(state, sq, turn));
    } else {
      const std = state.game.moves({ square: sq, verbose: true }).map(m => ({
        from: m.from, to: m.to, promotion: m.promotion, captured: m.captured, standard: true,
      }));
      moves.push(...std);
      if (piece.type === 'p' && has(state, turn, 'leaping')) moves.push(...generateLeapingMoves(state, sq, turn));
    }

    if (piece.type === 'p' && has(state, turn, 'watchtowers')) {
      moves.push(...generateTowerEntryMoves(state, sq, turn));
    }
    if (piece.type === 'k' && has(state, turn, 'mounting')) {
      moves.push(...generateMountMoves(state, sq, turn));
    }

    moves = dedupeMoves(moves);
    return filterIntoCheck(state, moves, turn);
  }

  function dedupeMoves(moves) {
    const map = new Map();
    for (const m of moves) {
      const key = (m.special === 'towerEnter' || m.special === 'mount')
        ? m.special + ':' + m.to
        : m.to + (m.promotion || '');
      if (!map.has(key)) map.set(key, m);
      else {
        const existing = map.get(key);
        if (!existing.standard && m.standard) map.set(key, m);
      }
    }
    return Array.from(map.values());
  }

  function generatePseudoStandardMoves(state, sq, color, piece) {
    const { f, r } = sqToFR(sq);
    // Lazy require (not a top-level one) — gameover-engine.js requires this
    // file at its own top level, so a top-level require here would deadlock
    // on the circular dependency. By call time both modules are fully loaded.
    const pseudoMovesFor = isNode ? require('./gameover-engine.js').pseudoMovesFor : root.pseudoMovesFor;
    const raw = pseudoMovesFor(state, color, { sq, type: piece.type, f, r });
    return raw.map(pm => {
      const m = { from: sq, to: pm.to };
      if (pm.kind === 'ep') {
        m.special = 'epCapture';
        m.captured = 'p';
      } else if (pm.kind === 'castleK' || pm.kind === 'castleQ') {
        m.special = pm.kind;
      } else {
        m.special = 'genericStep';
        const captured = pieceAt(state, pm.to);
        if (captured) m.captured = captured.type;
      }
      if (pm.promotion) m.needsPromo = true;
      return m;
    });
  }

  function generateFigurePawnMoves(state, sq, color, figure) {
    if (figure === 'apprentice') return generateApprenticeMoves(state, sq, color);
    if (figure === 'archer') return generateArcherMoves(state, sq, color);
    if (figure === 'ghoul') return generateGhoulMoves(state, sq, color);
    if (figure === 'guardsman') return generateGuardsmenMoves(state, sq, color);
    if (figure === 'spearman') return generateSpearmanMoves(state, sq, color);
    return [];
  }

  function isPromoRank(color, r) {
    return (color === 'w' && r === 7) || (color === 'b' && r === 0);
  }

  function generateApprenticeMoves(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const dir = color === 'w' ? 1 : -1;
    const startRank = color === 'w' ? 1 : 6;
    const res = [];

    for (const df of [-1, 0, 1]) {
      const target = frToSq(f + df, r + dir);
      if (target && isEmpty(state, target)) {
        const promo = isPromoRank(color, r + dir);
        res.push({ from: sq, to: target, special: 'apprenticeStep', promotion: promo ? 'q' : undefined, needsPromo: promo });
      }
    }
    if (r === startRank) {
      const oneAhead = frToSq(f, r + dir);
      const twoAhead = frToSq(f, r + 2 * dir);
      if (oneAhead && twoAhead && isEmpty(state, oneAhead) && isEmpty(state, twoAhead)) {
        res.push({ from: sq, to: twoAhead, special: 'apprenticeLeap' });
      }
    }
    return res;
  }

  function archerShootRangeSquares(sq, color) {
    const { f, r } = sqToFR(sq);
    const dir = color === 'w' ? 1 : -1;
    const res = [];
    for (const df of [-1, 0, 1]) {
      const target = frToSq(f + df, r + 2 * dir);
      if (target) res.push(target);
    }
    return res;
  }

  function generateArcherMoves(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const dir = color === 'w' ? 1 : -1;
    const res = [];

    for (const df of [-1, 0, 1]) {
      const target = frToSq(f + df, r + dir);
      if (target && isEmpty(state, target)) {
        const promo = isPromoRank(color, r + dir);
        res.push({ from: sq, to: target, special: 'archerStep', promotion: promo ? 'q' : undefined, needsPromo: promo });
      }
    }
    for (const target of archerShootRangeSquares(sq, color)) {
      const tp = pieceAt(state, target);
      if (tp && tp.color !== color) {
        res.push({ from: sq, to: target, special: 'archerShoot', captured: tp.type });
      }
    }
    return res;
  }

  function ghoulDirections(state, color) {
    const dirs = [{ df: 0, prefix: 'ghoul' }];
    if (has(state, color, 'deviant')) dirs.push({ df: -1, prefix: 'ghoulDiag' }, { df: 1, prefix: 'ghoulDiag' });
    return dirs;
  }

  function ghoulChargeSquares(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const dir = color === 'w' ? 1 : -1;
    const res = [];
    for (const { df } of ghoulDirections(state, color)) {
      const target = frToSq(f + 2 * df, r + 2 * dir);
      if (target) res.push(target);
    }
    return res;
  }

  function generateGhoulMoves(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const dir = color === 'w' ? 1 : -1;
    const startRank = color === 'w' ? 1 : 6;
    const res = [];

    for (const { df, prefix } of ghoulDirections(state, color)) {
      const oneAhead = frToSq(f + df, r + dir);
      if (oneAhead) {
        if (isEmpty(state, oneAhead)) {
          const promo = isPromoRank(color, r + dir);
          res.push({ from: sq, to: oneAhead, special: prefix + 'Step', promotion: promo ? 'q' : undefined, needsPromo: promo });
          if (df === 0 && r === startRank) {
            const twoAheadEmpty = frToSq(f + 2 * df, r + 2 * dir);
            if (twoAheadEmpty && isEmpty(state, twoAheadEmpty)) {
              res.push({ from: sq, to: twoAheadEmpty, special: prefix + 'Leap' });
            }
          }
        } else {
          const tp = pieceAt(state, oneAhead);
          if (tp && tp.color !== color) {
            const promo = isPromoRank(color, r + dir);
            res.push({ from: sq, to: oneAhead, special: prefix + 'Capture', captured: tp.type, promotion: promo ? 'q' : undefined, needsPromo: promo });
          }
        }
      }
      const twoAhead = frToSq(f + 2 * df, r + 2 * dir);
      if (twoAhead) {
        const tp2 = pieceAt(state, twoAhead);
        const chargeClear = has(state, color, 'leaping') || (oneAhead && isEmpty(state, oneAhead));
        if (tp2 && tp2.color !== color && chargeClear) {
          const promo = isPromoRank(color, r + 2 * dir);
          res.push({ from: sq, to: twoAhead, special: prefix + 'Charge', captured: tp2.type, promotion: promo ? 'q' : undefined, needsPromo: promo });
        }
        if (df !== 0 && has(state, color, 'leaping') && isEmpty(state, twoAhead)) {
          res.push({ from: sq, to: twoAhead, special: prefix + 'Leap' });
        }
      }
    }
    return res;
  }

  function ghoulLegalChargeTargets(state, sq, color) {
    return generateGhoulMoves(state, sq, color)
      .filter(m => m.special === 'ghoulCharge' || m.special === 'ghoulDiagCharge')
      .map(m => m.to);
  }

  // A Troll walks a single square along a rank or file — but can only ever
  // step onto open ground; it never captures by moving. Reuses
  // 'genericStep' for execution since a walk is just a step with no capture
  // and no promotion.
  function generateTrollMoves(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const res = [];
    for (const [df, dr] of dirs) {
      const target = frToSq(f + df, r + dr);
      if (target && isEmpty(state, target)) {
        res.push({ from: sq, to: target, special: 'genericStep' });
      }
    }
    return res;
  }

  // A Longbowman steps to any free adjacent square like a king, but never
  // captures by moving there. Instead it strikes any unit exactly two
  // squares away in a straight or diagonal line, without leaving its square
  // — same split as the Archer's step/shoot pattern.
  function longbowShootRangeSquares(sq) {
    const { f, r } = sqToFR(sq);
    const res = [];
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const target = frToSq(f + 2 * df, r + 2 * dr);
        if (target) res.push(target);
      }
    }
    return res;
  }

  function generateLongbowmanMoves(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const res = [];
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const target = frToSq(f + df, r + dr);
        if (target && isEmpty(state, target)) {
          res.push({ from: sq, to: target, special: 'longbowmanStep' });
        }
      }
    }
    for (const target of longbowShootRangeSquares(sq)) {
      const tp = pieceAt(state, target);
      if (tp && tp.color !== color) {
        res.push({ from: sq, to: target, special: 'longbowmanShoot', captured: tp.type });
      }
    }
    return res;
  }

  // ── Breaking Rank (passive) ─────────────────────────────────────────────
  // At the start of `color`'s turn, every enemy unit sitting on a square one
  // of `color`'s Ghouls could currently charge has a 1-in-6 chance of being
  // struck down automatically — and, same as a manual charge, the Ghoul
  // actually moves onto that square rather than just sniping it from afar.
  // Server is the sole authority, so this always just rolls directly — no
  // client-side desync concern (see stunlock.js's history for why that used
  // to matter under peer-to-peer multiplayer).
  const BREAKING_RANK_CHANCE = 1 / 6;

  function checkBreakingRank(state, color) {
    state.ghoulBrokeRank[color] = [];
    if (state.gameOver || !has(state, color, 'breakingRank')) return;

    const board = state.game.board();
    const charges = []; // { from, to }
    const claimedTargets = new Set(); // guards against two Ghouls (e.g. via Deviant's diagonal charges) both landing on the same square
    const justMoved = new Set(state.ghoulJustMoved[color]);
    for (let br = 0; br < 8; br++) {
      for (let bf = 0; bf < 8; bf++) {
        const cell = board[br][bf];
        if (!cell || cell.color !== color || cell.type !== 'p') continue;
        const gSq = frToSq(bf, 7 - br);
        if (justMoved.has(gSq)) {
          justMoved.delete(gSq); // exemption consumed either way
          continue;
        }
        for (const targetSq of ghoulLegalChargeTargets(state, gSq, color)) {
          if (claimedTargets.has(targetSq)) continue;
          if (Math.random() < BREAKING_RANK_CHANCE) {
            charges.push({ from: gSq, to: targetSq });
            claimedTargets.add(targetSq);
            break; // this Ghoul can only land on one square — first hit wins
          }
        }
      }
    }
    state.ghoulJustMoved[color] = Array.from(justMoved);
    if (charges.length === 0) return;
    applyBreakingRankCaptures(state, charges, color);
  }

  function applyBreakingRankCaptures(state, charges, color) {
    for (const { from, to } of charges) {
      if (state.mannedTowers[to]) delete state.mannedTowers[to];
      clearMountedIfCaptured(state, to);
      if (pieceAt(state, to)) state.game.remove(to);
      state.game.remove(from);
      const promo = isPromoRank(color, sqToFR(to).r);
      state.game.put({ type: promo ? 'q' : 'p', color }, to);
      state.ghoulBrokeRank[color].push(to);
      state.moveLog.push({ san: '💥' + from + to, color });
    }
  }

  function clearMountedIfCaptured(state, sq) {
    if (state.mounted.w === sq) state.mounted.w = null;
    if (state.mounted.b === sq) state.mounted.b = null;
  }

  // ── King auras (I Am Lightning / Ring of Fire) ───────────────────────────
  // Shared square math for both King auras below: the 8 squares touching
  // wherever that King currently stands, not a fixed zone — it follows the
  // King as it moves.
  const KING_ADJACENT_OFFSETS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  function kingAuraSquares(kingSq) {
    const { f, r } = sqToFR(kingSq);
    return KING_ADJACENT_OFFSETS.map(([df, dr]) => frToSq(f + df, r + dr)).filter(Boolean);
  }

  // Once state.lightningActive[color] is set (via castKingsLightning in
  // augments-engine.js), that King's aura executes anything standing in it
  // immediately, every single turn end. Called from afterTurnSettles for
  // every turn, whoever's move just ended, since it fires on both players'
  // turns for as long as the game runs, mirroring checkBreakingRank's
  // placement there.
  function checkKingsLightning(state) {
    if (state.gameOver) return;
    for (const color of ['w', 'b']) {
      if (!state.lightningActive[color]) continue;
      const kingSq = findKingSquare(state, color);
      if (!kingSq) continue;
      for (const sq of kingAuraSquares(kingSq)) {
        if (!pieceAt(state, sq)) continue;
        if (state.mannedTowers[sq]) delete state.mannedTowers[sq];
        clearMountedIfCaptured(state, sq);
        state.game.remove(sq);
        state.moveLog.push({ san: '🌩' + sq, color });
      }
    }
  }

  // Once state.fireActive[color] is set (via castRingOfFire in
  // augments-engine.js), that King's aura instead needs a unit to still be
  // standing in it at the NEXT turn-end check too before it's executed — one
  // full round of continuous exposure, not instant like Lightning.
  // state.fireAura tracks this per square: { turns, sig, color }, where sig
  // is that occupant's color+type. A square drops out of tracking (and
  // restarts at turns:1 if reclaimed) whenever it empties, the King moves
  // off it, or a different piece is found standing there — that last case
  // means the original occupant left/died and someone else arrived, which
  // isn't "continuously standing in the fire".
  function checkRingOfFire(state) {
    if (state.gameOver) return;
    for (const color of ['w', 'b']) {
      if (!state.fireActive[color]) continue;
      const kingSq = findKingSquare(state, color);
      if (!kingSq) continue;
      const auraSquares = kingAuraSquares(kingSq);
      const auraSet = new Set(auraSquares);

      for (const sq of Object.keys(state.fireAura)) {
        const entry = state.fireAura[sq];
        if (entry.color === color && !auraSet.has(sq)) delete state.fireAura[sq];
      }

      for (const sq of auraSquares) {
        const piece = pieceAt(state, sq);
        const entry = state.fireAura[sq];
        if (!piece) {
          if (entry && entry.color === color) delete state.fireAura[sq];
          continue;
        }
        const sig = piece.color + piece.type;
        if (entry && entry.color === color && entry.sig === sig) {
          entry.turns++;
          if (entry.turns >= 2) {
            if (state.mannedTowers[sq]) delete state.mannedTowers[sq];
            clearMountedIfCaptured(state, sq);
            state.game.remove(sq);
            state.fireDeathMarked[sq] = 2;
            state.moveLog.push({ san: '🔥' + sq, color });
            delete state.fireAura[sq];
          }
        } else {
          state.fireAura[sq] = { turns: 1, sig, color };
        }
      }
    }
  }

  // ── Leaping Pawns ────────────────────────────────────────────────────────
  function generateLeapingMoves(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const dir = color === 'w' ? 1 : -1;
    const target = frToSq(f, r + 2 * dir);
    const res = [];
    if (target && isEmpty(state, target)) {
      const isPromo = (color === 'w' && target[1] === '8') || (color === 'b' && target[1] === '1');
      res.push({ from: sq, to: target, special: 'leap', promotion: isPromo ? 'q' : undefined, needsPromo: isPromo });
    }
    return res;
  }

  function generateKingsPawnMoves(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const res = [];
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const target = frToSq(f + df, r + dr);
        if (target && isEmpty(state, target)) {
          const isPromo = (color === 'w' && target[1] === '8') || (color === 'b' && target[1] === '1');
          res.push({ from: sq, to: target, special: 'kingstep', promotion: isPromo ? 'q' : undefined, needsPromo: isPromo });
        }
      }
    }
    return res;
  }

  function generateGuardsmenMoves(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const dir = color === 'w' ? 1 : -1;
    const startRank = color === 'w' ? 1 : 6;
    const res = generateKingsPawnMoves(state, sq, color);
    const kingsguard = has(state, color, 'kingsguard');

    const oneAhead = frToSq(f, r + dir);
    const twoAhead = frToSq(f, r + 2 * dir);
    if (r === startRank && oneAhead && twoAhead && isEmpty(state, oneAhead) && isEmpty(state, twoAhead)) {
      res.push({ from: sq, to: twoAhead, special: 'guardsmenLeap' });
    }
    // Kingsguard: capture on any of the 8 adjacent squares, same as a king —
    // otherwise only the two forward diagonals.
    const captureDirs = kingsguard
      ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
      : [[-1, dir], [1, dir]];
    for (const [df, dr] of captureDirs) {
      const target = frToSq(f + df, r + dr);
      if (!target) continue;
      const tp = pieceAt(state, target);
      if (tp && tp.color !== color) {
        const promo = isPromoRank(color, r + dr);
        res.push({ from: sq, to: target, special: 'guardsmenCapture', captured: tp.type, promotion: promo ? 'q' : undefined, needsPromo: promo });
      }
    }
    return res;
  }

  // A spearman only ever moves or captures the single square straight ahead
  // (no diagonals, no charge) — but still double-steps from its start rank
  // onto open ground, same as a normal pawn.
  function generateSpearmanMoves(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const dir = color === 'w' ? 1 : -1;
    const startRank = color === 'w' ? 1 : 6;
    const res = [];

    const oneAhead = frToSq(f, r + dir);
    if (!oneAhead) return res;

    if (isEmpty(state, oneAhead)) {
      const promo = isPromoRank(color, r + dir);
      res.push({ from: sq, to: oneAhead, special: 'spearmanStep', promotion: promo ? 'q' : undefined, needsPromo: promo });
      if (r === startRank) {
        const twoAhead = frToSq(f, r + 2 * dir);
        if (twoAhead && isEmpty(state, twoAhead)) {
          res.push({ from: sq, to: twoAhead, special: 'spearmanLeap' });
        }
      }
    } else {
      const tp = pieceAt(state, oneAhead);
      if (tp && tp.color !== color) {
        const promo = isPromoRank(color, r + dir);
        res.push({ from: sq, to: oneAhead, special: 'spearmanCapture', captured: tp.type, promotion: promo ? 'q' : undefined, needsPromo: promo });
      }
    }
    return res;
  }

  // A Spearman braces its pike forward: any unit that captures it by moving
  // in from the square directly ahead of it (adjacent, same file, melee —
  // not a ranged shot or a charge over two squares) is impaled and dies too.
  function isSpearmanImpaled(state, m, color) {
    if (!m.captured || m.captured !== 'p') return false;
    const enemyColor = color === 'w' ? 'b' : 'w';
    if (figurePawnType(state, enemyColor) !== 'spearman') return false;
    const from = sqToFR(m.from), to = sqToFR(m.to);
    if (from.f !== to.f) return false;
    const spearDir = enemyColor === 'w' ? 1 : -1;
    // Any distance along the file counts, as long as the captor approached
    // from the spearman's forward side — a queen or rook sliding down the
    // whole board, or a ghoul's charge, impales itself just as surely as an
    // adjacent step does. The move was already generated as legal, so the
    // path between from/to is guaranteed clear.
    return Math.sign(from.r - to.r) === spearDir;
  }

  function generateTowerEntryMoves(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const res = [];
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const target = frToSq(f + df, r + dr);
        if (!target) continue;
        if (state.mannedTowers[target]) continue;
        const tp = pieceAt(state, target);
        if (!tp || tp.color !== color || tp.type !== 'r') continue;
        res.push({ from: sq, to: target, special: 'towerEnter' });
      }
    }
    return res;
  }

  function generateMountMoves(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const res = [];
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const target = frToSq(f + df, r + dr);
        if (!target) continue;
        const tp = pieceAt(state, target);
        if (tp && tp.color === color && tp.type === 'n') res.push({ from: sq, to: target, special: 'mount' });
      }
    }
    return res;
  }

  function generateMountedKingMoves(state, sq, color) {
    const { f, r } = sqToFR(sq);
    const deltas = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
    const res = [];
    for (const [df, dr] of deltas) {
      const target = frToSq(f + df, r + dr);
      if (!target) continue;
      if (isEmpty(state, target)) {
        res.push({ from: sq, to: target, special: 'mountedMove' });
      } else {
        const tp = pieceAt(state, target);
        if (tp && tp.color !== color) res.push({ from: sq, to: target, special: 'mountedMove', captured: tp.type });
      }
    }
    return res;
  }

  function generateExitMoves(state, sq) {
    const { f, r } = sqToFR(sq);
    const res = [];
    const type = (state.specialSelect && state.specialSelect.square === sq)
      ? state.specialSelect.type
      : (state.mannedTowers[sq] ? 'tower' : 'mount');
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const target = frToSq(f + df, r + dr);
        if (target && isEmpty(state, target)) {
          res.push({ from: sq, to: target, special: type === 'tower' ? 'towerLeave' : 'dismount' });
        }
      }
    }
    return filterIntoCheck(state, res, state.game.turn());
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CHECK DETECTION
  // ═══════════════════════════════════════════════════════════════════════
  function filterIntoCheck(state, moves, color) {
    const needsManualCheck = !!(state.mounted.w || state.mounted.b) || anyFigurePawnsInPlay(state) || anyFigureRooksInPlay(state) || anyFigureBishopsInPlay(state);
    return moves.filter(m => {
      if (m.standard && !needsManualCheck) return true;
      const snap = snapshotState(state);
      try {
        applyMoveToState(state, m, color, true);
        return !isKingAttacked(state, color);
      } finally {
        restoreSnapshot(state, snap);
      }
    });
  }

  function isKingAttacked(state, color) {
    const kingSq = state.mounted[color] || findKingSquare(state, color);
    if (!kingSq) return false;
    return squareAttackedBy(state, kingSq, color === 'w' ? 'b' : 'w');
  }

  function squareAttackedBy(state, sq, byColor) {
    const board = state.game.board();
    const { f: tf, r: tr } = sqToFR(sq);
    for (let br = 0; br < 8; br++) {
      for (let bf = 0; bf < 8; bf++) {
        const cell = board[br][bf];
        if (!cell || cell.color !== byColor) continue;
        const pf = bf, pr = 7 - br;
        const psq = frToSq(pf, pr);
        if (state.mounted[byColor] === psq && cell.type === 'k') {
          if (knightAttacks(pf, pr, tf, tr)) return true;
          continue;
        }
        if (attacksSquare(state, cell.type, cell.color, pf, pr, tf, tr)) return true;
      }
    }
    return false;
  }

  function knightAttacks(pf, pr, tf, tr) {
    const df = Math.abs(pf - tf), dr = Math.abs(pr - tr);
    return (df === 1 && dr === 2) || (df === 2 && dr === 1);
  }

  function attacksSquare(state, type, color, pf, pr, tf, tr) {
    const df = tf - pf, dr = tr - pr;
    const adf = Math.abs(df), adr = Math.abs(dr);
    switch (type) {
      case 'p': {
        const dir = color === 'w' ? 1 : -1;
        const figure = figurePawnType(state, color);
        if (figure === 'apprentice') return false;
        if (figure === 'archer') return dr === 2 * dir && adf <= 1;
        if (figure === 'ghoul') {
          const straight = adf === 0 && (dr === dir || dr === 2 * dir);
          const diag = has(state, color, 'deviant') && adf === adr && (adf === 1 || adf === 2) && dr === adf * dir;
          return straight || diag;
        }
        if (figure === 'spearman') return adf === 0 && dr === dir;
        if (figure === 'guardsman' && has(state, color, 'kingsguard')) return adf <= 1 && adr <= 1 && (adf + adr > 0);
        return dr === dir && adf === 1;
      }
      case 'n': return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
      case 'k': return adf <= 1 && adr <= 1 && (adf + adr > 0);
      case 'b': {
        if (figureBishopType(state, color) === 'longbowman') {
          return (adf === 2 && adr === 0) || (adf === 0 && adr === 2) || (adf === 2 && adr === 2);
        }
        return adf === adr && adf > 0 && clearPath(state, pf, pr, tf, tr);
      }
      case 'r': return !figureRookType(state, color) && ((df === 0) !== (dr === 0)) && clearPath(state, pf, pr, tf, tr);
      case 'q': return ((adf === adr && adf > 0) || ((df === 0) !== (dr === 0))) && clearPath(state, pf, pr, tf, tr);
    }
    return false;
  }

  function clearPath(state, pf, pr, tf, tr) {
    const sf = Math.sign(tf - pf), sr = Math.sign(tr - pr);
    let cf = pf + sf, cr = pr + sr;
    while (cf !== tf || cr !== tr) {
      const sq = frToSq(cf, cr);
      if (pieceAt(state, sq) || state.mannedTowers[sq]) return false;
      cf += sf; cr += sr;
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  STATE SNAPSHOT (for special-move check testing — NOT the undo stack;
  //  server-authoritative play has no client-side undo, see engine/index.js)
  // ═══════════════════════════════════════════════════════════════════════
  function snapshotState(state) {
    return {
      fen: state.game.fen(),
      mannedTowers: { ...state.mannedTowers },
      mounted: { ...state.mounted },
      specialSelect: state.specialSelect ? { ...state.specialSelect } : null,
      gameOver: state.gameOver, gameOverText: state.gameOverText,
      // applyMoveToState mutates this directly (no testOnly special-case,
      // same as mannedTowers/mounted above) — filterIntoCheck runs it
      // speculatively for every candidate move during legal-move generation,
      // so without snapshotting/restoring this too, just generating an
      // Apprentice's move list would silently corrupt which square is
      // flagged as "already used".
      apprenticeTeleportUsed: state.apprenticeTeleportUsed
        ? { w: { ...state.apprenticeTeleportUsed.w }, b: { ...state.apprenticeTeleportUsed.b } }
        : undefined,
    };
  }

  function restoreSnapshot(state, snap) {
    state.game.load(snap.fen);
    state.mannedTowers = { ...snap.mannedTowers };
    state.mounted = { ...snap.mounted };
    state.specialSelect = snap.specialSelect ? { ...snap.specialSelect } : null;
    state.gameOver = snap.gameOver;
    state.gameOverText = snap.gameOverText;
    if (snap.apprenticeTeleportUsed) state.apprenticeTeleportUsed = snap.apprenticeTeleportUsed;
  }

  function flipTurnFen(state, stripCastleColor, epTargetSquare) {
    const parts = state.game.fen().split(' ');
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    parts[3] = epTargetSquare || '-';
    if (stripCastleColor) {
      let castle = parts[2] === '-' ? '' : parts[2];
      if (stripCastleColor === 'w') castle = castle.replace(/[KQ]/g, '');
      else castle = castle.replace(/[kq]/g, '');
      parts[2] = castle || '-';
    }
    if (parts[1] === 'w') parts[5] = String(parseInt(parts[5]) + 1);
    return parts.join(' ');
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  MOVE EXECUTION
  // ═══════════════════════════════════════════════════════════════════════
  function applyMoveToState(state, m, color, testOnly) {
    // Whatever previously stood on m.to is being overwritten or captured —
    // any "already used Unstable Teleport" flag tied to that square is now
    // stale (the piece it belonged to is gone). A same-piece Apprentice step
    // re-adds its own flag at m.to just below if it had one, so this never
    // wipes out a legitimate carry-forward.
    if (state.apprenticeTeleportUsed) {
      delete state.apprenticeTeleportUsed.w[m.to];
      delete state.apprenticeTeleportUsed.b[m.to];
    }

    if (m.standard) {
      if (state.mannedTowers[m.to]) delete state.mannedTowers[m.to];
      const mv = { from: m.from, to: m.to };
      if (m.promotion) mv.promotion = m.promotion;
      state.game.move(mv);
      if (state.mannedTowers[m.from]) {
        const c = state.mannedTowers[m.from];
        delete state.mannedTowers[m.from];
        state.mannedTowers[m.to] = c;
      }
      return;
    }

    if (state.mannedTowers[m.to]) delete state.mannedTowers[m.to];
    clearMountedIfCaptured(state, m.to);

    const movedPiece = pieceAt(state, m.from);

    switch (m.special) {
      case 'leap':
      case 'kingstep':
      case 'apprenticeStep':
      case 'apprenticeLeap':
      case 'archerStep':
      case 'ghoulStep':
      case 'ghoulLeap':
      case 'ghoulCapture':
      case 'ghoulCharge':
      case 'ghoulDiagStep':
      case 'ghoulDiagLeap':
      case 'ghoulDiagCapture':
      case 'ghoulDiagCharge':
      case 'guardsmenLeap':
      case 'guardsmenCapture':
      case 'spearmanStep':
      case 'spearmanLeap':
      case 'spearmanCapture':
      case 'longbowmanStep': {
        if (m.captured) state.game.remove(m.to);
        const piece = pieceAt(state, m.from);
        state.game.remove(m.from);
        const placeType = m.promotion ? m.promotion : piece.type;
        state.game.put({ type: placeType, color }, m.to);
        break;
      }
      case 'archerShoot':
      case 'longbowmanShoot': {
        state.game.remove(m.to);
        break;
      }
      case 'towerEnter': {
        state.game.remove(m.from);
        state.mannedTowers[m.to] = color;
        break;
      }
      case 'towerLeave': {
        delete state.mannedTowers[m.from];
        state.game.put({ type: 'p', color }, m.to);
        break;
      }
      case 'mount': {
        state.game.remove(m.from);
        state.game.remove(m.to);
        state.game.put({ type: 'k', color }, m.to);
        state.mounted[color] = m.to;
        break;
      }
      case 'mountedMove': {
        if (m.captured) state.game.remove(m.to);
        state.game.remove(m.from);
        state.game.put({ type: 'k', color }, m.to);
        state.mounted[color] = m.to;
        break;
      }
      case 'dismount': {
        state.game.remove(m.from);
        state.game.put({ type: 'n', color }, m.from);
        state.game.put({ type: 'k', color }, m.to);
        state.mounted[color] = null;
        break;
      }
      case 'genericStep': {
        if (m.captured) state.game.remove(m.to);
        state.game.remove(m.from);
        const placeType = m.promotion ? m.promotion : movedPiece.type;
        state.game.put({ type: placeType, color }, m.to);
        if (state.mannedTowers[m.from]) {
          const c = state.mannedTowers[m.from];
          delete state.mannedTowers[m.from];
          state.mannedTowers[m.to] = c;
        }
        break;
      }
      case 'epCapture': {
        const capSq = frToSq(sqToFR(m.to).f, sqToFR(m.from).r);
        if (pieceAt(state, capSq)) state.game.remove(capSq);
        state.game.remove(m.from);
        state.game.put({ type: 'p', color }, m.to);
        break;
      }
      case 'castleK':
      case 'castleQ': {
        const rank = color === 'w' ? '1' : '8';
        const rookFrom = (m.special === 'castleK' ? 'h' : 'a') + rank;
        const rookTo = (m.special === 'castleK' ? 'f' : 'd') + rank;
        state.game.remove(m.from);
        state.game.remove(rookFrom);
        state.game.put({ type: 'k', color }, m.to);
        state.game.put({ type: 'r', color }, rookTo);
        break;
      }
    }

    // Carry the "already used Unstable Teleport" flag forward across a
    // normal Apprentice move — these are the only two ways an Apprentice's
    // own square changes outside of Unstable Teleport itself. Promoting
    // (m.promotion set) turns it into a Queen, so the flag is dropped rather
    // than carried — the ability's own type check would ignore it anyway,
    // but there's no reason to keep a dead entry around.
    if ((m.special === 'apprenticeStep' || m.special === 'apprenticeLeap') && state.apprenticeTeleportUsed) {
      const wasUsed = state.apprenticeTeleportUsed[color][m.from];
      delete state.apprenticeTeleportUsed[color][m.from];
      if (wasUsed && !m.promotion) state.apprenticeTeleportUsed[color][m.to] = true;
    }

    let stripCastleColor = null;
    let epTargetSquare = null;
    if (m.special === 'mount' || m.special === 'mountedMove' || m.special === 'dismount' ||
        m.special === 'castleK' || m.special === 'castleQ') {
      stripCastleColor = color;
    } else if (m.special === 'genericStep' && movedPiece) {
      if (movedPiece.type === 'k') stripCastleColor = color;
      else if (movedPiece.type === 'r' && ['a1', 'h1', 'a8', 'h8'].includes(m.from)) stripCastleColor = color;
      else if (movedPiece.type === 'p') {
        const fromR = sqToFR(m.from).r, toR = sqToFR(m.to).r;
        if (Math.abs(toR - fromR) === 2) epTargetSquare = frToSq(sqToFR(m.from).f, (fromR + toR) / 2);
      }
    }
    state.game.load(flipTurnFen(state, stripCastleColor, epTargetSquare));
  }

  function describeMove(m, piece) {
    if (m.special === 'towerEnter') return '⌂' + m.to;
    if (m.special === 'towerLeave') return m.to + '↑';
    if (m.special === 'mount') return 'K♞' + m.to;
    if (m.special === 'dismount') return 'K↓' + m.to;
    if (m.special === 'mountedMove') return '♞' + m.to;
    if (m.special === 'archerShoot' || m.special === 'longbowmanShoot') return '⇒' + m.to;
    if (m.special === 'castleK') return 'O-O';
    if (m.special === 'castleQ') return 'O-O-O';
    const p = piece && piece.type !== 'p' ? piece.type.toUpperCase() : '';
    const cap = m.captured ? 'x' : '';
    return p + cap + m.to;
  }

  // Finds+validates the move a client asked for (by from/to/promotion) against
  // the CURRENT legal move list — the server never trusts a client-provided
  // move object wholesale, only the from/to/promotion intent.
  function findRequestedMove(state, color, from, to, promotionChoice) {
    if (state.gameOver) return 'Game is over';
    if (state.pendingStunlock) return 'A Stunlock cast is pending — resolve it first';
    if (color !== state.game.turn()) return 'Not your turn';
    const piece = pieceAt(state, from);
    if (!piece || piece.color !== color) return 'No piece of yours there';
    if (state.ghoulBrokeRank[color].includes(from)) {
      return 'This Ghoul already broke rank this turn';
    }
    if (state.solarStrikeCastThisTurn && piece.type === 'q') {
      return 'The Queen cannot move the same turn Solar Strike was cast';
    }
    const legal = generateMoves(state, from);
    const move = legal.find(m => m.to === to);
    if (!move) return 'Illegal move';
    if (move.needsPromo && !promotionChoice) return 'A promotion piece is required';
    return move;
  }

  // The full authoritative move-application pipeline (mirrors app.js's
  // executeMove) minus anything DOM/render-only. Mutates `state`. Returns
  // `{ pendingTargeting }` where pendingTargeting is `{kind:'stunlock', bishopSq}`
  // if this move armed-and-triggered a stunlock cast, else null — the caller
  // (engine/index.js) decides what happens next (enter targeting vs. proceed
  // straight to Breaking Rank + game-over evaluation).
  function executeMove(state, color, move, promotionChoice) {
    const fromPiece = pieceAt(state, move.from);
    const m = { ...move };
    if (promotionChoice) m.promotion = promotionChoice;

    const impaled = isSpearmanImpaled(state, m, color);

    applyMoveToState(state, m, color, false);

    if (impaled) {
      if (state.mannedTowers[m.to]) delete state.mannedTowers[m.to];
      clearMountedIfCaptured(state, m.to);
      if (pieceAt(state, m.to)) state.game.remove(m.to);
    }

    if (m.special && m.special.indexOf('ghoul') === 0) {
      state.ghoulJustMoved[color] = state.ghoulJustMoved[color].filter(sq => sq !== m.from);
      state.ghoulJustMoved[color].push(m.to);
    }

    tickStunCounters(state);
    tickSolarMarks(state);

    // A Longbowman's shot doesn't relocate it — its charge (if any) stays put
    // rather than transferring to the (now-emptied) target square.
    const bishopFinalSq = m.special === 'longbowmanShoot' ? m.from : m.to;

    let pendingTargeting = null;
    if (!impaled && fromPiece && fromPiece.type === 'b' && has(state, color, 'stunlock')) {
      const hadCharge = state.stunlockCharges[color][m.from];
      const wasArmed = !!(state.armedAbility && state.armedAbility.id === 'stunlock' && state.armedAbility.unitSq === m.from);
      delete state.stunlockCharges[color][m.from];
      if (hadCharge) {
        state.stunlockCharges[color][bishopFinalSq] = true;
        if (wasArmed) {
          state.pendingStunlock = { color, bishopSq: bishopFinalSq };
          pendingTargeting = { kind: 'stunlock', bishopSq: bishopFinalSq };
        }
      }
    }
    // A Queen can't be the move that ends a turn in which Solar Strike was
    // cast — findRequestedMove rejects that before we ever get here.
    // armedAbility is cleared either way since any move consumes/invalidates
    // it, and the per-turn Solar Strike flag resets now that a (non-Queen)
    // move has actually completed the turn.
    state.armedAbility = null;
    state.solarStrikeCastThisTurn = false;

    state.moveLog.push({ san: describeMove(m, fromPiece) + (impaled ? '💀' : ''), color });
    state.lastMove = { from: m.from, to: m.to };
    state.specialSelect = null;

    return { pendingTargeting };
  }

  function tickStunCounters(state) {
    for (const sq of Object.keys(state.stunnedSquares)) {
      state.stunnedSquares[sq]--;
      if (state.stunnedSquares[sq] <= 0) delete state.stunnedSquares[sq];
    }
  }

  function tickSolarMarks(state) {
    for (const sq of Object.keys(state.solarMarked)) {
      state.solarMarked[sq]--;
      if (state.solarMarked[sq] <= 0) {
        delete state.solarMarked[sq];
        if (state.mannedTowers[sq]) delete state.mannedTowers[sq];
        clearMountedIfCaptured(state, sq);
        if (pieceAt(state, sq)) {
          state.game.remove(sq);
          state.fireDeathMarked[sq] = 2;
        }
      }
    }
  }

  // Ticked once per completed turn (see engine/index.js's afterTurnSettles,
  // called after every move AND every turn-consuming ability cast) — set to
  // 2 by castUnstableTeleport so it survives the immediate afterTurnSettles
  // right after the cast itself and only clears once the opponent's
  // following turn has also completed. Purely cosmetic; nothing else reads it.
  function tickTeleportMarks(state) {
    for (const sq of Object.keys(state.teleportMarked)) {
      state.teleportMarked[sq]--;
      if (state.teleportMarked[sq] <= 0) delete state.teleportMarked[sq];
    }
  }

  // Same ticking pattern/duration as tickTeleportMarks — see afterTurnSettles
  // in engine/index.js for why 2 lands as "one turn" of visibility.
  function tickFireDeathMarks(state) {
    for (const sq of Object.keys(state.fireDeathMarked)) {
      state.fireDeathMarked[sq]--;
      if (state.fireDeathMarked[sq] <= 0) delete state.fireDeathMarked[sq];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  WIRE SERIALIZATION
  // ═══════════════════════════════════════════════════════════════════════
  // `state.game` is a chess.js Chess() instance: its board/turn/FEN live in
  // closure variables only reachable through methods (fen(), turn(), ...),
  // and JSON.stringify silently drops function-valued properties — broadcast
  // the raw state object and every client would receive an empty `game: {}`.
  // Everything else on `state` is already plain data. Server-side code keeps
  // using the live `state.game` instance directly; only the outgoing wire
  // payload needs this transform.
  function serializeState(state) {
    if (!state.game) return state;
    return {
      ...state,
      game: {
        fen: state.game.fen(),
        turn: state.game.turn(),
        inCheck: state.game.in_check(),
        inCheckmate: state.game.in_checkmate(),
        inStalemate: state.game.in_stalemate(),
        inDraw: state.game.in_draw(),
        board: state.game.board(),
      },
    };
  }

  const exportsObj = {
    newGame, has, figurePawnType, anyFigurePawnsInPlay, figureRookType, anyFigureRooksInPlay,
    figureBishopType, anyFigureBishopsInPlay,
    sqToFR, frToSq, isEmpty, pieceAt, findKingSquare, isPromoRank,
    generateMoves, dedupeMoves, generateExitMoves,
    generateApprenticeMoves, generateArcherMoves, generateGhoulMoves, generateGuardsmenMoves,
    generateSpearmanMoves, generateTrollMoves, generateLongbowmanMoves, isSpearmanImpaled,
    archerShootRangeSquares, longbowShootRangeSquares, ghoulChargeSquares, ghoulLegalChargeTargets,
    generateLeapingMoves, generateKingsPawnMoves, generateTowerEntryMoves,
    generateMountMoves, generateMountedKingMoves,
    filterIntoCheck, isKingAttacked, squareAttackedBy, attacksSquare, clearPath,
    applyMoveToState, executeMove, describeMove, findRequestedMove, flipTurnFen,
    checkBreakingRank, applyBreakingRankCaptures, clearMountedIfCaptured,
    tickStunCounters, tickSolarMarks, tickTeleportMarks, tickFireDeathMarks,
    kingAuraSquares, checkKingsLightning, checkRingOfFire,
    snapshotState, restoreSnapshot,
    serializeState,
  };

  if (isNode) module.exports = exportsObj;
  else Object.assign(root, exportsObj);
})(typeof window !== 'undefined' ? window : globalThis);
