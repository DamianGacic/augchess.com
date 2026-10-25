// App-wide state shared by React and the classic scripts: which view is
// showing, the Supabase session/profile (from auth.js) and whether the
// sign-in modal is open. A plain store read through useSyncExternalStore.
import { useSyncExternalStore } from 'react';

let state = { view: 'home', session: null, profile: null, authOpen: false, descsLoaded: false };
const listeners = new Set();

export function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore() {
  return useSyncExternalStore(subscribe, () => state);
}

export function showView(view) {
  setState({ view });
}
