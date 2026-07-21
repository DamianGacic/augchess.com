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

  function createRoomState() {
    return draftEngine.createRoomState();
  }

  // Returns null on success, or a short string reason on rejection.
  function applyAction(state, color, action) {
    switch (action.type) {
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
        const move = chessEngine.findRequestedMove(state, color, action.from, action.to, action.promotion, action.exit);
        if (typeof move === 'string') return move;
        const { pendingTargeting } = chessEngine.executeMove(state, color, move, action.promotion);
        if (!pendingTargeting) afterTurnSettles(state);
        return null;
      }

      case 'armAbility':
        if (state.phase !== 'playing') return 'Not currently playing';
        return augmentsEngine.armAbility(state, color, action.key, action.unitSq);

      case 'castAbility': {
        if (state.phase !== 'playing') return 'Not currently playing';
        const wasPending = !!state.pendingStunlock;
        const err = augmentsEngine.castAbility(state, color, action.id, action);
        // A Stunlock cast resolving is what finally lets the turn pass (the
        // move that armed it already happened) — settle now. Solar Strike
        // never sets pendingStunlock, so this only fires for Stunlock.
        const stunlockResolved = wasPending && !state.pendingStunlock;
        // Advance, Silver Bullet, Clubbing, Unstable Fireball, Unstable
        // Teleport, I Am Lightning, and Ring of Fire all flip state.game's
        // turn themselves (see castAdvance/castSilverBullet/castClubbing/
        // castUnstableFireball/castUnstableTeleport/castKingsLightning/
        // castRingOfFire) since they consume the turn on their own, with no
        // chess.js move() to do it — settle right after, same as any other
        // turn-ending action.
        const turnConsumingIds = ['advance', 'silverBullet', 'clubbing', 'unstableFireball', 'unstableTeleport', 'kingsLightning', 'ringOfFire'];
        if (!err && (stunlockResolved || turnConsumingIds.includes(action.id))) afterTurnSettles(state);
        return err;
      }

      case 'cancelAbility':
        if (state.phase !== 'playing') return 'Not currently playing';
        return augmentsEngine.cancelAbility(state, color);

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
      // Breaking Rank fires at the beginning of *either* player's turn, so
      // White's very first turn needs its own check here — every other turn
      // gets one via afterTurnSettles below, right after the prior move.
      chessEngine.checkBreakingRank(state, state.game.turn());
    }
  }

  // Called once a turn has genuinely finished (a move with no pending cast,
  // or a pending Stunlock cast just got resolved/canceled) — the point where
  // Breaking Rank checks in and game-over gets (re-)evaluated, exactly
  // mirroring the old client's executeMove/applyStunlockToQuadrant tails.
  function afterTurnSettles(state) {
    chessEngine.checkBreakingRank(state, state.game.turn());
    chessEngine.checkKingsLightning(state);
    chessEngine.checkRingOfFire(state);
    chessEngine.tickTeleportMarks(state);
    chessEngine.tickFireDeathMarks(state);
    gameOverEngine.evaluateGameOver(state);
  }

  // "New Game" from the playing/gameover phase — back to settings so either
  // player can re-pick time control/points before drafting again.
  function resetToSettings(state) {
    state.phase = 'settings';
    state.settings = { minutes: state.settings.minutes, points: state.settings.points, locked: false };
    state.draftState = null;
    state.augments = { w: [], b: [] };
    delete state.game;
  }

  function serializeState(state) {
    return chessEngine.serializeState(state);
  }

  const exportsObj = { createRoomState, applyAction, serializeState };

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
