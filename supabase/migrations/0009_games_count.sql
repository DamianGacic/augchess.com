-- How many logged games the signed-in player has finished (any mode). New
-- players draft from a starter set of augments, and Ranked stays locked,
-- until this reaches UNLOCK_GAMES (engine/draft-engine.js). Run once in the
-- SQL editor after 0008_local_game_history.sql (already included in
-- schema.sql for new projects). The game server counts the same rows itself
-- with the service role key (server/ratings.js gamesPlayed).
create or replace function public.my_games_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.games
  where auth.uid() is not null and (white_id = auth.uid() or black_id = auth.uid());
$$;

revoke all on function public.my_games_count() from public;
grant execute on function public.my_games_count() to authenticated;
