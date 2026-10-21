/**
 * engine/augments-engine.js — Unit/global ability logic: what's available to
 * arm/cast for a given piece, and the Stunlock/Solar Strike cast mechanics
 * themselves. State-threaded port of the non-DOM parts of stunlock.js,
 * abilities.js, and solarstrike.js.
 *
 * Stunlock needs two round trips (arm before/during the bishop's move, cast
 * the quadrant after it lands, since the final square determines the
 * options). Solar Strike is a single round trip — it resolves immediately
 * against the Queen's CURRENT square, no move involved — so it only ever
 * goes through castAbility, never armAbility.
 *
 * Depends on: engine/chess-engine.js.
 */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const chessEngine = isNode ? require('./chess-engine.js') : root;
  const { sqToFR, frToSq, pieceAt, has, isEmpty, isPromoRank, flipTurnFen, clearMountedIfCaptured, figurePawnType, kingAuraSquares, findKingSquare,
    unitName, unitAt, unitsIn, listUnits, pluralUnit, logEntry } = chessEngine;

  // "e1 King" — the acting unit on its own square, as the history names it
  // (see the history scheme in chess-engine.js).
  function actor(state, color, sq, type) {
    return `${sq} ${unitName(state, color, type)}`;
  }

  function kingSquare(state, color) {
    return state.mounted[color] || findKingSquare(state, color);
  }

  // "d5–e6" for a block of squares (its two opposite corners).
  function areaLabel(squares) {
    return squares[0] + '–' + squares[squares.length - 1];
  }

  // ── Stunlock ──────────────────────────────────────────────────────────
  function getStunlockQuadrants(bishopSq) {
    const { f: bf, r: br } = sqToFR(bishopSq);
    const results = [];
    for (let f = Math.max(0, bf - 2); f <= Math.min(6, bf + 1); f++) {
      for (let r = Math.max(0, br - 2); r <= Math.min(6, br + 1); r++) {
        if (f + 1 >= bf - 1 && f <= bf + 1 && r + 1 >= br - 1 && r <= br + 1) {
          results.push({ f, r });
        }
      }
    }
    return results;
  }

  function quadrantSquares(f, r) {
    return [frToSq(f, r), frToSq(f + 1, r), frToSq(f, r + 1), frToSq(f + 1, r + 1)].filter(Boolean);
  }

  // `cornerSq` is the quadrant's top-left square, as chosen by the client.
  function castStunlock(state, color, cornerSq) {
    if (!state.pendingStunlock) return 'No Stunlock cast is pending';
    if (state.pendingStunlock.color !== color) return 'Not your cast to resolve';
    if (!cornerSq) return 'A quadrant is required';
    const { f, r } = sqToFR(cornerSq);
    const valid = getStunlockQuadrants(state.pendingStunlock.bishopSq).some(q => q.f === f && q.r === r);
    if (!valid) return 'That is not a valid quadrant for this bishop';

    const { bishopSq } = state.pendingStunlock;
    delete state.stunlockCharges[color][bishopSq];
    const squares = quadrantSquares(f, r);
    squares.forEach(sq => { state.stunnedSquares[sq] = 2; });
    const frozen = unitsIn(state, squares, color);
    logEntry(state, color, '⚡' + cornerSq, frozen.length
      ? `${actor(state, color, bishopSq, 'b')} froze ${listUnits(frozen)} (Stunlock on ${areaLabel(squares)}).`
      : `${actor(state, color, bishopSq, 'b')} cast Stunlock on ${areaLabel(squares)}, but froze nobody.`, 'event');
    state.pendingStunlock = null;
    return null;
  }

  function cancelStunlock(state, color) {
    if (!state.pendingStunlock) return 'No Stunlock cast is pending';
    if (state.pendingStunlock.color !== color) return 'Not your cast to cancel';
    state.pendingStunlock = null;
    return null;
  }

  // ── Solar Strike ──────────────────────────────────────────────────────
  // Valid 3×3 centers: within 2 squares (Chebyshev) of the queen, and far
  // enough from the edge that the full 3×3 stays on the board.
  function getSolarStrikeCenters(queenSq) {
    const { f: qf, r: qr } = sqToFR(queenSq);
    const centers = [];
    for (let f = 1; f <= 6; f++) {
      for (let r = 1; r <= 6; r++) {
        if (Math.max(Math.abs(f - qf), Math.abs(r - qr)) <= 2) centers.push({ f, r });
      }
    }
    return centers;
  }

  function solarStrikeSquares(f, r) {
    const squares = [];
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        const sq = frToSq(f + df, r + dr);
        if (sq) squares.push(sq);
      }
    }
    return squares;
  }

  // Resolves in one shot: the Queen's square + the chosen center. No arming
  // step — see file header for why this differs from Stunlock.
  function castSolarStrike(state, color, queenSq, centerSq) {
    if (state.gameOver) return 'Game is over';
    if (state.pendingStunlock) return 'A Stunlock cast is pending — resolve it first';
    if (color !== state.game.turn()) return 'Not your turn';
    if (!has(state, color, 'solarStrike')) return 'You do not have Solar Strike';
    if (state.solarStrikeCastThisTurn) return 'Already cast Solar Strike this turn';
    if (!queenSq || !centerSq) return 'A Queen square and a target center are required';
    const piece = pieceAt(state, queenSq);
    if (!piece || piece.color !== color || piece.type !== 'q') return 'That is not your Queen';
    const { f, r } = sqToFR(centerSq);
    const valid = getSolarStrikeCenters(queenSq).some(c => c.f === f && c.r === r);
    if (!valid) return 'That center is out of range';
    if (chessEngine.isVanguardFresh(state, color, queenSq)) return 'A Queen deployed by Vanguard has to move before she can cast Solar Strike';

    state.solarMarkedBy = state.solarMarkedBy || {};
    solarStrikeSquares(f, r).forEach(sq => { state.solarMarked[sq] = 2; state.solarMarkedBy[sq] = color; });
    logEntry(state, color, '☀' + centerSq, `${actor(state, color, queenSq, 'q')} marked ${areaLabel(solarStrikeSquares(f, r))} for a Solar Strike.`);
    state.solarStrikeCastThisTurn = true;
    state.armedAbility = null;
    return null;
  }

  // ── Advance ───────────────────────────────────────────────────────────
  // One-shot, once per game: every one of the caster's pawn-type units
  // steps one square forward, each independently, skipped if that square
  // isn't free. Consumes the turn immediately (no normal move follows) —
  // it flips state.game's turn itself via flipTurnFen, the same helper
  // custom (non-chess.js-move) special moves use, since no chess.js move()
  // is made here to do that flip for us. See castAbility dispatch in
  // engine/index.js for the afterTurnSettles() call this then needs.
  function castAdvance(state, color) {
    if (state.gameOver) return 'Game is over';
    if (color !== state.game.turn()) return 'Not your turn';
    if (!has(state, color, 'advance')) return 'You do not have Advance';
    if (state.advanceUsed[color]) return 'Advance has already been used this game';

    const dir = color === 'w' ? 1 : -1;
    const board = state.game.board();
    const steps = [];
    for (let br = 0; br < 8; br++) {
      for (let bf = 0; bf < 8; bf++) {
        const cell = board[br][bf];
        if (!cell || cell.color !== color || cell.type !== 'p') continue;
        const from = frToSq(bf, 7 - br);
        // Units sitting out White's first turn (Vanguard) stay put.
        if (state.vanguardLocked && state.vanguardLocked.includes(from)) continue;
        const to = frToSq(bf, 7 - br + dir);
        if (to && isEmpty(state, to)) steps.push({ from, to });
      }
    }
    steps.forEach(({ from, to }) => {
      state.game.remove(from);
      state.game.put({ type: isPromoRank(color, sqToFR(to).r) ? 'q' : 'p', color }, to);
    });

    state.advanceUsed[color] = true;
    const unit = unitName(state, color, 'p');
    logEntry(state, color, '⏫ Advance', steps.length
      ? `Advance: ${steps.length} ${steps.length === 1 ? unit : pluralUnit(unit)} moved forward.`
      : 'Advance: nobody had room to move.');
    state.game.load(flipTurnFen(state));
    return null;
  }

  // ── Silver Bullet ────────────────────────────────────────────────────
  // Valid targets: the first occupied square encountered along each of the
  // 8 rook/bishop directions out to 3 squares from the King, and only if
  // that unit is an enemy's — a friendly unit (or nothing) in the way just
  // blocks the line, same as a rook/bishop's line of sight.
  function getSilverBulletTargets(state, kingSq, color) {
    const { f: kf, r: kr } = sqToFR(kingSq);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const targets = [];
    for (const [df, dr] of dirs) {
      for (let dist = 1; dist <= 3; dist++) {
        const sq = frToSq(kf + df * dist, kr + dr * dist);
        if (!sq) break;
        if (isEmpty(state, sq)) continue;
        const piece = pieceAt(state, sq);
        if (piece && piece.color !== color) targets.push(sq);
        break;
      }
    }
    return targets;
  }

  // One-shot, once per game: strikes down a single enemy unit in range and
  // consumes the turn immediately (no normal move follows) — same
  // flipTurnFen approach as Advance, since no chess.js move() is made here
  // to do that flip for us. See castAbility dispatch in engine/index.js for
  // the afterTurnSettles() call this then needs.
  function castSilverBullet(state, color, kingSq, targetSq) {
    if (state.gameOver) return 'Game is over';
    if (color !== state.game.turn()) return 'Not your turn';
    if (!has(state, color, 'silverBullet')) return 'You do not have Silver Bullet';
    if (state.silverBulletUsed[color]) return 'Silver Bullet has already been used this game';
    if (!kingSq || !targetSq) return 'A King square and a target are required';
    const piece = pieceAt(state, kingSq);
    if (!piece || piece.color !== color || piece.type !== 'k') return 'That is not your King';
    const valid = getSilverBulletTargets(state, kingSq, color).includes(targetSq);
    if (!valid) return 'That target is out of range or not a valid line of sight';

    const victim = unitAt(state, targetSq, color);
    if (state.mannedTowers[targetSq]) delete state.mannedTowers[targetSq];
    delete state.mannedTowerOrigin[targetSq];
    clearMountedIfCaptured(state, targetSq);
    state.game.remove(targetSq);

    state.silverBulletUsed[color] = true;
    logEntry(state, color, '🎯' + kingSq + targetSq, `${actor(state, color, kingSq, 'k')} killed ${victim} (Silver Bullet).`);
    state.armedAbility = null;
    state.game.load(flipTurnFen(state));
    return null;
  }

  // ── Lightning Aura (King) ────────────────────────────────────────────────
  // One-shot, once per game: arms the King's permanent lightning aura. From
  // then on checkKingsLightning (chess-engine.js) enforces it at the end of
  // every turn, for the rest of the game — this function only flips the
  // switch. Consumes the turn immediately (no normal move follows) — same
  // flipTurnFen approach as Advance/Silver Bullet, since no chess.js move()
  // is made here to do that flip for us. See castAbility dispatch in
  // engine/index.js for the afterTurnSettles() call this then needs.
  function castKingsLightning(state, color, kingSq) {
    if (state.gameOver) return 'Game is over';
    if (color !== state.game.turn()) return 'Not your turn';
    if (!has(state, color, 'kingsLightning')) return 'You do not have Lightning Aura';
    if (!kingSq || kingSq !== kingSquare(state, color)) return 'Lightning Aura is cast from your King';
    if (state.lightningActive[color]) return 'Lightning Aura is already active';

    state.lightningActive[color] = true;
    logEntry(state, color, '🌩 Lightning Aura', `${actor(state, color, kingSquare(state, color), 'k')} cast Lightning Aura. Personal space enforced.`);
    state.armedAbility = null;
    state.game.load(flipTurnFen(state));
    return null;
  }

  // ── Ring of Fire (King) ──────────────────────────────────────────────────
  // Same activation as Lightning Aura — one-shot, once per game, no
  // targeting, consumes the turn immediately via flipTurnFen. checkRingOfFire
  // (chess-engine.js) then enforces the slower burn at the end of every turn
  // for the rest of the game. See castAbility dispatch in engine/index.js for
  // the afterTurnSettles() call this then needs.
  function castRingOfFire(state, color, kingSq) {
    if (state.gameOver) return 'Game is over';
    if (color !== state.game.turn()) return 'Not your turn';
    if (!has(state, color, 'ringOfFire')) return 'You do not have Ring of Fire';
    if (!kingSq || kingSq !== kingSquare(state, color)) return 'Ring of Fire is cast from your King';
    if (state.fireActive[color]) return 'Ring of Fire is already active';

    state.fireActive[color] = true;
    logEntry(state, color, '🔥 Ring of Fire', `${actor(state, color, kingSquare(state, color), 'k')} cast ${has(state, color, 'inferno') ? 'Inferno' : 'Ring of Fire'}.`);
    state.armedAbility = null;
    state.game.load(flipTurnFen(state));
    return null;
  }

  // ── Relentless Advance ───────────────────────────────────────────────────
  // Same activation as Lightning Aura/Ring of Fire — one-shot, once per
  // game, no targeting, consumes the turn immediately via flipTurnFen.
  // checkRelentlessAdvance (chess-engine.js) then nudges 2 random pawn-type
  // units forward at the end of every one of this color's own turns, for
  // the rest of the game. See castAbility dispatch in engine/index.js for
  // the afterTurnSettles() call this then needs.
  function castRelentlessAdvance(state, color) {
    if (state.gameOver) return 'Game is over';
    if (color !== state.game.turn()) return 'Not your turn';
    if (!has(state, color, 'relentlessAdvance')) return 'You do not have Relentless Advance';
    if (state.relentlessAdvanceActive[color]) return 'Relentless Advance is already active';

    state.relentlessAdvanceActive[color] = true;
    logEntry(state, color, '⏩ Relentless Advance', `Relentless Advance began: 2 ${pluralUnit(unitName(state, color, 'p'))} march every turn. No step back.`);
    state.armedAbility = null;
    state.game.load(flipTurnFen(state));
    return null;
  }

  // ── Raise the Dead (King, requires Ghouls) ─────────────────────────
  // Valid squares: any free square touching the King (kingAuraSquares), plus
  // — per file — the single free square nearest that color's own back rank
  // (walking up the file from home, the first free square found; everything
  // behind it is by definition occupied or the board edge). Never that
  // color's promotion rank — a raised Ghoul there could never move.
  function getRaiseTheDeadTargets(state, color) {
    const targets = new Set();
    const kingSq = findKingSquare(state, color);
    if (kingSq) {
      kingAuraSquares(kingSq).forEach(sq => { if (isEmpty(state, sq)) targets.add(sq); });
    }
    for (let f = 0; f < 8; f++) {
      for (let i = 0; i < 8; i++) {
        const sq = frToSq(f, color === 'w' ? i : 7 - i);
        if (isEmpty(state, sq)) { targets.add(sq); break; }
      }
    }
    return Array.from(targets).filter(sq => !isPromoRank(color, sqToFR(sq).r));
  }

  // Unlike every other ability, this one can resolve any number of times
  // before the turn actually ends: each successful raise stays armed
  // (state.pendingRaiseTheDead marks the session, mirroring
  // state.pendingStunlock) so the player can keep clicking valid squares.
  // The turn only actually ends — flipping state.game's turn via
  // flipTurnFen, same as Advance/Ring of Fire/Lightning Aura — once the
  // graveyard or the valid-target list runs dry (finishRaiseTheDeadTurn,
  // called automatically below) or the player ends it early via
  // endRaiseTheDead (the 'Z' key client-side). See castAbility dispatch in
  // engine/index.js for how it detects a turn-ending cast here (comparing
  // state.game.turn() before/after, since unlike the other turn-consuming
  // abilities this doesn't flip every single cast).
  function castRaiseTheDead(state, color, targetSq) {
    if (state.gameOver) return 'Game is over';
    if (color !== state.game.turn()) return 'Not your turn';
    if (!has(state, color, 'raiseTheDead')) return 'You do not have Raise the Dead';
    if (state.pendingRaiseTheDead && state.pendingRaiseTheDead.color !== color) return 'Not your turn';
    if (!state.pendingRaiseTheDead && state.turnNumber < state.raiseTheDeadCooldownUntil[color]) {
      return 'Raise the Dead is on cooldown';
    }
    if ((state.ghoulGraveyard[color] || 0) <= 0) return 'No dead Ghouls available to raise';
    if (!targetSq) return 'A target square is required';
    const validTargets = getRaiseTheDeadTargets(state, color);
    if (!validTargets.includes(targetSq)) return 'That is not a valid square to raise a Ghoul';

    // The first raise is the turn; more raises in the same session follow it.
    const continuing = !!state.pendingRaiseTheDead;
    state.game.put({ type: 'p', color }, targetSq);
    state.ghoulGraveyard[color]--;
    state.pendingRaiseTheDead = { color };
    logEntry(state, color, '💀' + targetSq, `${actor(state, color, kingSquare(state, color), 'k')} raised a Ghoul on ${targetSq}.`,
      continuing ? 'event' : 'turn');
    state.armedAbility = null;

    if (state.ghoulGraveyard[color] <= 0 || getRaiseTheDeadTargets(state, color).length === 0) {
      finishRaiseTheDeadTurn(state, color);
    }
    return null;
  }

  // The 'Z' key: end the turn early, keeping whatever's been raised so far.
  function endRaiseTheDead(state, color) {
    if (state.gameOver) return 'Game is over';
    if (!state.pendingRaiseTheDead || state.pendingRaiseTheDead.color !== color) return 'No Raise the Dead cast is pending';
    if (color !== state.game.turn()) return 'Not your turn';
    finishRaiseTheDeadTurn(state, color);
    return null;
  }

  // Shared by both the auto-exhaustion path in castRaiseTheDead and the
  // manual endRaiseTheDead: locks in a one-turn cooldown (state.turnNumber
  // is still at its pre-this-settle value here — see the comment on
  // state.turnNumber in newGame — so +4 lands exactly on this color's turn
  // after next: +1 for this turn settling, +1 for the opponent's reply,
  // +1 for this color's very next [blocked] turn, +1 for the opponent's
  // reply to that, landing on this color's following turn) and flips the
  // turn the same way Advance/Ring of Fire/Lightning Aura do.
  function finishRaiseTheDeadTurn(state, color) {
    state.raiseTheDeadCooldownUntil[color] = state.turnNumber + 4;
    state.pendingRaiseTheDead = null;
    state.game.load(flipTurnFen(state));
  }

  // ── Clubbing (Troll) ────────────────────────────────────────────────────
  // Aimed the same way as Stunlock — any 2×2 quadrant window overlapping the
  // Troll's own square, sliding freely rather than snapped to a fixed grid
  // — except a quadrant can never be chosen if it contains the Troll's own
  // square, nor if it only touches that square diagonally (i.e. it must
  // share the Troll's file or its rank, never neither).
  function getClubbingQuadrants(trollSq) {
    const { f: tf, r: tr } = sqToFR(trollSq);
    const results = [];
    for (let f = Math.max(0, tf - 2); f <= Math.min(6, tf + 1); f++) {
      for (let r = Math.max(0, tr - 2); r <= Math.min(6, tr + 1); r++) {
        const sharesFile = f <= tf && tf <= f + 1;
        const sharesRank = r <= tr && tr <= r + 1;
        if (sharesFile && sharesRank) continue; // would contain the Troll itself
        if (!sharesFile && !sharesRank) continue; // purely diagonal
        results.push({ f, r });
      }
    }
    return results;
  }

  // Every unit in the quadrant is killed regardless of color — clubbing is
  // indiscriminate, so it can hit friendly units caught in the blast too.
  // Like Advance/Silver Bullet, casting consumes the turn immediately (no
  // normal move follows) — it flips state.game's turn itself via
  // flipTurnFen since no chess.js move() happens here to do that for us.
  // Unlike those, it's not once-per-game: any Troll can club every turn.
  function castClubbing(state, color, trollSq, cornerSq) {
    if (state.gameOver) return 'Game is over';
    if (state.pendingStunlock) return 'A Stunlock cast is pending — resolve it first';
    if (color !== state.game.turn()) return 'Not your turn';
    if (!has(state, color, 'trolls')) return 'You do not have Troll Corps';
    if (!trollSq || !cornerSq) return 'A Troll and a target quadrant are required';
    const piece = pieceAt(state, trollSq);
    if (!piece || piece.color !== color || piece.type !== 'r') return 'That is not your Troll';
    const { f, r } = sqToFR(cornerSq);
    const valid = getClubbingQuadrants(trollSq).some(q => q.f === f && q.r === r);
    if (!valid) return 'That is not a valid quadrant for this Troll';

    const area = quadrantSquares(f, r);
    const smashed = unitsIn(state, area, color);
    area.forEach(sq => {
      if (state.mannedTowers[sq]) delete state.mannedTowers[sq];
      delete state.mannedTowerOrigin[sq];
      clearMountedIfCaptured(state, sq);
      if (pieceAt(state, sq)) state.game.remove(sq);
    });

    logEntry(state, color, '🔨' + cornerSq, smashed.length
      ? `${actor(state, color, trollSq, 'r')} killed ${listUnits(smashed)} (club).`
      : `${actor(state, color, trollSq, 'r')} clubbed ${areaLabel(area)}. Only air was harmed.`);
    state.armedAbility = null;
    state.game.load(flipTurnFen(state));
    return null;
  }

  // ── Unstable Fireball (Apprentice) ──────────────────────────────────────
  // Valid target: the square exactly 2 ahead of the Apprentice in its own
  // forward direction, but only if it holds an enemy unit AND the square 1
  // ahead (in between) is empty — a friendly or enemy unit standing in the
  // way blocks the line entirely, so there is never more than one target.
  function getFireballTargets(state, apprenticeSq, color) {
    const { f, r } = sqToFR(apprenticeSq);
    const dir = color === 'w' ? 1 : -1;
    const midSq = frToSq(f, r + dir);
    const targetSq = frToSq(f, r + 2 * dir);
    if (!midSq || !targetSq) return [];
    if (!isEmpty(state, midSq)) return [];
    const target = pieceAt(state, targetSq);
    if (!target || target.color === color) return [];
    return [targetSq];
  }

  // Unstable: 4/6 it works as intended (target dies), 1/6 the Apprentice
  // dies alongside its target, 1/6 the Apprentice dies and the target
  // survives. Like Clubbing, this is a per-unit ability with no once-per-game
  // limit — casting simply consumes the turn, same as Silver Bullet/Clubbing.
  function castUnstableFireball(state, color, apprenticeSq, targetSq) {
    if (state.gameOver) return 'Game is over';
    if (state.pendingStunlock) return 'A Stunlock cast is pending — resolve it first';
    if (color !== state.game.turn()) return 'Not your turn';
    if (!has(state, color, 'unstableFireball')) return 'You do not have Unstable Fireball';
    if (!apprenticeSq || !targetSq) return 'An Apprentice and a target are required';
    const piece = pieceAt(state, apprenticeSq);
    if (!piece || piece.color !== color || piece.type !== 'p' || figurePawnType(state, color) !== 'apprentice') {
      return 'That is not your Apprentice';
    }
    const valid = getFireballTargets(state, apprenticeSq, color).includes(targetSq);
    if (!valid) return 'That is not a valid Fireball target';

    const roll = Math.random();
    const killCaster = roll < 2 / 6; // covers both the 1/6 "both die" and 1/6 "caster only" bands
    const killTarget = roll < 1 / 6 || roll >= 2 / 6; // everything except the 1/6 "caster only" band
    const victim = unitAt(state, targetSq, color);

    if (killTarget) {
      if (state.mannedTowers[targetSq]) delete state.mannedTowers[targetSq];
      delete state.mannedTowerOrigin[targetSq];
      clearMountedIfCaptured(state, targetSq);
      state.game.remove(targetSq);
      state.fireDeathMarked[targetSq] = 2;
      // Drops a stale "already used Unstable Teleport" flag if the target
      // happened to be an enemy Apprentice — see applyMoveToState's own
      // version of this cleanup for the normal-move case.
      const enemyColor = color === 'w' ? 'b' : 'w';
      delete state.apprenticeTeleportUsed[enemyColor][targetSq];
    }
    if (killCaster) {
      if (state.mannedTowers[apprenticeSq]) delete state.mannedTowers[apprenticeSq];
      delete state.mannedTowerOrigin[apprenticeSq];
      clearMountedIfCaptured(state, apprenticeSq);
      state.game.remove(apprenticeSq);
      state.fireDeathMarked[apprenticeSq] = 2;
      delete state.apprenticeTeleportUsed[color][apprenticeSq];
    }

    let san = '🔥' + apprenticeSq + (killTarget ? 'x' : '-') + targetSq;
    if (killTarget && killCaster) san += ' (backfired!)';
    else if (!killTarget) san += ' (fizzled)';
    const caster = actor(state, color, apprenticeSq, 'p');
    const text = !killCaster ? `${caster} killed ${victim} (fireball).`
      : killTarget ? `${caster} killed ${victim} and itself (fireball backfired).`
      : `${caster} killed only itself (fireball fizzled).`;
    logEntry(state, color, san, text);
    state.lastMove = { from: apprenticeSq, to: targetSq };
    state.armedAbility = null;
    state.game.load(flipTurnFen(state));
    return null;
  }

  // ── Unstable Teleport (Apprentice) ──────────────────────────────────────
  // Valid targets: every free square on the board except the 2 rows closest
  // to the opponent's end (i.e. the Apprentice can never intentionally
  // teleport into the enemy's home territory).
  function getTeleportTargets(state, color) {
    const excludedRanks = color === 'w' ? [6, 7] : [0, 1];
    const targets = [];
    for (let f = 0; f <= 7; f++) {
      for (let r = 0; r <= 7; r++) {
        if (excludedRanks.includes(r)) continue;
        const sq = frToSq(f, r);
        if (isEmpty(state, sq)) targets.push(sq);
      }
    }
    return targets;
  }

  function freeNeighbours(state, sq) {
    const { f, r } = sqToFR(sq);
    const res = [];
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const n = frToSq(f + df, r + dr);
        if (n && isEmpty(state, n)) res.push(n);
      }
    }
    return res;
  }

  // Every free square on the board except the enemy's very last row (looser
  // than getTeleportTargets's 2-row exclusion — this is the "gone fully
  // haywire" fallback, not the intended landing zone).
  function freeSquaresExcludingEnemyLastRow(state, color) {
    const lastRow = color === 'w' ? 7 : 0;
    const targets = [];
    for (let f = 0; f <= 7; f++) {
      for (let r = 0; r <= 7; r++) {
        if (r === lastRow) continue;
        const sq = frToSq(f, r);
        if (isEmpty(state, sq)) targets.push(sq);
      }
    }
    return targets;
  }

  function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Unstable: 9/12 lands on the chosen field, 1/12 drifts to a random free
  // neighbour of it (or stays put if none are free), 1/12 scatters to a
  // random free square anywhere on the board (still never the enemy's very
  // last row), 1/12 the Apprentice is lost entirely. No once-per-game limit
  // — casting simply consumes the turn, same as Clubbing.
  function castUnstableTeleport(state, color, apprenticeSq, targetSq) {
    if (state.gameOver) return 'Game is over';
    if (state.pendingStunlock) return 'A Stunlock cast is pending — resolve it first';
    if (color !== state.game.turn()) return 'Not your turn';
    if (!has(state, color, 'unstableTeleport')) return 'You do not have Unstable Teleport';
    if (!apprenticeSq || !targetSq) return 'An Apprentice and a target field are required';
    const piece = pieceAt(state, apprenticeSq);
    if (!piece || piece.color !== color || piece.type !== 'p' || figurePawnType(state, color) !== 'apprentice') {
      return 'That is not your Apprentice';
    }
    if (state.apprenticeTeleportUsed[color][apprenticeSq]) return 'This Apprentice has already used Unstable Teleport';
    const valid = getTeleportTargets(state, color).includes(targetSq);
    if (!valid) return 'That is not a valid Teleport target';

    const roll = Math.random();
    let landingSq = targetSq;
    let outcome = 'intended';
    if (roll < 9 / 12) {
      landingSq = targetSq;
      outcome = 'intended';
    } else if (roll < 10 / 12) {
      const neighbours = freeNeighbours(state, targetSq);
      landingSq = neighbours.length ? randomPick(neighbours) : targetSq;
      outcome = 'drifted';
    } else if (roll < 11 / 12) {
      const pool = freeSquaresExcludingEnemyLastRow(state, color);
      landingSq = pool.length ? randomPick(pool) : targetSq;
      outcome = 'scattered';
    } else {
      landingSq = null;
      outcome = 'vanished';
    }

    if (state.mannedTowers[apprenticeSq]) delete state.mannedTowers[apprenticeSq];
    delete state.mannedTowerOrigin[apprenticeSq];
    clearMountedIfCaptured(state, apprenticeSq);
    state.game.remove(apprenticeSq);
    delete state.apprenticeTeleportUsed[color][apprenticeSq];
    if (landingSq) {
      const promo = isPromoRank(color, sqToFR(landingSq).r);
      state.game.put({ type: promo ? 'q' : 'p', color }, landingSq);
      // A promoted landing turns it into a Queen — no longer an Apprentice,
      // so there's nothing left to flag as "already used".
      if (!promo) state.apprenticeTeleportUsed[color][landingSq] = true;
    }
    // Blue ring around both the origin and landing square for one turn —
    // see tickTeleportMarks. On a vanish there's no landing square, so only
    // the origin gets ringed.
    state.teleportMarked[apprenticeSq] = 2;
    if (landingSq) state.teleportMarked[landingSq] = 2;

    // Note the outcome only when it actually changed the landing square —
    // the drifted/scattered fallback (no free square found) still lands
    // exactly on target, same as the intended outcome, and shouldn't be
    // flagged as unstable.
    let san = '✨' + apprenticeSq + (landingSq || '×');
    if (outcome === 'vanished') san += ' (vanished!)';
    else if (landingSq !== targetSq && outcome === 'drifted') san += ' (drifted)';
    else if (landingSq !== targetSq && outcome === 'scattered') san += ' (scattered)';
    const caster = actor(state, color, apprenticeSq, 'p');
    const text = !landingSq ? `${caster} teleported to nowhere (aimed at ${targetSq}).`
      : landingSq === targetSq ? `${caster} teleported to ${landingSq}.`
      : outcome === 'drifted' ? `${caster} mis-teleported to ${landingSq} (aimed at ${targetSq}).`
      : `${caster} mis-teleported far away to ${landingSq} (aimed at ${targetSq}).`;
    logEntry(state, color, san, text);
    state.lastMove = { from: apprenticeSq, to: landingSq || apprenticeSq };
    state.armedAbility = null;
    state.game.load(flipTurnFen(state));
    return null;
  }

  // ── Vanguard ────────────────────────────────────────────────────────────
  // Before White's first turn, the Vanguard owner moves any of their units
  // onto free squares of their Vanguard zone — all at once, in one action
  // (the plan is built client-side and stays hidden until it's sent).
  // `placements` may be empty (time ran out with nothing planned, or the
  // player chose not to deploy).
  function deployVanguard(state, color, placements) {
    if (!state.vanguard) return 'No Vanguard deployment is pending';
    if (state.vanguard.color !== color) return 'Not your Vanguard';
    if (!Array.isArray(placements)) return 'Placements must be a list';
    const zone = chessEngine.VANGUARD_ZONES[color];
    const froms = new Set(), tos = new Set();
    for (const p of placements) {
      if (!p || typeof p.from !== 'string' || typeof p.to !== 'string') return 'Malformed placement';
      const piece = pieceAt(state, p.from);
      if (!piece || piece.color !== color) return `No unit of yours on ${p.from}`;
      if (!zone.includes(p.to)) return `${p.to} is not one of your Vanguard squares`;
      if (!isEmpty(state, p.to)) return `${p.to} is not free`;
      if (froms.has(p.from) || tos.has(p.to)) return 'Each unit and each square can only be used once';
      froms.add(p.from); tos.add(p.to);
    }

    const moving = placements.map(p => ({ ...p, piece: pieceAt(state, p.from), name: actor(state, color, p.from, pieceAt(state, p.from).type) }));
    moving.forEach(p => state.game.remove(p.from));
    moving.forEach(p => {
      state.game.put({ type: p.piece.type, color }, p.to);
      // Per-square bookkeeping travels with the unit.
      for (const map of [state.stunlockCharges, state.ghoulSkin, state.apprenticeTeleportUsed]) {
        if (map && map[color] && p.from in map[color]) { map[color][p.to] = map[color][p.from]; delete map[color][p.from]; }
      }
    });

    // A King or Rook that left its home square can no longer castle.
    const parts = state.game.fen().split(' ');
    const at = (sq, type) => { const q = pieceAt(state, sq); return q && q.type === type && q.color === (sq[1] === '1' ? 'w' : 'b'); };
    const keep = { K: at('e1', 'k') && at('h1', 'r'), Q: at('e1', 'k') && at('a1', 'r'), k: at('e8', 'k') && at('h8', 'r'), q: at('e8', 'k') && at('a8', 'r') };
    parts[2] = parts[2].split('').filter(c => keep[c]).join('') || '-';
    state.game.load(parts.join(' '));

    logEntry(state, color, '⚔' + moving.map(p => p.from + p.to).join(','), moving.length
      ? `Vanguard: ${moving.map(p => `${p.name} moved to ${p.to}`).join(', ')}.`
      : 'Vanguard: nobody stepped forward.', 'event');
    // White's deployed units sit out White's first turn.
    state.vanguardLocked = color === 'w' && moving.length ? moving.map(p => p.to) : null;
    state.vanguardGrace = moving.length ? (color === 'w' ? 'b' : 'w') : null;
    state.vanguardFresh = state.vanguardFresh || { w: [], b: [] };
    state.vanguardFresh[color] = moving.map(p => ({ sq: p.to, type: p.piece.type }));
    state.vanguard = null;
    return null;
  }

  // ── Generic ability listing/dispatch ───────────────────────────────────
  // Up to 4 unit abilities available for the piece on `sq` right now, in the
  // order they'd occupy Q/W/E/R. Only Apprentices with both Unstable
  // Fireball and Unstable Teleport can ever have more than one at once
  // (every other type is mutually exclusive by piece.type).
  const UNIT_KEYS = ['Q', 'W', 'E', 'R'];
  function unitAbilitiesFor(state, sq) {
    const piece = pieceAt(state, sq);
    if (!piece) return [];
    const list = [];
    if (piece.type === 'b' && has(state, piece.color, 'stunlock') && state.stunlockCharges[piece.color][sq]) {
      list.push({ id: 'stunlock', key: 'Q' });
    }
    if (piece.type === 'q' && has(state, piece.color, 'solarStrike') && !state.solarStrikeCastThisTurn &&
        !chessEngine.isVanguardFresh(state, piece.color, sq)) {
      list.push({ id: 'solarStrike', key: 'Q' });
    }
    if (piece.type === 'k') {
      // The King's slots are fixed — Q Silver Bullet, W Lightning Aura,
      // E Ring of Fire, R Raise the Dead — so each key always means the same
      // thing. Slot assignment elsewhere (abilities.js) is purely positional,
      // hence the null padding; trailing nulls are trimmed below. An aura
      // that's already burning stays in its slot as a passive reminder.
      const c = piece.color;
      const king = [null, null, null, null];
      if (has(state, c, 'silverBullet') && !state.silverBulletUsed[c]) king[0] = { id: 'silverBullet', key: 'Q' };
      if (has(state, c, 'kingsLightning')) {
        king[1] = state.lightningActive[c] ? { id: 'kingsLightning', key: 'W', passive: true } : { id: 'kingsLightning', key: 'W' };
      }
      if (has(state, c, 'ringOfFire')) {
        king[2] = state.fireActive[c] ? { id: 'ringOfFire', key: 'E', passive: true } : { id: 'ringOfFire', key: 'E' };
      }
      if (has(state, c, 'raiseTheDead') && (state.ghoulGraveyard[c] || 0) > 0 &&
          state.turnNumber >= state.raiseTheDeadCooldownUntil[c]) {
        king[3] = { id: 'raiseTheDead', key: 'R' };
      }
      while (king.length && !king[king.length - 1]) king.pop();
      list.push(...king);
    }
    if (piece.type === 'r' && has(state, piece.color, 'trolls')) {
      list.push({ id: 'clubbing', key: 'Q' });
    }
    if (piece.type === 'p' && figurePawnType(state, piece.color) === 'apprentice') {
      if (has(state, piece.color, 'unstableFireball')) list.push({ id: 'unstableFireball', key: UNIT_KEYS[list.length] });
      if (has(state, piece.color, 'unstableTeleport') && !state.apprenticeTeleportUsed[piece.color][sq]) {
        list.push({ id: 'unstableTeleport', key: UNIT_KEYS[list.length] });
      }
    }
    return list;
  }

  // Unit abilities this unit can cast right now, for the board's "ready"
  // markers. Clubbing and Unstable Fireball never run out, so marking them
  // would just badge every Troll/Apprentice for the whole game.
  const ALWAYS_READY_ABILITIES = ['clubbing', 'unstableFireball'];
  function readyAbilityMarkers(state, sq) {
    return unitAbilitiesFor(state, sq)
      .filter(a => a && !a.passive && !ALWAYS_READY_ABILITIES.includes(a.id))
      .map(a => a.id);
  }

  // Global (non-unit) abilities standing for `color` right now: Breaking
  // Rank is a passive reminder (never armed/cast), Advance casts directly
  // (like Solar Strike) as long as it hasn't been used yet this game.
  function globalAbilitiesFor(state, color) {
    const list = [];
    if (has(state, color, 'breakingRank')) list.push({ id: 'breakingRank', passive: true });
    if (has(state, color, 'coronation')) list.push({ id: 'coronation', passive: true });
    if (has(state, color, 'advance') && !state.advanceUsed[color]) list.push({ id: 'advance' });
    if (has(state, color, 'relentlessAdvance')) {
      list.push(state.relentlessAdvanceActive[color] ? { id: 'relentlessAdvance', passive: true } : { id: 'relentlessAdvance' });
    }
    if (has(state, color, 'warmWelcome')) list.push({ id: 'warmWelcome', passive: true });
    return list;
  }

  // Arms a "resolves after a later move" ability (currently only Stunlock).
  // Solar Strike resolves immediately via castAbility and never arms.
  function armAbility(state, color, key, unitSq) {
    if (state.gameOver) return 'Game is over';
    if (state.pendingStunlock) return 'A Stunlock cast is pending — resolve it first';
    if (color !== state.game.turn()) return 'Not your turn';
    if (state.pendingSwiftMove) return 'Resolve the Swift follow-up move first';
    const piece = pieceAt(state, unitSq);
    if (!piece || piece.color !== color) return 'Not your piece';
    // Null-safe: Raise the Dead pads the King's list with nulls to land on R.
    const ability = unitAbilitiesFor(state, unitSq).find(a => a && a.key === key);
    if (!ability) return 'No ability there to arm';
    if (ability.id !== 'stunlock') return 'That ability casts directly and does not arm';

    if (state.armedAbility && state.armedAbility.key === key && state.armedAbility.unitSq === unitSq) {
      state.armedAbility = null; // toggle off
    } else {
      state.armedAbility = { id: ability.id, unitSq, key };
    }
    return null;
  }

  function castAbility(state, color, id, params) {
    params = params || {};
    // Raise the Dead holds a turn open across multiple casts (see
    // castRaiseTheDead) — nothing else should be castable mid-session.
    if (state.pendingRaiseTheDead && id !== 'raiseTheDead') {
      return 'A Raise the Dead cast is pending — resolve it first';
    }
    // Same for a pending Swift follow-up step (see executeMove) — a
    // turn-consuming cast here would flip the turn with it still pending.
    if (state.pendingSwiftMove) return 'Resolve the Swift follow-up move first';
    if (id === 'stunlock') return castStunlock(state, color, params.center);
    if (id === 'solarStrike') return castSolarStrike(state, color, params.unitSq, params.center);
    if (id === 'advance') return castAdvance(state, color);
    if (id === 'kingsLightning') return castKingsLightning(state, color, params.unitSq);
    if (id === 'ringOfFire') return castRingOfFire(state, color, params.unitSq);
    if (id === 'relentlessAdvance') return castRelentlessAdvance(state, color);
    if (id === 'silverBullet') return castSilverBullet(state, color, params.unitSq, params.center);
    if (id === 'clubbing') return castClubbing(state, color, params.unitSq, params.quadrant);
    if (id === 'unstableFireball') return castUnstableFireball(state, color, params.unitSq, params.center);
    if (id === 'unstableTeleport') return castUnstableTeleport(state, color, params.unitSq, params.center);
    if (id === 'raiseTheDead') return castRaiseTheDead(state, color, params.target);
    return 'Unknown ability: ' + id;
  }

  // Abilities that spend the whole turn (no move follows) — engine/index.js
  // settles the turn right after one of these is cast.
  const TURN_CONSUMING_ABILITIES = ['advance', 'silverBullet', 'clubbing', 'unstableFireball', 'unstableTeleport', 'kingsLightning', 'ringOfFire', 'relentlessAdvance'];

  // Every concrete turn-ending ability cast `color` could make right now
  // (one action per valid target), in castAbility's params shape. Raise the
  // Dead is included as a single raise that ends the session.
  function turnEndingAbilityActions(state, color) {
    const actions = [];
    globalAbilitiesFor(state, color)
      .filter(a => !a.passive && TURN_CONSUMING_ABILITIES.includes(a.id))
      .forEach(a => actions.push({ id: a.id }));
    for (const sq of state.game.SQUARES) {
      const piece = pieceAt(state, sq);
      if (!piece || piece.color !== color) continue;
      for (const a of unitAbilitiesFor(state, sq)) {
        if (!a || a.passive) continue;
        if (a.id === 'kingsLightning' || a.id === 'ringOfFire') actions.push({ id: a.id, unitSq: sq });
        if (a.id === 'silverBullet') getSilverBulletTargets(state, sq, color).forEach(t => actions.push({ id: a.id, unitSq: sq, center: t }));
        if (a.id === 'clubbing') getClubbingQuadrants(sq).forEach(q => actions.push({ id: a.id, unitSq: sq, quadrant: frToSq(q.f, q.r) }));
        if (a.id === 'unstableFireball') getFireballTargets(state, sq, color).forEach(t => actions.push({ id: a.id, unitSq: sq, center: t }));
        if (a.id === 'unstableTeleport') getTeleportTargets(state, color).forEach(t => actions.push({ id: a.id, unitSq: sq, center: t }));
        if (a.id === 'raiseTheDead') getRaiseTheDeadTargets(state, color).forEach(t => actions.push({ id: a.id, target: t }));
      }
    }
    return actions;
  }

  // Same rule as for moves (see kingSurvivesMove in chess-engine.js): plays
  // the cast out on a copy, including the turn's countdowns and Lightning
  // Aura, and returns null if `color`'s King survives it uncapturable — else
  // the reason it can't be cast. Dice abilities (Unstable Fireball/Teleport)
  // are judged by their intended outcome: luck can still spoil a cast, but a
  // player may always try one that works as aimed.
  function abilityKingSafetyError(state, color, action) {
    const sim = chessEngine.cloneForSimulation(state);
    const random = Math.random;
    Math.random = () => 0.5; // the "works as intended" band of every roll
    try {
      const err = castAbility(sim, color, action.id, action);
      if (err) return err;
      if (sim.pendingRaiseTheDead) finishRaiseTheDeadTurn(sim, color);
      chessEngine.tickTurnWithoutMove(sim);
      chessEngine.checkKingsLightning(sim);
      return chessEngine.kingSafeOn(sim, color) ? null : 'That would leave your King open to capture';
    } finally {
      Math.random = random;
    }
  }

  // Declines a pending Swift follow-up move — the shot itself already
  // happened and held the turn open (see applyMoveToState in
  // chess-engine.js); declining just closes it out with the one flip that
  // was deferred, same as if Swift had never applied.
  function declineSwiftMove(state, color) {
    if (state.pendingSwiftMove.color !== color) return 'Not your move to decline';
    state.pendingSwiftMove = null;
    state.game.load(flipTurnFen(state));
    return null;
  }

  function cancelAbility(state, color) {
    if (state.pendingStunlock) return cancelStunlock(state, color);
    if (state.pendingSwiftMove) return declineSwiftMove(state, color);
    if (state.armedAbility && color === state.game.turn()) {
      state.armedAbility = null;
      return null;
    }
    return null; // nothing to cancel is not an error
  }

  const exportsObj = {
    getStunlockQuadrants, quadrantSquares, castStunlock, cancelStunlock,
    getSolarStrikeCenters, solarStrikeSquares, castSolarStrike, castAdvance,
    castKingsLightning, castRingOfFire, castRelentlessAdvance,
    getSilverBulletTargets, castSilverBullet,
    getClubbingQuadrants, castClubbing,
    getFireballTargets, castUnstableFireball,
    getTeleportTargets, castUnstableTeleport,
    getRaiseTheDeadTargets, castRaiseTheDead, endRaiseTheDead, deployVanguard,
    TURN_CONSUMING_ABILITIES, turnEndingAbilityActions, abilityKingSafetyError,
    unitAbilitiesFor, readyAbilityMarkers, globalAbilitiesFor, armAbility, castAbility, cancelAbility,
  };

  if (isNode) module.exports = exportsObj;
  else Object.assign(root, exportsObj);
})(typeof window !== 'undefined' ? window : globalThis);
