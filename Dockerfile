# AugChess: one container running the game server (server/), which also
# serves the built site — the same setup as production on Render.
#
#   docker build -t augchess .
#   docker run -p 8000:8000 augchess
#
# Ranked play needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (-e flags or
# --env-file); without them everything else works and ranked stays off.

# ── Build the site (Vite + React) into dist/ ─────────────────────────────────
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Runtime: game server + the files it loads + the built site ───────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8000
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
# Game rules shared with the browser (server/rooms.js requires these).
COPY engine ./engine
COPY chess.js data.js ./
COPY --from=web /app/dist ./dist
USER node
EXPOSE 8000
CMD ["node", "server/index.js"]
