/**
 * engine/draft-engine.js — Pure, state-threaded pre-game settings + augment
 * draft logic. No DOM, no networking — this runs unmodified in the browser
 * (as a <script>, same as today) and on the server (as the authority).
 *
 * Every exported function takes the room's `state` object explicitly instead
 * of closing over globals, so a server process can hold many independent
 * instances at once. Mutating functions return `null` on success or a short
 * string reason on rejection (the server turns that into `actionRejected`;
 * locally it can just be ignored/logged).
 *
 * Depends on: AUGMENTS, FIGURES (data.js) — loaded globally in the browser,
 * required in Node.
 */

(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const data = isNode ? require('../data.js') : root;
  const AUGMENTS = data.AUGMENTS;
  const FIGURES = data.FIGURES;

  // ─── Settings phase ───────────────────────────────────────────────────────
  const MIN_POINTS = 1;
  const MAX_POINTS = 99;
  const MAX_MINUTES = 180;

  function createRoomState() {
    return {
      phase: 'settings', // 'settings' | 'draft' | 'playing' | 'gameover'
      settings: { minutes: 3, points: 3, locked: false },
      draftState: null, // { points:{w,b}, current:'w'|'b', owned:{w:[],b:[]}, passed:{w,b} }
      augments: { w: [], b: [] },
    };
  }

  // Either player may change settings any time before the draft starts.
  // A field left out (undefined) keeps its current value, so two quick changes
  // to different fields online can't undo each other.
  function updateSettings(state, minutes = state.settings.minutes, points = state.settings.points) {
    if (state.phase !== 'settings') return 'Settings can only be changed before the draft starts';
    if (state.settings.locked) return 'Settings are already locked in';
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
      return `Time control must be a whole number of minutes from 1 to ${MAX_MINUTES}`;
    }
    // Points can be typed in freely (custom field), so bound them here where
    // the server also enforces it.
    if (!Number.isInteger(points) || points < MIN_POINTS || points > MAX_POINTS) {
      return `Auction points must be a whole number from ${MIN_POINTS} to ${MAX_POINTS}`;
    }
    state.settings.minutes = minutes;
    state.settings.points = points;
    return null;
  }

  // Either player may start the draft — whoever gets there first locks it in
  // for both (mirrors the old "whoever clicks Start Draft" race, but now the
  // server resolves it deterministically instead of a client-side race).
  function startSettings(state) {
    if (state.phase !== 'settings') return 'Draft already started';
    if (state.settings.locked) return 'Draft is already starting';
    state.settings.locked = true;
    startAugmentDraft(state);
    return null;
  }

  function startAugmentDraft(state) {
    state.phase = 'draft';
    state.draftState = {
      points: { w: state.settings.points, b: state.settings.points },
      current: 'w',
      owned: { w: [], b: [] },
      passed: { w: false, b: false },
    };
  }

  // ─── Draft phase ────────────────────────────────────────────────────────
  // The piece type an exchange augment swaps (e.g. 'p' for a pawn-exchange
  // augment), looked up via the FIGURES entry it exchanges for. Null for
  // non-exchange augments.
  function exchangeType(aug) {
    if (!aug.exchanges) return null;
    const fig = FIGURES.find(f => f.id === aug.exchanges);
    return fig ? fig.replaces : null;
  }

  function canAfford(state, color, aug) {
    const ds = state.draftState;
    if (ds.owned[color].includes(aug.id)) return false;
    if (ds.points[color] < aug.cost) return false;
    const other = color === 'w' ? 'b' : 'w';
    if (ds.owned[other].includes(aug.id)) return false; // claimed by opponent
    if (aug.requires && !ds.owned[color].includes(aug.requires)) return false;
    if (conflictsWithOwned(state, color, aug)) return false;
    return true;
  }

  // Whether `aug` can't be combined with something `color` already owns: a
  // second exchange of the same piece type, or an augment that names the
  // other in its `excludes` list (either way round).
  function conflictsWithOwned(state, color, aug) {
    const exType = exchangeType(aug);
    return state.draftState.owned[color].some(id => {
      const owned = AUGMENTS.find(a => a.id === id);
      if (!owned) return false;
      if (exType && exchangeType(owned) === exType) return true;
      return (aug.excludes || []).includes(owned.id) || (owned.excludes || []).includes(aug.id);
    });
  }

  function draftPick(state, color, augId) {
    if (state.phase !== 'draft') return 'Not in the draft phase';
    const ds = state.draftState;
    if (color !== ds.current) return 'Not your turn to pick';
    const aug = AUGMENTS.find(a => a.id === augId);
    if (!aug) return 'Unknown augment';
    if (!canAfford(state, color, aug)) return 'That augment is not available to you right now';

    ds.points[color] -= aug.cost;
    ds.owned[color].push(augId);
    ds.passed[color] = false;
    advanceDraft(state);
    return null;
  }

  function draftPass(state, color) {
    if (state.phase !== 'draft') return 'Not in the draft phase';
    const ds = state.draftState;
    if (color !== ds.current) return 'Not your turn to pass';
    ds.passed[color] = true;
    advanceDraft(state);
    return null;
  }

  function advanceDraft(state) {
    const ds = state.draftState;
    const canBuy = (c) => AUGMENTS.some(a => canAfford(state, c, a));
    const doneW = ds.passed.w || !canBuy('w');
    const doneB = ds.passed.b || !canBuy('b');

    if (doneW && doneB) { finishDraft(state); return; }

    const other = ds.current === 'w' ? 'b' : 'w';
    const otherDone = other === 'w' ? doneW : doneB;
    if (!otherDone) ds.current = other;
  }

  // Leaves state.phase === 'draft' bumped to 'playing' with augments locked
  // in; the caller (engine/index.js) is responsible for then initializing the
  // actual chess position via chess-engine's newGame — kept separate here to
  // avoid a circular dependency between draft-engine and chess-engine.
  function finishDraft(state) {
    state.augments = { w: [...state.draftState.owned.w], b: [...state.draftState.owned.b] };
    state.phase = 'playing';
  }

  const exportsObj = {
    createRoomState, updateSettings, startSettings, startAugmentDraft,
    exchangeType, canAfford, conflictsWithOwned, draftPick, draftPass, advanceDraft, finishDraft,
  };

  if (isNode) module.exports = exportsObj;
  else Object.assign(root, exportsObj);
})(typeof window !== 'undefined' ? window : globalThis);
