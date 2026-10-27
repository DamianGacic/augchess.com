// Optional Supabase sign-in, profile and friends — the app's auth.js, same
// RPCs. Phones differ from the site in how a sign-in comes back:
//   - email + password: signUp / signIn; a confirmation email (if the
//     project sends one) links back through the augchess:// deep link.
//   - Google / X: the system browser runs the OAuth flow and redirects back
//     to the app with a PKCE code.
// Both redirects have to be allowed in Supabase (Auth → URL Configuration).
import './prefs.js'; // installs the localStorage the session is kept in
import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';
import { createClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: localStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
});

let snapshot = { session: null, profile: null, ready: false };
const listeners = new Set();
let heartbeatTimer = null;
let markReady;
export const authReady = new Promise(resolve => { markReady = resolve; });

function emit(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach(l => l());
}

export function useAuth() {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => snapshot);
}

export function currentSession() { return snapshot.session; }

// Outside React: called on every sign-in/out (and profile change).
export function onAuthChange(cb) { listeners.add(cb); }

async function fetchProfile(session) {
  const { data, error } = await client.from('profiles').select('*').eq('id', session.user.id).single();
  if (error) { console.warn('Auth: fetchProfile failed', error); return null; }
  return data;
}

async function handleSession(session) {
  if (session && !heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      if (AppState.currentState === 'active') client.rpc('track_heartbeat').then(({ error }) => error && console.warn('Auth: track_heartbeat failed', error));
    }, HEARTBEAT_INTERVAL_MS);
  }
  if (!session && heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  emit({ session, profile: session ? await fetchProfile(session) : null });
}

export async function initAuth() {
  try {
    const { data } = await client.auth.getSession();
    await handleSession(data.session);
  } catch (e) {
    console.warn('Auth: could not reach Supabase', e);
  }
  emit({ ready: true });
  markReady();
  client.auth.onAuthStateChange((event, session) => {
    // Supabase warns against awaiting its own calls inside this callback.
    setTimeout(async () => {
      if (event === 'SIGNED_IN') {
        const { error } = await client.rpc('track_login');
        if (error) console.warn('Auth: track_login failed', error);
      }
      handleSession(session);
    }, 0);
  });
}

const redirectUrl = () => Linking.createURL('auth');

export const exchangeCode = code => client.auth.exchangeCodeForSession(code);

// A deep link back into the app (OAuth redirect or the emailed link).
function handleAuthUrl(url) {
  const { queryParams } = Linking.parse(url);
  if (queryParams && queryParams.code) return exchangeCode(String(queryParams.code));
  return { error: null };
}

// New account with email + password. If the project requires email
// confirmation there's no session yet: the user confirms, then signs in.
// The display name rides along as user_metadata (applied by track_login()).
export function signUp(email, password, displayName) {
  const trimmed = (displayName || '').trim();
  return client.auth.signUp({
    email, password,
    options: { emailRedirectTo: redirectUrl(), ...(trimmed ? { data: { display_name: trimmed } } : {}) },
  });
}

export const signIn = (email, password) => client.auth.signInWithPassword({ email, password });

export async function signInWithProvider(provider) {
  const { data, error } = await client.auth.signInWithOAuth({
    provider, options: { redirectTo: redirectUrl(), skipBrowserRedirect: true },
  });
  if (error) return { error };
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl());
  if (result.type !== 'success') return { error: null, cancelled: true };
  return handleAuthUrl(result.url);
}

export async function setDisplayName(name) {
  const { error } = await client.rpc('set_display_name', { new_name: name });
  if (!error && snapshot.session) emit({ profile: await fetchProfile(snapshot.session) });
  return { error };
}

export async function checkDisplayNameAvailable(name) {
  const { data, error } = await client.rpc('display_name_available', { check_name: name });
  return { available: data, error };
}

export const listFriends = () => client.rpc('list_friends');
export const sendFriendRequest = (name) => client.rpc('send_friend_request', { friend_name: name });
export const respondFriendRequest = (userId, accept) => client.rpc('respond_friend_request', { other: userId, accept });
export const removeFriend = (userId) => client.rpc('remove_friend', { other: userId });
export const leaderboard = () => client.rpc('leaderboard');
// Game history: local games (vs AI / hotseat) are posted from here; the
// server records online ones (supabase/migrations/0008_local_game_history.sql).
export const recordLocalGame = (game) => client.rpc('record_local_game', { g: game });
export const listGames = () => client.rpc('list_games');
// Finished games on this account, for unlocks (0009_games_count.sql).
export const myGamesCount = () => client.rpc('my_games_count');
export const gameReplay = (id) => client.rpc('game_replay', { game_id: id });
export const signOut = () => client.auth.signOut();
