-- Invite links. An officer shares a link; a player who opens it and signs in with Discord joins
-- the guild themselves, either as a listed player not yet linked to anyone or as a new player.
-- Nothing about a guild is visible without its code; resetting the code ends old links.

create table public.guild_invites (
  guild_id uuid primary key references public.guilds on delete cascade,
  code text not null unique check (code ~ '^[a-f0-9]{32}$'),
  created_at timestamptz not null default now()
);
alter table public.guild_invites enable row level security;
revoke all on public.guild_invites from public, anon, authenticated;

-- The guild's invite code, created on first use; `p_reset` replaces it. Officers only.
create function public.guild_invite_code(p_guild_id uuid, p_reset boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  fresh text := replace(gen_random_uuid()::text, '-', '');
  result text;
begin
  if not public.is_guild_officer(p_guild_id) then
    raise exception 'Only officers can invite players.' using errcode = '42501';
  end if;
  insert into public.guild_invites (guild_id, code) values (p_guild_id, fresh)
  on conflict (guild_id) do update
    set code = case when p_reset then excluded.code else guild_invites.code end,
        created_at = case when p_reset then now() else guild_invites.created_at end
  returning code into result;
  return result;
end $$;

-- Turn the invite link off. Officers only.
create function public.disable_guild_invite(p_guild_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_guild_officer(p_guild_id) then
    raise exception 'Only officers can invite players.' using errcode = '42501';
  end if;
  delete from public.guild_invites where guild_id = p_guild_id;
end $$;

-- The guild's current invite code without creating one, or null. Officers only.
create function public.current_guild_invite(p_guild_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_guild_officer(p_guild_id) then
    raise exception 'Only officers can invite players.' using errcode = '42501';
  end if;
  return (select i.code from public.guild_invites i where i.guild_id = p_guild_id);
end $$;

create function public.invite_guild(p_code text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare found_guild uuid;
begin
  select i.guild_id into found_guild from public.guild_invites i where i.code = lower(btrim(p_code));
  if found_guild is null then
    raise exception 'This invite link no longer works. Ask an officer for a new one.' using errcode = 'P0002';
  end if;
  return found_guild;
end $$;
revoke execute on function public.invite_guild(text) from public, anon, authenticated;

-- What an invite offers: the guild's name, whether the caller is already in it, and the listed
-- players nobody has claimed yet (officers are never offered).
create function public.invite_details(p_code text)
returns table (guild_id uuid, guild_name text, already_member boolean, open_players jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare g uuid;
begin
  if public.my_discord_id() is null then
    raise exception 'Sign in with Discord to join a guild.' using errcode = '42501';
  end if;
  g := public.invite_guild(p_code);
  return query select gu.id, gu.name, public.is_guild_member(g),
    coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.position, m.id)
      from public.members m where m.guild_id = g and m.discord_id = '' and not m.is_officer), '[]')
    from public.guilds gu where gu.id = g;
end $$;

-- Join through an invite: claim the listed player `p_member_id`, or, when it is null, join as a
-- new player named `p_name`. Joining a guild you are already in just returns it.
create function public.join_guild(p_code text, p_member_id text, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  discord text := public.my_discord_id();
  g uuid;
begin
  if discord is null then
    raise exception 'Sign in with Discord to join a guild.' using errcode = '42501';
  end if;
  g := public.invite_guild(p_code);
  if public.is_guild_member(g) then return g; end if;

  if p_member_id is not null then
    update public.members m set discord_id = discord
      where m.guild_id = g and m.id = p_member_id and m.discord_id = '' and not m.is_officer;
    if not found then
      raise exception 'Someone else already claimed that player. Choose another, or join as a new player.'
        using errcode = 'P0001';
    end if;
  else
    insert into public.members (guild_id, id, name, discord_id, is_officer, position)
    values (g, 'm-' || left(replace(gen_random_uuid()::text, '-', ''), 12), btrim(coalesce(p_name, '')),
      discord, false, coalesce((select max(m.position) + 1 from public.members m where m.guild_id = g), 0));
  end if;

  -- Windows still saving with the old revision reload first, so they never overwrite the join.
  update public.guild_revisions set revision = revision + 1 where guild_id = g;
  return g;
end $$;

revoke execute on function public.guild_invite_code(uuid, boolean), public.disable_guild_invite(uuid),
  public.current_guild_invite(uuid), public.invite_details(text), public.join_guild(text, text, text)
  from public, anon;
grant execute on function public.guild_invite_code(uuid, boolean), public.disable_guild_invite(uuid),
  public.current_guild_invite(uuid), public.invite_details(text), public.join_guild(text, text, text)
  to authenticated;

-- Keep in step with the newest migration's timestamp (checked by src/lib/schema-version.test.js).
create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$
  select '20261012130000'::text
$$;
