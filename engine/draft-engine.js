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
  function createRoomState() {
    return {
      phase: 'settings', // 'settings' | 'draft' | 'playing' | 'gameover'
      settings: { minutes: 3, points: 3, locked: false },
      draftState: null, // { points:{w,b}, current:'w'|'b', owned:{w:[],b:[]}, passed:{w,b} }
      augments: { w: [], b: [] },
    };
  }

  // Either player may change settings any time before the draft starts.
  function updateSettings(state, minutes, points) {
    if (state.phase !== 'settings') return 'Settings can only be changed before the draft starts';
    if (state.settings.locked) return 'Settings are already locked in';
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
    const exType = exchangeType(aug);
    if (exType) {
      const conflict = ds.owned[color].some(id => {
        const owned = AUGMENTS.find(a => a.id === id);
        return owned && exchangeType(owned) === exType;
      });
      if (conflict) return false;
    }
    return true;
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
    exchangeType, canAfford, draftPick, draftPass, advanceDraft, finishDraft,
  };

  if (isNode) module.exports = exportsObj;
  else Object.assign(root, exportsObj);
})(typeof window !== 'undefined' ? window : globalThis);
