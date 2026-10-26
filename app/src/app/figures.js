// Alternative units, by the piece they replace (src/pages/FiguresPage.jsx).
import { Pressable, ScrollView, Text, View } from 'react-native';
import E from '../lib/engine.js';
import { FigureArt, showFigureDetail } from '../components/augmentBits.js';
import { C, S } from '../theme.js';

export default function Figures() {
  return (
    <ScrollView style={S.screen} contentContainerStyle={S.scroll}>
      <Text style={S.muted}>Alternative units that replace standard pieces through Unit Exchange augments.</Text>
      {E.FIGURE_TYPE_ORDER.map(type => {
        const figures = E.FIGURES.filter(f => f.replaces === type);
        if (!figures.length) return null;
        return (
          <View key={type} style={{ gap: 8 }}>
            <Text style={[S.h2, { marginTop: 8 }]}>{E.FIGURE_TYPE_NAMES[type]} Figures</Text>
            {figures.map(fig => (
              <Pressable key={fig.id} onPress={() => showFigureDetail(fig)} style={[S.card, { flexDirection: 'row', gap: 12, alignItems: 'center' }]}>
                <FigureArt fig={fig} size={72} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: C.textBright, fontWeight: '800', fontSize: 16 }}>{fig.name}</Text>
                  <Text style={{ color: C.kind.unit, fontSize: 12, fontWeight: '700' }}>
                    Replaces {E.FIGURE_TYPE_NAMES[fig.replaces]}{!fig.image ? ' · Art pending' : ''}
                  </Text>
                  <Text style={S.muted} numberOfLines={3}>{fig.desc}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}
