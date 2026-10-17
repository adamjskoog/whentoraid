-- Raid-Helper-style sign-up posts. Before officers publish a roster, the WhenToRaid bot posts each
-- upcoming raid with Sign up / Late / Tentative / Absent buttons. A press is recorded as a sign-up
-- and written into the player's check-in for that raid, so the planner uses it like availability
-- entered in the app. Posting is off until an officer turns it on; nothing here sends a message.

-- ---------------------------------------------------------------------------------------------
-- UTC millisecond ranges, stored as [{ start, end }] (see valid_ranges), as Postgres multiranges.
create function public.ranges_to_multirange(r jsonb) returns int8multirange
language sql immutable set search_path = '' as $$
  select coalesce(range_agg(int8range((e ->> 'start')::numeric::bigint, (e ->> 'end')::numeric::bigint)),
    '{}'::int8multirange)
  from jsonb_array_elements(coalesce(r, '[]'::jsonb)) e
$$;

create function public.multirange_to_ranges(m int8multirange) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('start', lower(x), 'end', upper(x)) order by lower(x)), '[]'::jsonb)
  from unnest(m) x
$$;

-- The times a usual schedule fills in for week `w`. Mirrors templateRanges in
-- src/lib/availability-template.js: one half-hour cell per slot, in the schedule's own timezone.
create function public.template_ranges(t jsonb, w date) returns jsonb
language sql stable set search_path = '' as $$
  select case when t is null then null else public.multirange_to_ranges(coalesce((
    select range_agg(int8range(s, e)) filter (where e > s)
    from (
      select (extract(epoch from (((w + cell / spd)::timestamp
                + make_interval(mins => dsh * 60 + (cell % spd) * 30)) at time zone tz)) * 1000)::bigint s,
             (extract(epoch from (((w + cell / spd)::timestamp
                + make_interval(mins => dsh * 60 + (cell % spd + 1) * 30)) at time zone tz)) * 1000)::bigint e
      from jsonb_array_elements_text(coalesce(t -> 'slots', '[]'::jsonb)) c(cell_text)
      cross join lateral (select c.cell_text::int cell, (t ->> 'slotsPerDay')::int spd,
        (t ->> 'dayStartHour')::int dsh, t ->> 'timezone' tz) v
    ) cells
  ), '{}'::int8multirange)) end
$$;

-- ---------------------------------------------------------------------------------------------
-- When a raid runs in a week: its saved plan (the published time once published), otherwise the
-- raid's weekly schedule. Mirrors seriesOccurrences in src/lib/raid-series.js; a start time that a
-- clock change skips has no occurrence.
create function public.raid_occurrence(g uuid, w date, r text)
returns table (start_ms bigint, end_ms bigint, cancelled boolean, published boolean, raid_name text, targets jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  raid jsonb; p public.plans; s jsonb; base jsonb; ex jsonb; d int; mins int;
  local_start timestamp; utc_start timestamptz; duration_ms bigint;
begin
  select x into raid from public.guilds gu, jsonb_array_elements(gu.settings -> 'raids') x
    where gu.id = g and x ->> 'id' = r;
  if raid is null then return; end if;
  duration_ms := (raid ->> 'durationSlots')::bigint * 30 * 60 * 1000;
  select * into p from public.plans where guild_id = g and week = w and raid_id = r;
  if found then
    if p.published is not null then
      return query select (p.published ->> 'start')::numeric::bigint, (p.published ->> 'end')::numeric::bigint,
        p.cancelled, true, coalesce(p.published ->> 'raidName', raid ->> 'name'), raid -> 'targets';
    else
      return query select p.start, p.start + duration_ms, p.cancelled, false, raid ->> 'name', raid -> 'targets';
    end if;
    return;
  end if;
  s := raid -> 'series';
  if jsonb_typeof(s) is distinct from 'object' then return; end if;
  select c into base from jsonb_array_elements(coalesce(s -> 'changes', '[]'::jsonb)) c
    where (c ->> 'fromWeek')::date <= w order by (c ->> 'fromWeek')::date desc limit 1;
  base := coalesce(base, s);
  ex := coalesce(s -> 'exceptions' -> (w::text), '{}'::jsonb);
  d := coalesce((ex ->> 'day')::int, (base ->> 'day')::int);
  mins := coalesce((ex ->> 'minutes')::int, (base ->> 'minutes')::int);
  if w + d < (s ->> 'startDate')::date or w + d > (s ->> 'endDate')::date then return; end if;
  local_start := (w + d)::timestamp + make_interval(mins => mins);
  utc_start := local_start at time zone (s ->> 'timezone');
  if (utc_start at time zone (s ->> 'timezone')) <> local_start then return; end if;
  return query select (extract(epoch from utc_start) * 1000)::bigint,
    (extract(epoch from utc_start) * 1000)::bigint + duration_ms,
    coalesce((ex ->> 'cancelled')::boolean, false), false, raid ->> 'name', raid -> 'targets';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Sign-ups, one per player per raid. `signed_at` orders the post (it is kept when a player only
-- changes character or moves between Sign up, Late and Tentative). `after_deadline` flags a
-- sign-up made after the guild's weekly check-in deadline, which Discord still accepts.
create table public.raid_signups (
  guild_id uuid not null,
  week date not null check (extract(isodow from week) = 1),
  raid_id text not null check (raid_id ~ '^[a-z0-9-]{1,64}$'),
  member_id text not null,
  status text not null check (status in ('signed', 'late', 'tentative', 'absent')),
  character_id text check (character_id is null or char_length(character_id) between 1 and 64),
  after_deadline boolean not null default false,
  signed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, week, raid_id, member_id),
  foreign key (guild_id, member_id) references public.members (guild_id, id) on delete cascade
);
alter table public.raid_signups enable row level security;
revoke all on public.raid_signups from public, anon, authenticated;

create function public.get_raid_signups(p_guild_id uuid, p_week date)
returns table (raid_id text, member_id text, status text, character_id text, after_deadline boolean, signed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_guild_member(p_guild_id) then
    raise exception 'You are not a guild member.' using errcode = '42501';
  end if;
  return query select s.raid_id, s.member_id, s.status, s.character_id, s.after_deadline, s.signed_at
    from public.raid_signups s where s.guild_id = p_guild_id and s.week = p_week order by s.signed_at;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Settings and the delivery kind.
alter table public.raid_reminder_settings
  add column signup_enabled boolean not null default false,
  add column signup_lead_days int not null default 7 check (signup_lead_days between 1 and 14);

alter table public.discord_deliveries drop constraint discord_deliveries_kind_check;
alter table public.discord_deliveries add constraint discord_deliveries_kind_check
  check (kind in ('roster', 'checkin', 'upcoming', 'signup'));

create or replace function public.get_raid_reminders(p_guild_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_guild_officer(p_guild_id);
  select to_jsonb(s) - 'guild_id' - 'next_checkin_at' into result from public.raid_reminder_settings s where guild_id = p_guild_id;
  return coalesce(result, '{"checkin_enabled":false,"upcoming_enabled":false,"interval_hours":24,"lead_hours":24,"only_unconfirmed":true,"signup_enabled":false,"signup_lead_days":7}');
end $$;

create or replace function public.set_raid_reminders(p_guild_id uuid, p_settings jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_guild_officer(p_guild_id);
  insert into public.raid_reminder_settings (guild_id, checkin_enabled, upcoming_enabled, interval_hours, lead_hours,
    only_unconfirmed, signup_enabled, signup_lead_days)
  values (p_guild_id, coalesce((p_settings ->> 'checkin_enabled')::boolean, false),
    coalesce((p_settings ->> 'upcoming_enabled')::boolean, false), coalesce((p_settings ->> 'interval_hours')::int, 24),
    coalesce((p_settings ->> 'lead_hours')::int, 24), coalesce((p_settings ->> 'only_unconfirmed')::boolean, true),
    coalesce((p_settings ->> 'signup_enabled')::boolean, false), coalesce((p_settings ->> 'signup_lead_days')::int, 7))
  on conflict (guild_id) do update set checkin_enabled = excluded.checkin_enabled, upcoming_enabled = excluded.upcoming_enabled,
    interval_hours = excluded.interval_hours, lead_hours = excluded.lead_hours, only_unconfirmed = excluded.only_unconfirmed,
    signup_enabled = excluded.signup_enabled, signup_lead_days = excluded.signup_lead_days;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Queueing. A sign-up post is one delivery per raid (`signup:<week>/<raid>`); every change bumps
-- its version so the worker edits the same message with the current sign-ups.
create function public.bump_signup_post(g uuid, k text) returns void
language sql security definer set search_path = '' as $$
  update public.discord_deliveries set version = version + 1,
    status = case when status in ('sending', 'uncertain') then status else 'pending' end,
    attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
  where guild_id = g and delivery_key = k and kind = 'signup'
$$;

-- Officers post (or refresh) a raid's sign-up post now, before the automatic lead time.
create function public.queue_signup_post(p_guild_id uuid, p_week date, p_raid_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare hook public.guild_discord; o record; fingerprint text; k text := 'signup:' || p_week::text || '/' || p_raid_id; result uuid;
begin
  perform public.require_guild_officer(p_guild_id);
  if p_week is null or extract(isodow from p_week) <> 1 then
    raise exception 'Choose a week starting on Monday.' using errcode = '22023';
  end if;
  select * into hook from public.guild_discord where guild_id = p_guild_id;
  if not found or hook.channel_id = '' then
    raise exception 'Sign-up posts need the WhenToRaid bot. Choose its channel in Guild settings.' using errcode = '22023';
  end if;
  select * into o from public.raid_occurrence(p_guild_id, p_week, p_raid_id);
  if o.start_ms is null then raise exception 'Set a time for this raid first.' using errcode = '22023'; end if;
  if o.cancelled then raise exception 'This raid is cancelled.' using errcode = '22023'; end if;
  if o.start_ms <= extract(epoch from now()) * 1000 then
    raise exception 'This raid has already started.' using errcode = '22023';
  end if;
  -- Finished sign-up posts are cleaned up after 30 days, so a post must not outlive its raid by that.
  if o.start_ms > extract(epoch from now() + interval '28 days') * 1000 then
    raise exception 'Sign-up posts can be made up to four weeks ahead.' using errcode = '22023';
  end if;
  fingerprint := md5('bot:' || hook.channel_id);
  insert into public.discord_deliveries (guild_id, delivery_key, week, raid_id, kind, payload, webhook_fingerprint)
  values (p_guild_id, k, p_week, p_raid_id, 'signup', '{}', fingerprint)
  on conflict (guild_id, delivery_key) do update set payload = '{}', version = discord_deliveries.version + 1,
    status = case when discord_deliveries.status in ('sending', 'uncertain') then discord_deliveries.status else 'pending' end,
    -- A post in a channel the guild no longer uses cannot be edited: start a new one.
    message_ids = case when discord_deliveries.webhook_fingerprint = excluded.webhook_fingerprint
      then discord_deliveries.message_ids else '[]' end,
    webhook_fingerprint = excluded.webhook_fingerprint, attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
  returning id into result;
  return result;
end $$;

create function public.get_signup_post(p_guild_id uuid, p_week date, p_raid_id text)
returns table (id uuid, status text, posted boolean, last_error text, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_guild_officer(p_guild_id);
  return query select d.id, d.status, d.message_ids <> '[]', d.last_error, d.updated_at from public.discord_deliveries d
    where d.guild_id = p_guild_id and d.delivery_key = 'signup:' || p_week::text || '/' || p_raid_id;
end $$;

-- A raid's time, cancellation or publication changed: show it on its sign-up post.
create function public.follow_signup_post() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.plans;
begin
  if tg_op = 'DELETE' then p := old; else p := new; end if;
  if tg_op = 'UPDATE' and new.start = old.start and new.cancelled = old.cancelled
     and new.published is not distinct from old.published then
    return new;
  end if;
  perform public.bump_signup_post(p.guild_id, 'signup:' || p.week::text || '/' || p.raid_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger follow_signup_post after insert or update or delete on public.plans
  for each row execute function public.follow_signup_post();

-- The scheduler: reminders as before, plus sign-up posts for raids inside each guild's lead time
-- (not yet published, not cancelled), and closing posts whose raid has started.
create or replace function public.enqueue_due_raid_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare s record; p record; w date; k text; deadline timestamptz; raid_id text; o record;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  delete from public.discord_deliveries where kind <> 'roster' and status in ('sent', 'failed') and updated_at < now() - interval '30 days';
  for s in select rs.*, g.timezone, md5(public.discord_target(d.webhook_url, d.channel_id)) as fingerprint
    from public.raid_reminder_settings rs join public.guilds g on g.id = rs.guild_id
    join public.guild_discord d on d.guild_id = rs.guild_id where rs.checkin_enabled or rs.upcoming_enabled
    for update of rs skip locked loop
    w := date_trunc('week', now() at time zone s.timezone)::date;
    deadline := public.checkin_deadline(s.guild_id, w);
    if s.checkin_enabled and s.next_checkin_at <= now() and (deadline is null or deadline > now()) then
      k := 'checkin:' || w::text || ':' || floor(extract(epoch from now()) / (s.interval_hours * 3600))::text;
      insert into public.discord_deliveries (guild_id, delivery_key, week, kind, payload, webhook_fingerprint)
      values (s.guild_id, k, w, 'checkin', '{}', s.fingerprint) on conflict (guild_id, delivery_key) do nothing;
      update public.raid_reminder_settings set next_checkin_at = now() + make_interval(hours => s.interval_hours) where guild_id = s.guild_id;
    end if;
    if s.upcoming_enabled then
      for p in select * from public.plans where guild_id = s.guild_id and published is not null and not cancelled
        and (published ->> 'start')::numeric > now_ms
        and (published ->> 'start')::numeric <= extract(epoch from now() + make_interval(hours => s.lead_hours)) * 1000 loop
        k := 'upcoming:' || p.week::text || '/' || p.raid_id || ':' || (p.published ->> 'start');
        insert into public.discord_deliveries (guild_id, delivery_key, week, raid_id, kind, payload, webhook_fingerprint)
        values (s.guild_id, k, p.week, p.raid_id, 'upcoming', '{}', s.fingerprint) on conflict (guild_id, delivery_key) do nothing;
      end loop;
    end if;
  end loop;

  for s in select rs.guild_id, rs.signup_lead_days, g.timezone, g.settings, md5('bot:' || d.channel_id) as fingerprint
    from public.raid_reminder_settings rs join public.guilds g on g.id = rs.guild_id
    join public.guild_discord d on d.guild_id = rs.guild_id
    where rs.signup_enabled and d.channel_id <> '' loop
    for w in select generate_series(date_trunc('week', now() at time zone s.timezone),
        date_trunc('week', now() at time zone s.timezone) + make_interval(days => (s.signup_lead_days / 7 + 1) * 7),
        interval '7 days')::date loop
      for raid_id in select x ->> 'id' from jsonb_array_elements(s.settings -> 'raids') x loop
        select * into o from public.raid_occurrence(s.guild_id, w, raid_id);
        if o.start_ms is null or o.cancelled or o.published or o.start_ms <= now_ms
           or o.start_ms > now_ms + s.signup_lead_days::bigint * 86400000 then
          continue;
        end if;
        insert into public.discord_deliveries (guild_id, delivery_key, week, raid_id, kind, payload, webhook_fingerprint)
        values (s.guild_id, 'signup:' || w::text || '/' || raid_id, w, raid_id, 'signup', '{}', s.fingerprint)
        -- After the guild moves the bot to another channel, post there instead.
        on conflict (guild_id, delivery_key) do update set webhook_fingerprint = excluded.webhook_fingerprint,
          message_ids = '[]', payload = '{}', version = discord_deliveries.version + 1, status = 'pending',
          attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
        where discord_deliveries.webhook_fingerprint <> excluded.webhook_fingerprint
          and discord_deliveries.status not in ('sending', 'uncertain');
      end loop;
    end loop;
  end loop;

  -- Once a raid starts its sign-up post loses its buttons. `closed` makes this happen only once.
  update public.discord_deliveries q set payload = q.payload || '{"closed": true}', version = q.version + 1,
    status = case when q.status in ('sending', 'uncertain') then q.status else 'pending' end,
    attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
  where q.kind = 'signup' and not (q.payload ? 'closed') and q.message_ids <> '[]'
    and exists (select 1 from public.raid_occurrence(q.guild_id, q.week, q.raid_id) x where x.start_ms <= now_ms);
end $$;

-- What a sign-up post shows, read by the worker when it sends (so it is always current).
create function public.raid_signup_payload(p_id uuid, p_lease uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.discord_deliveries; o record; signups jsonb; guild_name text;
begin
  select * into d from public.discord_deliveries where id = p_id and lease_token = p_lease and status = 'sending' and kind = 'signup';
  if not found then return null; end if;
  select name into guild_name from public.guilds where id = d.guild_id;
  select * into o from public.raid_occurrence(d.guild_id, d.week, d.raid_id);
  select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(c.name, m.name), 'player', m.name, 'class', c.class,
      'spec', c.spec, 'role', c.role, 'status', s.status, 'discordId', m.discord_id) order by s.signed_at), '[]')
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

-- ---------------------------------------------------------------------------------------------
-- A sign-up button (or character menu) pressed in Discord. Called only by the raid-interactions
-- Edge Function after it verified Discord's signature; every identifier comes from the signed
-- interaction. The message must be this delivery's post in the guild's server and bot channel,
-- and the presser a member of the guild.
--
-- Outcomes: saved (with guildId, so the caller can refresh the post), choose (pick a character:
-- `characters` lists them), no-characters, bad-character, not-member, closed, duplicate, unknown.
create function public.signup_from_discord(
  p_interaction_id text, p_discord_id text, p_discord_guild_id text, p_channel_id text,
  p_message_id text, p_delivery_id uuid, p_status text, p_character_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.discord_deliveries; g public.guilds; hook public.guild_discord; m public.members; o record;
  existing public.raid_signups; c public.checkins; chosen public.characters; active_count int;
  late_entry boolean; win int8range; ranges int8multirange; tentative int8multirange; preferred int8multirange;
  availability jsonb; preferences jsonb; declined jsonb; planning_day text; deadline timestamptz;
  template jsonb;
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

  delete from public.discord_interactions where received_at < now() - interval '1 day';
  insert into public.discord_interactions (id) values (p_interaction_id) on conflict (id) do nothing;
  if not found then return jsonb_build_object('outcome', 'duplicate'); end if;
  -- Pressing the same answer again changes nothing, so it neither reloads open apps nor re-sends the post.
  if existing.status = p_status and existing.character_id is not distinct from chosen.id then
    return jsonb_build_object('outcome', 'saved', 'status', p_status, 'raidName', o.raid_name,
      'character', chosen.name, 'afterDeadline', existing.after_deadline);
  end if;

  deadline := public.checkin_deadline(d.guild_id, d.week);
  late_entry := deadline is not null and deadline <= now();
  insert into public.raid_signups as s (guild_id, week, raid_id, member_id, status, character_id, after_deadline, signed_at, updated_at)
  values (d.guild_id, d.week, d.raid_id, m.id, p_status, chosen.id, late_entry, clock_timestamp(), now())
  on conflict (guild_id, week, raid_id, member_id) do update set status = excluded.status,
    character_id = excluded.character_id, after_deadline = s.after_deadline or excluded.after_deadline,
    -- Changing character, or moving between Sign up, Late and Tentative, keeps the player's place.
    signed_at = case when s.status = 'absent' or excluded.status = 'absent' then clock_timestamp() else s.signed_at end,
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
  preferences := preferences || jsonb_build_object(d.raid_id,
    jsonb_build_object('participating', p_status <> 'absent', 'declined', declined));
  insert into public.checkins (guild_id, week, member_id, checked_in, ranges, declined, raid_preferences, availability)
  values (d.guild_id, d.week, m.id, true, public.multirange_to_ranges(ranges), coalesce(c.declined, '[]'), preferences, availability)
  on conflict (guild_id, week, member_id) do update set checked_in = true, ranges = excluded.ranges,
    raid_preferences = excluded.raid_preferences, availability = excluded.availability;
  update public.guild_revisions set revision = revision + 1 where guild_id = d.guild_id;
  perform public.bump_signup_post(d.guild_id, d.delivery_key);
  return jsonb_build_object('outcome', 'saved', 'status', p_status, 'raidName', o.raid_name,
    'character', chosen.name, 'afterDeadline', late_entry, 'guildId', d.guild_id);
end $$;

revoke execute on function
  public.ranges_to_multirange(jsonb), public.multirange_to_ranges(int8multirange), public.template_ranges(jsonb, date),
  public.raid_occurrence(uuid, date, text), public.bump_signup_post(uuid, text), public.follow_signup_post(),
  public.raid_signup_payload(uuid, uuid),
  public.signup_from_discord(text, text, text, text, text, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.get_raid_signups(uuid, date), public.queue_signup_post(uuid, date, text),
  public.get_signup_post(uuid, date, text) from public, anon;
grant execute on function public.get_raid_signups(uuid, date), public.queue_signup_post(uuid, date, text),
  public.get_signup_post(uuid, date, text) to authenticated;
grant execute on function public.raid_signup_payload(uuid, uuid),
  public.signup_from_discord(text, text, text, text, text, uuid, text, text) to service_role;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261017120000'::text $$;
