// The repo's shared rules code — the same files the server runs — merged
// into one object, the way the browser sees them as globals. index.js's
// applyAction wraps the draft/chess/augments engines, so it goes last.
const { Chess } = require('../../../chess.js');
const data = require('../../../data.js');

const E = Object.assign(
  { Chess },
  data,
  require('../../../engine/draft-engine.js'),
  require('../../../engine/chess-engine.js'),
  require('../../../engine/gameover-engine.js'),
  require('../../../engine/augments-engine.js'),
  require('../../../engine/clock-engine.js'),
  require('../../../engine/bot-engine.js'),
  { applyAction: require('../../../engine/index.js').applyAction },
);

export default E;
