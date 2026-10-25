# augchess.com
Chess with augmented rules.
Augments are selected auction style before game start






## Development
```
npm install && (cd server && npm install)
supabase start            # local Supabase (needs Docker); sign-in mail at http://127.0.0.1:54324
cd server && npm run dev  # game server on :8000, using the local Supabase
npm run dev               # site on http://localhost:5173 (Vite, React in src/)
```
`npm run build` writes the site to `dist/`, which the game server serves in production.
