// Every logged game, newest first (src/pages/HistoryPage.jsx); tap one to
// step through it on the game screen. Re-fetched on every visit.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { listGames, gameReplay, useAuth } from '../lib/auth.js';
import * as Game from '../lib/game.js';
import { C, S } from '../theme.js';

const MODE = { online: 'Casual', ranked: 'Ranked', ai: 'vs AI', local: 'Local' };
const name = n => n || 'Guest';
const delta = d => (d == null ? '' : ` (${d >= 0 ? '+' : ''}${d})`);

export default function History() {
  const { profile } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(null);
  useEffect(() => {
    listGames().then(({ data, error: err }) => (err ? setError('Could not load the game history.') : setRows(data)),
      () => setError('Could not load the game history.'));
  }, []);

  async function open(id) {
    setOpening(id);
    const { data, error: err } = await gameReplay(id);
    setOpening(null);
    if (err || !data || !data[0] || !data[0].frames.length) { setError('Could not load that game.'); return; }
    Game.startReplay(data[0].frames);
    router.push('/game');
  }

  const me = profile && profile.display_name;
  let status = error;
  if (!status && !rows) status = 'Loading…';
  else if (!status && !rows.length) status = 'No games logged yet. Finished games show up here.';
  return (
    <ScrollView style={S.screen} contentContainerStyle={S.scroll}>
      <Text style={S.muted}>Every finished game. Tap one to step through it.</Text>
      <View style={S.card}>
        {(rows || []).map(g => (
          <Pressable key={g.id} onPress={() => open(g.id)} disabled={opening === g.id}
            style={[styles.row, me && (g.white_name === me || g.black_name === me) && styles.me]}
            accessibilityRole="button">
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                <Text style={g.result === 'w' && styles.winner}>{name(g.white_name)}{delta(g.white_delta)}</Text>
                {' vs '}
                <Text style={g.result === 'b' && styles.winner}>{name(g.black_name)}{delta(g.black_delta)}</Text>
              </Text>
              <Text style={styles.detail}>{MODE[g.mode]} · {g.result_text} · {g.moves} moves · {new Date(g.ended_at).toLocaleString()}</Text>
            </View>
            <Text style={styles.play}>{opening === g.id ? '…' : '▶'}</Text>
          </Pressable>
        ))}
        {!!status && <Text style={S.muted}>{status}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  me: { backgroundColor: 'rgba(242, 195, 91, 0.12)' },
  name: { color: C.textBright, fontWeight: '700' },
  winner: { color: C.gold, fontWeight: '800' },
  detail: { color: C.textFaint, fontSize: 12, marginTop: 3 },
  play: { color: C.text, fontWeight: '800' },
});
