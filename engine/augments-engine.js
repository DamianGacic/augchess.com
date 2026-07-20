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
  const { sqToFR, frToSq, pieceAt, has, isEmpty, isPromoRank, flipTurnFen, clearMountedIfCaptured, figurePawnType } = chessEngine;

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
    quadrantSquares(f, r).forEach(sq => { state.stunnedSquares[sq] = 2; });
    state.moveLog.push({ san: '⚡' + cornerSq, color });
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

    solarStrikeSquares(f, r).forEach(sq => { state.solarMarked[sq] = 2; });
    state.moveLog.push({ san: '☀' + centerSq, color });
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
        const to = frToSq(bf, 7 - br + dir);
        if (to && isEmpty(state, to)) steps.push({ from, to });
      }
    }
    steps.forEach(({ from, to }) => {
      state.game.remove(from);
      state.game.put({ type: isPromoRank(color, sqToFR(to).r) ? 'q' : 'p', color }, to);
    });

    state.advanceUsed[color] = true;
    state.moveLog.push({ san: '⏫ Advance', color });
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

    if (state.mannedTowers[targetSq]) delete state.mannedTowers[targetSq];
    clearMountedIfCaptured(state, targetSq);
    state.game.remove(targetSq);

    state.silverBulletUsed[color] = true;
    state.moveLog.push({ san: '🎯' + kingSq + targetSq, color });
    state.armedAbility = null;
    state.game.load(flipTurnFen(state));
    return null;
  }

  // ── I Am Lightning (King) ────────────────────────────────────────────────
  // One-shot, once per game: arms the King's permanent lightning aura. From
  // then on checkKingsLightning (chess-engine.js) enforces it at the end of
  // every turn, for the rest of the game — this function only flips the
  // switch. Consumes the turn immediately (no normal move follows) — same
  // flipTurnFen approach as Advance/Silver Bullet, since no chess.js move()
  // is made here to do that flip for us. See castAbility dispatch in
  // engine/index.js for the afterTurnSettles() call this then needs.
  function castKingsLightning(state, color) {
    if (state.gameOver) return 'Game is over';
    if (color !== state.game.turn()) return 'Not your turn';
    if (!has(state, color, 'kingsLightning')) return 'You do not have I Am Lightning';
    if (state.lightningActive[color]) return 'I Am Lightning is already active';

    state.lightningActive[color] = true;
    state.moveLog.push({ san: '🌩 I Am Lightning', color });
    state.armedAbility = null;
    state.game.load(flipTurnFen(state));
    return null;
  }

  // ── Ring of Fire (King) ──────────────────────────────────────────────────
  // Same activation as I Am Lightning — one-shot, once per game, no
  // targeting, consumes the turn immediately via flipTurnFen. checkRingOfFire
  // (chess-engine.js) then enforces the slower burn at the end of every turn
  // for the rest of the game. See castAbility dispatch in engine/index.js for
  // the afterTurnSettles() call this then needs.
  function castRingOfFire(state, color) {
    if (state.gameOver) return 'Game is over';
    if (color !== state.game.turn()) return 'Not your turn';
    if (!has(state, color, 'ringOfFire')) return 'You do not have Ring of Fire';
    if (state.fireActive[color]) return 'Ring of Fire is already active';

    state.fireActive[color] = true;
    state.moveLog.push({ san: '🔥 Ring of Fire', color });
    state.armedAbility = null;
    state.game.load(flipTurnFen(state));
    return null;
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

    quadrantSquares(f, r).forEach(sq => {
      if (state.mannedTowers[sq]) delete state.mannedTowers[sq];
      clearMountedIfCaptured(state, sq);
      if (pieceAt(state, sq)) state.game.remove(sq);
    });

    state.moveLog.push({ san: '🔨' + cornerSq, color });
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

    if (killTarget) {
      if (state.mannedTowers[targetSq]) delete state.mannedTowers[targetSq];
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
      clearMountedIfCaptured(state, apprenticeSq);
      state.game.remove(apprenticeSq);
      state.fireDeathMarked[apprenticeSq] = 2;
      delete state.apprenticeTeleportUsed[color][apprenticeSq];
    }

    let san = '🔥' + apprenticeSq + (killTarget ? 'x' : '-') + targetSq;
    if (killTarget && killCaster) san += ' (backfired!)';
    else if (!killTarget) san += ' (fizzled)';
    state.moveLog.push({ san, color });
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
    state.moveLog.push({ san, color });
    state.lastMove = { from: apprenticeSq, to: landingSq || apprenticeSq };
    state.armedAbility = null;
    state.game.load(flipTurnFen(state));
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
    if (piece.type === 'q' && has(state, piece.color, 'solarStrike') && !state.solarStrikeCastThisTurn) {
      list.push({ id: 'solarStrike', key: 'Q' });
    }
    if (piece.type === 'k' && has(state, piece.color, 'silverBullet') && !state.silverBulletUsed[piece.color]) {
      list.push({ id: 'silverBullet', key: 'Q' });
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

  // Global (non-unit) abilities standing for `color` right now: Breaking
  // Rank is a passive reminder (never armed/cast), Advance casts directly
  // (like Solar Strike) as long as it hasn't been used yet this game.
  function globalAbilitiesFor(state, color) {
    const list = [];
    if (has(state, color, 'breakingRank')) list.push({ id: 'breakingRank', passive: true });
    if (has(state, color, 'advance') && !state.advanceUsed[color]) list.push({ id: 'advance' });
    if (has(state, color, 'kingsLightning')) {
      list.push(state.lightningActive[color] ? { id: 'kingsLightning', passive: true } : { id: 'kingsLightning' });
    }
    if (has(state, color, 'ringOfFire')) {
      list.push(state.fireActive[color] ? { id: 'ringOfFire', passive: true } : { id: 'ringOfFire' });
    }
    return list;
  }

  // Arms a "resolves after a later move" ability (currently only Stunlock).
  // Solar Strike resolves immediately via castAbility and never arms.
  function armAbility(state, color, key, unitSq) {
    if (state.gameOver) return 'Game is over';
    if (state.pendingStunlock) return 'A Stunlock cast is pending — resolve it first';
    if (color !== state.game.turn()) return 'Not your turn';
    const piece = pieceAt(state, unitSq);
    if (!piece || piece.color !== color) return 'Not your piece';
    const ability = unitAbilitiesFor(state, unitSq).find(a => a.key === key);
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
    if (id === 'stunlock') return castStunlock(state, color, params.center);
    if (id === 'solarStrike') return castSolarStrike(state, color, params.unitSq, params.center);
    if (id === 'advance') return castAdvance(state, color);
    if (id === 'kingsLightning') return castKingsLightning(state, color);
    if (id === 'ringOfFire') return castRingOfFire(state, color);
    if (id === 'silverBullet') return castSilverBullet(state, color, params.unitSq, params.center);
    if (id === 'clubbing') return castClubbing(state, color, params.unitSq, params.quadrant);
    if (id === 'unstableFireball') return castUnstableFireball(state, color, params.unitSq, params.center);
    if (id === 'unstableTeleport') return castUnstableTeleport(state, color, params.unitSq, params.center);
    return 'Unknown ability: ' + id;
  }

  function cancelAbility(state, color) {
    if (state.pendingStunlock) return cancelStunlock(state, color);
    if (state.armedAbility && color === state.game.turn()) {
      state.armedAbility = null;
      return null;
    }
    return null; // nothing to cancel is not an error
  }

  const exportsObj = {
    getStunlockQuadrants, quadrantSquares, castStunlock, cancelStunlock,
    getSolarStrikeCenters, solarStrikeSquares, castSolarStrike, castAdvance,
    castKingsLightning, castRingOfFire,
    getSilverBulletTargets, castSilverBullet,
    getClubbingQuadrants, castClubbing,
    getFireballTargets, castUnstableFireball,
    getTeleportTargets, castUnstableTeleport,
    unitAbilitiesFor, globalAbilitiesFor, armAbility, castAbility, cancelAbility,
  };

  if (isNode) module.exports = exportsObj;
  else Object.assign(root, exportsObj);
})(typeof window !== 'undefined' ? window : globalThis);
