# augchess.com
Chess with augmented rules.
Augments are selected auction style before game start

## Game modes
Local (hotseat), vs AI, Play Online (casual queue), Play Ranked, game links, and
**Correspondence**: slow games between two signed-in players. Each side has a
time bank of 1–3 days that only runs on their turn (draft picks, setup, moves);
the game is saved after every action (`correspondence_games` /
`correspondence_moves`, `supabase/migrations/0011_correspondence.sql`) and can be
picked up any time from the Correspondence page.

## To do
- Correspondence: notifications when it's your turn (email, push, in-app badge)
- Correspondence: the mobile app (`app/`)
- Correspondence: expire invitations nobody accepts
- Correspondence: resigning during the draft (only possible once play starts)
- Correspondence: chat is kept in memory only, so it's lost when the game is unloaded






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
