-- Adds optional, unique display names on top of the original schema.sql.
-- Run once in the SQL editor for a project that already ran the original
-- schema.sql (i.e. `profiles` and `activity_log` already exist).

alter table public.profiles add column display_name text;

create unique index profiles_display_name_lower_idx
  on public.profiles (lower(display_name))
  where display_name is not null;

-- Replaces track_login to also apply a display name chosen at signup time
-- (passed as auth user_metadata via signInWithOtp's options.data), but only
-- if the profile doesn't already have one and the name is still free by the
-- time the magic link is actually clicked.
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
