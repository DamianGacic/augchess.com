-- Local games (vs the AI, or two players at one screen) in the game
-- history too. Run once in the SQL editor after 0007_game_history.sql
-- (already included in schema.sql for new projects).
--
-- These are posted by the browser/app itself, so nothing vouches for them:
-- they're labelled by mode, never touch ratings, and the signed-in caller
-- (auth.uid(), never a client-supplied id) is the only account named.

-- 'online' | 'ranked' (written by the game server) | 'ai' | 'local'
alter table public.games add column mode text not null default 'online'
  check (mode in ('online', 'ranked', 'ai', 'local'));
update public.games set mode = 'ranked' where ranked;
alter table public.games alter column room_id drop not null;
-- vs the AI: the side it played, shown as "AI" in the history
alter table public.games add column ai_color text check (ai_color in ('w', 'b'));

-- g: { mode: 'ai'|'local', human: 'w'|'b' (vs the AI), result, result_text,
-- white_augments, black_augments, minutes, points, moves, frames, started_at }.
-- Open to guests too (no one is named then).
-- ponytail: no rate limit, only a size cap; throttle per caller if it's abused.
create or replace function public.record_local_game(g jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  game_mode text := g->>'mode';
  me uuid := (select p.id from public.profiles p where p.id = auth.uid());
  gid uuid;
begin
  if game_mode not in ('ai', 'local') then raise exception 'mode must be ai or local'; end if;
  if jsonb_typeof(g->'frames') <> 'array' or jsonb_array_length(g->'frames') = 0 then raise exception 'no frames'; end if;
  if octet_length((g->'frames')::text) > 5000000 then raise exception 'game too large'; end if;

  insert into public.games (mode, ai_color, white_id, black_id, result, result_text,
    white_augments, black_augments, minutes, points, moves, frames, started_at)
  values (game_mode,
    case when game_mode = 'ai' then case g->>'human' when 'w' then 'b' else 'w' end end,
    case when game_mode = 'local' or g->>'human' = 'w' then me end,
    case when game_mode = 'local' or g->>'human' = 'b' then me end,
    g->>'result', left(g->>'result_text', 200),
    array(select jsonb_array_elements_text(coalesce(g->'white_augments', '[]'))),
    array(select jsonb_array_elements_text(coalesce(g->'black_augments', '[]'))),
    (g->>'minutes')::integer, (g->>'points')::integer, coalesce((g->>'moves')::integer, 0),
    g->'frames', (g->>'started_at')::timestamptz)
  returning id into gid;
  return gid;
end;
$$;

revoke all on function public.record_local_game(jsonb) from public;
grant execute on function public.record_local_game(jsonb) to anon, authenticated;

-- record_game (server) sets mode from its ranked flag.
create or replace function public.record_game(g jsonb)
returns table (color text, rating integer, delta integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  gid uuid; r record;
  w uuid := (g->>'white_id')::uuid;
  b uuid := (g->>'black_id')::uuid;
  is_ranked boolean := coalesce((g->>'ranked')::boolean, false);
begin
  insert into public.games (room_id, ranked, mode, white_id, black_id, result, result_text,
    white_augments, black_augments, minutes, points, moves, frames, started_at)
  values (g->>'room_id', is_ranked, case when is_ranked then 'ranked' else 'online' end, w, b, g->>'result', g->>'result_text',
    array(select jsonb_array_elements_text(coalesce(g->'white_augments', '[]'))),
    array(select jsonb_array_elements_text(coalesce(g->'black_augments', '[]'))),
    (g->>'minutes')::integer, (g->>'points')::integer, coalesce((g->>'moves')::integer, 0),
    coalesce(g->'frames', '[]'), (g->>'started_at')::timestamptz)
  returning id into gid;

  if is_ranked and w is not null and b is not null then
    for r in select * from public.record_rated_game(w, b,
      case g->>'result' when 'w' then 1 when 'b' then 0 else 0.5 end)
    loop
      if r.color = 'w' then update public.games set white_rating = r.rating, white_delta = r.delta where id = gid;
      else update public.games set black_rating = r.rating, black_delta = r.delta where id = gid;
      end if;
      color := r.color; rating := r.rating; delta := r.delta;
      return next;
    end loop;
  end if;
end;
$$;

-- list_games gains the mode (a new return column, so drop and recreate).
drop function public.list_games(integer);
create function public.list_games(max_rows integer default 100)
returns table (
  id uuid, mode text, white_name text, black_name text,
  result text, result_text text, white_augments text[], black_augments text[],
  white_delta integer, black_delta integer, moves integer, ended_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select g.id, g.mode,
         case when g.ai_color = 'w' then 'AI' else pw.display_name end,
         case when g.ai_color = 'b' then 'AI' else pb.display_name end,
         g.result, g.result_text, g.white_augments, g.black_augments,
         g.white_delta, g.black_delta, g.moves, g.ended_at
  from public.games g
  left join public.profiles pw on pw.id = g.white_id
  left join public.profiles pb on pb.id = g.black_id
  order by g.ended_at desc
  limit least(max_rows, 100);
$$;

revoke all on function public.list_games(integer) from public;
grant execute on function public.list_games(integer) to anon, authenticated;
