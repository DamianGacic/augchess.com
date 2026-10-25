// Lets React components re-render with the classic scripts' game state.
// app.js calls GameBridge.changed() at the top of every renderAll(); a
// component that calls useGame() then re-reads the globals it shows
// (state, netMode, myColor, pendingPromotion, …) by bare name.
import { useSyncExternalStore } from 'react';

let version = 0;
const listeners = new Set();

window.GameBridge = {
  changed() {
    version++;
    listeners.forEach(l => l());
  },
};

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGame() {
  return useSyncExternalStore(subscribe, () => version);
}
