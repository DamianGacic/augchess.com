// Vite builds the React app (src/) into dist/, which server/index.js serves.
// `npm run dev` serves on :5173 and forwards the game API/WebSockets to the
// game server on :8000 (`cd server && npm run dev`).
//
// The game screen still runs on the original classic <script>s while it's
// ported piece by piece. Vite leaves those tags alone but doesn't bundle
// them, so copyLegacy() puts them (and the art they load by URL) into dist/.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';

const LEGACY_DIRS = ['engine', 'augments', 'figures', 'assets'];
const NOT_LEGACY = new Set(['board3d.js']); // a module: Vite bundles it

function copyLegacy() {
  return {
    name: 'copy-legacy-scripts',
    apply: 'build',
    writeBundle({ dir }) {
      for (const file of fs.readdirSync('.')) {
        if (file.endsWith('.js') && !NOT_LEGACY.has(file)) fs.copyFileSync(file, `${dir}/${file}`);
      }
      for (const d of LEGACY_DIRS) fs.cpSync(d, `${dir}/${d}`, { recursive: true });
      fs.copyFileSync('favicon.svg', `${dir}/favicon.svg`);
    },
  };
}

export default defineConfig({
  plugins: [react(), copyLegacy()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
});
