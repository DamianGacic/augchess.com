-- AugChess optional-login usage tracking, display names, friends + ratings.
-- Run once in the Supabase SQL editor for a brand-new project (Dashboard ->
-- SQL Editor -> New query -> paste this whole file -> Run). If your project
-- already ran the earlier version of this file, use
-- the migrations in supabase/migrations/ it hasn't run yet instead.
--
-- Two tables, both bounded in size relative to real usage rather than to
-- game activity:
--   profiles      one row per user, upserted -> stays O(number of users)
--   activity_log  one row per login/heartbeat event, not per game action

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  login_count integer not null default 0,
  rating integer not null default 1200,
  games_played integer not null default 0
);

create index profiles_rating_idx on public.profiles (rating desc);

alter table public.profiles enable row level security;

create policy "select own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Case-insensitive uniqueness, but only among names actually set (nulls are
-- excluded so plenty of users can go without one at once).
create unique index profiles_display_name_lower_idx
  on public.profiles (lower(display_name))
  where display_name is not null;

create table public.activity_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null check (event in ('login', 'heartbeat')),
  created_at timestamptz not null default now()
);

alter table public.activity_log enable row level security;

create policy "select own activity"
  on public.activity_log for select
  using (auth.uid() = user_id);

-- security definer functions do the atomic upsert/increment so the client
-- never needs a read-modify-write round trip. Only 'authenticated' can call
-- them, so anonymous/local play never touches the database at all.

-- Applies a display name chosen at signup time (passed as auth
-- user_metadata via signInWithOtp's options.data), but only if the profile
-- doesn't already have one and the name is still free by the time the
-- magic link is actually clicked -- a unique-name collision here must never
-- fail the login itself, just leave display_name unset.
create or replace function public.track_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_name text := nullif(trim(auth.jwt() -> 'user_metadata' ->> 'display_name'), '');
begin
  insert into public.profiles (id, email, last_seen_at, login_count)
  values (auth.uid(), auth.jwt() ->> 'email', now(), 1)
  on conflict (id) do update
    set last_seen_at = now(),
        login_count = profiles.login_count + 1,
        email = excluded.email;

  if meta_name is not null then
    begin
      update public.profiles
      set display_name = meta_name
      where id = auth.uid() and display_name is null;
    exception when unique_violation then
      null; -- taken in the meantime; the user can set another name later
    end;
  end if;

  insert into public.activity_log (user_id, event) values (auth.uid(), 'login');
end;
$$;

revoke all on function public.track_login() from public;
grant execute on function public.track_login() to authenticated;

create or replace function public.track_heartbeat()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set last_seen_at = now() where id = auth.uid();
  insert into public.activity_log (user_id, event) values (auth.uid(), 'heartbeat');
end;
$$;

revoke all on function public.track_heartbeat() from public;
grant execute on function public.track_heartbeat() to authenticated;

-- Live availability check -- callable while signed out (anon) so the
-- sign-in modal can reject a taken name before the magic link is even sent,
-- and while signed in (excludes the caller's own current name).
create or replace function public.display_name_available(check_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text := nullif(trim(check_name), '');
begin
  if cleaned is null then
    return true;
  end if;
  return not exists (
    select 1 from public.profiles
    where lower(display_name) = lower(cleaned)
      and (auth.uid() is null or id <> auth.uid())
  );
end;
$$;

revoke all on function public.display_name_available(text) from public;
grant execute on function public.display_name_available(text) to anon, authenticated;

-- Set/change/clear (pass '' or null) the caller's own display name.
-- Raises on a taken name (2-20 chars) so the client can surface a clear
-- error rather than silently failing.
create or replace function public.set_display_name(new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text := nullif(trim(new_name), '');
begin
  if cleaned is not null and (char_length(cleaned) < 2 or char_length(cleaned) > 20) then
    raise exception 'display name must be 2-20 characters';
  end if;

  begin
    update public.profiles set display_name = cleaned where id = auth.uid();
  exception when unique_violation then
    raise exception 'display name already taken';
  end;
end;
$$;

revoke all on function public.set_display_name(text) from public;
grant execute on function public.set_display_name(text) to authenticated;

-- To eyeball usage later, e.g.:
--   select email, display_name, login_count, created_at, last_seen_at
--   from public.profiles order by last_seen_at desc;

-- Friends: request by display name, accept/decline, remove.
--
-- One row per pair, whichever side asked first; the unique index on the
-- unordered pair stops A->B and B->A rows from coexisting. All writes go
-- through the security definer functions below, so clients only get select.

create table public.friendships (
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);

create unique index friendships_pair_idx
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

alter table public.friendships enable row level security;

create policy "select own friendships"
  on public.friendships for select
  using (auth.uid() in (requester, addressee));

-- Sends a request to whoever holds that display name. If they had already
-- asked the caller, this accepts theirs instead of making a second row.
create or replace function public.send_friend_request(friend_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  select id into target from public.profiles
  where lower(display_name) = lower(trim(friend_name));
  if target is null then
    raise exception 'no player with that display name';
  end if;
  if target = auth.uid() then
    raise exception 'that''s you';
  end if;

  update public.friendships set status = 'accepted'
  where requester = target and addressee = auth.uid() and status = 'pending';
  if found then return; end if;

  begin
    insert into public.friendships (requester, addressee) values (auth.uid(), target);
  exception when unique_violation then
    raise exception 'already friends or request pending';
  end;
end;
$$;

revoke all on function public.send_friend_request(text) from public;
grant execute on function public.send_friend_request(text) to authenticated;

-- Accept or decline a request someone sent the caller.
create or replace function public.respond_friend_request(other uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if accept then
    update public.friendships set status = 'accepted'
    where requester = other and addressee = auth.uid() and status = 'pending';
  else
    delete from public.friendships
    where requester = other and addressee = auth.uid() and status = 'pending';
  end if;
end;
$$;

revoke all on function public.respond_friend_request(uuid, boolean) from public;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

-- Unfriend, or cancel a request the caller sent — either direction.
create or replace function public.remove_friend(other uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.friendships
  where (requester = auth.uid() and addressee = other)
     or (requester = other and addressee = auth.uid());
end;
$$;

revoke all on function public.remove_friend(uuid) from public;
grant execute on function public.remove_friend(uuid) to authenticated;

-- The caller's friends and pending requests, with the other side's name and
-- last_seen_at (profiles' RLS only shows your own row, hence definer).
-- direction: 'incoming' | 'outgoing' for pending rows, null once accepted.
create or replace function public.list_friends()
returns table (user_id uuid, display_name text, status text, direction text, last_seen_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select p.id, p.display_name, f.status,
         case when f.status = 'accepted' then null
              when f.requester = auth.uid() then 'outgoing'
              else 'incoming' end,
         p.last_seen_at
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where auth.uid() in (f.requester, f.addressee)
  order by lower(p.display_name);
$$;

revoke all on function public.list_friends() from public;
grant execute on function public.list_friends() to authenticated;

-- Ratings: every profile starts at 1200 (column above). Nothing changes
-- them yet; updates will have to come from the game server.
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

-- Elo updates for ranked games. Only the game server calls this (with the
-- service role key), so there is no client grant.
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
