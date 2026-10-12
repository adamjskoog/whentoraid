-- General links add new members. Existing profiles require a short-lived, single-use link
-- addressed to exactly one unclaimed non-officer. Only officers may issue or revoke it.
create table public.member_invites (
  guild_id uuid not null,
  member_id text not null,
  code text not null unique check (code ~ '^[a-f0-9]{32}$'),
  expires_at timestamptz not null default now() + interval '7 days',
  primary key (guild_id, member_id),
  foreign key (guild_id, member_id) references public.members (guild_id, id) on delete cascade
);
alter table public.member_invites enable row level security;
revoke all on public.member_invites from public, anon, authenticated;

create function public.create_member_invite(p_guild_id uuid, p_member_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare result text;
begin
  if not public.is_guild_officer(p_guild_id) then
    raise exception 'Only officers can invite players.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.members m where m.guild_id = p_guild_id
    and m.id = p_member_id and m.discord_id = '' and not m.is_officer) then
    raise exception 'Choose a player who is not already linked to Discord and is not an officer.'
      using errcode = '22023';
  end if;
  insert into public.member_invites (guild_id, member_id, code)
    values (p_guild_id, p_member_id, replace(gen_random_uuid()::text, '-', ''))
    on conflict (guild_id, member_id) do update
      set code = excluded.code, expires_at = excluded.expires_at
    returning code into result;
  return result;
end $$;

create function public.disable_member_invite(p_guild_id uuid, p_member_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_guild_officer(p_guild_id) then
    raise exception 'Only officers can invite players.' using errcode = '42501';
  end if;
  delete from public.member_invites where guild_id = p_guild_id and member_id = p_member_id;
end $$;

create or replace function public.invite_guild(p_code text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare found_guild uuid;
begin
  select i.guild_id into found_guild from public.guild_invites i where i.code = lower(btrim(p_code));
  if found_guild is null then
    select i.guild_id into found_guild from public.member_invites i
      join public.members m on m.guild_id = i.guild_id and m.id = i.member_id
      where i.code = lower(btrim(p_code)) and i.expires_at > now()
        and m.discord_id = '' and not m.is_officer;
  end if;
  if found_guild is null then
    raise exception 'This invite link no longer works. Ask an officer for a new one.' using errcode = 'P0002';
  end if;
  return found_guild;
end $$;

create or replace function public.invite_details(p_code text)
returns table (guild_id uuid, guild_name text, already_member boolean, open_players jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare g uuid;
begin
  if public.my_discord_id() is null then
    raise exception 'Sign in with Discord to join a guild.' using errcode = '42501';
  end if;
  g := public.invite_guild(p_code);
  return query select gu.id, gu.name, public.is_guild_member(g),
    coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name))
      from public.member_invites i join public.members m on m.guild_id = i.guild_id and m.id = i.member_id
      where i.guild_id = g and i.code = lower(btrim(p_code)) and i.expires_at > now()
        and m.discord_id = '' and not m.is_officer), '[]'::jsonb)
    from public.guilds gu where gu.id = g;
end $$;

create or replace function public.join_guild(p_code text, p_member_id text, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  discord text := public.my_discord_id();
  g uuid;
  target_member text;
  general boolean;
begin
  if discord is null then
    raise exception 'Sign in with Discord to join a guild.' using errcode = '42501';
  end if;
  g := public.invite_guild(p_code);
  -- Same lock order as atomic saves, so a concurrent join cannot be overwritten by an old save.
  perform 1 from public.guild_revisions r where r.guild_id = g for update;
  perform 1 from public.guild_invites i where i.guild_id = g and i.code = lower(btrim(p_code)) for share;
  general := found;
  if not general then
    select i.member_id into target_member from public.member_invites i
      where i.guild_id = g and i.code = lower(btrim(p_code)) and i.expires_at > now() for update;
    if target_member is null then
      raise exception 'This invite link no longer works. Ask an officer for a new one.' using errcode = 'P0002';
    end if;
  end if;
  if public.is_guild_member(g) then return g; end if;
  if general and p_member_id is not null then
    raise exception 'Ask an officer for a personal link to claim an existing player.' using errcode = '42501';
  end if;
  if not general then
    if p_member_id is distinct from target_member then
      raise exception 'This personal invite belongs to a different player.' using errcode = '42501';
    end if;
    update public.members m set discord_id = discord
      where m.guild_id = g and m.id = target_member and m.discord_id = '' and not m.is_officer;
    if not found then
      raise exception 'This invite link no longer works. Ask an officer for a new one.' using errcode = 'P0002';
    end if;
    delete from public.member_invites where guild_id = g and member_id = target_member;
  else
    insert into public.members (guild_id, id, name, discord_id, is_officer, position)
      values (g, 'm-' || left(replace(gen_random_uuid()::text, '-', ''), 12), btrim(coalesce(p_name, '')),
        discord, false, coalesce((select max(m.position) + 1 from public.members m where m.guild_id = g), 0));
  end if;
  update public.guild_revisions set revision = revision + 1 where guild_id = g;
  return g;
end $$;

revoke execute on function public.create_member_invite(uuid, text), public.disable_member_invite(uuid, text)
  from public, anon;
grant execute on function public.create_member_invite(uuid, text), public.disable_member_invite(uuid, text)
  to authenticated;
-- Replacement functions retain their existing grants. The resolver stays private.
revoke execute on function public.invite_guild(text) from public, anon, authenticated;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$
  select '20261013090000'::text
$$;
