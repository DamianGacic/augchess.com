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

### Mobile app (`app/`, Expo Go)
```
cd app && npm install
npx expo start            # scan the QR code with Expo Go
```
The app imports `engine/`, `chess.js` and `data.js` straight from the repo, so it plays by the same rules as the server. In development it reaches the game server (:8000) and local Supabase (:54321) on the computer Expo runs on; set `EXPO_PUBLIC_SERVER_URL` / `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` to point it elsewhere. Sign-in redirects back to `augchess://auth` (or `exp://…/--/auth` in Expo Go), which has to be allowed in Supabase's redirect URLs.
