-- Elo updates for ranked games. Run once in the SQL editor after
-- 0004_ratings.sql (already included in schema.sql for brand-new projects).
--
-- Only the game server calls record_rated_game (with the service role key):
-- it's the one party that knows a game's real result, so no client grant.

alter table public.profiles add column games_played integer not null default 0;

-- white_score: 1 = White won, 0.5 = draw, 0 = Black won.
-- Expected score E = 1 / (1 + 10^((Ropp - R) / 400)); new R = R + K(S - E),
-- each player with their own FIDE-style K: 40 for their first 30 games,
-- 10 at 2400+, 20 otherwise.
-- ponytail: K drops back to 20 if a 2400+ player falls below 2400 (FIDE keeps
-- 10 for life); track a peak rating if that ever matters.
create or replace function public.record_rated_game(white uuid, black uuid, white_score numeric)
returns table (color text, rating integer, delta integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  rw integer; rb integer; gw integer; gb integer;
  ew numeric; kw integer; kb integer; dw integer; db integer;
begin
  if white = black then raise exception 'a player can''t play themselves'; end if;
  if white_score not in (0, 0.5, 1) then raise exception 'white_score must be 0, 0.5 or 1'; end if;

  select p.rating, p.games_played into rw, gw from public.profiles p where p.id = white for update;
  select p.rating, p.games_played into rb, gb from public.profiles p where p.id = black for update;
  if rw is null or rb is null then raise exception 'unknown player'; end if;

  ew := 1 / (1 + power(10, (rb - rw) / 400.0));
  kw := case when gw < 30 then 40 when rw >= 2400 then 10 else 20 end;
  kb := case when gb < 30 then 40 when rb >= 2400 then 10 else 20 end;
  dw := round(kw * (white_score - ew));
  db := round(kb * ((1 - white_score) - (1 - ew)));

  update public.profiles p set rating = p.rating + dw, games_played = p.games_played + 1 where p.id = white;
  update public.profiles p set rating = p.rating + db, games_played = p.games_played + 1 where p.id = black;

  return query values ('w', rw + dw, dw), ('b', rb + db, db);
end;
$$;

revoke all on function public.record_rated_game(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.record_rated_game(uuid, uuid, numeric) to service_role;
