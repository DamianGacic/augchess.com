// Top rated players (src/pages/LeaderboardPage.jsx). Re-fetched on every visit.
import { useEffect, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { leaderboard, useAuth } from '../lib/auth.js';
import { C, S } from '../theme.js';

export default function Leaderboard() {
  const { profile } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    leaderboard().then(({ data, error: err }) => (err ? setError(true) : setRows(data)), () => setError(true));
  }, []);
  const me = profile && profile.display_name;
  let status = '';
  if (error) status = 'Could not load the leaderboard.';
  else if (!rows) status = 'Loading…';
  else if (!rows.length) status = 'No rated players yet — set a display name in Settings to appear here.';
  return (
    <ScrollView style={S.screen} contentContainerStyle={S.scroll}>
      <Text style={S.muted}>Top rated players. Everyone starts at 1200.</Text>
      <View style={S.card}>
        {(rows || []).map((row, i) => (
          <View key={row.display_name} style={[styles.row, row.display_name === me && styles.me]}>
            <Text style={styles.rank}>{i + 1}</Text>
            <Text style={styles.name}>{row.display_name}</Text>
            <Text style={styles.rating}>{row.rating}</Text>
          </View>
        ))}
        {!!status && <Text style={S.muted}>{status}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  me: { backgroundColor: 'rgba(242, 195, 91, 0.12)' },
  rank: { color: C.textFaint, width: 32, fontWeight: '800' },
  name: { color: C.textBright, flex: 1, fontWeight: '700' },
  rating: { color: C.goldStrong, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
