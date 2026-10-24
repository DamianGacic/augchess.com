-- Ratings + public leaderboard. Run once in the SQL editor after
-- 0003_friends.sql (already included in schema.sql for brand-new projects).
--
-- Every profile starts at 1200. Nothing changes ratings yet: clients can't
-- write profiles directly (select-only RLS), so updates will have to come
-- from the game server, which is the only party that knows real results.

alter table public.profiles add column rating integer not null default 1200;

create index profiles_rating_idx on public.profiles (rating desc);

-- Top players with a display name (unnamed accounts stay off the board).
-- Public: callable signed out too, like display_name_available().
create or replace function public.leaderboard(max_rows integer default 100)
returns table (display_name text, rating integer)
language sql
security definer
set search_path = public
as $$
  select display_name, rating
  from public.profiles
  where display_name is not null
  order by rating desc, created_at
  limit least(max_rows, 100);
$$;

revoke all on function public.leaderboard(integer) from public;
grant execute on function public.leaderboard(integer) to anon, authenticated;
