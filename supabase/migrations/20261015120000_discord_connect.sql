-- Connecting the WhenToRaid bot from Guild settings. An officer adds the bot on Discord's own screen;
-- the discord-connect Edge Function exchanges the code from that redirect, and Discord's token
-- response names the server (only someone with Manage Server there can add the bot). The server is
-- recorded here, and the bot only posts to channels in it, so a guild cannot point the bot at a
-- channel in somebody else's server.
create table public.guild_discord_servers (
  guild_id uuid primary key references public.guilds on delete cascade,
  server_id text not null check (server_id ~ '^\d{17,20}$'),
  server_name text not null default '' check (char_length(server_name) <= 100),
  linked_at timestamptz not null default now()
);
alter table public.guild_discord_servers enable row level security;
revoke all on public.guild_discord_servers from public, anon, authenticated;

-- Called only by the discord-connect Edge Function, after Discord confirmed the server.
create function public.link_discord_server(p_guild_id uuid, p_server_id text, p_server_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare previous text;
begin
  if coalesce(p_server_id, '') !~ '^\d{17,20}$' then
    raise exception 'That is not a Discord server.' using errcode = '22023';
  end if;
  select server_id into previous from public.guild_discord_servers where guild_id = p_guild_id;
  insert into public.guild_discord_servers (guild_id, server_id, server_name)
  values (p_guild_id, p_server_id, left(btrim(coalesce(p_server_name, '')), 100))
  on conflict (guild_id) do update set
    server_id = excluded.server_id, server_name = excluded.server_name, linked_at = now();
  if previous is distinct from p_server_id then
    -- A bot channel in the previous server cannot be posted to any more; the webhook, if any, stays.
    delete from public.guild_discord where guild_id = p_guild_id and channel_id <> '' and webhook_url is null;
    update public.guild_discord set channel_id = '', posts = '{}'
     where guild_id = p_guild_id and channel_id <> '';
  end if;
  -- Discord buttons are routed by the guild's server id. Bumping the revision makes browsers that
  -- still hold the old id reload instead of saving it back.
  update public.guilds set discord_server_id = p_server_id
   where id = p_guild_id and discord_server_id is distinct from p_server_id;
  if found then
    update public.guild_revisions set revision = revision + 1 where guild_id = p_guild_id;
  end if;
end $$;
revoke execute on function public.link_discord_server(uuid, text, text) from public, anon, authenticated;
grant execute on function public.link_discord_server(uuid, text, text) to service_role;

-- Officers also see which server the bot was added to.
drop function public.get_guild_discord(uuid);
create function public.get_guild_discord(p_guild_id uuid)
returns table (
  webhook_url text, mention_players boolean, posts jsonb, channel_id text, server_id text, server_name text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_guild_officer(p_guild_id);
  return query
    select coalesce(d.webhook_url, ''), coalesce(d.mention_players, false), coalesce(d.posts, '{}'::jsonb),
           coalesce(d.channel_id, ''), coalesce(s.server_id, ''), coalesce(s.server_name, '')
      from (select p_guild_id as guild_id) g
      left join public.guild_discord d on d.guild_id = g.guild_id
      left join public.guild_discord_servers s on s.guild_id = g.guild_id
     where d.guild_id is not null or s.guild_id is not null;
end $$;
revoke execute on function public.get_guild_discord(uuid) from public, anon;
grant execute on function public.get_guild_discord(uuid) to authenticated;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261015120000'::text $$;
