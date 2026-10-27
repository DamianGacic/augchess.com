// The game's full-screen steps and pop-ups: settings, the augment draft,
// promotion and the online lobby (src/game/*.jsx and the site's mp modal).
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Share, Text, TextInput, View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Game from '../lib/game.js';
import { G, E, useGame } from '../lib/game.js';
import { Emblem, augById, showAugmentDetail } from './augmentBits.js';
import Button from './Button.js';
import { C, S } from '../theme.js';

const MINUTES = [3, 5, 15, 25, 45];
const POINT_PRESETS = [3, 9, 14];
const COLORS = [['w', 'White'], ['b', 'Black'], ['random', 'Random']];

function Chip({ label, selected, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && { color: '#1b1405' }]}>{label}</Text>
    </Pressable>
  );
}

// Pre-draft settings: time control and auction points (either player can
// change them online — every change goes through dispatch), plus the
// human's color against the AI.
export function SettingsSheet() {
  useGame();
  const [custom, setCustom] = useState(null);
  const s = G.state;
  if (s.phase !== 'settings') return null;
  const { minutes, points } = s.settings;
  const update = patch => Game.dispatch({ type: 'settingsUpdate', ...patch });
  const isPreset = POINT_PRESETS.includes(points);
  const typeCustom = text => {
    setCustom(text);
    const value = Number(text);
    if (Number.isInteger(value) && value >= 1 && value <= 99) update({ points: value });
  };
  return (
    <View style={[StyleSheet.absoluteFill, S.backdrop]}>
      <View style={S.sheet}>
        <Text style={S.h2}>Game Settings</Text>
        <Text style={S.muted}>Agree on a time control and auction points, then start the draft. Either player can choose.</Text>
        <Text style={styles.label}>Time Control</Text>
        <View style={styles.chips}>{MINUTES.map(m => <Chip key={m} label={`${m} min`} selected={m === minutes} onPress={() => update({ minutes: m })} />)}</View>
        <Text style={styles.label}>Auction Points</Text>
        <View style={styles.chips}>
          {POINT_PRESETS.map(p => <Chip key={p} label={`${p} pts`} selected={p === points} onPress={() => { setCustom(null); update({ points: p }); }} />)}
          <TextInput
            style={[styles.custom, !isPreset && styles.chipSelectedBorder]} keyboardType="number-pad" maxLength={2}
            placeholder="Custom" placeholderTextColor={C.textFaint}
            value={custom ?? (isPreset ? '' : String(points))} onChangeText={typeCustom} onBlur={() => setCustom(null)}
          />
        </View>
        {G.vsAi && (
          <>
            <Text style={styles.label}>You Play</Text>
            <View style={styles.chips}>{COLORS.map(([c, label]) => <Chip key={c} label={label} selected={G.colorChoice === c} onPress={() => Game.setColorChoice(c)} />)}</View>
          </>
        )}
        <Button title="Start Draft" variant="primary" onPress={Game.startDraft} />
      </View>
    </View>
  );
}

// Which group an augment is listed under in the draft (DraftModal.jsx).
function draftGroup(aug) {
  if (aug.category === 'pregame') return 'Pre-game';
  if (aug.category === 'wincondition') return 'Win Condition';
  if (aug.exchanges) return 'Unit Exchange';
  if (aug.category === 'unitability') return 'Unit Abilities';
  if (aug.category === 'globalability') return 'Global Abilities';
  return 'Utility';
}
const GROUPS = ['Pre-game', 'Win Condition', 'Utility', 'Unit Exchange', 'Unit Abilities', 'Global Abilities'];
const children = id => E.AUGMENTS.filter(a => a.requires === id);

// One player's picks, each pick that unlocks follow-ups followed by them —
// a follow-up is bought from here once its parent is owned.
function Picks({ color }) {
  const ds = G.state.draftState;
  const owned = ds.owned[color];
  const canPick = ds.current === color && Game.canActFor(color);
  const top = owned.filter(id => !augById(id).requires);
  return (
    <View style={styles.picks}>
      <Text style={styles.picksLabel}>{color === 'w' ? 'White' : 'Black'} · {ds.points[color]} pts left</Text>
      {!top.length && <Text style={S.muted}>No picks yet</Text>}
      <View style={styles.pickRow}>
        {top.map(id => (
          <View key={id} style={styles.pickGroup}>
            <Pressable onPress={() => showAugmentDetail(augById(id))} style={styles.pick}>
              <Emblem id={id} size={22} /><Text style={styles.pickText}>{augById(id).name}</Text>
            </Pressable>
            {children(id).map(child => {
              const has = owned.includes(child.id);
              const short = child.cost - ds.points[color];
              const enabled = !has && canPick && short <= 0;
              return (
                <Pressable
                  key={child.id}
                  onPress={() => (has ? showAugmentDetail(child) : enabled && Game.dispatch({ type: 'draftPick', augId: child.id }))}
                  onLongPress={() => showAugmentDetail(child)}
                  style={[styles.pick, styles.child, !has && styles.childGreyed, enabled && styles.childBuyable]}
                >
                  <Emblem id={child.id} size={20} />
                  <Text style={styles.pickText}>{child.name} {has ? '' : `· ${child.cost}${short > 0 ? ` (${short} short)` : ''}`}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

// locked: not in this new player's starter set (Game.starterSet).
function DraftCard({ aug, locked }) {
  const ds = G.state.draftState;
  const cur = ds.current;
  const other = cur === 'w' ? 'b' : 'w';
  const disabled = locked || ds.points[cur] < aug.cost || E.conflictsWithOwned(G.state, cur, aug) ||
    ds.owned[other].includes(aug.id) || !Game.canActFor(cur);
  return (
    <Pressable
      onPress={() => !disabled && Game.dispatch({ type: 'draftPick', augId: aug.id })}
      onLongPress={() => showAugmentDetail(aug)}
      style={[styles.card, disabled && styles.cardDisabled, locked && styles.cardLocked]}
      accessibilityLabel={locked ? `${aug.name}, locked: unlocks after ${E.UNLOCK_GAMES} games` : undefined}
    >
      <Emblem id={aug.id} size={44} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.cardHead}>
          <Text style={styles.cardName}>{aug.name}</Text>
          {ds.owned.w.includes(aug.id) && <Text style={styles.owner}>W</Text>}
          {ds.owned.b.includes(aug.id) && <Text style={styles.owner}>B</Text>}
          <Text style={styles.cost}>{locked ? '🔒' : aug.cost}</Text>
        </View>
        <Text style={styles.cardDesc} numberOfLines={3}>{aug.desc}</Text>
      </View>
      <Pressable hitSlop={10} onPress={() => showAugmentDetail(aug)}><Text style={styles.info}>ⓘ</Text></Pressable>
    </Pressable>
  );
}

export function DraftSheet() {
  useGame();
  const s = G.state;
  if (s.phase !== 'draft' || !s.draftState) return null;
  const ds = s.draftState;
  // Follow-ups only show under their parent; the current player's own
  // picks move to their picks row instead of lingering in the list.
  const list = [...E.AUGMENTS].sort((a, b) => a.cost - b.cost).filter(a => !a.requires && !ds.owned[ds.current].includes(a.id));
  const thinking = Game.aiThinking();
  // Starter limits only apply to picks this player makes.
  const starter = Game.canActFor(ds.current) ? Game.starterSet() : null;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg0 }]}>
      <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
        <View style={styles.draftHead}>
          <Text style={S.h2}>Augment Draft</Text>
          <Text style={[S.muted, { color: C.goldStrong }]}>
            {thinking ? '🤖 The AI is choosing…' : `${ds.current === 'w' ? 'White' : 'Black'}, choose an augment (or pass)`}
          </Text>
          {starter && (
            <Text style={styles.unlockNote}>
              New player: {E.STARTER_AUGMENTS} starter augments. Everything unlocks after {E.UNLOCK_GAMES} games ({G.gamesPlayed}/{E.UNLOCK_GAMES}).
            </Text>
          )}
          <Picks color="w" />
          <Picks color="b" />
        </View>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
          {GROUPS.map(group => {
            const augs = list.filter(a => draftGroup(a) === group);
            if (!augs.length) return null;
            return (
              <View key={group} style={{ gap: 8 }}>
                <Text style={styles.label}>{group}</Text>
                {augs.map(aug => <DraftCard key={aug.id} aug={aug} locked={!!starter && !starter.has(aug.id)} />)}
              </View>
            );
          })}
          <Text style={[S.muted, { textAlign: 'center' }]}>Tap to pick · long-press for details</Text>
        </ScrollView>
        <View style={{ padding: 12 }}>
          <Button title="Pass / Done" disabled={!Game.canActFor(ds.current)} onPress={() => Game.dispatch({ type: 'draftPass' })} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const PROMOS = [['q', '♛', 'Queen'], ['r', '♜', 'Rook'], ['b', '♝', 'Bishop'], ['n', '♞', 'Knight']];

export function PromotionSheet() {
  useGame();
  const p = G.pendingPromotion;
  return (
    <Modal visible={!!p} transparent animationType="fade" onRequestClose={Game.cancelPromotion}>
      <Pressable style={S.backdrop} onPress={Game.cancelPromotion}>
        <View style={S.sheet}>
          <Text style={S.h2}>Promote Pawn</Text>
          <View style={styles.promos}>
            {p && PROMOS.map(([k, g, label]) => (
              <Pressable key={k} onPress={() => Game.choosePromotion(k)} style={styles.promo} accessibilityLabel={label}>
                <Text style={[styles.promoGlyph, p.color === 'w' ? { color: '#e6e6e6' } : { color: '#262626', textShadowColor: '#fff', textShadowRadius: 2 }]}>{g + '︎'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

// Creating a link, searching the queue, joining: the site's multiplayer modal.
export function LobbySheet({ onClose }) {
  useGame();
  const [copied, setCopied] = useState(false);
  const l = G.lobby;
  const close = () => { Game.closeLobby(); if (onClose) onClose(); };
  return (
    <Modal visible={!!l} transparent animationType="fade" onRequestClose={close}>
      <View style={S.backdrop}>
        {l && (
          <View style={S.sheet}>
            <Text style={S.h2}>{l.title}</Text>
            <Text style={S.body}>{l.status}</Text>
            {l.link && (
              <>
                <Text selectable style={[S.input, { fontSize: 13 }]}>{l.link}</Text>
                <Text style={S.muted}>Or have them enter the code <Text style={{ color: C.goldStrong, fontWeight: '800' }}>{l.gameId}</Text> in the app.</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button style={{ flex: 1 }} title={copied ? 'Copied!' : 'Copy'} onPress={async () => { await Clipboard.setStringAsync(l.link); setCopied(true); setTimeout(() => setCopied(false), 2000); }} />
                  <Button style={{ flex: 1 }} title="Share" variant="primary" onPress={() => Share.share({ message: `Play AugChess with me: ${l.link}` })} />
                </View>
              </>
            )}
            {l.waiting && <ActivityIndicator color={C.gold} />}
            <Button title={l.link ? 'Hide' : 'Close'} onPress={l.link ? Game.closeLobby : close} />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  label: { color: C.textSecondary, fontWeight: '800', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.bg2, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: C.gold, borderColor: C.goldStrong },
  chipSelectedBorder: { borderColor: C.gold },
  chipText: { color: C.text, fontWeight: '700' },
  custom: { width: 80, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.bg2, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, color: C.textBright },
  draftHead: { padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.bg1 },
  picks: { gap: 4 },
  picksLabel: { color: C.textBright, fontWeight: '800', fontSize: 13 },
  pickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pickGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.bg2, borderRadius: 999, borderWidth: 1, borderColor: C.gold, paddingVertical: 3, paddingHorizontal: 8 },
  pickText: { color: C.text, fontSize: 12, fontWeight: '600' },
  child: { borderColor: C.success },
  childGreyed: { opacity: 0.5, borderStyle: 'dashed' },
  childBuyable: { opacity: 1 },
  card: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.bg1, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10 },
  cardLocked: { opacity: 0.35 },
  unlockNote: { color: C.gold, fontSize: 13 },
  cardDisabled: { opacity: 0.4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardName: { color: C.textBright, fontWeight: '800', fontSize: 15, flexShrink: 1 },
  owner: { color: C.bg0, backgroundColor: C.textSecondary, fontSize: 10, fontWeight: '900', paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' },
  cost: { marginLeft: 'auto', color: '#1b1405', backgroundColor: C.gold, fontWeight: '900', paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  cardDesc: { color: C.textSecondary, fontSize: 13, lineHeight: 18 },
  info: { color: C.textSecondary, fontSize: 20, paddingHorizontal: 4 },
  promos: { flexDirection: 'row', justifyContent: 'space-around' },
  promo: { width: 64, height: 64, borderRadius: 12, backgroundColor: '#b58863', alignItems: 'center', justifyContent: 'center' },
  promoGlyph: { fontSize: 48, lineHeight: 56 },
});
