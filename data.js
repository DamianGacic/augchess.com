/**
 * data.js — Static data: piece maps, augment & figure definitions, description loader.
 * No game state, no DOM, no dependencies. Must be loaded before all other scripts.
 */

// ─── Piece Unicode Map ────────────────────────────────────────────────────────
const PIECES = {
  wK: '♚', wQ: '♛', wR: '♜', wB: '♝', wN: '♞', wP: '♟',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// ─── Augment Definitions ──────────────────────────────────────────────────────
const AUGMENT_DESCRIPTION_PATH = 'augments/descriptions';

const AUGMENT_IMAGE_PATH = 'augments/images';

// ─── Figure Definitions ───────────────────────────────────────────────────────
const FIGURE_IMAGE_PATH = 'figures/images';

// piece types in display order (pawns first, king last)
const FIGURE_TYPE_ORDER = ['p', 'n', 'b', 'r', 'q', 'k'];
const FIGURE_TYPE_NAMES = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

const FIGURES = [
  // Pawns
  { id: 'archer',      name: 'Archer',      replaces: 'p', image: null, desc: 'A nimble archer who can strike from a distance. Details coming soon.' },
  // Knights
  { id: 'cavalry',     name: 'Cavalry',     replaces: 'n', image: null, desc: 'A mounted warrior who charges across the field. Details coming soon.' },
  // Bishops
  { id: 'longbowman',  name: 'Longbowman',  replaces: 'b', image: null, desc: 'A skilled longbowman who commands the diagonals. Details coming soon.' },
  // Rooks
  { id: 'troll',       name: 'Troll',       replaces: 'r', image: null, desc: 'A hulking troll who dominates the ranks and files. Details coming soon.' },
  // Queens
  { id: 'sorceress',   name: 'Sorceress',   replaces: 'q', image: null, desc: 'A powerful sorceress who bends the rules of movement. Details coming soon.' },
  // Kings
  { id: 'warlord',     name: 'Warlord',     replaces: 'k', image: null, desc: 'A fearless warlord who leads from the front. Details coming soon.' },
];

const AUGMENTS = [
  { id: 'leaping',     name: 'Leaping Pawns', cost: 1, desc: 'Loading description...' },
  { id: 'watchtowers', name: 'Watchtowers',  cost: 1, desc: 'Loading description...' },
  { id: 'kingspawns',  name: "King's Pawns", cost: 2, desc: 'Loading description...' },
  { id: 'mounting',    name: 'Mounting',     cost: 2, desc: 'Loading description...', image: 'mounting.jpg' },
  { id: 'stunlock',    name: 'Stunlock',     cost: 2, desc: 'Loading description...' },
];

const TOWER_SQUARES = { w: ['a1', 'h1'], b: ['a8', 'h8'] };
const ALL_TOWERS = ['a1', 'h1', 'a8', 'h8'];

function augmentDescriptionUrl(id) {
  return `${AUGMENT_DESCRIPTION_PATH}/${id}.txt`;
}

async function loadAugmentDescriptions() {
  await Promise.all(AUGMENTS.map(async aug => {
    try {
      const response = await fetch(augmentDescriptionUrl(aug.id));
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      aug.desc = (await response.text()).trim();
    } catch (err) {
      console.warn(`Could not load augment description for ${aug.id}:`, err);
      aug.desc = aug.desc || 'Description unavailable.';
    }
  }));
}
