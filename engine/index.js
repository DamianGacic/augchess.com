/**
 * engine/index.js — Single entry point tying the engine modules together.
 * `applyAction` is the one thing server/rooms.js calls: dispatch one client
 * action against room state, mutate in place, return null on success or a
 * short rejection reason on failure.
 *
 * Same dual browser-<script>/Node-require shape as the other engine files.
 */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const draftEngine = isNode ? require('./draft-engine.js') : root;
  const chessEngine = isNode ? require('./chess-engine.js') : root;
  const gameOverEngine = isNode ? require('./gameover-engine.js') : root;
  const augmentsEngine = isNode ? require('./augments-engine.js') : root;
  const clockEngine = isNode ? require('./clock-engine.js') : root;

  function createRoomState() {
    return draftEngine.createRoomState();
  }

  // Returns null on success, or a short string reason on rejection. Wraps
  // the actual dispatch (dispatchAction) with a before/after Ghoul-count
  // diff for Raise the Dead's graveyard — a net decrease anywhere in the
  // engine (a normal capture, Ring of Fire, Clubbing, Solar Strike, a
  // Spearman impale, ...) means Ghouls died, so this is a generic catch-all
  // rather than instrumenting every individual capture/kill call site. See
  // chessEngine.ghoulCount's own comment for the accepted promotion
  // imprecision.
  //
  // The clock is charged up to `now` first, so an action arriving after the
  // acting player's flag has fallen finds the game already over (and gets
  // refused) instead of being played.
  function applyAction(state, color, action, now = Date.now()) {
    if (state.phase === 'playing' && state.game) clockEngine.tickClock(state, now);
    const beforeW = state.game ? chessEngine.ghoulCount(state, 'w') : 0;
    const beforeB = state.game ? chessEngine.ghoulCount(state, 'b') : 0;
    const err = dispatchAction(state, color, action, now);
    if (state.game) {
      const deadW = Math.max(0, beforeW - chessEngine.ghoulCount(state, 'w'));
      const deadB = Math.max(0, beforeB - chessEngine.ghoulCount(state, 'b'));
      if (deadW) state.ghoulGraveyard.w += deadW;
      if (deadB) state.ghoulGraveyard.b += deadB;
    }
    return err;
  }

  // Game actions that are blocked while a Vanguard deployment is pending, and
  // the unit square each one acts with (for White's first-turn lock on
  // freshly deployed Vanguard units).
  const PLAY_ACTIONS = ['move', 'armAbility', 'castAbility', 'endRaiseTheDead', 'cancelAbility'];
  function actingSquare(state, color, action) {
    if (action.type === 'move') return action.from;
    if (action.type === 'armAbility') return action.unitSq;
    if (action.type === 'castAbility') {
      if (action.unitSq) return action.unitSq;
      if (action.id === 'raiseTheDead') return state.mounted[color] || chessEngine.findKingSquare(state, color);
    }
    return null;
  }

  function dispatchAction(state, color, action, now) {
    // Not every play path checks gameOver itself (e.g. ending a Raise the
    // Dead session) — and settling a turn after the game ended would let
    // evaluateGameOver re-open it.
    if (state.gameOver && PLAY_ACTIONS.includes(action.type)) return 'Game is over';
    if (state.vanguard && PLAY_ACTIONS.includes(action.type)) return 'Waiting for the Vanguard to deploy';
    if (state.vanguardLocked && color === 'w' && state.vanguardLocked.includes(actingSquare(state, color, action))) {
      return 'Vanguard units sit out White\'s first turn';
    }
    switch (action.type) {
      case 'vanguardDeploy': {
        if (state.phase !== 'playing') return 'Not currently playing';
        const err = augmentsEngine.deployVanguard(state, color, action.placements);
        // The deployment happens before White's first turn — that turn's
        // start-of-turn check (Breaking Rank) runs now, against the new board.
        if (!err) chessEngine.checkBreakingRank(state, state.game.turn());
        return err;
      }

      case 'settingsUpdate':
        return draftEngine.updateSettings(state, action.minutes, action.points);

      case 'settingsStart': {
        const err = draftEngine.startSettings(state);
        if (!err) afterDraftPhaseChange(state);
        return err;
      }

      case 'draftPick': {
        const err = draftEngine.draftPick(state, color, action.augId);
        if (!err) afterDraftPhaseChange(state);
        return err;
      }

      case 'draftPass': {
        const err = draftEngine.draftPass(state, color);
        if (!err) afterDraftPhaseChange(state);
        return err;
      }

      case 'move': {
        if (state.phase !== 'playing') return 'Not currently playing';
        if (state.pendingRaiseTheDead) return 'A Raise the Dead cast is pending — resolve it first';
        const move = chessEngine.findRequestedMove(state, color, action.from, action.to, action.promotion, action.exit);
        if (typeof move === 'string') return move;
        const { pendingTargeting } = chessEngine.executeMove(state, color, move, action.promotion);
        // A Swift shot holds its own turn open (see applyMoveToState) for an
        // optional follow-up step — don't settle until that's resolved
        // (either this same move just resolved it, or it declines via
        // cancelAbility below).
        if (!pendingTargeting && !state.pendingSwiftMove) afterTurnSettles(state, now);
        return null;
      }

      case 'armAbility':
        if (state.phase !== 'playing') return 'Not currently playing';
        return augmentsEngine.armAbility(state, color, action.key, action.unitSq);

      case 'castAbility': {
        if (state.phase !== 'playing') return 'Not currently playing';
        const wasPending = !!state.pendingStunlock;
        const turnBeforeCast = state.game.turn();
        const turnConsuming = augmentsEngine.TURN_CONSUMING_ABILITIES.includes(action.id);
        // Same rule as moves: a turn spent on an ability may not leave your
        // King open to capture.
        if (turnConsuming) {
          const unsafe = augmentsEngine.abilityKingSafetyError(state, color, action);
          if (unsafe) return unsafe;
        }
        const err = augmentsEngine.castAbility(state, color, action.id, action);
        // A Stunlock cast resolving is what finally lets the turn pass (the
        // move that armed it already happened) — settle now. Solar Strike
        // never sets pendingStunlock, so this only fires for Stunlock.
        const stunlockResolved = wasPending && !state.pendingStunlock;
        // Advance, Silver Bullet, Clubbing, Unstable Fireball, Unstable
        // Teleport, Lightning Aura, Ring of Fire, and Relentless Advance all
        // flip state.game's turn themselves (see castAdvance/castSilverBullet/
        // castClubbing/castUnstableFireball/castUnstableTeleport/
        // castKingsLightning/castRingOfFire/castRelentlessAdvance) since they
        // consume the turn on their own, with no chess.js move() to do it —
        // settle right after, same as any other turn-ending action.
        // Raise the Dead is turn-consuming too, but not on every cast — it
        // can stay armed across several raises (see castRaiseTheDead), only
        // actually flipping state.game's turn once the session is
        // exhausted. Comparing turn() before/after this cast is how we
        // detect that a turn-ending flip just happened, since a fixed id
        // check (like TURN_CONSUMING_ABILITIES) can't distinguish "raised
        // one, staying armed" from "raised the last one, session over".
        const raiseTheDeadResolved = action.id === 'raiseTheDead' && state.game.turn() !== turnBeforeCast;
        if (err) return err;
        // A turn spent on an ability counts down stuns, Solar Strikes and
        // cooldowns just like a move does. (A resolving Stunlock already had
        // its bishop's move do that.)
        if (raiseTheDeadResolved || turnConsuming) chessEngine.tickTurnWithoutMove(state);
        if (stunlockResolved || raiseTheDeadResolved || turnConsuming) afterTurnSettles(state, now);
        return null;
      }

      case 'endRaiseTheDead': {
        if (state.phase !== 'playing') return 'Not currently playing';
        const err = augmentsEngine.endRaiseTheDead(state, color);
        if (err) return err;
        chessEngine.tickTurnWithoutMove(state);
        afterTurnSettles(state, now);
        return null;
      }

      case 'cancelAbility': {
        if (state.phase !== 'playing') return 'Not currently playing';
        // Declining a pending Swift follow-up move is the one cancelAbility
        // path that actually finishes a turn (the shot already happened and
        // left it open) — settle once it clears.
        const wasPendingSwift = !!state.pendingSwiftMove;
        const err = augmentsEngine.cancelAbility(state, color);
        if (!err && wasPendingSwift && !state.pendingSwiftMove) afterTurnSettles(state, now);
        return err;
      }

      case 'newGame': {
        if (state.phase === 'settings' || state.phase === 'draft') return 'A game is already being set up';
        resetToSettings(state);
        return null;
      }

      default:
        return 'Unknown action: ' + action.type;
    }
  }

  // Called after any draft-phase action that might have flipped state.phase.
  function afterDraftPhaseChange(state) {
    if (state.phase === 'playing' && !state.game) {
      chessEngine.newGame(state);
      clockEngine.initClock(state);
      // Breaking Rank fires at the beginning of *either* player's turn, so
      // White's very first turn needs its own check here — every other turn
      // gets one via afterTurnSettles below, right after the prior move.
      // A pending Vanguard deployment runs that check itself once it resolves.
      if (!state.vanguard) chessEngine.checkBreakingRank(state, state.game.turn());
    }
  }

  // Called once a turn has genuinely finished (a move with no pending cast,
  // or a pending Stunlock cast just got resolved/canceled) — the point where
  // Breaking Rank checks in and game-over gets (re-)evaluated, exactly
  // mirroring the old client's executeMove/applyStunlockToQuadrant tails.
  function afterTurnSettles(state, now) {
    // Plain "how many turns have fully settled" counter — see the comment on
    // state.turnNumber in chess-engine.js's newGame. Used by Raise the
    // Dead's one-turn cooldown (chess.js's own move counter doesn't work
    // here since Figure-type moves bypass it entirely).
    state.turnNumber = (state.turnNumber || 0) + 1;
    // The Vanguard owner's opponent just finished their first turn — Breaking
    // Rank and Warm Welcome are back from here on (the check just below too).
    const justMoved = state.game.turn() === 'w' ? 'b' : 'w';
    if (state.vanguardGrace === justMoved) state.vanguardGrace = null;
    const fenBefore = state.game.fen();
    chessEngine.checkBreakingRank(state, state.game.turn());
    chessEngine.checkKingsLightning(state);
    chessEngine.checkRingOfFire(state);
    chessEngine.checkRelentlessAdvance(state); // still skips units sitting out White's first turn
    // White's first turn is over — its Vanguard units are free to act again.
    state.vanguardLocked = null;
    // These edit the board via put()/remove() behind chess.js's back, leaving
    // its move history out of sync with the board — in_draw()'s repetition
    // check then replays that history and throws (taking serializeState and
    // the server broadcast down with it). Reloading drops the stale history.
    if (state.game.fen() !== fenBefore) state.game.load(state.game.fen());
    chessEngine.tickTeleportMarks(state);
    chessEngine.tickFireDeathMarks(state);
    chessEngine.tickWarmWelcomeMarks(state);
    const wasOver = state.gameOver;
    gameOverEngine.evaluateGameOver(state);
    noteOutcome(state, wasOver);
    clockEngine.switchClockTurn(state, now);
  }

  // Move history: close the game with how it ended, or tag the turn that
  // just gave check.
  function noteOutcome(state, wasOver) {
    if (state.gameOver) {
      if (!wasOver) {
        const text = state.gameOverText.replace(/^[^A-Za-z]+/, '');
        chessEngine.logEntry(state, null, '#', text.endsWith('!') || text.endsWith('.') ? text : text + '.', 'event');
      }
      return;
    }
    const toMove = state.game.turn();
    if (!chessEngine.kingThreatenedAfterPly(state, toMove)) return;
    // Not attacked yet, but the Solar Strike going off this move opens the King up.
    const tag = chessEngine.isKingAttacked(state, toMove) ? 'Check!' : 'Check once the Solar Strike lands!';
    for (let i = state.moveLog.length - 1; i >= 0; i--) {
      const entry = state.moveLog[i];
      if (entry.kind !== 'turn') continue;
      if (entry.text && !entry.text.endsWith('Check!') && !entry.text.endsWith('lands!')) entry.text += ' ' + tag;
      break;
    }
  }

  // "New Game" from the playing/gameover phase — back to settings so either
  // player can re-pick time control/points before drafting again.
  function resetToSettings(state) {
    state.phase = 'settings';
    state.settings = { minutes: state.settings.minutes, points: state.settings.points, locked: false };
    state.draftState = null;
    state.augments = { w: [], b: [] };
    delete state.game;
    delete state.clock;
    delete state.timeForfeit;
  }

  function serializeState(state) {
    return chessEngine.serializeState(state);
  }

  const exportsObj = {
    createRoomState, applyAction, serializeState,
    tickClock: clockEngine.tickClock, clockRemaining: clockEngine.clockRemaining,
  };

  if (isNode) {
    module.exports = exportsObj;
  } else {
    // Browser: draft-engine.js/chess-engine.js already put the REAL
    // createRoomState/serializeState on this same shared `root` object.
    // Exposing these wrapper versions here too would self-recurse forever —
    // e.g. this createRoomState calls draftEngine.createRoomState(), but
    // draftEngine IS root, so once Object.assign below overwrote
    // root.createRoomState with this very wrapper, that call would just
    // invoke itself. applyAction is the only name genuinely new here.
    Object.assign(root, { applyAction });
  }
})(typeof window !== 'undefined' ? window : globalThis);
