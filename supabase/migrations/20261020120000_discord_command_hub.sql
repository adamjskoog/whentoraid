-- Read-only Discord command hub. Only the signed-interaction worker may supply Discord identity.
-- Resolve membership against the OAuth-verified server; never accept a browser-provided guild ID.
create or replace function public.discord_raid_overview(p_discord_id text, p_discord_guild_id text, p_channel_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  candidates uuid[]; g public.guilds; m public.members; hook public.guild_discord;
  first_week date; horizon bigint; current_ms bigint; event record; mine jsonb; signups jsonb;
  roster_entry jsonb; roster_character text; response_status text; confirmed int; unavailable int;
  roster_counts jsonb; roster jsonb; result jsonb := '[]';
begin
  if coalesce(p_discord_id, '') !~ '^\d{17,20}$'
     or coalesce(p_discord_guild_id, '') !~ '^\d{17,20}$'
     or coalesce(p_channel_id, '') !~ '^\d{17,20}$' then
    raise exception 'Invalid Discord identity.' using errcode = '22023';
  end if;
  with memberships as (
    select gu.id, coalesce(d.channel_id = p_channel_id, false) as in_channel
    from public.guilds gu
    join public.guild_discord_servers ds on ds.guild_id = gu.id and ds.server_id = p_discord_guild_id
    join public.members me on me.guild_id = gu.id and me.discord_id = p_discord_id
    left join public.guild_discord d on d.guild_id = gu.id
    where gu.discord_server_id = ds.server_id
  )
  select array_agg(id order by id) into candidates from memberships
  where in_channel or not exists (select 1 from memberships where in_channel);
  if coalesce(cardinality(candidates), 0) = 0 then return '{"outcome":"not-member"}'; end if;
  if cardinality(candidates) <> 1 then return '{"outcome":"ambiguous"}'; end if;
  select * into g from public.guilds where id = candidates[1];
  select * into m from public.members where guild_id = g.id and discord_id = p_discord_id;
  select * into hook from public.guild_discord where guild_id = g.id;
  first_week := date_trunc('week', now() at time zone g.timezone)::date;
  current_ms := (extract(epoch from now()) * 1000)::bigint;
  horizon := (extract(epoch from now() + interval '28 days') * 1000)::bigint;

  for event in
    with weeks as (
      select first_week + offset_days as week from generate_series(-7, 28, 7) offset_days
      union
      select p.week from public.plans p where p.guild_id = g.id
        and coalesce((p.published ->> 'start')::numeric::bigint, p.start) between current_ms and horizon
    )
    select w.week, r ->> 'id' as raid_id, o.*, p.published as publication,
      s.message_ids ->> -1 as signup_message, d.message_ids ->> -1 as roster_message
    from weeks w cross join jsonb_array_elements(g.settings -> 'raids') r
    cross join lateral public.raid_occurrence(g.id, w.week, r ->> 'id') o
    left join public.plans p on p.guild_id = g.id and p.week = w.week and p.raid_id = r ->> 'id'
    left join public.discord_deliveries s on s.guild_id = g.id and s.week = w.week
      and s.raid_id = r ->> 'id' and s.kind = 'signup' and s.action = 'post'
      and s.webhook_fingerprint = md5('bot:' || hook.channel_id) and not (s.payload ? 'closed')
    left join public.discord_deliveries d on d.guild_id = g.id and d.week = w.week
      and d.raid_id = r ->> 'id' and d.kind = 'roster' and d.action = 'post'
      and d.webhook_fingerprint = md5('bot:' || hook.channel_id)
      -- A queued edit may leave buttons on an older post; do not offer that confirmation link.
      and d.status = 'sent' and o.published
      and not coalesce((d.payload ->> 'cancelled')::boolean, false)
      and not coalesce((d.payload ->> 'withdrawn')::boolean, false)
    where not o.cancelled and o.start_ms > current_ms and o.start_ms <= horizon
      -- Players see announced signups and published rosters, never unannounced officer drafts.
      and (m.is_officer or o.published or s.message_ids ->> 0 is not null)
    order by o.start_ms, r ->> 'id', w.week limit 50
  loop
    with ordered as (
      select s.*, c.name, member.name as player_name, c.class, c.spec as saved_spec, coalesce(s.role, c.role) as chosen_role,
        case when s.status in ('signed','late') then
          count(*) filter (where s.status in ('signed','late')) over
            (partition by coalesce(s.role, c.role) order by s.signed_at, s.member_id)
        end as place
      from public.raid_signups s
      join public.members member on member.guild_id = s.guild_id and member.id = s.member_id
      left join public.characters c on c.guild_id = s.guild_id and c.id = s.character_id
      where s.guild_id = g.id and s.week = event.week and s.raid_id = event.raid_id
    )
    select coalesce(jsonb_agg(jsonb_build_object('memberId', member_id, 'name', coalesce(name, player_name),
      'player', player_name, 'class', class, 'spec', coalesce(spec, saved_spec), 'role', chosen_role,
      'status', status) order by signed_at, member_id), '[]'),
      coalesce((jsonb_agg(jsonb_build_object('status', status, 'character', name, 'spec', coalesce(spec, saved_spec),
        'role', chosen_role, 'place', place, 'afterDeadline', after_deadline,
        'bench', coalesce(place > (event.targets ->> (array_position(array['Tank','Healer','DPS'], chosen_role) - 1))::int
          and (event.targets ->> (array_position(array['Tank','Healer','DPS'], chosen_role) - 1))::int > 0, false)))
        filter (where member_id = m.id)) -> 0, '{}')
    into signups, mine from ordered;

    select entry into roster_entry from jsonb_array_elements(coalesce(event.publication -> 'team', '[]')) entry
      where entry ->> 'memberId' = m.id limit 1;
    select c.name into roster_character from public.characters c
      where c.guild_id = g.id and c.id = roster_entry ->> 'characterId';
    select r.status into response_status from public.raid_responses r
      where r.guild_id = g.id and r.week = event.week and r.raid_id = event.raid_id and r.member_id = m.id
        and r.assignment = public.raid_assignment(event.publication, m.id);
    mine := mine || jsonb_build_object('rostered', roster_entry is not null,
      'rosterCharacter', roster_character, 'rosterRole', roster_entry ->> 'role', 'response', response_status);

    select count(*) filter (where r.status = 'confirmed'), count(*) filter (where r.status = 'unavailable')
      into confirmed, unavailable from public.raid_responses r
      where r.guild_id = g.id and r.week = event.week and r.raid_id = event.raid_id
        and r.assignment = public.raid_assignment(event.publication, r.member_id);
    select jsonb_build_array(count(*) filter (where e ->> 'role' = 'Tank'),
      count(*) filter (where e ->> 'role' = 'Healer'), count(*) filter (where e ->> 'role' = 'DPS'))
      into roster_counts from jsonb_array_elements(coalesce(event.publication -> 'team', '[]')) e;
    select coalesce(jsonb_agg(jsonb_build_object('memberId', e ->> 'memberId',
      'name', coalesce(c.name, member.name, 'Removed player'), 'player', member.name, 'class', c.class,
      'spec', case when s.character_id = e ->> 'characterId' and s.role = e ->> 'role'
        then coalesce(s.spec, c.spec) else c.spec end,
      'role', e ->> 'role', 'status', s.status)
      order by array_position(array['Tank','Healer','DPS'], e ->> 'role'), team.position), '[]') into roster
    from jsonb_array_elements(coalesce(event.publication -> 'team', '[]')) with ordinality team(e, position)
    left join public.members member on member.guild_id = g.id and member.id = e ->> 'memberId'
    left join public.characters c on c.guild_id = g.id and c.id = e ->> 'characterId'
    left join public.raid_signups s on s.guild_id = g.id and s.week = event.week and s.raid_id = event.raid_id
      and s.member_id = e ->> 'memberId';
    result := result || jsonb_build_array(jsonb_build_object(
      'raidId', event.raid_id, 'raidName', event.raid_name, 'week', event.week,
      'start', event.start_ms, 'end', event.end_ms, 'targets', event.targets,
      'published', event.published, 'signups', signups, 'roster', roster, 'mine', mine,
      'signupMessageId', event.signup_message, 'rosterMessageId', event.roster_message)
      || case when m.is_officer then jsonb_build_object(
        'rosterCounts', roster_counts, 'rosterTargets', coalesce(event.publication -> 'targets', event.targets),
        'confirmed', confirmed, 'unavailable', unavailable,
        'unconfirmed', jsonb_array_length(coalesce(event.publication -> 'team', '[]')) - confirmed - unavailable)
        else '{}'::jsonb end);
  end loop;
  return jsonb_build_object('outcome', 'ok', 'guildId', g.id, 'guildName', g.name,
    'serverId', p_discord_guild_id, 'channelId', hook.channel_id, 'officer', m.is_officer, 'raids', result);
end $$;

revoke execute on function public.discord_raid_overview(text, text, text) from public, anon, authenticated;
grant execute on function public.discord_raid_overview(text, text, text) to service_role;

-- The public card and personal bench position use the same deterministic signup order.
create or replace function public.raid_signup_payload(p_id uuid, p_lease uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.discord_deliveries; o record; signups jsonb; guild_name text;
begin
  select * into d from public.discord_deliveries where id = p_id and lease_token = p_lease and status = 'sending' and kind = 'signup';
  if not found then return null; end if;
  select name into guild_name from public.guilds where id = d.guild_id;
  select * into o from public.raid_occurrence(d.guild_id, d.week, d.raid_id);
  select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(c.name, m.name), 'player', m.name, 'class', c.class,
      'spec', coalesce(s.spec, c.spec), 'role', coalesce(s.role, c.role), 'status', s.status, 'discordId', m.discord_id)
      order by s.signed_at, s.member_id), '[]')
    into signups
    from public.raid_signups s join public.members m on m.guild_id = s.guild_id and m.id = s.member_id
    left join public.characters c on c.guild_id = s.guild_id and c.id = s.character_id
    where s.guild_id = d.guild_id and s.week = d.week and s.raid_id = d.raid_id;
  return jsonb_build_object('guildId', d.guild_id, 'week', d.week, 'raidId', d.raid_id, 'guildName', guild_name,
    'raidName', coalesce(o.raid_name, 'Raid'), 'start', o.start_ms, 'end', o.end_ms, 'targets', coalesce(o.targets, '[0,0,0]'),
    'cancelled', coalesce(o.cancelled, true), 'published', coalesce(o.published, false),
    'closed', d.payload ? 'closed' or o.start_ms is null or o.start_ms <= extract(epoch from now()) * 1000,
    'signups', signups);
end $$;

-- Complete 200-player signup lists can need more than ten messages when names require escaping.
-- Keep bounded receipts for all continuations so the worker can edit and remove them safely.
create or replace function public.valid_discord_posts(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object' and not exists (
    select 1 from jsonb_each(p) e
    where e.key !~ '^\d{4}-\d{2}-\d{2}/[a-z0-9-]{1,64}$'
       or jsonb_typeof(e.value) is distinct from 'array'
       or jsonb_array_length(e.value) not between 1 and 20
       or exists (
         select 1 from jsonb_array_elements(e.value) m
         where jsonb_typeof(m) is distinct from 'string' or (m #>> '{}') !~ '^\d{17,20}$'
       )
  )
$$;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261020120000'::text $$;
