-- Correspondence games: slow, turn-based games between two signed-in
-- players that can run for days. Each side has a time bank (1-3 days,
-- chosen at the start) that only runs while it's their turn — a draft pick,
-- a Patchy Lines / Vanguard setup, or a move. Run once in the SQL editor
-- after 0010_drop_games_count.sql (already included in schema.sql for new
-- projects).
--
-- The game server (service role) owns the game itself: it loads `state`,
-- plays actions through the engine and saves each one with
-- save_correspondence_turn. Browsers only start, accept, decline and list
-- games, through the security definer functions below; both tables have RLS
-- on and no policies.

create table public.correspondence_games (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  -- One seat is the creator's. The other is the invited friend, or null for
  -- an invite link until someone opens it and accepts.
  white_id uuid references public.profiles(id) on delete cascade,
  black_id uuid references public.profiles(id) on delete cascade,
  status text not null default 'invited'
    check (status in ('invited', 'active', 'finished', 'cancelled')),
  days integer not null check (days between 1 and 3),
  points integer not null check (points between 1 and 99),
  -- engine serializeState() snapshot; null until the server first loads the
  -- accepted game (it sets the draft up then, timed from accepted_at)
  state jsonb,
  -- Mirrors of the clock in `state`, so the list and the timeout sweep don't
  -- have to read it: each side's bank as of turn_started_at, whose bank is
  -- running, and when it runs out.
  white_ms_left bigint,
  black_ms_left bigint,
  turn text check (turn in ('w', 'b')),
  turn_started_at timestamptz,
  deadline timestamptz,
  ply integer not null default 0, -- actions saved so far (correspondence_moves)
  result text check (result in ('w', 'b', 'draw')),
  result_text text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  check (created_by in (white_id, black_id)),
  check (white_id is null or black_id is null or white_id <> black_id)
);

create index correspondence_games_white_idx on public.correspondence_games (white_id);
create index correspondence_games_black_idx on public.correspondence_games (black_id);
create index correspondence_games_deadline_idx on public.correspondence_games (deadline) where status = 'active';

alter table public.correspondence_games enable row level security;

-- Every action that changed the game, in order: who sent it, what it was,
-- the move-list lines it added, and the state after it (the frames of the
-- game's replay once it ends).
create table public.correspondence_moves (
  game_id uuid not null references public.correspondence_games(id) on delete cascade,
  ply integer not null,
  color text check (color in ('w', 'b')), -- null: the server (a timeout)
  action jsonb not null,
  log jsonb not null default '[]',
  state jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, ply)
);

alter table public.correspondence_moves enable row level security;

-- The game server reads and writes these with the service role key
-- (server/correspondence.js). New tables aren't exposed to the API roles by
-- default any more (hosted or local), so it's spelled out.
grant select, insert, update on public.correspondence_games to service_role;
grant select, insert on public.correspondence_moves to service_role;

-- Finished correspondence games go into the game history like any other.
alter table public.games drop constraint games_mode_check;
alter table public.games add constraint games_mode_check
  check (mode in ('online', 'ranked', 'ai', 'local', 'correspondence'));

-- ponytail: a cap instead of real abuse handling.
-- Games a player may have going (invited or active) at once.
create or replace function public.correspondence_open_limit() returns integer
language sql immutable as $$ select 20 $$;

-- Starts a game: against a friend (opponent = their id), or as an invite
-- link anyone signed in can accept (opponent = null). play_as: 'w' | 'b' |
-- 'random'. Returns the game's id.
create or replace function public.create_correspondence_game(
  opponent uuid, days integer, points integer, play_as text default 'random')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_color text := play_as;
  gid uuid;
begin
  if me is null or not exists (select 1 from profiles where id = me) then
    raise exception 'Sign in to play correspondence games';
  end if;
  if days not between 1 and 3 then raise exception 'Time bank must be 1 to 3 days'; end if;
  if points not between 1 and 99 then raise exception 'Auction points must be 1 to 99'; end if;
  if my_color = 'random' then my_color := case when random() < 0.5 then 'w' else 'b' end; end if;
  if my_color not in ('w', 'b') then raise exception 'play_as must be w, b or random'; end if;
  if opponent is not null and not exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and least(f.requester, f.addressee) = least(me, opponent)
      and greatest(f.requester, f.addressee) = greatest(me, opponent)
  ) then
    raise exception 'You can only challenge your friends';
  end if;
  if (select count(*) from correspondence_games g
      where me in (g.white_id, g.black_id) and g.status in ('invited', 'active'))
     >= correspondence_open_limit() then
    raise exception 'You already have % correspondence games going', correspondence_open_limit();
  end if;

  insert into correspondence_games (created_by, white_id, black_id, days, points)
  values (me,
    case when my_color = 'w' then me else opponent end,
    case when my_color = 'b' then me else opponent end,
    days, points)
  returning id into gid;
  return gid;
end;
$$;

revoke all on function public.create_correspondence_game(uuid, integer, integer, text) from public;
grant execute on function public.create_correspondence_game(uuid, integer, integer, text) to authenticated;

-- Accepts a friend's challenge, or takes the open seat of an invite link.
-- Both banks start full and White's starts running: the draft begins now.
create or replace function public.accept_correspondence_game(game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  g correspondence_games;
  bank bigint;
begin
  if me is null or not exists (select 1 from profiles where id = me) then
    raise exception 'Sign in to play correspondence games';
  end if;
  select * into g from correspondence_games where id = game_id for update;
  if g.id is null or g.status <> 'invited' then raise exception 'This invitation is no longer open'; end if;
  if g.created_by = me then raise exception 'You can''t accept your own invitation'; end if;
  if me not in (g.white_id, g.black_id) and g.white_id is not null and g.black_id is not null then
    raise exception 'This invitation is for someone else';
  end if;
  if (select count(*) from correspondence_games c
      where me in (c.white_id, c.black_id) and c.status in ('invited', 'active') and c.id <> g.id)
     >= correspondence_open_limit() then
    raise exception 'You already have % correspondence games going', correspondence_open_limit();
  end if;

  bank := g.days::bigint * 86400000;
  update correspondence_games set
    white_id = coalesce(white_id, me),
    black_id = coalesce(black_id, me),
    status = 'active',
    accepted_at = now(),
    updated_at = now(),
    white_ms_left = bank,
    black_ms_left = bank,
    turn = 'w',
    turn_started_at = now(),
    deadline = now() + make_interval(days => g.days)
  where id = game_id;
end;
$$;

revoke all on function public.accept_correspondence_game(uuid) from public;
grant execute on function public.accept_correspondence_game(uuid) to authenticated;

-- Declines a challenge (the invited player) or withdraws it (the creator),
-- as long as it hasn't been accepted yet.
create or replace function public.cancel_correspondence_game(game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  update correspondence_games set status = 'cancelled', updated_at = now()
  where id = game_id and status = 'invited' and me in (white_id, black_id);
  if not found then raise exception 'This invitation is no longer open'; end if;
end;
$$;

revoke all on function public.cancel_correspondence_game(uuid) from public;
grant execute on function public.cancel_correspondence_game(uuid) to authenticated;

-- The caller's games, newest activity first: open invitations, games in
-- progress, and finished/cancelled ones from the last 30 days.
-- ponytail: one page of 100.
create or replace function public.list_correspondence_games()
returns table (
  id uuid, status text, my_color text, created_by_me boolean,
  opponent_name text, days integer, points integer,
  turn text, white_ms_left bigint, black_ms_left bigint, turn_started_at timestamptz,
  deadline timestamptz, ply integer, result text, result_text text,
  created_at timestamptz, updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select g.id, g.status,
         case when g.white_id = auth.uid() then 'w' else 'b' end,
         g.created_by = auth.uid(),
         p.display_name, g.days, g.points,
         g.turn, g.white_ms_left, g.black_ms_left, g.turn_started_at,
         g.deadline, g.ply, g.result, g.result_text,
         g.created_at, g.updated_at
  from correspondence_games g
  left join profiles p
    on p.id = case when g.white_id = auth.uid() then g.black_id else g.white_id end
  where auth.uid() in (g.white_id, g.black_id)
    and (g.status in ('invited', 'active') or g.updated_at > now() - interval '30 days')
  order by g.updated_at desc
  limit 100;
$$;

revoke all on function public.list_correspondence_games() from public;
grant execute on function public.list_correspondence_games() to authenticated;

-- What an invite link shows before it's accepted: who sent it and the
-- terms. Readable by anyone with the link (its id).
create or replace function public.correspondence_game_info(game_id uuid)
returns table (
  status text, creator_name text, creator_color text, open_seat boolean,
  invited_me boolean, i_play boolean, days integer, points integer
)
language sql
security definer
set search_path = public
as $$
  select g.status, p.display_name,
         case when g.white_id = g.created_by then 'w' else 'b' end,
         g.white_id is null or g.black_id is null,
         g.created_by <> auth.uid() and auth.uid() in (g.white_id, g.black_id),
         auth.uid() in (g.white_id, g.black_id),
         g.days, g.points
  from correspondence_games g
  join profiles p on p.id = g.created_by
  where g.id = game_id;
$$;

revoke all on function public.correspondence_game_info(uuid) from public;
grant execute on function public.correspondence_game_info(uuid) to anon, authenticated;

-- Server only. Saves one action: the game's new state and clock mirrors,
-- plus the action itself as the next correspondence_moves row. Refuses
-- (returns false) if `ply` isn't the next one, so two servers can never
-- interleave saves of the same game.
-- t: { game_id, ply, color, action, log, state, white_ms_left, black_ms_left,
--      turn, turn_started_at, deadline, result?, result_text? }
create or replace function public.save_correspondence_turn(t jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  gid uuid := (t->>'game_id')::uuid;
  next_ply integer := (t->>'ply')::integer;
  finished boolean := t->>'result' is not null;
begin
  update correspondence_games set
    state = t->'state',
    white_ms_left = (t->>'white_ms_left')::bigint,
    black_ms_left = (t->>'black_ms_left')::bigint,
    turn = t->>'turn',
    turn_started_at = (t->>'turn_started_at')::timestamptz,
    deadline = (t->>'deadline')::timestamptz,
    ply = next_ply,
    status = case when finished then 'finished' else status end,
    result = t->>'result',
    result_text = t->>'result_text',
    finished_at = case when finished then now() end,
    updated_at = now()
  where id = gid and status = 'active' and ply = next_ply - 1;
  if not found then return false; end if;

  insert into correspondence_moves (game_id, ply, color, action, log, state)
  values (gid, next_ply, t->>'color', t->'action', coalesce(t->'log', '[]'), t->'state');
  return true;
end;
$$;

revoke all on function public.save_correspondence_turn(jsonb) from public, anon, authenticated;
grant execute on function public.save_correspondence_turn(jsonb) to service_role;

-- record_game (server) takes an optional mode: 'correspondence', or else
-- online/ranked from its ranked flag as before.
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
  values (g->>'room_id', is_ranked,
    case when is_ranked then 'ranked' when g->>'mode' = 'correspondence' then 'correspondence' else 'online' end,
    w, b, g->>'result', g->>'result_text',
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
