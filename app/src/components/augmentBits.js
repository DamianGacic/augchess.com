// Emblems, tags and the augment/figure detail sheet (views.js).
import { useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import E from '../lib/engine.js';
import { augmentIcons, figureIcons, figureImages, descriptions } from '../generated/assets.js';
import Button from './Button.js';
import { C, S } from '../theme.js';

// Fill in the descriptions the site fetches at runtime.
for (const aug of E.AUGMENTS) if (descriptions[aug.id]) aug.desc = descriptions[aug.id];

export const augById = id => E.AUGMENTS.find(a => a.id === id);

export function Emblem({ id, size = 40, figure = false, style }) {
  const source = (figure ? figureIcons : augmentIcons)[id];
  return <Image source={source} style={[{ width: size, height: size }, style]} contentFit="contain" />;
}

// Figure artwork for the dark UI: the white-side render, else its emblem.
export function FigureArt({ fig, size }) {
  if (!fig.image) return <Emblem id={fig.id} figure size={size} />;
  const key = fig.image.replace('-black.', '-white.').replace(/\.(png|svg)$/, '');
  return <Image source={figureImages[key]} style={{ width: size, height: size }} contentFit="contain" />;
}

export function KindTag({ aug }) {
  const kind = E.augmentKind(aug);
  return <Text style={[styles.tag, { color: C.kind[kind], borderColor: C.kind[kind] }]}>{E.AUGMENT_KIND_NAMES[kind]}</Text>;
}

export function CostTag({ cost }) {
  return <Text style={[styles.tag, { color: C.gold, borderColor: C.goldDeep }]}>{cost} {cost === 1 ? 'point' : 'points'}</Text>;
}

export function RequiresTag({ aug }) {
  const parent = augById(aug.requires);
  return <Text style={[styles.tag, { color: C.textSecondary, borderColor: C.line }]}>Requires {parent ? parent.name : aug.requires}</Text>;
}

// ─── Detail sheet ────────────────────────────────────────────────────────────
let detail = null; // { aug } | { fig }
const listeners = new Set();
const setDetail = d => { detail = d; listeners.forEach(l => l()); };
export const showAugmentDetail = aug => setDetail({ aug });
export const showFigureDetail = fig => setDetail({ fig });

export function DetailSheet() {
  const d = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => detail);
  const close = () => setDetail(null);
  return (
    <Modal visible={!!d} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={S.backdrop} onPress={close}>
        <Pressable style={S.sheet} onPress={() => {}}>
          {d && d.aug && (
            <ScrollView contentContainerStyle={{ gap: 10 }}>
              <View style={styles.head}>
                <Emblem id={d.aug.id} size={56} />
                <Text style={[S.h2, { flex: 1 }]}>{d.aug.name}</Text>
              </View>
              <View style={styles.tags}>
                <KindTag aug={d.aug} />
                <CostTag cost={d.aug.cost} />
                {d.aug.requires && <RequiresTag aug={d.aug} />}
              </View>
              <Text style={S.body}>{d.aug.desc}</Text>
            </ScrollView>
          )}
          {d && d.fig && (
            <ScrollView contentContainerStyle={{ gap: 10, alignItems: 'center' }}>
              <FigureArt fig={d.fig} size={140} />
              <Text style={S.h2}>{d.fig.name}</Text>
              <Text style={S.muted}>Replaces: {E.FIGURE_TYPE_NAMES[d.fig.replaces]}</Text>
              <Text style={S.body}>{d.fig.desc}</Text>
            </ScrollView>
          )}
          <Button title="Close" onPress={close} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
});
