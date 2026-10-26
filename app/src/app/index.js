// Home (src/pages/HomePage.jsx): start a game, or go browse.
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import * as Game from '../lib/game.js';
import E from '../lib/engine.js';
import { useAuth } from '../lib/auth.js';
import { SERVER_URL } from '../lib/config.js';
import { Emblem, showAugmentDetail } from '../components/augmentBits.js';
import Button from '../components/Button.js';
import { C, S } from '../theme.js';

const STEPS = [
  ['01', 'coronation', 'Set the stakes', 'Agree on a time control and how many auction points each side gets to spend.'],
  ['02', 'archers', 'Draft augments', 'Take turns picking augments. Swap your pawns for Archers or Ghouls, arm your King with Silver Bullet, or unlock follow-up upgrades.'],
  ['03', 'solarStrike', 'Play it out', 'Everything else is ordinary chess. Select a unit to see its abilities under the board.'],
];

// The site's game links look like https://augchess.com/?game=<id>.
const gameLink = id => `${SERVER_URL}/?game=${id}`;
const parseGameId = text => { const m = /([a-f0-9]{12})/i.exec(text.trim()); return m ? m[1].toLowerCase() : null; };

export default function Home() {
  const { session, profile } = useAuth();
  const [code, setCode] = useState('');
  const go = () => router.push('/game');
  const codeId = parseGameId(code);

  return (
    <ScrollView style={S.screen} contentContainerStyle={S.scroll}>
      <View style={styles.topRow}>
        {[['star-four-points-outline', 'Augments', '/augments'], ['chess-knight', 'Figures', '/figures'],
          ['trophy', 'Leaderboard', '/leaderboard'], ['history', 'History', '/history'], ['cog', 'Settings', '/account']].map(([icon, label, path]) => (
          <Pressable key={label} onPress={() => router.push(path)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={label}>
            <MaterialDesignIcons name={icon} size={22} color={C.text} />
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.push('/account')} style={[styles.iconBtn, session && { borderColor: C.gold }]}
          accessibilityRole="button" accessibilityLabel={session ? `Account: ${(profile && profile.display_name) || 'signed in'}` : 'Sign in'}>
          <MaterialDesignIcons name={session ? 'account-circle' : 'account-circle-outline'} size={24} color={session ? C.gold : C.text} />
        </Pressable>
      </View>
      <Text style={styles.eyebrow}>CHESS, AUGMENTED</Text>
      <Text style={styles.hero}>Draft your <Text style={{ color: C.gold }}>edge.</Text>{'\n'}Break the rules.</Text>
      <Text style={S.muted}>Classic chess, until someone bids on an augment. Before every match, both players spend points on new units, abilities and rule-breaking powers.</Text>

      <View style={{ gap: 8, marginTop: 8 }}>
        <View style={styles.pair}>
          <Button style={styles.half} title="Start New Game" variant="primary" onPress={() => { Game.startHotseat(); go(); }} />
          <Button style={styles.half} title="Play vs AI" onPress={() => { Game.startVsAi(); go(); }} />
        </View>
        <View style={styles.pair}>
          <Button style={styles.half} title="Play Online" variant="online" onPress={() => { Game.findMatch(false); go(); }} />
          <Button style={styles.half} title="Play Ranked" variant="online" onPress={() => {
            if (!session) { router.push('/account'); return; } // ranked needs an account
            Game.findMatch(true); go();
          }} />
        </View>
        <View style={styles.joinRow}>
          <TextInput style={[S.input, { flex: 1 }]} value={code} onChangeText={setCode} placeholder="Game code or link" placeholderTextColor={C.textFaint} autoCapitalize="none" autoCorrect={false} />
          <Button title="Join" disabled={!codeId} onPress={() => { Game.joinGame(codeId); setCode(''); go(); }} />
          <Button title="+" accessibilityLabel="Create game link" variant="primary" onPress={() => { Game.createGameLink(gameLink); go(); }} />
        </View>
      </View>

      <Text style={[S.h2, { marginTop: 12 }]}>How a match works</Text>
      {STEPS.map(([num, icon, title, text]) => (
        <View key={num} style={[S.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          <Emblem id={icon} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={styles.stepTitle}><Text style={{ color: C.gold }}>{num} </Text>{title}</Text>
            <Text style={S.muted}>{text}</Text>
          </View>
        </View>
      ))}

      <Text style={[S.h2, { marginTop: 12 }]}>The Arsenal</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {E.AUGMENTS.map(aug => (
          <Pressable key={aug.id} onPress={() => showAugmentDetail(aug)} style={styles.marquee}>
            <Emblem id={aug.id} size={26} />
            <Text style={styles.marqueeText}>{aug.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={[S.muted, { marginTop: 16, fontSize: 12 }]}>Icons by game-icons.net (Lorc, Delapouite et al.), CC BY 3.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.bg1 },
  eyebrow: { color: C.gold, fontWeight: '800', letterSpacing: 2, fontSize: 12 },
  hero: { color: C.textBright, fontSize: 36, fontWeight: '900', lineHeight: 42 },
  joinRow: { flexDirection: 'row', gap: 8 },
  pair: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  stepTitle: { color: C.textBright, fontWeight: '800', fontSize: 16, marginBottom: 2 },
  marquee: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.bg1, borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  marqueeText: { color: C.text, fontWeight: '600' },
});
