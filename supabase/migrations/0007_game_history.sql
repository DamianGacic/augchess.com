-- Game history: every finished online game (casual and ranked), written by
-- the game server, with the state after every action for step-through
-- replays. Run once in the SQL editor after 0006_matchmaking.sql (already
-- included in schema.sql for new projects).
--
-- Only the server writes (record_game, service role); everyone reads through
-- list_games() / game_replay(), so the table itself has RLS on and no policies.

create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  ranked boolean not null default false,
  -- null = a player who wasn't signed in (shown as Guest)
  white_id uuid references public.profiles(id) on delete set null,
  black_id uuid references public.profiles(id) on delete set null,
  result text not null check (result in ('w', 'b', 'draw')),
  result_text text not null,
  white_augments text[] not null default '{}',
  black_augments text[] not null default '{}',
  minutes integer,
  points integer,
  moves integer not null default 0,
  -- ranked only: each side's rating after the game and the change
  white_rating integer, white_delta integer,
  black_rating integer, black_delta integer,
  -- serialized room state after every action, oldest first
  -- ponytail: whole snapshots (~3KB each, the moveLog repeats); store
  -- actions + RNG seeds instead if the table ever gets big.
  frames jsonb not null,
  started_at timestamptz,
  ended_at timestamptz not null default now()
);

create index games_ended_at_idx on public.games (ended_at desc);
create index games_white_idx on public.games (white_id);
create index games_black_idx on public.games (black_id);

alter table public.games enable row level security;

-- g: { room_id, ranked, white_id, black_id, result: 'w'|'b'|'draw',
-- result_text, white_augments, black_augments, minutes, points, moves,
-- frames, started_at }. A ranked game between two accounts also gets its Elo
-- update (record_rated_game); the new ratings come back as in that function.
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
  insert into public.games (room_id, ranked, white_id, black_id, result, result_text,
    white_augments, black_augments, minutes, points, moves, frames, started_at)
  values (g->>'room_id', is_ranked, w, b, g->>'result', g->>'result_text',
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

revoke all on function public.record_game(jsonb) from public, anon, authenticated;
grant execute on function public.record_game(jsonb) to service_role;

-- Newest first, without the frames. Public, like the leaderboard.
-- ponytail: one page of 100; add a `before` cursor when there are more.
create or replace function public.list_games(max_rows integer default 100)
returns table (
  id uuid, ranked boolean, white_name text, black_name text,
  result text, result_text text, white_augments text[], black_augments text[],
  white_delta integer, black_delta integer, moves integer, ended_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select g.id, g.ranked, pw.display_name, pb.display_name,
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

create or replace function public.game_replay(game_id uuid)
returns table (white_name text, black_name text, result_text text, frames jsonb)
language sql
security definer
set search_path = public
as $$
  select pw.display_name, pb.display_name, g.result_text, g.frames
  from public.games g
  left join public.profiles pw on pw.id = g.white_id
  left join public.profiles pb on pb.id = g.black_id
  where g.id = game_id;
$$;

revoke all on function public.game_replay(uuid) from public;
grant execute on function public.game_replay(uuid) to anon, authenticated;
