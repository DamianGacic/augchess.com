/**
 * ai-player.js — Play vs AI. A hotseat game where one seat belongs to
 * the bot (engine/bot-engine.js): whenever the game waits on the bot's
 * color, it picks its actions and feeds them through dispatch() one at a
 * time, with a short pause between them so each step can be seen.
 *
 * The human's seat is enforced the same way as online play: `myColor` is
 * the human's color, and the input checks that look at `netMode`/`myColor`
 * also look at `aiColor`.
 *
 * Depends on: app.js (state, dispatch, renderAll, aiColor, myColor, flipped, netMode,
 * undoStack, showGameSettings), engine/bot-engine.js.
 */

const AiPlayer = (() => {
  const STEP_DELAY_MS = 450;
  const DRAFT_DELAY_MS = 700;
  let vsAi = false;  // chosen from the home page; seats assigned at "Start Draft"
  let colorChoice = 'w';   // the human's pick: 'w' | 'b' | 'random'
  let timer = null;
  let queue = [];
  let refusals = 0;

  // The "You Play" row of the React settings modal reads/sets this.
  function setColorChoice(color) {
    colorChoice = color;
    GameBridge.changed();
  }

  // Home page "Play vs AI": a fresh local game against the bot.
  function begin() {
    stop();
    vsAi = true;
    aiColor = null;
    myColor = null;
    newLocalGame();
    showView('game');
    showGameSettings();
  }

  // Home page "Start New Game" (two players at one screen) or going online.
  function end() {
    stop();
    vsAi = false;
    aiColor = null;
    if (!netMode) myColor = null;
  }

  // Called as the draft starts: fixes who plays which color.
  function assignSeats() {
    if (!vsAi) return;
    const human = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice;
    myColor = human;
    aiColor = human === 'w' ? 'b' : 'w';
    flipped = human === 'b';
  }

  function thinking() {
    return !!aiColor && !netMode && botActor(state) === aiColor;
  }

  // Called after every render: if the game now waits on the bot, act soon.
  function schedule() {
    if (!thinking()) { queue = []; return; }
    if (timer) return;
    timer = setTimeout(step, state.phase === 'draft' ? DRAFT_DELAY_MS : STEP_DELAY_MS);
  }

  function step() {
    timer = null;
    if (!thinking()) { queue = []; return; }
    if (!queue.length) queue = chooseBotActions(state, aiColor);
    const action = queue.shift();
    if (!action) return;
    const err = dispatch(action, aiColor);
    if (err) {
      // The plan went stale (e.g. a die rolled differently than simulated):
      // think again, but don't spin forever on an action it keeps getting wrong.
      queue = [];
      if (++refusals > 3) { console.warn('AI gave up on its turn:', err); return; }
      schedule();
      return;
    }
    refusals = 0;
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
    queue = [];
  }

  return {
    begin, end, assignSeats, schedule, stop, thinking, setColorChoice,
    get vsAi() { return vsAi; },
    get colorChoice() { return colorChoice; },
  };
})();
