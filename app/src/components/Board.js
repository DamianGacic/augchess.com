// The board — app.js renderBoard. Every highlight the site draws with a CSS
// class is a tinted layer here, stacked in the same order.
import { memo } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { G, E, tapSquare, targetingOverlay, isChoosingShield, vanguardPending, vanguardMine, vanguardZone, useGame } from '../lib/game.js';
import { usePrefs, BOARD_THEMES } from '../lib/prefs.js';
import { augmentIcons, figureImages } from '../generated/assets.js';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];
// ︎ keeps iOS from drawing the pawn (and friends) as an emoji.
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const glyph = t => GLYPH[t] + '︎';

// Tints for the site's square classes (style.css).
const TINT = {
  lastMove: 'rgba(205, 210, 60, 0.5)',
  selected: 'rgba(80, 190, 80, 0.6)',
  inCheck: 'rgba(230, 40, 40, 0.75)',
  checkIncoming: 'rgba(240, 110, 60, 0.65)',
  stunned: 'rgba(150, 70, 200, 0.45)',
  brokeRank: 'rgba(140, 90, 90, 0.4)',
  solarMarked: 'rgba(235, 170, 50, 0.5)',
  solarImminent: 'rgba(240, 120, 40, 0.65)',
  teleportMarked: 'rgba(103, 58, 183, 0.3)',
  fireDeathMarked: 'rgba(230, 74, 25, 0.35)',
  warmWelcomeMarked: 'rgba(255, 152, 0, 0.3)',
  lightningZone: 'rgba(255, 220, 40, 0.4)',
  fireZone: 'rgba(240, 90, 40, 0.35)',
  firePriming: 'rgba(200, 40, 10, 0.4)',
  shieldChoice: 'rgba(150, 158, 170, 0.6)',
  vanguardTarget: 'rgba(255, 210, 80, 0.55)',
  shootPreview: 'rgba(120, 120, 120, 0.25)',
};
const TARGET_TINT = {
  stunlock: ['rgba(138, 43, 226, 0.3)', 'rgba(171, 71, 188, 0.75)'],
  solarStrike: ['rgba(255, 152, 0, 0.3)', 'rgba(251, 140, 0, 0.75)'],
  clubbing: ['rgba(76, 175, 80, 0.3)', 'rgba(56, 142, 60, 0.75)'],
  silverBullet: ['rgba(158, 158, 158, 0.4)', 'rgba(117, 117, 117, 0.8)'],
  unstableFireball: ['rgba(244, 67, 54, 0.3)', 'rgba(191, 54, 12, 0.75)'],
  unstableTeleport: ['rgba(103, 58, 183, 0.3)', 'rgba(69, 39, 160, 0.75)'],
  raiseTheDead: ['rgba(123, 31, 162, 0.35)', 'rgba(106, 27, 154, 0.8)'],
};
const SHIELD_ANGLES = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };

// Figures render as artwork instead of a glyph (app.js figureImageKey).
function figureKey(s, type, color) {
  if (type === 'p') {
    const fig = E.figurePawnType(s, color);
    if (fig === 'guardsman') return s.augments[color] && s.augments[color].includes('kingsguard') ? 'kingsguard' : 'guardsman';
    return fig;
  }
  if (type === 'b' && E.figureBishopType(s, color) === 'longbowman') return 'longbowman';
  if (type === 'r' && E.figureRookType(s, color) === 'troll') return 'troll';
  if (type === 'k' && E.hasWarlord(s, color)) return 'warlord';
  return null;
}

// Ghouls share one uncolored art set, a variant assigned per square.
function figureSource(s, key, color, sq) {
  if (key === 'ghoul') {
    const idx = s.ghoulSkin && s.ghoulSkin[color] ? s.ghoulSkin[color][sq] : undefined;
    return figureImages[`ghoul${idx !== undefined ? idx : 0}`];
  }
  const side = color === 'w' ? 'white' : 'black';
  if (key === 'archer' && E.isArcherOnCooldown(s, color, sq)) return figureImages[`archer-${side}-empty`];
  return figureImages[`${key}-${side}`];
}

function Unit({ s, type, color, sq, size, faded }) {
  const key = figureKey(s, type, color);
  if (key) return <Image source={figureSource(s, key, color, sq)} style={{ width: size, height: size, opacity: faded ? 0.35 : 1 }} contentFit="contain" />;
  return (
    <Text style={[styles.glyph, { fontSize: size * 0.9, lineHeight: size, opacity: faded ? 0.35 : 1 }, color === 'w' ? styles.white : styles.black]}>
      {glyph(type)}
    </Text>
  );
}

// A small occupant marker (the garrison of a manned tower, a mounted King).
function Badge({ s, type, color, warlord, size }) {
  return (
    <View style={[styles.badge, { width: size * 0.48, height: size * 0.48, borderRadius: size * 0.24 }, color === 'w' ? styles.badgeWhite : styles.badgeBlack]}>
      {warlord
        ? <Image source={figureImages[`warlord-${color === 'w' ? 'white' : 'black'}`]} style={{ width: size * 0.4, height: size * 0.4 }} contentFit="contain" />
        : <Text style={[styles.glyph, { fontSize: size * 0.36, lineHeight: size * 0.44 }, color === 'w' ? styles.white : styles.black]}>{glyph(type)}</Text>}
    </View>
  );
}

function Square({ sq, size, light, theme, layers, marker, piece, labels, onPress }) {
  return (
    <Pressable onPress={onPress} style={{ width: size, height: size, backgroundColor: light ? theme[0] : theme[1] }}>
      {layers.map((l, i) => <View key={i} pointerEvents="none" style={[StyleSheet.absoluteFill, l]} />)}
      {labels}
      {piece && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>{piece}</View>}
      {marker}
    </Pressable>
  );
}

function Board({ size }) {
  useGame();
  const prefs = usePrefs();
  const s = G.state;
  if (!s.game) return <View style={{ width: size, height: size, backgroundColor: '#182036', borderRadius: 4 }} />;
  const sqSize = size / 8;
  const theme = BOARD_THEMES[prefs.boardTheme] || BOARD_THEMES.brown;
  const ranks = G.flipped ? [...RANKS].reverse() : RANKS;
  const files = G.flipped ? [...FILES].reverse() : FILES;

  const toMove = s.game.turn();
  const toMoveKingSq = s.mounted[toMove] || E.findKingSquare(s, toMove);
  const kingCheck = toMoveKingSq && E.kingThreatenedAfterPly(s, toMove) ? (E.isKingAttacked(s, toMove) ? 'inCheck' : 'checkIncoming') : null;
  const solarBurns = E.solarBurnsThisPly(s);
  const sel = G.selectedSquare;
  const legal = new Map(G.legalMoves.map(m => [m.to, m]));
  const target = targetingOverlay();
  const anyTowers = E.has(s, 'w', 'watchtowers') || E.has(s, 'b', 'watchtowers');

  // Shoot/charge range previews for the selected unit.
  let range = null;
  if (sel) {
    const p = E.pieceAt(s, sel);
    const manned = s.mannedTowers[sel];
    if (manned) {
      if (s.mannedTowerOrigin[sel] === 'b') range = E.longbowShootRangeSquares(sel, s, manned);
      else if (E.figurePawnType(s, manned) === 'archer') range = E.archerShootRangeSquares(sel, manned);
    } else if (p && p.type === 'p') {
      const fig = E.figurePawnType(s, p.color);
      if (fig === 'archer') range = E.archerShootRangeSquares(sel, p.color);
      else if (fig === 'ghoul') range = E.ghoulChargeSquares(s, sel, p.color);
    } else if (p && p.type === 'b' && E.figureBishopType(s, p.color) === 'longbowman') {
      range = E.longbowShootRangeSquares(sel, s, p.color);
    }
  }

  // The King's auras follow him, so they're worked out fresh every render.
  const auras = [];
  for (const color of ['w', 'b']) {
    const kingSq = s.mounted[color] || E.findKingSquare(s, color);
    if (!kingSq) continue;
    if (s.lightningActive[color]) auras.push({ kingSq, zone: E.kingAuraSquares(kingSq), tint: TINT.lightningZone, ring: '#f9a825' });
    if (s.fireActive[color]) auras.push({ kingSq, zone: E.kingAuraSquares(kingSq, E.ringOfFireRadius(s, color)), tint: TINT.fireZone, ring: '#d84315' });
  }

  const shieldChoices = isChoosingShield() ? E.shieldChoiceSquares(s.pendingShield.sq) : null;
  const shieldBlocked = sel && !s.specialSelect && E.anyShieldsInPlay(s)
    ? new Set(E.generateMoves(s, sel, { shieldBlocked: true }).map(m => m.to)) : new Set();

  const vgPending = vanguardPending();
  const vgMine = vanguardMine();
  const vgZone = new Set(vanguardZone());
  const vgPlan = vgMine ? G.vanguardPlan : [];

  const squares = [];
  ranks.forEach((rank, r) => files.forEach((file, f) => {
    const sq = file + rank;
    const light = (FILES.indexOf(file) + Number(rank)) % 2 === 1;
    const layers = [];
    const add = (backgroundColor) => layers.push({ backgroundColor });

    if (anyTowers && E.ALL_TOWERS.includes(sq)) layers.push({ borderWidth: 2, borderColor: 'rgba(80, 50, 20, 0.35)' });
    if (prefs.lastMove && s.lastMove && (sq === s.lastMove.from || sq === s.lastMove.to)) add(TINT.lastMove);
    if (s.stunnedSquares[sq] > 0) add(TINT.stunned);
    if (s.ghoulBrokeRank[toMove].includes(sq)) add(TINT.brokeRank);
    if (s.solarMarked[sq] > 0) add(solarBurns.includes(sq) ? TINT.solarImminent : TINT.solarMarked);
    if (s.teleportMarked[sq] > 0) add(TINT.teleportMarked);
    if (s.fireDeathMarked[sq] > 0) add(TINT.fireDeathMarked);
    if (s.warmWelcomeMarked[sq] > 0) add(TINT.warmWelcomeMarked);
    for (const a of auras) {
      if (sq === a.kingSq) layers.push({ borderWidth: 3, borderColor: a.ring });
      else if (a.zone.includes(sq)) add(a.tint);
    }
    if (s.fireAura[sq] && s.fireAura[sq].turns >= 1) add(TINT.firePriming);
    if (range && range.includes(sq) && !legal.has(sq)) add(TINT.shootPreview);
    if (sel === sq || (vgMine && G.vanguardSelected === sq)) add(TINT.selected);
    if (kingCheck && sq === toMoveKingSq) add(TINT[kingCheck]);
    if (target && target.targetable.has(sq)) add(TARGET_TINT[target.id][target.preview.has(sq) ? 1 : 0]);
    if (shieldChoices && shieldChoices.some(c => c.sq === sq)) add(TINT.shieldChoice);
    if (s.pendingShield && sq === s.pendingShield.sq) layers.push({ borderWidth: 3, borderColor: 'rgba(225, 230, 238, 0.95)' });
    if (vgPending && vgZone.has(sq)) {
      layers.push({ borderWidth: 3, borderColor: 'rgba(255, 200, 70, 0.95)' });
      if (vgMine && G.vanguardSelected && E.isEmpty(s, sq) && !vgPlan.some(p => p.to === sq)) add(TINT.vanguardTarget);
    }

    // Move markers: a dot for a move, a ring for a capture, a crosshair
    // for a shot, claws for a ghoul charge.
    let marker = null;
    const lm = legal.get(sq);
    if (lm && prefs.legalMoves && sq !== sel && !target) {
      const shot = lm.special === 'archerShoot' || lm.special === 'longbowmanShoot';
      const claw = lm.special === 'ghoulCharge' || lm.special === 'ghoulDiagCharge';
      const occupant = E.pieceAt(s, sq);
      const capture = (occupant && occupant.color !== toMove) || lm.captured;
      marker = (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
          {shot ? <Text style={[styles.mark, { fontSize: sqSize * 0.5, color: '#b42828' }]}>⌖</Text>
            : claw ? <Text style={[styles.mark, { fontSize: sqSize * 0.45, color: '#b42828' }]}>⫽</Text>
            : capture ? <View style={{ width: sqSize * 0.9, height: sqSize * 0.9, borderRadius: sqSize, borderWidth: sqSize * 0.08, borderColor: 'rgba(0,0,0,0.3)' }} />
            : <View style={{ width: sqSize * 0.3, height: sqSize * 0.3, borderRadius: sqSize, backgroundColor: 'rgba(0,0,0,0.25)' }} />}
        </View>
      );
    }
    if (shieldBlocked.has(sq)) {
      marker = <Text pointerEvents="none" style={[styles.corner, { fontSize: sqSize * 0.28 }]}>🛡</Text>;
    }

    // The unit on the square.
    let piece = null;
    const p = E.pieceAt(s, sq);
    const pieceSize = sqSize * 0.85;
    if (s.mannedTowers[sq]) {
      const color = s.mannedTowers[sq];
      piece = (
        <View>
          <Unit s={s} type="r" color={color} sq={sq} size={pieceSize} />
          <View style={styles.badgeSpot}><Badge s={s} type={s.mannedTowerOrigin[sq] === 'b' ? 'b' : 'p'} color={color} size={sqSize} /></View>
        </View>
      );
    } else if (p && p.type === 'k' && s.mounted[p.color] === sq) {
      piece = (
        <View>
          <Text style={[styles.glyph, { fontSize: pieceSize * 0.9, lineHeight: pieceSize }, p.color === 'w' ? styles.white : styles.black]}>{glyph('n')}</Text>
          <View style={styles.badgeSpot}><Badge s={s} type="k" color={p.color} warlord={E.hasWarlord(s, p.color)} size={sqSize} /></View>
          {E.hasWarlord(s, p.color) && s.warlordWounded && s.warlordWounded[p.color] && <View style={styles.health} />}
        </View>
      );
    } else if (p) {
      const plannedAway = vgPlan.some(v => v.from === sq);
      const ready = E.readyAbilityMarkers(s, sq);
      const shieldDir = E.shieldDirAt(s, sq);
      piece = (
        <View>
          <Unit s={s} type={p.type} color={p.color} sq={sq} size={pieceSize} faded={plannedAway || (s.vanguardLocked && s.vanguardLocked.includes(sq))} />
          {ready.length > 0 && (
            <View style={styles.ready}>
              {ready.map(id => <Image key={id} source={augmentIcons[id]} style={{ width: sqSize * 0.24, height: sqSize * 0.24 }} />)}
            </View>
          )}
          {p.type === 'k' && E.hasWarlord(s, p.color) && s.warlordWounded && s.warlordWounded[p.color] && <View style={styles.health} />}
          {shieldDir && (
            <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${SHIELD_ANGLES[shieldDir] + (G.flipped ? 180 : 0)}deg` }] }]}>
              <View style={[styles.shieldBar, s.pendingShield && s.pendingShield.sq === sq && styles.shieldPending]} />
            </View>
          )}
        </View>
      );
    }
    // Vanguard: where each planned unit will land.
    const planned = vgPlan.find(v => v.to === sq);
    if (planned) {
      const u = E.pieceAt(s, planned.from);
      if (u) piece = <View style={{ opacity: 0.7 }}><Unit s={s} type={u.type} color={u.color} sq={planned.from} size={pieceSize} /></View>;
    }

    const labels = prefs.coords && (
      <>
        {f === 0 && <Text pointerEvents="none" style={[styles.rankLabel, { color: light ? theme[1] : theme[0], fontSize: sqSize * 0.2 }]}>{rank}</Text>}
        {r === 7 && <Text pointerEvents="none" style={[styles.fileLabel, { color: light ? theme[1] : theme[0], fontSize: sqSize * 0.2 }]}>{file}</Text>}
      </>
    );

    squares.push(
      <Square key={sq} sq={sq} size={sqSize} light={light} theme={theme} layers={layers} marker={marker} piece={piece} labels={labels} onPress={() => tapSquare(sq)} />
    );
  }));

  return <View style={[styles.board, { width: size, height: size }]}>{squares}</View>;
}

export default memo(Board);

const styles = StyleSheet.create({
  board: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 4, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  glyph: { textAlign: 'center', includeFontPadding: false },
  white: { color: '#e6e6e6', textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 0 } },
  black: { color: '#262626', textShadowColor: 'rgba(255,255,255,0.35)', textShadowRadius: 1, textShadowOffset: { width: 0, height: 0 } },
  mark: { fontWeight: '900' },
  corner: { position: 'absolute', top: 1, right: 2 },
  badgeSpot: { position: 'absolute', right: -4, bottom: -4 },
  badge: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  badgeWhite: { backgroundColor: '#5a5f6b', borderColor: '#e6e6e6' },
  badgeBlack: { backgroundColor: '#d8d8d8', borderColor: '#262626' },
  ready: { position: 'absolute', top: -2, right: -4, gap: 1 },
  health: { position: 'absolute', bottom: 0, left: '15%', width: '35%', height: 3, backgroundColor: '#e53935', borderRadius: 2 },
  shieldBar: { position: 'absolute', top: '4%', left: '15%', width: '70%', height: '9%', backgroundColor: '#8d939c', borderRadius: 3, borderWidth: 1, borderColor: '#3e434b' },
  shieldPending: { backgroundColor: '#e1e6ee' },
  rankLabel: { position: 'absolute', top: 1, left: 2, fontWeight: '700' },
  fileLabel: { position: 'absolute', bottom: 0, right: 3, fontWeight: '700' },
});
