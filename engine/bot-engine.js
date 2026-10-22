/**
 * engine/bot-engine.js — A simple computer opponent. It never re-implements
 * any rules: every option it considers is played out on a throwaway copy of
 * the room state through the real applyAction (engine/index.js), so it can
 * only ever pick actions the server would accept, augments and all.
 *
 * Search: every move and ability (plus the two-step plans Solar Strike and
 * Stunlock need) is played out and scored; the most promising handful then
 * get the opponent's most dangerous replies (captures, shots and abilities)
 * played against them, with one recapture for us, and keep the worst
 * outcome. Dice abilities are judged by their intended result, like
 * abilityKingSafetyError does.
 *
 * Entry points:
 *   botActor(state)              → the color whose decision the game waits on, or null
 *   chooseBotActions(state, color, opts) → actions to dispatch in order, for that decision
 *   chooseDraftAction(state, color)      → a draftPick/draftPass action
 *
 * Same dual browser-<script>/Node-require shape as the other engine files.
 */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const chessEngine = isNode ? require('./chess-engine.js') : root;
  const augmentsEngine = isNode ? require('./augments-engine.js') : root;
  const draftEngine = isNode ? require('./draft-engine.js') : root;
  const data = isNode ? require('../data.js') : root;
  // Required lazily: engine/index.js is loaded after this file's siblings.
  const applyAction = (...args) => (isNode ? require('./index.js') : root).applyAction(...args);

  const { pieceAt, has, figurePawnType, figureRookType, figureBishopType, sqToFR, frToSq,
    generateMoves, generateExitMoves, cloneForSimulation, SHIELD_DIRS } = chessEngine;

  const WIN = 100000;
  const DEFAULT_BUDGET_MS = 1500;
  const DEEP_CANDIDATES = 12;   // how many top options get the opponent's replies
  const PLAN_PIECES = 6;        // non-Queen moves tried after a Solar Strike cast

  // ═══════════════════════════════════════════════════════════════════════
  //  WHOSE DECISION
  // ═══════════════════════════════════════════════════════════════════════
  function botActor(state) {
    if (state.phase === 'draft' && state.draftState) return state.draftState.current;
    if (state.phase !== 'playing' || !state.game || state.gameOver) return null;
    if (state.vanguard) return state.vanguard.color;
    if (state.pendingStunlock) return state.pendingStunlock.color;
    if (state.pendingShield) return state.pendingShield.color;
    return state.game.turn();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  DRAFT
  // ═══════════════════════════════════════════════════════════════════════
  // Rough worth of each augment in pawns-of-advantage. Picked by worth per
  // point (with some noise), so the bot spends its budget on bargains first.
  const AUGMENT_WORTH = {
    leaping: 1.2, watchtowers: 1, mounting: 1.5, vanguard: 2.5, legion: 9,
    stunlock: 4.5, bishopsShields: 6, apprentices: 0.6, archers: 4.5, ghouls: 2,
    guardsmen: 2.2, spearmen: 2, trolls: 3, longbowmen: 3, warlord: 5,
    deviant: 1.5, breakingRank: 2.5, raiseTheDead: 6, solarStrike: 11, advance: 2,
    silverBullet: 3.5, kingsLightning: 4.5, ringOfFire: 3, relentlessAdvance: 2.5,
    coronation: 1.5, inferno: 4, unstableFireball: 3.5, unstableTeleport: 1.2,
    kingsguard: 2.5, quickdraw: 2.2, swift: 2, nimble: 2, warmWelcome: 2,
    accuracy: 2.5, longshot: 2.5,
  };

  function chooseDraftAction(state, color, rand = Math.random) {
    let best = null, bestScore = -Infinity;
    for (const aug of data.AUGMENTS) {
      if (!draftEngine.canAfford(state, color, aug)) continue;
      const worth = AUGMENT_WORTH[aug.id] !== undefined ? AUGMENT_WORTH[aug.id] : aug.cost * 0.7;
      const score = worth / aug.cost + rand() * 0.35;
      if (score > bestScore) { bestScore = score; best = aug; }
    }
    return best ? { type: 'draftPick', augId: best.id } : { type: 'draftPass' };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  EVALUATION — from `color`'s point of view, in pawns
  // ═══════════════════════════════════════════════════════════════════════
  const PAWN_FIGURE_VALUE = { apprentice: 0.8, archer: 1.6, ghoul: 1.1, guardsman: 1.3, spearman: 1.2 };

  function unitValue(state, piece, sq) {
    const c = piece.color;
    switch (piece.type) {
      case 'p': {
        const fig = figurePawnType(state, c);
        return fig ? (PAWN_FIGURE_VALUE[fig] || 1) : 1;
      }
      case 'n': return 3.1;
      case 'b': {
        const shield = state.bishopShields && state.bishopShields[c] && state.bishopShields[c][sq];
        return (figureBishopType(state, c) === 'longbowman' ? 3.4 : 3.2) + (shield ? 0.4 : 0);
      }
      case 'r': return figureRookType(state, c) === 'troll' ? 5.3 : 5;
      case 'q': return 9.5;
      default: return 0;
    }
  }

  function winnerOf(state) {
    const text = state.gameOverText || '';
    if (/White wins/.test(text)) return 'w';
    if (/Black wins/.test(text)) return 'b';
    if (state.timeForfeit) return state.timeForfeit === 'w' ? 'b' : 'w';
    return null;
  }

  // Stored-up abilities are worth something unspent, so the bot only
  // fires a one-shot when it gains more than it gives up.
  function reserveValue(state, c) {
    let v = 0;
    if (has(state, c, 'silverBullet') && !state.silverBulletUsed[c]) v += 1.2;
    if (has(state, c, 'advance') && !state.advanceUsed[c]) v += 0.4;
    if (state.stunlockCharges && state.stunlockCharges[c]) v += 0.6 * Object.keys(state.stunlockCharges[c]).length;
    if (has(state, c, 'raiseTheDead')) v += 0.7 * (state.ghoulGraveyard[c] || 0);
    // Auras burn for the rest of the game once lit: worth more lit than kept.
    if (has(state, c, 'kingsLightning')) v += state.lightningActive[c] ? 1 : 0.3;
    if (has(state, c, 'ringOfFire')) v += state.fireActive[c] ? 1 : 0.3;
    if (has(state, c, 'relentlessAdvance')) v += state.relentlessAdvanceActive[c] ? 0.8 : 0.2;
    return v;
  }

  function evaluate(state, color) {
    if (state.gameOver) {
      const w = winnerOf(state);
      return w === color ? WIN : w ? -WIN : 0;
    }
    let score = 0;
    const board = state.game.board();
    for (let br = 0; br < 8; br++) {
      for (let bf = 0; bf < 8; bf++) {
        const cell = board[br][bf];
        if (!cell) continue;
        const sq = frToSq(bf, 7 - br);
        const sign = cell.color === color ? 1 : -1;
        let v = unitValue(state, cell, sq);
        const rank = cell.color === 'w' ? 7 - br : br; // 0 = own back rank
        const centre = 3.5 - Math.max(Math.abs(bf - 3.5), Math.abs((7 - br) - 3.5));
        if (cell.type === 'p') v += rank >= 5 ? 0.15 * (rank - 4) + 0.05 * rank : 0.04 * rank;
        else if (cell.type === 'n' || cell.type === 'b') v += 0.06 * centre;
        else if (cell.type === 'k') {
          if (has(state, cell.color, 'coronation')) v += 0.12 * rank;
          else if (rank > 1) v -= 0.15 * rank; // a king out in the open
        }
        // A Solar Strike is about to burn this square.
        if (state.solarMarked && state.solarMarked[sq]) v -= cell.type === 'k' ? 0 : unitValue(state, cell, sq) * 0.9;
        // Standing in a Ring of Fire since the last turn-end: it burns at
        // the next one unless it gets out (and only one unit can per turn).
        const fire = state.fireAura && state.fireAura[sq];
        if (fire && cell.type !== 'k' && fire.sig === cell.color + cell.type) v -= unitValue(state, cell, sq) * 0.75;
        if (state.stunnedSquares && state.stunnedSquares[sq] > 0) v -= 0.1;
        score += sign * v;
      }
    }
    const enemy = color === 'w' ? 'b' : 'w';
    // Well ahead: hunt the King down — drive it to the edge, close in on it.
    if (Math.abs(score) > 4) {
      const ahead = score > 0 ? color : enemy;
      const loser = chessEngine.findKingSquare(state, ahead === 'w' ? 'b' : 'w');
      const hunter = chessEngine.findKingSquare(state, ahead);
      if (loser && hunter) {
        const l = sqToFR(loser), h = sqToFR(hunter);
        const edge = Math.max(Math.abs(l.f - 3.5), Math.abs(l.r - 3.5));
        const gap = Math.max(Math.abs(l.f - h.f), Math.abs(l.r - h.r));
        score += (ahead === color ? 1 : -1) * (0.25 * edge + 0.1 * (7 - gap));
      }
    }
    if (chessEngine.hasWarlord && chessEngine.hasWarlord(state, color) && chessEngine.isWarlordFresh(state, color)) score += 1.5;
    if (chessEngine.hasWarlord && chessEngine.hasWarlord(state, enemy) && chessEngine.isWarlordFresh(state, enemy)) score -= 1.5;
    score += reserveValue(state, color) - reserveValue(state, enemy);
    return score;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PLAYING ACTIONS OUT ON COPIES
  // ═══════════════════════════════════════════════════════════════════════
  function clone(state) {
    return cloneForSimulation(state);
  }

  // Dice land on "works as aimed", same as abilityKingSafetyError.
  function withFixedRandom(fn) {
    const random = Math.random;
    Math.random = () => 0.5;
    try { return fn(); } finally { Math.random = random; }
  }

  // Charged at the clock's own timestamp, so simulating never spends time.
  function simNow(state) {
    return state.clock && state.clock.since ? state.clock.since : 0;
  }

  // Plays `actions` for `color` on a copy, then settles any decision the
  // turn left open with a quick default. Null if any action is refused.
  function playOut(state, color, actions) {
    const sim = clone(state);
    for (const a of actions) {
      if (applyAction(sim, color, a, simNow(sim))) return null;
    }
    settleQuickly(sim, color);
    return sim;
  }

  function settleQuickly(sim, color) {
    for (let guard = 0; guard < 20; guard++) {
      if (sim.gameOver) return;
      let action = null;
      if (sim.pendingStunlock && sim.pendingStunlock.color === color) action = quickStunlock(sim, color);
      else if (sim.pendingShield && sim.pendingShield.color === color) action = { type: 'orientShield', dir: quickShieldDir(sim, color) };
      else if (sim.pendingSwiftMove && sim.pendingSwiftMove.color === color) action = { type: 'cancelAbility' };
      else if (sim.pendingRaiseTheDead && sim.pendingRaiseTheDead.color === color) {
        const t = augmentsEngine.getRaiseTheDeadTargets(sim, color)[0];
        action = t ? { type: 'castAbility', id: 'raiseTheDead', target: t } : { type: 'endRaiseTheDead' };
      }
      if (!action) return;
      if (applyAction(sim, color, action, simNow(sim))) return;
    }
  }

  // The 2×2 quadrant holding the most enemy value (and least of our own).
  function stunlockQuadrantScores(state, color) {
    const { bishopSq } = state.pendingStunlock;
    return augmentsEngine.getStunlockQuadrants(bishopSq).map(q => {
      let v = 0;
      for (const sq of augmentsEngine.quadrantSquares(q.f, q.r)) {
        const p = pieceAt(state, sq);
        if (p) v += (p.color === color ? -1 : 1) * (p.type === 'k' ? 2 : unitValue(state, p, sq));
      }
      return { corner: frToSq(q.f, q.r), v };
    });
  }

  function quickStunlock(state, color) {
    const best = stunlockQuadrantScores(state, color).sort((a, b) => b.v - a.v)[0];
    return best && best.v > 0 ? { type: 'castAbility', id: 'stunlock', center: best.corner } : { type: 'cancelAbility' };
  }

  // Face the nearest enemy unit.
  function quickShieldDir(state, color) {
    const { f, r } = sqToFR(state.pendingShield.sq);
    let best = null, bestDist = Infinity;
    for (const sq of state.game.SQUARES) {
      const p = pieceAt(state, sq);
      if (!p || p.color === color) continue;
      const t = sqToFR(sq);
      const d = Math.max(Math.abs(t.f - f), Math.abs(t.r - r));
      if (d < bestDist) { bestDist = d; best = t; }
    }
    if (!best) return 'n';
    const df = Math.sign(best.f - f), dr = Math.sign(best.r - r);
    const dir = Object.keys(SHIELD_DIRS).find(k => SHIELD_DIRS[k][0] === df && SHIELD_DIRS[k][1] === dr);
    return dir || 'n';
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CANDIDATES
  // ═══════════════════════════════════════════════════════════════════════
  function ownSquares(state, color) {
    return state.game.SQUARES.filter(sq => { const p = pieceAt(state, sq); return p && p.color === color; });
  }

  function moveAction(m, exit) {
    const a = { type: 'move', from: m.from, to: m.to };
    if (m.promotion || m.needsPromo) a.promotion = 'q';
    if (exit) a.exit = true;
    return a;
  }

  // Every move `color` (the side to move) can make, as {action, move}.
  function allMoves(state, color, onlyFrom) {
    const out = [];
    for (const sq of onlyFrom ? [onlyFrom] : ownSquares(state, color)) {
      for (const m of generateMoves(state, sq)) {
        if (m.promotion && m.promotion !== 'q') continue;
        out.push({ action: moveAction(m), move: m });
      }
      if (state.mannedTowers[sq] === color || state.mounted[color] === sq) {
        for (const m of generateExitMoves(state, sq)) out.push({ action: moveAction(m, true), move: m });
      }
    }
    return out;
  }

  function abilityActions(state, color) {
    return augmentsEngine.turnEndingAbilityActions(state, color)
      .map(a => ({ type: 'castAbility', ...a }));
  }

  // A full turn's worth of options, each a list of actions (plans).
  function turnPlans(state, color) {
    const moves = allMoves(state, color);
    const plans = moves.map(m => [m.action]);
    abilityActions(state, color).forEach(a => plans.push([a]));

    // Stunlock: arm the bishop, then move it (the quadrant is picked once
    // the move lands, as its own decision).
    if (has(state, color, 'stunlock')) {
      for (const { action, move } of moves) {
        const sq = move.from;
        const p = pieceAt(state, sq);
        if (!p || p.type !== 'b' || !state.stunlockCharges[color][sq] || move.special === 'towerEnter') continue;
        plans.push([{ type: 'armAbility', key: 'Q', unitSq: sq }, action]);
      }
    }

    // Solar Strike: mark a 3×3 worth burning, then make a non-Queen move.
    if (has(state, color, 'solarStrike') && !state.solarStrikeCastThisTurn) {
      for (const qSq of ownSquares(state, color)) {
        if (!augmentsEngine.unitAbilitiesFor(state, qSq).some(a => a && a.id === 'solarStrike')) continue;
        const centres = augmentsEngine.getSolarStrikeCenters(qSq).map(c => {
          let v = 0;
          for (const sq of augmentsEngine.solarStrikeSquares(c.f, c.r)) {
            const p = pieceAt(state, sq);
            if (p && p.type !== 'k') v += (p.color === color ? -1 : 1) * unitValue(state, p, sq);
          }
          return { sq: frToSq(c.f, c.r), v };
        }).filter(c => c.v >= 3).sort((a, b) => b.v - a.v).slice(0, 3);
        if (!centres.length) continue;
        const followUps = moves.filter(m => pieceAt(state, m.move.from).type !== 'q');
        const ranked = rankShallow(state, color, followUps.map(m => [m.action])).slice(0, PLAN_PIECES);
        for (const c of centres) {
          for (const r of ranked) plans.push([{ type: 'castAbility', id: 'solarStrike', unitSq: qSq, center: c.sq }, ...r.plan]);
        }
      }
    }
    return plans;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  SEARCH
  // ═══════════════════════════════════════════════════════════════════════
  function rankShallow(state, color, plans) {
    const out = [];
    for (const plan of plans) {
      const sim = playOut(state, color, plan);
      if (!sim) continue;
      out.push({ plan, sim, shallow: evaluate(sim, color) });
    }
    return out.sort((a, b) => b.shallow - a.shallow);
  }

  // The opponent's sharpest replies: anything that kills, promotes, or is
  // an ability. Quiet moves are covered by "standing pat" on the position.
  // Checks too (chess.js flags those, for the units it knows), so a quiet
  // mate isn't missed; ones that aren't legal here get refused when played.
  function threatReplies(sim, opp) {
    const replies = allMoves(sim, opp)
      .filter(({ move }) => move.captured || /Shoot|Charge|Capture/.test(move.special || '') || move.promotion || move.needsPromo)
      .map(({ action }) => action);
    const seen = new Set(replies.map(a => a.from + a.to));
    for (const m of sim.game.moves({ verbose: true })) {
      if (!/[+#]/.test(m.san) || seen.has(m.from + m.to)) continue;
      seen.add(m.from + m.to);
      replies.push(m.promotion ? { type: 'move', from: m.from, to: m.to, promotion: 'q' } : { type: 'move', from: m.from, to: m.to });
    }
    return replies.concat(abilityActions(sim, opp));
  }

  // Our best one-move recapture on `sq` after the opponent struck there.
  function bestRecapture(sim, color, sq, base) {
    let best = base;
    for (const { action, move } of allMoves(sim, color)) {
      if (move.to !== sq || !(move.captured || /Shoot|Charge|Capture/.test(move.special || ''))) continue;
      const after = playOut(sim, color, [action]);
      if (after) best = Math.max(best, evaluate(after, color));
    }
    return best;
  }

  // The worst the opponent's sharpest replies can do to us from `sim`.
  function worstReply(sim, color, deadline) {
    const stand = evaluate(sim, color);
    if (sim.gameOver) return stand;
    const opp = botActor(sim);
    if (!opp || opp === color) return stand;
    let worst = stand;
    for (const reply of threatReplies(sim, opp)) {
      const after = playOut(sim, opp, [reply]);
      if (!after) continue;
      let v = evaluate(after, color);
      if (!after.gameOver && reply.type === 'move' && botActor(after) === color && Date.now() < deadline) {
        v = bestRecapture(after, color, reply.to, v);
      }
      if (v < worst) worst = v;
      if (worst <= -WIN / 2) break;
    }
    return worst;
  }

  // Scores every plan one ply deep, then plays the opponent's sharpest
  // replies against the best few; the best worst case wins.
  function searchPlans(state, color, plans, opts) {
    const deadline = Date.now() + (opts.budgetMs || DEFAULT_BUDGET_MS);
    const ranked = rankShallow(state, color, plans);
    if (!ranked.length) return null;
    ranked.forEach((r, i) => {
      if (i < (opts.deep || DEEP_CANDIDATES) && Date.now() < deadline) {
        r.score = worstReply(r.sim, color, deadline);
      } else {
        r.score = r.shallow - 1; // unchecked: assume something hangs
      }
      r.score += opts.rand() * (opts.noise !== undefined ? opts.noise : 0.08);
    });
    ranked.sort((a, b) => b.score - a.score);
    return ranked[0];
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  DECISIONS
  // ═══════════════════════════════════════════════════════════════════════
  function chooseBotActions(state, color, opts = {}) {
    if (botActor(state) !== color) return [];
    // Noise in the choice stays truly random; only the simulated dice are fixed.
    opts = { ...opts, rand: opts.rand || Math.random };
    if (state.phase === 'draft') return [chooseDraftAction(state, color, opts.rand)];
    return withFixedRandom(() => decide(state, color, opts));
  }

  function decide(state, color, opts) {
    if (state.vanguard) return [chooseVanguard(state, color, opts)];

    if (state.pendingStunlock) {
      const options = stunlockQuadrantScores(state, color).filter(q => q.v > 0)
        .map(q => [{ type: 'castAbility', id: 'stunlock', center: q.corner }]);
      options.push([{ type: 'cancelAbility' }]);
      return pick(state, color, options, opts);
    }

    if (state.pendingShield) {
      const options = Object.keys(SHIELD_DIRS).map(dir => [{ type: 'orientShield', dir }]);
      return pick(state, color, options, { ...opts, noise: 0.01 });
    }

    if (state.pendingRaiseTheDead) {
      const options = augmentsEngine.getRaiseTheDeadTargets(state, color)
        .map(t => [{ type: 'castAbility', id: 'raiseTheDead', target: t }]);
      if (!options.length) return [{ type: 'endRaiseTheDead' }];
      return pick(state, color, options, { ...opts, deep: 4 });
    }

    if (state.pendingSwiftMove) {
      const options = allMoves(state, color, state.pendingSwiftMove.archerSq)
        .filter(({ move }) => move.special !== 'archerShoot')
        .map(m => [m.action]);
      options.push([{ type: 'cancelAbility' }]);
      return pick(state, color, options, opts);
    }

    return pick(state, color, turnPlans(state, color), opts);
  }

  function pick(state, color, plans, opts) {
    const best = searchPlans(state, color, plans, opts);
    if (best) return best.plan;
    // Nothing playable at all: decline whatever is open.
    return [{ type: 'cancelAbility' }];
  }

  // Vanguard: greedily step up to two units into the zone while that
  // scores better than staying put.
  function chooseVanguard(state, color, opts) {
    const zone = chessEngine.VANGUARD_ZONES[color];
    const units = ownSquares(state, color).filter(sq => ['n', 'b', 'p'].includes(pieceAt(state, sq).type));
    const placements = [];
    const scoreOf = (pl) => {
      const sim = clone(state);
      if (applyAction(sim, color, { type: 'vanguardDeploy', placements: pl }, simNow(sim))) return -Infinity;
      return botActor(sim) === color ? evaluate(sim, color) : worstReply(sim, color, Date.now() + 300);
    };
    let current = scoreOf(placements);
    for (let step = 0; step < 2; step++) {
      let best = null;
      for (const from of units) {
        if (placements.some(p => p.from === from)) continue;
        for (const to of zone) {
          if (placements.some(p => p.to === to) || pieceAt(state, to)) continue;
          // Quick filter before the expensive check: only units near the zone.
          if (Math.abs(sqToFR(from).f - sqToFR(to).f) > 2) continue;
          const pl = placements.concat([{ from, to }]);
          const s = scoreOf(pl) + opts.rand() * 0.05;
          if (!best || s > best.s) best = { s, pl };
        }
      }
      if (!best || best.s <= current + 0.05) break;
      current = best.s;
      placements.splice(0, placements.length, ...best.pl);
    }
    return { type: 'vanguardDeploy', placements };
  }

  const exportsObj = { botActor, chooseBotActions, chooseDraftAction, evaluateForBot: evaluate };

  if (isNode) module.exports = exportsObj;
  else Object.assign(root, exportsObj);
})(typeof window !== 'undefined' ? window : globalThis);
