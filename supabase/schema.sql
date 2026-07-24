-- AugChess optional-login usage tracking.
-- Run once in the Supabase SQL editor for your project (Dashboard -> SQL
-- Editor -> New query -> paste this whole file -> Run).
--
-- Two tables, both bounded in size relative to real usage rather than to
-- game activity:
--   profiles      one row per user, upserted -> stays O(number of users)
--   activity_log  one row per login/heartbeat event, not per game action

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  login_count integer not null default 0
);

alter table public.profiles enable row level security;

create policy "select own profile"
  on public.profiles for select
  using (auth.uid() = id);

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

create or replace function public.track_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, last_seen_at, login_count)
  values (auth.uid(), auth.jwt() ->> 'email', now(), 1)
  on conflict (id) do update
    set last_seen_at = now(),
        login_count = profiles.login_count + 1,
        email = excluded.email;

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

-- To eyeball usage later, e.g.:
--   select email, login_count, created_at, last_seen_at from public.profiles
--   order by last_seen_at desc;
