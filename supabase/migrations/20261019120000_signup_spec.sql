-- Spec pick at sign-up. A Discord sign-up uses the character's saved spec; the private confirmation
-- offers a "Change spec" menu, and the spec chosen there applies to that raid only. It is stored on
-- the sign-up (for the post and the bench) and as `signedAs` in the player's check-in for that raid
-- (for the planner). NULL spec and role mean the character's saved ones.

alter table public.raid_signups
  add column spec text check (spec is null or char_length(spec) between 1 and 40),
  add column role text check (role is null or role in ('Tank', 'Healer', 'DPS')),
  add constraint raid_signups_spec_role check ((spec is null) = (role is null));

-- The specs a class can sign up as, each with its raid role, in the in-game order. Mirrors SPEC_ROLES
-- in src/lib/constants.js; Feral Combat has no default role there, so it is offered as tank and as DPS.
create function public.class_spec_roles(c text) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('spec', x.spec, 'role', x.role) order by x.n), '[]')
  from (values
    ('Warrior', 1, 'Arms', 'DPS'), ('Warrior', 2, 'Fury', 'DPS'), ('Warrior', 3, 'Protection', 'Tank'),
    ('Paladin', 1, 'Holy', 'Healer'), ('Paladin', 2, 'Protection', 'Tank'), ('Paladin', 3, 'Retribution', 'DPS'),
    ('Hunter', 1, 'Beast Mastery', 'DPS'), ('Hunter', 2, 'Marksmanship', 'DPS'), ('Hunter', 3, 'Survival', 'DPS'),
    ('Rogue', 1, 'Assassination', 'DPS'), ('Rogue', 2, 'Combat', 'DPS'), ('Rogue', 3, 'Subtlety', 'DPS'),
    ('Priest', 1, 'Discipline', 'Healer'), ('Priest', 2, 'Holy', 'Healer'), ('Priest', 3, 'Shadow', 'DPS'),
    ('Shaman', 1, 'Elemental', 'DPS'), ('Shaman', 2, 'Enhancement', 'DPS'), ('Shaman', 3, 'Restoration', 'Healer'),
    ('Mage', 1, 'Arcane', 'DPS'), ('Mage', 2, 'Fire', 'DPS'), ('Mage', 3, 'Frost', 'DPS'),
    ('Warlock', 1, 'Affliction', 'DPS'), ('Warlock', 2, 'Demonology', 'DPS'), ('Warlock', 3, 'Destruction', 'DPS'),
    ('Druid', 1, 'Balance', 'DPS'), ('Druid', 2, 'Feral Combat', 'Tank'), ('Druid', 3, 'Feral Combat', 'DPS'),
    ('Druid', 4, 'Restoration', 'Healer')
  ) x(class, n, spec, role) where x.class = c
$$;

-- Check-in raid preferences may now carry `signedAs: { characterId, spec, role }`.
create or replace function public.valid_raid_preferences(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  return (select count(*) from jsonb_object_keys(p)) <= 10 and not exists (
    select 1 from jsonb_each(p) e where e.key !~ '^[a-z0-9-]{1,64}$'
      or jsonb_typeof(e.value) is distinct from 'object'
      or jsonb_typeof(e.value -> 'participating') is distinct from 'boolean'
      or not coalesce(public.valid_string_list(e.value -> 'declined', 20), false)
      or (e.value ? 'signedAs' and not (
        jsonb_typeof(e.value -> 'signedAs') = 'object'
        and jsonb_typeof(e.value -> 'signedAs' -> 'characterId') = 'string'
        and char_length(e.value -> 'signedAs' ->> 'characterId') between 1 and 64
        and jsonb_typeof(e.value -> 'signedAs' -> 'spec') = 'string'
        and char_length(e.value -> 'signedAs' ->> 'spec') between 1 and 40
        and jsonb_typeof(e.value -> 'signedAs' -> 'role') = 'string'
        and e.value -> 'signedAs' ->> 'role' in ('Tank', 'Healer', 'DPS')))
  );
exception when others then return false;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Readers: the sign-up's own spec and role win over the character's saved ones.
drop function public.get_raid_signups(uuid, date);
create function public.get_raid_signups(p_guild_id uuid, p_week date)
returns table (raid_id text, member_id text, status text, character_id text, after_deadline boolean,
  signed_at timestamptz, spec text, role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_guild_member(p_guild_id) then
    raise exception 'You are not a guild member.' using errcode = '42501';
  end if;
  return query select s.raid_id, s.member_id, s.status, s.character_id, s.after_deadline, s.signed_at, s.spec, s.role
    from public.raid_signups s where s.guild_id = p_guild_id and s.week = p_week order by s.signed_at;
end $$;
revoke execute on function public.get_raid_signups(uuid, date) from public, anon;
grant execute on function public.get_raid_signups(uuid, date) to authenticated;

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
      order by s.signed_at), '[]')
    into signups
    from public.raid_signups s join public.members m on m.guild_id = s.guild_id and m.id = s.member_id
    left join public.characters c on c.guild_id = s.guild_id and c.id = s.character_id
    where s.guild_id = d.guild_id and s.week = d.week and s.raid_id = d.raid_id;
  return jsonb_build_object('guildId', d.guild_id, 'week', d.week, 'raidId', d.raid_id, 'guildName', guild_name,
    'raidName', coalesce(o.raid_name, 'Raid'), 'start', o.start_ms, 'end', o.end_ms, 'targets', coalesce(o.targets, '[0,0,0]'),
    -- A raid removed from the schedule reads as cancelled.
    'cancelled', coalesce(o.cancelled, true), 'published', coalesce(o.published, false),
    'closed', d.payload ? 'closed' or o.start_ms is null or o.start_ms <= extract(epoch from now()) * 1000,
    'signups', signups);
end $$;

create or replace function public.signup_standing(p_delivery_id uuid, p_discord_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.discord_deliveries; m public.members; o record; mine record; target int;
begin
  select * into d from public.discord_deliveries where id = p_delivery_id and kind = 'signup';
  if not found then return null; end if;
  select * into m from public.members where guild_id = d.guild_id and discord_id = p_discord_id;
  if not found then return null; end if;
  select x.role, x.place into mine from (
    select s.member_id, coalesce(s.role, c.role) as role,
      row_number() over (partition by coalesce(s.role, c.role) order by s.signed_at, s.member_id) as place
    from public.raid_signups s
    left join public.characters c on c.guild_id = s.guild_id and c.id = s.character_id
    where s.guild_id = d.guild_id and s.week = d.week and s.raid_id = d.raid_id and s.status in ('signed', 'late')
  ) x where x.member_id = m.id;
  if not found or mine.role is null then return null; end if;
  select * into o from public.raid_occurrence(d.guild_id, d.week, d.raid_id);
  target := coalesce((o.targets ->> (array_position(array['Tank', 'Healer', 'DPS'], mine.role) - 1))::int, 0);
  return jsonb_build_object('role', mine.role, 'place', mine.place, 'target', target,
    'bench', target > 0 and mine.place > target);
end $$;

-- What the private confirmation shows about the character: its spec and role for this raid, and the
-- specs it can change to.
create function public.signup_as(c public.characters, s_spec text, s_role text) returns jsonb
language sql immutable set search_path = '' as $$
  select case when c.id is null then '{}'::jsonb else jsonb_build_object('character', c.name, 'class', c.class,
    'spec', coalesce(s_spec, c.spec), 'role', coalesce(s_role, c.role), 'specs', public.class_spec_roles(c.class)) end
$$;

-- ---------------------------------------------------------------------------------------------
-- signup_from_discord as before (20261017120000), except that a sign-up keeps the spec chosen for
-- this raid while the player stays on the same character, and its reply describes the character.
create or replace function public.signup_from_discord(
  p_interaction_id text, p_discord_id text, p_discord_guild_id text, p_channel_id text,
  p_message_id text, p_delivery_id uuid, p_status text, p_character_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.discord_deliveries; g public.guilds; hook public.guild_discord; m public.members; o record;
  existing public.raid_signups; c public.checkins; chosen public.characters; active_count int;
  late_entry boolean; win int8range; ranges int8multirange; tentative int8multirange; preferred int8multirange;
  availability jsonb; preferences jsonb; declined jsonb; planning_day text; deadline timestamptz;
  template jsonb; same_character boolean; preference jsonb;
begin
  if p_interaction_id !~ '^\d{17,20}$' or p_discord_id !~ '^\d{17,20}$' or p_discord_guild_id !~ '^\d{17,20}$'
     or p_channel_id !~ '^\d{17,20}$' or p_message_id !~ '^\d{17,20}$'
     or p_status is null or p_status not in ('signed', 'late', 'tentative', 'absent')
     or (p_character_id is not null and char_length(p_character_id) not between 1 and 64) then
    raise exception 'Invalid Discord sign-up.' using errcode = '22023';
  end if;
  select * into d from public.discord_deliveries where id = p_delivery_id and kind = 'signup';
  if not found then return jsonb_build_object('outcome', 'unknown'); end if;
  select * into g from public.guilds where id = d.guild_id;
  select * into hook from public.guild_discord where guild_id = d.guild_id;
  if g.discord_server_id is distinct from p_discord_guild_id or hook.channel_id is distinct from p_channel_id
     or d.webhook_fingerprint <> md5('bot:' || p_channel_id) or not (d.message_ids ? p_message_id) then
    return jsonb_build_object('outcome', 'unknown');
  end if;
  select * into m from public.members where guild_id = d.guild_id and discord_id = p_discord_id;
  if not found then return jsonb_build_object('outcome', 'not-member', 'guildName', g.name); end if;
  -- Same lock order as atomic saves, taken before reading the raid and characters: an officer's
  -- save cannot change them underneath this press, and an app saving meanwhile reloads instead.
  perform 1 from public.guild_revisions r where r.guild_id = d.guild_id for update;
  select * into o from public.raid_occurrence(d.guild_id, d.week, d.raid_id);
  if o.start_ms is null or o.cancelled or d.payload ? 'closed' or o.start_ms <= extract(epoch from now()) * 1000 then
    return jsonb_build_object('outcome', 'closed');
  end if;

  select * into existing from public.raid_signups
    where guild_id = d.guild_id and week = d.week and raid_id = d.raid_id and member_id = m.id;
  select count(*) into active_count from public.characters where guild_id = d.guild_id and member_id = m.id and not retired;
  if p_character_id is not null then
    select * into chosen from public.characters
      where guild_id = d.guild_id and id = p_character_id and member_id = m.id and not retired;
    if not found then return jsonb_build_object('outcome', 'bad-character'); end if;
  elsif p_status in ('signed', 'late') then
    if active_count = 0 then return jsonb_build_object('outcome', 'no-characters'); end if;
    if active_count > 1 then
      return jsonb_build_object('outcome', 'choose', 'status', p_status, 'characters', (
        select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'class', x.class, 'spec', x.spec, 'role', x.role)
          order by x.main desc, x.position)
        from (select * from public.characters where guild_id = d.guild_id and member_id = m.id and not retired
          order by main desc, position limit 25) x));
    end if;
    select * into chosen from public.characters where guild_id = d.guild_id and member_id = m.id and not retired;
  elsif p_status = 'tentative' then
    -- Tentative keeps a character already chosen, or the only one.
    select * into chosen from public.characters where guild_id = d.guild_id and member_id = m.id and not retired
      and (id = existing.character_id or active_count = 1) limit 1;
  end if;
  same_character := chosen.id is not null and existing.character_id is not distinct from chosen.id;

  delete from public.discord_interactions where received_at < now() - interval '1 day';
  insert into public.discord_interactions (id) values (p_interaction_id) on conflict (id) do nothing;
  if not found then return jsonb_build_object('outcome', 'duplicate'); end if;
  -- Pressing the same answer again changes nothing, so it neither reloads open apps nor re-sends the post.
  if existing.status = p_status and existing.character_id is not distinct from chosen.id then
    return jsonb_build_object('outcome', 'saved', 'status', p_status, 'raidName', o.raid_name,
      'afterDeadline', existing.after_deadline) || public.signup_as(chosen, existing.spec, existing.role);
  end if;

  deadline := public.checkin_deadline(d.guild_id, d.week);
  late_entry := deadline is not null and deadline <= now();
  insert into public.raid_signups as s (guild_id, week, raid_id, member_id, status, character_id, after_deadline, signed_at, updated_at)
  values (d.guild_id, d.week, d.raid_id, m.id, p_status, chosen.id, late_entry, clock_timestamp(), now())
  on conflict (guild_id, week, raid_id, member_id) do update set status = excluded.status,
    character_id = excluded.character_id, after_deadline = s.after_deadline or excluded.after_deadline,
    -- Changing character, or moving between Sign up, Late and Tentative, keeps the player's place.
    signed_at = case when s.status = 'absent' or excluded.status = 'absent' then clock_timestamp() else s.signed_at end,
    -- A spec chosen for this raid belongs to the character it was chosen for.
    spec = case when same_character then s.spec end, role = case when same_character then s.role end,
    updated_at = now();

  -- The check-in. Without a saved one, the usual schedule is copied in first so it is not lost.
  select * into c from public.checkins where guild_id = d.guild_id and week = d.week and member_id = m.id;
  if not found then
    select t.template into template from public.availability_templates t where t.guild_id = d.guild_id and t.member_id = m.id;
    c.ranges := coalesce(public.template_ranges(public.template_for_week(template, d.week), d.week), '[]');
    c.declined := '[]';
    c.raid_preferences := '{}';
    c.availability := '{}';
  end if;
  win := int8range(o.start_ms, o.end_ms);
  ranges := public.ranges_to_multirange(c.ranges);
  tentative := public.ranges_to_multirange(c.availability -> 'tentative');
  preferred := public.ranges_to_multirange(c.availability -> 'preferred');
  if p_status in ('signed', 'late') then
    ranges := ranges + int8multirange(win);
    tentative := tentative - int8multirange(win);
  elsif p_status = 'tentative' then
    ranges := ranges - int8multirange(win);
    preferred := preferred - int8multirange(win);
    tentative := tentative + int8multirange(win);
  end if;
  availability := c.availability;
  if availability ? 'tentative' or not isempty(tentative) then
    availability := availability || jsonb_build_object('tentative', public.multirange_to_ranges(tentative));
  end if;
  if availability ? 'preferred' then
    availability := availability || jsonb_build_object('preferred', public.multirange_to_ranges(preferred));
  end if;
  -- Signing up for a raid on a day marked away means the player is around after all.
  if p_status <> 'absent' and availability ? 'absent' then
    planning_day := ((to_timestamp(o.start_ms / 1000.0) at time zone g.timezone)
      - make_interval(hours => g.day_start_hour))::date::text;
    availability := jsonb_set(availability, '{absent}', coalesce((select jsonb_agg(x) from jsonb_array_elements(availability -> 'absent') x
      where x #>> '{}' <> planning_day), '[]'));
  end if;
  preferences := coalesce(c.raid_preferences, '{}');
  declined := coalesce(preferences -> d.raid_id -> 'declined', c.declined, '[]');
  if chosen.id is not null then
    -- Only the chosen character is offered for this raid.
    select coalesce(jsonb_agg(x.id order by x.position), '[]') into declined from public.characters x
      where x.guild_id = d.guild_id and x.member_id = m.id and not x.retired and x.id <> chosen.id;
  end if;
  preference := jsonb_build_object('participating', p_status <> 'absent', 'declined', declined);
  if chosen.id is not null and preferences -> d.raid_id -> 'signedAs' ->> 'characterId' = chosen.id then
    preference := preference || jsonb_build_object('signedAs', preferences -> d.raid_id -> 'signedAs');
  end if;
  preferences := preferences || jsonb_build_object(d.raid_id, preference);
  insert into public.checkins (guild_id, week, member_id, checked_in, ranges, declined, raid_preferences, availability)
  values (d.guild_id, d.week, m.id, true, public.multirange_to_ranges(ranges), coalesce(c.declined, '[]'), preferences, availability)
  on conflict (guild_id, week, member_id) do update set checked_in = true, ranges = excluded.ranges,
    raid_preferences = excluded.raid_preferences, availability = excluded.availability;
  update public.guild_revisions set revision = revision + 1 where guild_id = d.guild_id;
  perform public.bump_signup_post(d.guild_id, d.delivery_key);
  return jsonb_build_object('outcome', 'saved', 'status', p_status, 'raidName', o.raid_name,
    'afterDeadline', late_entry, 'guildId', d.guild_id)
    || public.signup_as(chosen, case when same_character then existing.spec end,
      case when same_character then existing.role end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- "Change spec" chosen from the private confirmation. Called only by the raid-interactions Edge
-- Function, with the same checks as signup_from_discord. Changes the spec and role this player's
-- sign-up uses for this raid; choosing the character's saved spec clears it.
--
-- Outcomes: saved (as signup_from_discord), not-signed (no sign-up with a character to change),
-- bad-spec, not-member, closed, duplicate, unknown.
create function public.signup_spec_from_discord(
  p_interaction_id text, p_discord_id text, p_discord_guild_id text, p_channel_id text,
  p_message_id text, p_delivery_id uuid, p_spec text, p_role text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.discord_deliveries; g public.guilds; hook public.guild_discord; m public.members; o record;
  existing public.raid_signups; chosen public.characters; new_spec text; new_role text;
begin
  if p_interaction_id !~ '^\d{17,20}$' or p_discord_id !~ '^\d{17,20}$' or p_discord_guild_id !~ '^\d{17,20}$'
     or p_channel_id !~ '^\d{17,20}$' or p_message_id !~ '^\d{17,20}$'
     or p_spec is null or char_length(p_spec) not between 1 and 40
     or p_role is null or p_role not in ('Tank', 'Healer', 'DPS') then
    raise exception 'Invalid Discord sign-up.' using errcode = '22023';
  end if;
  select * into d from public.discord_deliveries where id = p_delivery_id and kind = 'signup';
  if not found then return jsonb_build_object('outcome', 'unknown'); end if;
  select * into g from public.guilds where id = d.guild_id;
  select * into hook from public.guild_discord where guild_id = d.guild_id;
  if g.discord_server_id is distinct from p_discord_guild_id or hook.channel_id is distinct from p_channel_id
     or d.webhook_fingerprint <> md5('bot:' || p_channel_id) or not (d.message_ids ? p_message_id) then
    return jsonb_build_object('outcome', 'unknown');
  end if;
  select * into m from public.members where guild_id = d.guild_id and discord_id = p_discord_id;
  if not found then return jsonb_build_object('outcome', 'not-member', 'guildName', g.name); end if;
  perform 1 from public.guild_revisions r where r.guild_id = d.guild_id for update;
  select * into o from public.raid_occurrence(d.guild_id, d.week, d.raid_id);
  if o.start_ms is null or o.cancelled or d.payload ? 'closed' or o.start_ms <= extract(epoch from now()) * 1000 then
    return jsonb_build_object('outcome', 'closed');
  end if;

  select * into existing from public.raid_signups
    where guild_id = d.guild_id and week = d.week and raid_id = d.raid_id and member_id = m.id;
  if not found or existing.status = 'absent' or existing.character_id is null then
    return jsonb_build_object('outcome', 'not-signed');
  end if;
  select * into chosen from public.characters
    where guild_id = d.guild_id and id = existing.character_id and member_id = m.id and not retired;
  if not found then return jsonb_build_object('outcome', 'not-signed'); end if;
  if not exists (select 1 from jsonb_array_elements(public.class_spec_roles(chosen.class)) x
      where x ->> 'spec' = p_spec and x ->> 'role' = p_role) then
    return jsonb_build_object('outcome', 'bad-spec');
  end if;

  delete from public.discord_interactions where received_at < now() - interval '1 day';
  insert into public.discord_interactions (id) values (p_interaction_id) on conflict (id) do nothing;
  if not found then return jsonb_build_object('outcome', 'duplicate'); end if;
  if p_spec <> chosen.spec or p_role <> chosen.role then
    new_spec := p_spec;
    new_role := p_role;
  end if;
  if existing.spec is not distinct from new_spec and existing.role is not distinct from new_role then
    return jsonb_build_object('outcome', 'saved', 'status', existing.status, 'raidName', o.raid_name,
      'afterDeadline', existing.after_deadline) || public.signup_as(chosen, new_spec, new_role);
  end if;

  update public.raid_signups set spec = new_spec, role = new_role, updated_at = now()
    where guild_id = d.guild_id and week = d.week and raid_id = d.raid_id and member_id = m.id;
  -- The planner reads the check-in, which the sign-up already wrote.
  update public.checkins c set raid_preferences = c.raid_preferences || jsonb_build_object(d.raid_id,
      (coalesce(c.raid_preferences -> d.raid_id, jsonb_build_object('participating', true, 'declined', c.declined))
        - 'signedAs')
      || case when new_spec is null then '{}'::jsonb else jsonb_build_object('signedAs',
        jsonb_build_object('characterId', chosen.id, 'spec', new_spec, 'role', new_role)) end)
    where c.guild_id = d.guild_id and c.week = d.week and c.member_id = m.id;
  update public.guild_revisions set revision = revision + 1 where guild_id = d.guild_id;
  perform public.bump_signup_post(d.guild_id, d.delivery_key);
  return jsonb_build_object('outcome', 'saved', 'status', existing.status, 'raidName', o.raid_name,
    'afterDeadline', existing.after_deadline, 'guildId', d.guild_id) || public.signup_as(chosen, new_spec, new_role);
end $$;

revoke execute on function public.class_spec_roles(text), public.signup_as(public.characters, text, text),
  public.signup_spec_from_discord(text, text, text, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.signup_spec_from_discord(text, text, text, text, text, uuid, text, text) to service_role;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261019120000'::text $$;
