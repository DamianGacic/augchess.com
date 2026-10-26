// Every augment, grouped by kind (src/pages/AugmentsPage.jsx).
import { useState } from 'react';
import { Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import E from '../lib/engine.js';
import { Emblem, KindTag, CostTag, RequiresTag, showAugmentDetail } from '../components/augmentBits.js';
import { C, S } from '../theme.js';

export default function Augments() {
  const [filter, setFilter] = useState('all');
  const kinds = filter === 'all' ? E.AUGMENT_KIND_ORDER : [filter];
  return (
    <ScrollView style={S.screen} contentContainerStyle={S.scroll}>
      <Text style={S.muted}>Every power you can draft, and what it does to the board.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {['all', ...E.AUGMENT_KIND_ORDER].map(kind => {
          const count = kind === 'all' ? E.AUGMENTS.length : E.AUGMENTS.filter(a => E.augmentKind(a) === kind).length;
          const active = filter === kind;
          return (
            <Pressable key={kind} onPress={() => setFilter(kind)} style={[styles.chip, active && { borderColor: kind === 'all' ? C.gold : C.kind[kind], backgroundColor: C.bg3 }]}>
              <Text style={[styles.chipText, kind !== 'all' && { color: C.kind[kind] }]}>{kind === 'all' ? 'All' : E.AUGMENT_KIND_NAMES[kind]} {count}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {kinds.map(kind => {
        const augs = E.AUGMENTS.filter(a => E.augmentKind(a) === kind).sort((a, b) => a.cost - b.cost);
        if (!augs.length) return null;
        return (
          <View key={kind} style={{ gap: 8 }}>
            <Text style={[S.h2, { color: C.kind[kind], marginTop: 8 }]}>{E.AUGMENT_KIND_NAMES[kind]}</Text>
            {augs.map(aug => (
              <Pressable key={aug.id} onPress={() => showAugmentDetail(aug)} style={[S.card, { borderLeftWidth: 3, borderLeftColor: C.kind[kind] }]}>
                <View style={styles.head}>
                  <Emblem id={aug.id} size={44} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.name}>{aug.name}</Text>
                    <View style={styles.tags}><KindTag aug={aug} /><CostTag cost={aug.cost} /></View>
                  </View>
                </View>
                <Text style={S.muted} numberOfLines={4}>{aug.desc}</Text>
                {aug.requires && <View style={styles.tags}><RequiresTag aug={aug} /></View>}
              </Pressable>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: C.bg1 },
  chipText: { color: C.text, fontWeight: '700', fontSize: 13 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: C.textBright, fontWeight: '800', fontSize: 16 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
