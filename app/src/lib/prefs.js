// Board preferences, saved on the device — the app's settings.js.
// expo-sqlite installs a synchronous localStorage global, which Supabase
// also uses to keep the session (auth.js).
import 'expo-sqlite/localStorage/install';
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'augchess:prefs';
export const DEFAULTS = { boardTheme: 'brown', coords: true, legalMoves: true, lastMove: true, autoQueen: false };

export const BOARD_THEMES = {
  brown: ['#f0d9b5', '#b58863'],
  green: ['#eeeed2', '#769656'],
  blue: ['#dee3e6', '#8ca2ad'],
  gray: ['#d9d9d9', '#8f8f8f'],
};

let prefs = { ...DEFAULTS };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (e) { /* storage unavailable */ }

const listeners = new Set();

export function getPref(key) { return prefs[key]; }

export function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (e) { /* storage unavailable */ }
  listeners.forEach(l => l());
}

export function usePrefs() {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => prefs);
}
