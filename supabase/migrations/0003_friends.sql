-- Friends: request by display name, accept/decline, remove.
-- Run once in the SQL editor after 0002_display_names.sql (already included
-- in schema.sql for brand-new projects).
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
