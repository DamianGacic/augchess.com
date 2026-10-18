-- AugChess optional-login usage tracking + display names.
-- Run once in the Supabase SQL editor for a brand-new project (Dashboard ->
-- SQL Editor -> New query -> paste this whole file -> Run). If your project
-- already ran the earlier version of this file, use
-- supabase/migrations/0002_display_names.sql instead.
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
  login_count integer not null default 0
);

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
