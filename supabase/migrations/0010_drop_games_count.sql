-- Removes my_games_count (0009_games_count.sql). Only the starter-augment limit
-- on the draft screens called it, and that limit no longer exists. The Ranked
-- queue is unaffected: the game server counts a player's games itself
-- (server/ratings.js gamesPlayed). Run once in the SQL editor after
-- 0009_games_count.sql (schema.sql no longer creates the function).
--
-- Run this only after the web build and any released app build have been
-- updated. A client still on the starter-augment code treats a failed count as
-- 0 games, so it would limit every signed-in player to the starter set.
drop function if exists public.my_games_count();
