// The site's dark "war table" palette (style.css :root).
import { StyleSheet } from 'react-native';

export const C = {
  bg0: '#0a0e19',
  bg1: '#111729',
  bg2: '#182036',
  bg3: '#212b46',
  line: '#27314d',
  lineStrong: '#37446a',
  textBright: '#f3f5fb',
  text: '#d9deeb',
  textSecondary: '#95a0bf',
  textFaint: '#66718f',
  gold: '#f2c35b',
  goldStrong: '#ffd877',
  goldDeep: '#a8761c',
  danger: '#ef5350',
  success: '#4fdba4',
  kind: {
    pregame: '#ff7b72',
    wincondition: '#f472b6',
    utility: '#4cc2f0',
    unit: '#f4ad44',
    unitability: '#b592ff',
    globalability: '#6d8bff',
    upgrade: '#4fdba4',
  },
};

export const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg0 },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  h1: { color: C.textBright, fontSize: 28, fontWeight: '800' },
  h2: { color: C.textBright, fontSize: 18, fontWeight: '700' },
  body: { color: C.text, fontSize: 15, lineHeight: 21 },
  muted: { color: C.textSecondary, fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: C.bg1, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  input: {
    backgroundColor: C.bg2, borderColor: C.line, borderWidth: 1, borderRadius: 10,
    color: C.textBright, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: C.bg1, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 16, padding: 18, gap: 12, maxHeight: '90%' },
});
