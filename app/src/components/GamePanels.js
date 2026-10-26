// Everything on the game screen around the board.
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import * as Game from '../lib/game.js';
import { G, E, useGame } from '../lib/game.js';
import { augmentIcons } from '../generated/assets.js';
import { augById, showAugmentDetail } from './augmentBits.js';
import Button from './Button.js';
import { C } from '../theme.js';

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const LOW_TIME_MS = 30 * 1000;
const name = c => (c === 'w' ? 'White' : 'Black');

// Re-renders every 200ms while a clock is running.
function useTicker(active) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setTick(t => t + 1), 200);
    return () => clearInterval(id);
  }, [active]);
}

export function PlayerBar({ color }) {
  useGame();
  const s = G.state;
  const clock = s.phase === 'playing' ? s.clock : null;
  const running = !!(clock && clock.running === color && !s.gameOver);
  useTicker(running);
  const ms = Game.clockMs(color);
  const taken = s.game ? Game.captured()[color] : [];
  const tag = color === G.myColor ? ' (you)' : color === G.aiColor ? ' (AI)' : '';
  return (
    <View style={styles.playerBar}>
      <View style={[styles.dot, { backgroundColor: color === 'w' ? '#e6e6e6' : '#262626' }]} />
      <Text style={styles.playerName}>{name(color)}{tag}</Text>
      <Text style={styles.captured} numberOfLines={1}>{taken.map(t => GLYPH[t] + '︎').join('')}</Text>
      <Text style={[styles.clock, running && styles.clockActive, clock && ms <= LOW_TIME_MS && ms > 0 && styles.clockLow]}>{Game.formatTime(ms)}</Text>
    </View>
  );
}

export function StatusLine() {
  useGame();
  const { text, tone } = Game.statusLine();
  return (
    <View style={[styles.status, tone === 'over' && styles.statusOver, tone === 'draw' && styles.statusDraw, tone === 'check' && styles.statusCheck, tone === 'shield' && styles.statusShield]}>
      <Text style={[styles.statusText, (tone === 'over' || tone === 'draw') && { color: C.goldStrong }]}>{text}</Text>
    </View>
  );
}

function Slot({ k, ability, armed, onPress, extra }) {
  return (
    <Pressable onPress={onPress} disabled={!ability} style={[styles.slot, !ability && styles.slotEmpty, ability && ability.passive && styles.slotPassive, armed && styles.slotArmed]}>
      {ability && <Image source={augmentIcons[ability.id]} style={styles.slotIcon} />}
      <Text style={styles.slotKey}>{k}</Text>
      {extra != null && <Text style={styles.slotExtra}>{extra}</Text>}
    </Pressable>
  );
}

// The selected unit's Q/W/E/R abilities and the army's A/S/D/F ones, plus
// whatever can be called off or stepped out of right now.
export function AbilityBar() {
  useGame();
  const s = G.state;
  if (s.phase !== 'playing' || !s.game || s.gameOver) return null;
  const { color, unit, global } = Game.abilitySlots();
  const cancel = Game.cancelOption();
  const exit = Game.exitOption();
  if (!unit.length && !global.length && !cancel && !exit) return null;
  return (
    <View style={styles.abilityRow}>
      {Game.UNIT_KEYS.map((k, i) => unit[i] && (
        <Slot key={k} k={k} ability={unit[i]} armed={!unit[i].passive && Game.isAbilityArmed(unit[i], k)} onPress={() => Game.tapUnitAbility(k)}
          extra={unit[i].id === 'raiseTheDead' ? s.ghoulGraveyard[color] || 0 : null} />
      ))}
      {Game.GLOBAL_KEYS.map((k, i) => global[i] && (
        <Slot key={k} k={k} ability={global[i]} onPress={() => Game.tapGlobalAbility(k)} />
      ))}
      <View style={{ flex: 1 }} />
      {exit && <Button small title={exit.armed ? 'Move unit' : exit.label} variant={exit.armed ? 'primary' : 'secondary'} onPress={Game.toggleExit} />}
      {cancel && <Button small title={cancel} onPress={Game.cancelAction} />}
    </View>
  );
}

export function VanguardPanel() {
  useGame();
  if (!Game.vanguardPending()) return null;
  const mine = Game.vanguardMine();
  const secs = Math.ceil(Game.vanguardRemainingMs() / 1000);
  return (
    <View style={styles.panel}>
      <Image source={augmentIcons.vanguard} style={styles.panelIcon} />
      <View style={{ flex: 1 }}>
        <Text style={styles.panelTitle}>Vanguard · {secs}s</Text>
        <Text style={styles.panelSub}>
          {mine ? `${G.vanguardSelected ? 'Now tap a gold square' : 'Tap a unit, then a gold square'} · ${G.vanguardPlan.length}/${Game.vanguardZone().length} placed`
            : `${name(G.state.vanguard.color)} is deploying their Vanguard…`}
        </Text>
      </View>
      {mine && <Button small title="Clear" onPress={Game.clearVanguardPlan} />}
      {mine && <Button small title="Deploy" variant="primary" onPress={Game.deployVanguard} />}
    </View>
  );
}

export function ShieldPanel() {
  useGame();
  const s = G.state;
  if (s.phase !== 'playing' || !s.pendingShield || s.pendingStunlock || s.gameOver) return null;
  const { color, sq } = s.pendingShield;
  const mine = Game.isChoosingShield();
  const dir = E.shieldDirAt(s, sq);
  return (
    <View style={styles.panel}>
      <Image source={augmentIcons.bishopsShields} style={styles.panelIcon} />
      <View style={{ flex: 1 }}>
        <Text style={styles.panelTitle}>{mine ? 'Turn your shield' : 'Shield'}</Text>
        <Text style={styles.panelSub}>{mine ? `Tap a square next to the ${sq} bishop: its shield will face that way.` : `${name(color)} is turning the ${sq} bishop's shield…`}</Text>
      </View>
      {mine && <Button small title={`Keep ${dir ? E.shieldDirLabel(color, dir) : ''}`} onPress={Game.keepShield} />}
    </View>
  );
}

// Replay: step through the logged game instead of playing.
function ReplayControls() {
  const r = G.replay;
  return (
    <View style={styles.controls}>
      <Button small title="⏮" accessibilityLabel="First move" onPress={() => Game.replayStep(0)} />
      <Button small title="◀" accessibilityLabel="Previous" onPress={() => Game.replayStep(r.index - 1)} />
      <Text style={styles.replayPos}>{r.index + 1} / {r.frames.length}</Text>
      <Button small title="▶" accessibilityLabel="Next" onPress={() => Game.replayStep(r.index + 1)} />
      <Button small title="⏭" accessibilityLabel="Last move" onPress={() => Game.replayStep(Infinity)} />
      <Button small title="Flip" onPress={() => { G.flipped = !G.flipped; Game.changed(); }} />
    </View>
  );
}

export function Controls() {
  useGame();
  if (G.replay) return <ReplayControls />;
  const draw = Game.drawState();
  const confirmForfeit = () => Alert.alert('Forfeit this game?', 'Your opponent wins.', [
    { text: 'Keep playing', style: 'cancel' },
    { text: 'Forfeit', style: 'destructive', onPress: Game.forfeit },
  ]);
  const canNew = !(G.rankedGame && G.state.phase === 'playing' && !G.state.gameOver);
  return (
    <View style={styles.controls}>
      {canNew && <Button small title="New Game" variant="primary" onPress={Game.newGame} />}
      <Button small title="Flip" onPress={() => { G.flipped = !G.flipped; Game.changed(); }} />
      {!G.netMode && <Button small title="Undo" disabled={!G.undoStack.length} onPress={Game.undoMove} />}
      {Game.canForfeit() && <Button small title="Forfeit" variant="danger" onPress={confirmForfeit} />}
      {draw === 'none' && <Button small title="Offer Draw" onPress={Game.offerDraw} />}
      {draw === 'offered' && <Button small title="Draw Offered" disabled />}
      {draw === 'received' && <Button small title="Accept Draw" variant="primary" onPress={() => Game.answerDraw(true)} />}
      {draw === 'received' && <Button small title="Decline" onPress={() => Game.answerDraw(false)} />}
    </View>
  );
}

function MoveList() {
  const groups = Game.moveGroups();
  const scroll = useRef(null);
  return (
    <ScrollView ref={scroll} style={styles.tabBody} nestedScrollEnabled onContentSizeChange={() => scroll.current && scroll.current.scrollToEnd({ animated: false })}>
      {!groups.length && <Text style={styles.empty}>No moves yet.</Text>}
      {groups.map((g, i) => (
        <View key={i} style={styles.moveTurn}>
          {g.turn && (
            <View style={styles.moveLine}>
              <Text style={styles.moveNum}>{g.num}</Text>
              <View style={[styles.dot, { backgroundColor: g.turn.color === 'w' ? '#e6e6e6' : '#262626' }]} />
              <Text style={styles.moveText}>{g.turn.text || g.turn.san}</Text>
            </View>
          )}
          {g.events.map((e, j) => <Text key={j} style={[styles.moveEvent, e.san === '#' && styles.moveResult]}>{e.text || e.san}</Text>)}
        </View>
      ))}
    </ScrollView>
  );
}

function Chat() {
  const [text, setText] = useState('');
  const scroll = useRef(null);
  const enabled = Game.canChat();
  return (
    <View style={styles.tabBody}>
      <ScrollView ref={scroll} style={{ flex: 1 }} nestedScrollEnabled onContentSizeChange={() => scroll.current && scroll.current.scrollToEnd({ animated: false })}>
        {!G.chat.length && <Text style={styles.empty}>{enabled ? 'Say hello.' : G.netMode ? 'Spectators can only read.' : 'Chat is for online and vs-AI games.'}</Text>}
        {G.chat.map((m, i) => (
          <Text key={i} style={styles.chatLine}>
            <Text style={{ fontWeight: '800', color: m.color === 'w' ? '#f3f5fb' : '#95a0bf' }}>
              {name(m.color)}{m.color === G.myColor ? ' (you)' : !G.netMode && m.color === G.aiColor ? ' (AI)' : ''}{'  '}
            </Text>
            {m.text}
          </Text>
        ))}
      </ScrollView>
      <View style={styles.chatForm}>
        <TextInput
          style={styles.chatInput} value={text} onChangeText={setText} editable={enabled} maxLength={300}
          placeholder={enabled ? 'Say something…' : 'Chat unavailable'} placeholderTextColor={C.textFaint}
          returnKeyType="send" onSubmitEditing={() => { if (Game.sendChat(text)) setText(''); }}
        />
        <Button small title="Send" disabled={!enabled} onPress={() => { if (Game.sendChat(text)) setText(''); }} />
      </View>
    </View>
  );
}

function ActiveAugments() {
  const s = G.state;
  return (
    <ScrollView style={styles.tabBody} nestedScrollEnabled>
      {['w', 'b'].map(c => (
        <View key={c} style={{ marginBottom: 10 }}>
          <Text style={styles.sideLabel}>{name(c)}</Text>
          <View style={styles.augRow}>
            {!s.augments[c].length && <Text style={styles.empty}>No augments.</Text>}
            {s.augments[c].map(id => (
              <Pressable key={id} onPress={() => showAugmentDetail(augById(id))} style={styles.augChip}>
                <Image source={augmentIcons[id]} style={{ width: 22, height: 22 }} />
                <Text style={styles.augChipText}>{augById(id).name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

export function GameTabs() {
  useGame();
  const [tab, setTab] = useState('moves');
  const tabs = [['moves', 'Moves'], ['chat', `Chat${G.chat.length ? ` (${G.chat.length})` : ''}`], ['augments', 'Augments']];
  return (
    <View style={styles.tabs}>
      <View style={styles.tabBar}>
        {tabs.map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)} style={[styles.tab, tab === id && styles.tabActive]}>
            <Text style={[styles.tabText, tab === id && { color: C.goldStrong }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'moves' && <MoveList />}
      {tab === 'chat' && <Chat />}
      {tab === 'augments' && <ActiveAugments />}
    </View>
  );
}

const styles = StyleSheet.create({
  playerBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: C.lineStrong },
  playerName: { color: C.textBright, fontWeight: '700', fontSize: 15 },
  captured: { flex: 1, color: C.textSecondary, fontSize: 15 },
  clock: { color: C.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'], backgroundColor: C.bg2, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  clockActive: { backgroundColor: C.gold, color: '#1b1405' },
  clockLow: { backgroundColor: C.danger, color: '#fff' },
  status: { backgroundColor: C.bg1, borderColor: C.line, borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginTop: 8 },
  statusOver: { borderColor: C.gold },
  statusDraw: { borderColor: C.textSecondary },
  statusCheck: { borderColor: C.danger },
  statusShield: { borderColor: '#a3aab4' },
  statusText: { color: C.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  abilityRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  slot: { width: 48, height: 48, borderRadius: 10, backgroundColor: C.bg2, borderWidth: 1, borderColor: '#b592ff', alignItems: 'center', justifyContent: 'center' },
  slotEmpty: { opacity: 0.3 },
  slotPassive: { borderColor: C.line, opacity: 0.7 },
  slotArmed: { backgroundColor: '#3b2a63', borderColor: C.goldStrong, borderWidth: 2 },
  slotIcon: { width: 34, height: 34 },
  slotKey: { position: 'absolute', top: 1, left: 4, color: C.textSecondary, fontSize: 10, fontWeight: '800' },
  slotExtra: { position: 'absolute', bottom: 1, right: 4, color: C.goldStrong, fontSize: 11, fontWeight: '800' },
  panel: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bg2, borderColor: C.gold, borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 8 },
  panelIcon: { width: 36, height: 36 },
  panelTitle: { color: C.goldStrong, fontWeight: '800', fontSize: 15 },
  panelSub: { color: C.textSecondary, fontSize: 13 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10 },
  replayPos: { color: C.textBright, fontWeight: '800', minWidth: 56, textAlign: 'center', fontVariant: ['tabular-nums'] },
  tabs: { marginTop: 12, backgroundColor: C.bg1, borderColor: C.line, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: C.gold },
  tabText: { color: C.textSecondary, fontWeight: '700' },
  tabBody: { height: 220, padding: 10 },
  empty: { color: C.textFaint, fontSize: 14 },
  moveTurn: { marginBottom: 6 },
  moveLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  moveNum: { color: C.textFaint, width: 28, fontVariant: ['tabular-nums'] },
  moveText: { color: C.text, flex: 1, fontSize: 14 },
  moveEvent: { color: C.textSecondary, fontSize: 13, marginLeft: 52 },
  moveResult: { color: C.goldStrong, fontWeight: '700' },
  chatLine: { color: C.text, fontSize: 14, marginBottom: 4 },
  chatForm: { flexDirection: 'row', gap: 6, marginTop: 6 },
  chatInput: { flex: 1, backgroundColor: C.bg2, color: C.textBright, borderRadius: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: C.line },
  sideLabel: { color: C.textBright, fontWeight: '800', marginBottom: 6 },
  augRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  augChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.bg2, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: C.line },
  augChipText: { color: C.text, fontSize: 13 },
});
