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
  { id: 'archer',      name: 'Archer',      replaces: 'p', image: 'archer-black.png', desc: 'An archer who moves quietly forward or diagonally, then strikes from a distance — the field two squares ahead, or either square flanking it — without ever leaving its position. Needs a moment to nock a fresh arrow, so it can’t shoot again the turn right after it fires.' },
  { id: 'apprentice',  name: 'Apprentice',  replaces: 'p', image: null, desc: 'A cautious apprentice who has not yet learned to fight. It advances forward or diagonally onto open ground but can never capture a thing.' },
  { id: 'ghoul',       name: 'Ghoul',       replaces: 'p', image: 'ghoul0.png', desc: 'A relentless ghoul that shambles straight ahead, clawing at the square directly before it — or charging an enemy two fields ahead across an empty square — but never diagonally.' },
  { id: 'guardsman',   name: 'Guardsman',   replaces: 'p', image: null, desc: 'A disciplined guardsman who can shift to any adjacent square, yet still strikes only in the classic forward-diagonal pawn pattern.' },
  { id: 'spearman',    name: 'Spearman',    replaces: 'p', image: 'spearman-black.png', desc: 'A braced spearman who only ever moves or strikes one square straight ahead — but any foe that charges in from directly ahead to cut it down is skewered in turn.' },
  // Knights
  { id: 'cavalry',     name: 'Cavalry',     replaces: 'n', image: null, desc: 'A mounted warrior who charges across the field. Details coming soon.' },
  // Bishops
  { id: 'longbowman',  name: 'Longbowman',  replaces: 'b', image: 'longbowman-black.png', desc: 'A skilled longbowman who steps to any free adjacent square, then strikes any unit exactly two squares away in a straight or diagonal line — without ever closing the distance.' },
  // Rooks
  { id: 'troll',       name: 'Troll',       replaces: 'r', image: 'troll-black.png', desc: 'A hulking troll who dominates the ranks and files, walking as far as it likes along either — but only onto open ground, never capturing by moving. Once a turn it can instead club an entire adjacent quadrant, flattening every unit inside.' },
  // Queens
  { id: 'sorceress',   name: 'Sorceress',   replaces: 'q', image: null, desc: 'A powerful sorceress who bends the rules of movement. Details coming soon.' },
  // Kings
  { id: 'warlord',     name: 'Warlord',     replaces: 'k', image: null, desc: 'A fearless warlord who leads from the front. Details coming soon.' },
];

const AUGMENTS = [
  { id: 'leaping',     name: 'Leaping Pawns', cost: 1, desc: 'Loading description...' },
  { id: 'watchtowers', name: 'Watchtowers',  cost: 1, desc: 'Loading description...' },
  { id: 'mounting',    name: 'Mounting',     cost: 2, desc: 'Loading description...', image: 'mounting.jpg' },
  { id: 'vanguard',    name: 'Vanguard',     cost: 3, desc: 'Loading description...' },
  { id: 'legion',      name: 'Legion',       cost: 8, desc: 'Loading description...' },
  { id: 'stunlock',    name: 'Stunlock',     cost: 5, desc: 'Loading description...', category: 'ability' },
  { id: 'apprentices', name: 'Apprentices', cost: 1, desc: 'Loading description...', exchanges: 'apprentice' },
  { id: 'archers',     name: 'Archers',     cost: 4, desc: 'Loading description...', exchanges: 'archer' },
  { id: 'ghouls',      name: 'Ghouls',      cost: 2, desc: 'Loading description...', exchanges: 'ghoul' },
  { id: 'guardsmen',   name: 'Guardsmen',  cost: 2, desc: 'Loading description...', exchanges: 'guardsman' },
  { id: 'spearmen',    name: 'Spearmen',   cost: 2, desc: 'Loading description...', exchanges: 'spearman' },
  { id: 'trolls',      name: 'Trolls',      cost: 3, desc: 'Loading description...', exchanges: 'troll' },
  { id: 'longbowmen',  name: 'Longbowmen', cost: 3, desc: 'Loading description...', exchanges: 'longbowman' },
  // Ghoul follow-ups — only offered to a player once they own Ghouls.
  { id: 'deviant',      name: 'Deviant',      cost: 2, desc: 'Loading description...', requires: 'ghouls' },
  { id: 'breakingRank', name: 'Breaking Rank', cost: 3, desc: 'Loading description...', requires: 'ghouls', category: 'ability' },
  { id: 'raiseTheDead', name: 'Raise the Dead', cost: 7, desc: 'Loading description...', requires: 'ghouls', category: 'ability' },
  { id: 'solarStrike',  name: 'Solar Strike',  cost: 12, desc: 'Loading description...', category: 'ability' },
  { id: 'advance',      name: 'Advance',       cost: 3, desc: 'Loading description...', category: 'ability' },
  { id: 'silverBullet', name: 'Silver Bullet', cost: 3, desc: 'Loading description...', category: 'ability' },
  { id: 'kingsLightning', name: 'Lightning Aura', cost: 5, desc: 'Loading description...', category: 'ability' },
  { id: 'ringOfFire', name: 'Ring of Fire', cost: 3, desc: 'Loading description...', category: 'ability' },
  { id: 'relentlessAdvance', name: 'Relentless Advance', cost: 3, desc: 'Loading description...', category: 'ability' },
  { id: 'coronation', name: 'Coronation', cost: 4, desc: 'Loading description...', category: 'ability' },
  // Ring of Fire follow-up — only offered to a player once they own Ring of Fire.
  { id: 'inferno', name: 'Inferno', cost: 5, desc: 'Loading description...', requires: 'ringOfFire' },
  // Apprentice follow-ups — only offered to a player once they own Apprentices.
  { id: 'unstableFireball', name: 'Unstable Fireball', cost: 3, desc: 'Loading description...', requires: 'apprentices', category: 'ability' },
  { id: 'unstableTeleport', name: 'Unstable Teleport', cost: 2, desc: 'Loading description...', requires: 'apprentices', category: 'ability' },
  // Guardsmen follow-ups — only offered to a player once they own Guardsmen.
  { id: 'kingsguard', name: 'Kingsguard', cost: 3, desc: 'Loading description...', requires: 'guardsmen' },
  // Archer follow-ups — only offered to a player once they own Archers.
  { id: 'quickdraw',   name: 'Quickdraw',    cost: 2, desc: 'Loading description...', requires: 'archers' },
  { id: 'swift',       name: 'Swift',        cost: 2, desc: 'Loading description...', requires: 'archers' },
  { id: 'nimble',      name: 'Nimble',       cost: 2, desc: 'Loading description...', requires: 'archers' },
  { id: 'warmWelcome', name: 'Warm Welcome', cost: 2, desc: 'Loading description...', requires: 'archers', category: 'ability' },
];

const TOWER_SQUARES = { w: ['a1', 'h1'], b: ['a8', 'h8'] };
const ALL_TOWERS = ['a1', 'h1', 'a8', 'h8'];

// ─── Augment Kinds & Icons ────────────────────────────────────────────────────
// Visual kind of an augment — drives its emblem frame color (see
// tools/build-icons.js and the --kind-* colors in style.css) and how the
// Augments page groups it.
const AUGMENT_KIND_ORDER = ['movement', 'unit', 'ability', 'upgrade'];
const AUGMENT_KIND_NAMES = { movement: 'Movement', unit: 'Unit Exchange', ability: 'Ability', upgrade: 'Upgrade' };

function augmentKind(aug) {
  if (aug.exchanges) return 'unit';
  if (aug.category === 'ability') return 'ability';
  if (aug.requires) return 'upgrade';
  return 'movement';
}

// Emblem SVG for an augment or unit ability id (generated by tools/build-icons.js).
function augmentIconUrl(id) {
  return `augments/icons/${id}.svg`;
}

function figureIconUrl(id) {
  return `figures/icons/${id}.svg`;
}

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

// Pure data/no DOM (loadAugmentDescriptions aside, which the server never
// calls) — reused as-is on the server so client and server always agree on
// costs/rules. Same dual-export shape as chess.js: unchanged as a browser
// <script>, requireable in Node.
{
  const exportsObj = {
    PIECES, PIECE_VALUES, AUGMENT_DESCRIPTION_PATH, AUGMENT_IMAGE_PATH, FIGURE_IMAGE_PATH,
    FIGURE_TYPE_ORDER, FIGURE_TYPE_NAMES, FIGURES, AUGMENTS, TOWER_SQUARES, ALL_TOWERS,
    AUGMENT_KIND_ORDER, AUGMENT_KIND_NAMES, augmentKind, augmentIconUrl, figureIconUrl,
    augmentDescriptionUrl, loadAugmentDescriptions,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    // Top-level `const`/`let` in a classic <script> are bare-identifier
    // globals, NOT window properties — engine/*.js reads these off `root`
    // (window) in the browser, so they need to be assigned explicitly here.
    Object.assign(typeof window !== 'undefined' ? window : globalThis, exportsObj);
  }
}
