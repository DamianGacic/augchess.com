#!/usr/bin/env node
/**
 * tools/build-icons.js — Generates every emblem SVG the UI uses:
 *   augments/icons/<augmentId>.svg   one per AUGMENTS entry (+ unit abilities
 *                                    like Clubbing that aren't augments)
 *   figures/icons/<figureId>.svg     one per FIGURES entry
 *   assets/logo.svg, favicon.svg     the AugChess mark
 *
 * Each emblem is a game-icons.net glyph (CC BY 3.0 — credited in the site
 * footer and assets/CREDITS.md) set inside a chamfered frame whose colors
 * come from the augment's kind (see augmentKind() in data.js), so every icon
 * shares one visual language.
 *
 * Adding an augment: add its id → glyph name to GLYPHS below and rerun:
 *   node tools/build-icons.js [path/to/game-icons/icons.json]
 * Without a path it downloads the pinned icon set from jsDelivr. Browse glyph
 * names at https://game-icons.net.
 */

const fs = require('fs');
const path = require('path');
const { AUGMENTS, FIGURES, augmentKind } = require('../data.js');

const ICON_SET_URL = 'https://cdn.jsdelivr.net/npm/@iconify-json/game-icons@1.2.1/icons.json';
const ROOT = path.join(__dirname, '..');

// Augment / ability id → game-icons glyph name.
const GLYPHS = {
  leaping: 'jump-across',
  watchtowers: 'watchtower',
  mounting: 'cloaked-figure-on-horseback',
  legion: 'guards',
  stunlock: 'crossed-chains',
  apprentices: 'wizard-face',
  archers: 'bowman',
  ghouls: 'shambling-zombie',
  guardsmen: 'visored-helm',
  spearmen: 'spears',
  trolls: 'troll',
  longbowmen: 'high-shot',
  deviant: 'divergence',
  breakingRank: 'claw-slashes',
  raiseTheDead: 'raise-zombie',
  solarStrike: 'sunbeams',
  advance: 'team-upgrade',
  silverBullet: 'silver-bullet',
  kingsLightning: 'lightning-dome',
  ringOfFire: 'fire-ring',
  relentlessAdvance: 'rally-the-troops',
  coronation: 'crown',
  inferno: 'wildfires',
  unstableFireball: 'fireball',
  unstableTeleport: 'teleport',
  kingsguard: 'custodian-helmet',
  quickdraw: 'fast-arrow',
  swift: 'sprint',
  nimble: 'acrobatic',
  warmWelcome: 'arrowed',
  // Unit abilities granted by an exchange rather than drafted directly.
  clubbing: 'wood-club',
};
const EXTRA_ICONS = [{ id: 'clubbing', kind: 'ability' }];

// Figure id → glyph name (shared with the matching exchange augment).
const FIGURE_GLYPHS = {
  archer: 'bowman',
  apprentice: 'wizard-face',
  ghoul: 'shambling-zombie',
  guardsman: 'visored-helm',
  spearman: 'spears',
  cavalry: 'cavalry',
  longbowman: 'high-shot',
  troll: 'troll',
  sorceress: 'witch-face',
  warlord: 'warlord-helmet',
};

// Frame palette per kind: gradient top → bottom. Mirrors --kind-* in style.css.
const PALETTES = {
  movement: { top: '#4cc2f0', bottom: '#0c3354' },
  unit:     { top: '#f4ad44', bottom: '#5e2a06' },
  ability:  { top: '#b592ff', bottom: '#30176a' },
  upgrade:  { top: '#4fdba4', bottom: '#0a4234' },
  figure:   { top: '#a3aecb', bottom: '#232b42' },
  logo:     { top: '#f8d778', bottom: '#8d5a10' },
};

const OUTER = 'M22 2H106L126 22V106L106 126H22L2 106V22Z';
const INNER = 'M25 8H103L120 25V103L103 120H25L8 103V25Z';

function emblem(body, palette, glyphColor = '#fbf7ee') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="${palette.top}"/><stop offset="1" stop-color="${palette.bottom}"/></linearGradient>
<radialGradient id="glow" cx=".5" cy=".44" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset=".55" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
<filter id="drop" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#000" flood-opacity=".5"/></filter>
</defs>
<path d="${OUTER}" fill="url(#bg)"/>
<path d="${OUTER}" fill="url(#glow)"/>
<path d="${INNER}" fill="none" stroke="url(#rim)" stroke-width="2"/>
<g filter="url(#drop)" color="${glyphColor}" transform="translate(24 22) scale(.15625)">${body}</g>
</svg>
`;
}

async function loadIconSet() {
  const local = process.argv[2];
  if (local) return JSON.parse(fs.readFileSync(local, 'utf8'));
  const res = await fetch(ICON_SET_URL);
  if (!res.ok) throw new Error(`Could not download icon set: ${res.status}`);
  return res.json();
}

function write(relPath, svg) {
  const file = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, svg);
}

async function main() {
  const set = await loadIconSet();
  const glyph = name => {
    const icon = set.icons[name];
    if (!icon) throw new Error(`Unknown game-icons glyph: ${name}`);
    return icon.body;
  };

  const entries = AUGMENTS.map(aug => ({ id: aug.id, kind: augmentKind(aug) })).concat(EXTRA_ICONS);
  for (const { id, kind } of entries) {
    if (!GLYPHS[id]) throw new Error(`No glyph mapped for augment "${id}" — add it to GLYPHS`);
    write(`augments/icons/${id}.svg`, emblem(glyph(GLYPHS[id]), PALETTES[kind]));
  }

  for (const fig of FIGURES) {
    if (!FIGURE_GLYPHS[fig.id]) throw new Error(`No glyph mapped for figure "${fig.id}" — add it to FIGURE_GLYPHS`);
    write(`figures/icons/${fig.id}.svg`, emblem(glyph(FIGURE_GLYPHS[fig.id]), PALETTES.figure));
  }

  const logo = emblem(glyph('chess-knight'), PALETTES.logo, '#141a2b');
  write('assets/logo.svg', logo);
  write('favicon.svg', logo);

  console.log(`Wrote ${entries.length} augment, ${FIGURES.length} figure and 2 logo SVGs.`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
