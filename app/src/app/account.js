// Account, friends and board preferences (src/pages/SettingsPage.jsx), with
// the sign-in form (src/components/AuthModal.jsx) in place of the account
// section while signed out.
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View, StyleSheet, Pressable } from 'react-native';
import * as Auth from '../lib/auth.js';
import { usePrefs, setPref, BOARD_THEMES } from '../lib/prefs.js';
import Button from '../components/Button.js';
import { C, S } from '../theme.js';

const ONLINE_WINDOW_MS = 15 * 60 * 1000; // a heartbeat lands every 10 minutes
const TOGGLES = [
  ['coords', 'Show coordinates'],
  ['legalMoves', 'Show legal moves'],
  ['lastMove', 'Highlight last move'],
  ['autoQueen', 'Always promote to Queen'],
];

function SignIn() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const signingUp = mode === 'signup';

  async function oauth(provider) {
    setStatus('Opening the browser…');
    const { error } = await Auth.signInWithProvider(provider);
    setStatus(error ? error.message || 'Could not sign in — try again.' : '');
  }

  async function submit() {
    const addr = email.trim();
    const name = displayName.trim();
    if (!addr || !password) return;
    setBusy(true);
    setStatus(signingUp ? 'Creating your account…' : 'Signing in…');
    if (signingUp && name) {
      const { available, error } = await Auth.checkDisplayNameAvailable(name);
      if (!error && available === false) {
        setStatus('That display name is taken — leave it blank and pick one later, or try another.');
        setBusy(false);
        return;
      }
    }
    const { data, error } = signingUp ? await Auth.signUp(addr, password, name) : await Auth.signIn(addr, password);
    setBusy(false);
    if (error) setStatus(error.message || 'Something went wrong — try again.');
    else if (data.session) setStatus('');
    else setStatus('Check your email to confirm your account, then sign in.');
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={S.muted}>Optional — gives you a display name, friends and ranked games. Playing and game links never need an account.</Text>
      <Button title="Continue with Google" onPress={() => oauth('google')} />
      <Button title="Continue with X" onPress={() => oauth('x')} />
      <Text style={[S.muted, { textAlign: 'center' }]}>or use email</Text>
      <TextInput style={S.input} placeholder="you@example.com" placeholderTextColor={C.textFaint} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" value={email} onChangeText={setEmail} />
      <TextInput style={S.input} placeholder="Password" placeholderTextColor={C.textFaint} secureTextEntry autoCapitalize="none"
        autoComplete={signingUp ? 'new-password' : 'current-password'} textContentType={signingUp ? 'newPassword' : 'password'}
        value={password} onChangeText={setPassword} onSubmitEditing={submit} />
      {signingUp && <TextInput style={S.input} placeholder="Display name (optional)" placeholderTextColor={C.textFaint} maxLength={20} autoCapitalize="none" value={displayName} onChangeText={setDisplayName} />}
      <Button title={signingUp ? 'Create account' : 'Sign in'} variant="primary" disabled={busy || !email.trim() || !password} onPress={submit} />
      <Pressable onPress={() => { setMode(signingUp ? 'signin' : 'signup'); setStatus(''); }}>
        <Text style={[styles.link, { textAlign: 'center' }]}>{signingUp ? 'Already have an account? Sign in' : 'New here? Create an account'}</Text>
      </Pressable>
      {!!status && <Text style={S.muted}>{status}</Text>}
    </View>
  );
}

function Account({ session, profile }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setStatus('Saving…');
    const { error } = await Auth.setDisplayName(name.trim());
    setSaving(false);
    setStatus(error ? error.message || 'Could not save — try another name.' : 'Saved!');
    if (!error) setEditing(false);
  }
  return (
    <View style={{ gap: 8 }}>
      <Row label="Email" value={session.user.email} />
      <Row label="Display name" value={(profile && profile.display_name) || 'Not set'}
        action={<Pressable onPress={() => { setName((profile && profile.display_name) || ''); setStatus(''); setEditing(!editing); }}><Text style={styles.link}>Edit</Text></Pressable>} />
      <Row label="Rating" value={String((profile && profile.rating) || '—')} />
      {editing && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput style={[S.input, { flex: 1 }]} placeholder="Display name" placeholderTextColor={C.textFaint} maxLength={20} autoCapitalize="none" value={name} onChangeText={setName} />
          <Button title="Save" variant="primary" disabled={saving} onPress={save} />
        </View>
      )}
      {!!status && <Text style={S.muted}>{status}</Text>}
      <Button title="Sign out" onPress={() => Auth.signOut()} />
    </View>
  );
}

function Row({ label, value, action }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
      {action}
    </View>
  );
}

function Friends() {
  const [friends, setFriends] = useState([]);
  const [status, setStatus] = useState('');
  const [name, setName] = useState('');
  const [removeArmed, setRemoveArmed] = useState(null);

  const refresh = useCallback(async () => {
    const { data, error } = await Auth.listFriends();
    if (error) setStatus('Could not load friends.');
    else setFriends(data || []);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const act = rpc => async () => {
    const { error } = await rpc();
    if (error) setStatus(error.message || 'Something went wrong — try again.');
    refresh();
  };
  async function add() {
    const target = name.trim();
    if (!target) return;
    setStatus('Sending…');
    const { error } = await Auth.sendFriendRequest(target);
    setStatus(error ? error.message || 'Could not send request.' : `Request sent to ${target}.`);
    if (!error) setName('');
    refresh();
  }
  function remove(f) {
    if (removeArmed === f.user_id) { setRemoveArmed(null); act(() => Auth.removeFriend(f.user_id))(); return; }
    setRemoveArmed(f.user_id);
    setStatus(`Tap Remove again to unfriend ${f.display_name || 'them'}.`);
  }

  const requests = friends.filter(f => f.status === 'pending');
  const accepted = friends.filter(f => f.status === 'accepted');
  const friendRow = (f, actions) => {
    const online = f.status === 'accepted' && Date.now() - new Date(f.last_seen_at) < ONLINE_WINDOW_MS;
    return (
      <View key={f.user_id} style={styles.row}>
        <Text style={[styles.rowValue, { flex: 1, color: online ? C.success : C.text }]}>{f.display_name || '(no name)'}{f.direction === 'outgoing' ? ' · request sent' : ''}</Text>
        {actions.map(([label, fn, primary]) => <Button key={label} small title={label} variant={primary ? 'primary' : 'secondary'} onPress={fn} />)}
      </View>
    );
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput style={[S.input, { flex: 1 }]} placeholder="Friend's display name" placeholderTextColor={C.textFaint} maxLength={20} autoCapitalize="none" value={name} onChangeText={setName} onSubmitEditing={add} />
        <Button title="Add" variant="primary" onPress={add} />
      </View>
      {!!status && <Text style={S.muted}>{status}</Text>}
      <Text style={styles.subhead}>Requests</Text>
      {requests.map(f => friendRow(f, f.direction === 'incoming'
        ? [['Accept', act(() => Auth.respondFriendRequest(f.user_id, true)), true], ['Decline', act(() => Auth.respondFriendRequest(f.user_id, false))]]
        : [['Cancel', act(() => Auth.removeFriend(f.user_id))]]))}
      {!requests.length && <Text style={S.muted}>No pending requests.</Text>}
      <Text style={styles.subhead}>Friends</Text>
      {accepted.map(f => friendRow(f, [['Remove', () => remove(f)]]))}
      {!accepted.length && <Text style={S.muted}>No friends yet — add someone by their display name.</Text>}
    </View>
  );
}

function BoardPrefs() {
  const prefs = usePrefs();
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.rowLabel}>Board theme</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {Object.entries(BOARD_THEMES).map(([id, [light, dark]]) => (
          <Pressable key={id} onPress={() => setPref('boardTheme', id)} style={[styles.theme, prefs.boardTheme === id && { borderColor: C.gold }]}>
            <View style={{ flexDirection: 'row' }}><View style={[styles.swatch, { backgroundColor: light }]} /><View style={[styles.swatch, { backgroundColor: dark }]} /></View>
            <Text style={styles.themeText}>{id[0].toUpperCase() + id.slice(1)}</Text>
          </Pressable>
        ))}
      </View>
      {TOGGLES.map(([key, label]) => (
        <View key={key} style={styles.row}>
          <Text style={[styles.rowValue, { flex: 1 }]}>{label}</Text>
          <Switch value={!!prefs[key]} onValueChange={v => setPref(key, v)} trackColor={{ true: C.goldDeep }} thumbColor={prefs[key] ? C.gold : undefined} />
        </View>
      ))}
      <Text style={S.muted}>Saved on this device.</Text>
    </View>
  );
}

export default function AccountScreen() {
  const { session, profile } = Auth.useAuth();
  return (
    <ScrollView style={S.screen} contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">
      <View style={S.card}>
        <Text style={S.h2}>Account</Text>
        {session ? <Account session={session} profile={profile} /> : <SignIn />}
      </View>
      <View style={S.card}>
        <Text style={S.h2}>Friends</Text>
        {session ? <Friends key={session.user.id} /> : <Text style={S.muted}>Sign in to add friends.</Text>}
      </View>
      <View style={S.card}>
        <Text style={S.h2}>Board</Text>
        <BoardPrefs />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  rowLabel: { color: C.textSecondary, fontWeight: '700', width: 110 },
  rowValue: { color: C.textBright, flexShrink: 1 },
  link: { color: C.gold, fontWeight: '700' },
  subhead: { color: C.textBright, fontWeight: '800', marginTop: 6 },
  theme: { flex: 1, alignItems: 'center', gap: 4, padding: 6, borderWidth: 2, borderColor: C.line, borderRadius: 10 },
  swatch: { width: 20, height: 20 },
  themeText: { color: C.text, fontSize: 12, fontWeight: '700' },
});
