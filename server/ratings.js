/**
 * server/ratings.js — The game server's only Supabase calls, all made
 * with the service role key (never sent to browsers):
 *   verifyUser(accessToken)  who a player's Supabase session belongs to
 *   getRating(userId)        their current rating, for matchmaking
 *   recordGame(game)         saves a finished game to the history and, for a
 *                            ranked one, applies the Elo update (record_game in
 *                            supabase/migrations/0007_game_history.sql)
 * Ranked play and the history are off unless SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
 * set (on Render: the service's Environment tab).
 */
'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const enabled = !!(SUPABASE_URL && SERVICE_KEY);

// Returns the user's id, or null for a missing/expired/forged token.
async function verifyUser(accessToken) {
  if (!enabled || typeof accessToken !== 'string' || !accessToken) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id || null;
  } catch (err) {
    console.error('verifyUser failed', err);
    return null;
  }
}

async function getRating(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=rating&id=eq.${encodeURIComponent(userId)}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`getRating ${res.status}: ${await res.text()}`);
  const [row] = await res.json();
  if (!row) throw new Error(`getRating: no profile for ${userId}`);
  return row.rating;
}

// game: see record_game. Resolves to { w: {rating, delta}, b: {rating, delta} }
// for a ranked game, {} otherwise.
async function recordGame(game) {
  if (!enabled) return {};
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_game`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ g: game }),
  });
  if (!res.ok) throw new Error(`record_game ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return Object.fromEntries(rows.map(r => [r.color, { rating: r.rating, delta: r.delta }]));
}

module.exports = { enabled, verifyUser, getRating, recordGame };
