-- Posting rosters to a Discord channel. A channel webhook URL lets anyone who has it post there,
-- so it lives in its own table that no client can read directly: only officers, through the
-- functions below. It is not part of the guild rows every player loads.
--
-- `posts` remembers which Discord messages hold each raid's posted roster, keyed "week/raid id",
-- so a later post edits those messages instead of adding new ones.

create function public.valid_webhook_url(url text) returns boolean
language sql immutable set search_path = '' as $$
  select url ~ '^https://(ptb\.|canary\.)?discord(app)?\.com/api/webhooks/\d{17,20}/[A-Za-z0-9_-]{20,100}$'
$$;

create function public.valid_discord_posts(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object' and not exists (
    select 1 from jsonb_each(p) e
    where e.key !~ '^\d{4}-\d{2}-\d{2}/[a-z0-9-]{1,64}$'
       or jsonb_typeof(e.value) is distinct from 'array'
       or jsonb_array_length(e.value) not between 1 and 10
       or exists (
         select 1 from jsonb_array_elements(e.value) m
         where jsonb_typeof(m) is distinct from 'string' or (m #>> '{}') !~ '^\d{17,20}$'
       )
  )
$$;

create table public.guild_discord (
  guild_id uuid primary key references public.guilds on delete cascade,
  webhook_url text not null check (public.valid_webhook_url(webhook_url)),
  -- Mention rostered players who have a Discord ID when a roster is first posted.
  mention_players boolean not null default false,
  posts jsonb not null default '{}'
    check (public.valid_discord_posts(posts) and pg_column_size(posts) < 40000)
);
alter table public.guild_discord enable row level security;
revoke all on public.guild_discord from public, anon, authenticated;

create function public.require_guild_officer(g uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_guild_officer(g) then
    raise exception 'Only officers can manage the guild’s Discord channel.' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.require_guild_officer(uuid) from public, anon, authenticated;

-- The guild's Discord channel settings, or no row when none is set. Officers only.
create function public.get_guild_discord(p_guild_id uuid)
returns table (webhook_url text, mention_players boolean, posts jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_guild_officer(p_guild_id);
  return query select d.webhook_url, d.mention_players, d.posts
    from public.guild_discord d where d.guild_id = p_guild_id;
end $$;

-- Set the webhook; an empty URL removes the channel and forgets earlier posts. Officers only.
create function public.set_guild_discord(p_guild_id uuid, p_webhook_url text, p_mention_players boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_guild_officer(p_guild_id);
  if coalesce(btrim(p_webhook_url), '') = '' then
    delete from public.guild_discord where guild_id = p_guild_id;
    return;
  end if;
  if not public.valid_webhook_url(btrim(p_webhook_url)) then
    raise exception 'That is not a Discord webhook URL.' using errcode = '22023';
  end if;
  insert into public.guild_discord (guild_id, webhook_url, mention_players)
  values (p_guild_id, btrim(p_webhook_url), coalesce(p_mention_players, false))
  on conflict (guild_id) do update set
    mention_players = excluded.mention_players,
    -- Messages posted through another channel's webhook cannot be edited through this one.
    posts = case when guild_discord.webhook_url = excluded.webhook_url then guild_discord.posts else '{}' end,
    webhook_url = excluded.webhook_url;
end $$;

-- Remember the messages holding one raid's posted roster; an empty list forgets them. Entries for
-- weeks more than 90 days old are dropped, so the map stays small.
create function public.record_discord_post(p_guild_id uuid, p_key text, p_message_ids jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_guild_officer(p_guild_id);
  if p_key !~ '^\d{4}-\d{2}-\d{2}/[a-z0-9-]{1,64}$' or jsonb_typeof(p_message_ids) is distinct from 'array' then
    raise exception 'Invalid Discord post.' using errcode = '22023';
  end if;
  update public.guild_discord d set posts = (
    select coalesce(jsonb_object_agg(e.key, e.value), '{}')
    from jsonb_each(d.posts || jsonb_build_object(p_key, p_message_ids)) e
    where (e.key <> p_key or jsonb_array_length(p_message_ids) > 0)
      and left(e.key, 10)::date >= current_date - 90
  )
  where d.guild_id = p_guild_id;
  if not found then
    raise exception 'Set a Discord channel in Guild settings first.' using errcode = '22023';
  end if;
end $$;

revoke execute on function public.get_guild_discord(uuid), public.set_guild_discord(uuid, text, boolean),
  public.record_discord_post(uuid, text, jsonb) from public, anon;
grant execute on function public.get_guild_discord(uuid), public.set_guild_discord(uuid, text, boolean),
  public.record_discord_post(uuid, text, jsonb) to authenticated;

-- Keep in step with the newest migration's timestamp (checked by src/lib/schema-version.test.js).
create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$
  select '20261012120000'::text
$$;
