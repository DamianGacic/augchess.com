-- Matchmaking reads a player's rating with the service role key
-- (server/ratings.js getRating). Run once in the SQL editor after
-- 0005_rated_games.sql (already included in schema.sql for new projects).
grant select on public.profiles to service_role;
