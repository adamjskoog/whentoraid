-- Hardening from the October 2026 audit: ids that are safe as JavaScript object keys, per-guild
-- storage budgets, and check-in deadlines that players cannot write past.

-- Ids key plain objects in every player's browser (check-ins by member, plans by raid). A name
-- every object inherits, such as "constructor", would read as a built-in function there and break
-- the page for the whole guild. Keep this list in step with isSafeId in src/lib/ids.js.
create function public.valid_entity_id(id text) returns boolean
language sql immutable set search_path = '' as $$
  select id ~ '^[A-Za-z0-9_-]{1,64}$' and id not in (
    '__proto__', 'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
    'toLocaleString', 'toString', 'valueOf', '__defineGetter__', '__defineSetter__',
    '__lookupGetter__', '__lookupSetter__'
  )
$$;

alter table public.members add constraint members_id_safe check (public.valid_entity_id(id));
alter table public.characters add constraint characters_id_safe check (public.valid_entity_id(id));

-- Raid ids are lowercase, so "constructor" is the only inherited name they could match.
alter table public.guilds add constraint guilds_raid_ids_safe
  check (not jsonb_path_exists(settings, '$.raids[*] ? (@.id == "constructor")'));
alter table public.plans add constraint plans_raid_id_safe check (raid_id <> 'constructor');
alter table public.checkins add constraint checkins_raid_preferences_safe
  check (not raid_preferences ? 'constructor');

create or replace function public.valid_team(r jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(r) = 'array' and jsonb_array_length(r) <= 40 and not exists (
    select 1 from jsonb_array_elements(r) e
    where jsonb_typeof(e) is distinct from 'object'
       or jsonb_typeof(e -> 'memberId') is distinct from 'string'
       or jsonb_typeof(e -> 'characterId') is distinct from 'string'
       or not public.valid_entity_id(e ->> 'memberId')
       or not public.valid_entity_id(e ->> 'characterId')
       or (e ->> 'role') is null or (e ->> 'role') not in ('Tank', 'Healer', 'DPS')
  )
$$;

-- Attendance is keyed by member id; values are the options in src/lib/attendance.js.
create function public.valid_attendance(a jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(a) = 'object' and not exists (
    select 1 from jsonb_each(a) e
    where not public.valid_entity_id(e.key)
       or jsonb_typeof(e.value) is distinct from 'string'
       or (e.value #>> '{}') not in ('attended', 'late', 'noshow')
  )
$$;
alter table public.plans add constraint plans_attendance_shape check (public.valid_attendance(attendance));

-- Storage budgets. Per-row limits alone let one signed-in account fill the database with plan
-- and check-in rows. Older check-ins cannot be written (see enforce_guild_limits), so only the
-- writable window counts toward the check-in budget. Every write path, including the RPC and
-- guild creation, runs these statement triggers.
create function public.enforce_guild_storage() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g uuid;
  used bigint;
begin
  for g in select distinct guild_id from changed_rows loop
    if tg_table_name = 'checkins' then
      select coalesce(sum(pg_column_size(c.*)), 0) into used from public.checkins c
        where c.guild_id = g and c.week >= current_date - 400;
    else
      select coalesce(sum(pg_column_size(p.*)), 0) into used from public.plans p where p.guild_id = g;
    end if;
    if used > 8000000 then
      raise exception 'This guild has reached its storage limit for %.',
        case when tg_table_name = 'checkins' then 'check-ins' else 'raid plans' end
        using errcode = 'program_limit_exceeded';
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.enforce_guild_storage from public, anon, authenticated;

-- A trigger with transition tables can have only one event.
create trigger checkins_storage_insert after insert on public.checkins
  referencing new table as changed_rows for each statement execute function public.enforce_guild_storage();
create trigger checkins_storage_update after update on public.checkins
  referencing new table as changed_rows for each statement execute function public.enforce_guild_storage();
create trigger plans_storage_insert after insert on public.plans
  referencing new table as changed_rows for each statement execute function public.enforce_guild_storage();
create trigger plans_storage_update after update on public.plans
  referencing new table as changed_rows for each statement execute function public.enforce_guild_storage();

-- checkin_deadline casts the deadline to integers, so a fractional or huge value would make every
-- player write in the guild fail. Same rule as validateDeadline in src/lib/guild.js.
create function public.valid_deadline(s jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  day numeric;
  minutes numeric;
begin
  if s -> 'checkinDeadline' is null or s -> 'checkinDeadline' = 'null'::jsonb then return true; end if;
  day := (s #>> '{checkinDeadline,day}')::numeric;
  minutes := (s #>> '{checkinDeadline,minutes}')::numeric;
  return day = trunc(day) and day between 0 and 6 and minutes = trunc(minutes) and minutes between 0 and 1439;
exception when others then return false;
end $$;
alter table public.guilds add constraint guilds_deadline_whole check (public.valid_deadline(settings));

-- Check-in deadlines. After a week's deadline, only officers change that week's check-ins, so the
-- roster officers planned from stays put. Mirrors deadlineUtc in src/lib/checkins.js.
create function public.checkin_deadline(g uuid, w date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((w + (gu.settings #>> '{checkinDeadline,day}')::int)::timestamp
           + make_interval(mins => (gu.settings #>> '{checkinDeadline,minutes}')::int))
         at time zone gu.timezone
  from public.guilds gu
  where gu.id = g and jsonb_typeof(gu.settings -> 'checkinDeadline') = 'object'
$$;

-- A signed-in player who is not an officer of the guild. Database owners and maintenance
-- scripts have no auth.uid() and are not limited.
create function public.is_player_not_officer(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not public.is_guild_officer(g)
$$;

create function public.closed_week_message(w date) returns text
language sql immutable set search_path = '' as $$
  select format('Check-ins for the week of %s closed at the deadline. Ask an officer to change yours.',
    to_char(w, 'FMMonth FMDD'))
$$;

create function public.enforce_checkin_deadline() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_week date;
  row_guild uuid;
begin
  if tg_op = 'DELETE' then
    row_guild := old.guild_id;
    row_week := old.week;
  else
    row_guild := new.guild_id;
    row_week := new.week;
  end if;
  if public.is_player_not_officer(row_guild)
     and (public.checkin_deadline(row_guild, row_week) <= now()
          or (tg_op = 'UPDATE' and public.checkin_deadline(row_guild, old.week) <= now())) then
    raise exception '%', public.closed_week_message(row_week) using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger checkins_deadline before insert or update or delete on public.checkins
  for each row execute function public.enforce_checkin_deadline();

-- A usual schedule fills in any week without a saved check-in, so changing it could change a
-- closed week too. Templates may carry the schedule they replaced as `previous`, which keeps
-- covering the weeks before the new `fromWeek`. Mirrors templateFor in
-- src/lib/availability-template.js.
create function public.template_for_week(t jsonb, w date) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when t is null then null
    when (t ->> 'fromWeek')::date <= w then t - 'previous'
    when jsonb_typeof(t -> 'previous') = 'object' and (t #>> '{previous,fromWeek}')::date <= w
      then t -> 'previous'
  end
$$;

create function public.enforce_template_deadline() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_guild uuid;
  row_member text;
  this_week date;
  stored jsonb;
  proposed jsonb;
begin
  if tg_op = 'DELETE' then
    row_guild := old.guild_id;
    row_member := old.member_id;
  else
    row_guild := new.guild_id;
    row_member := new.member_id;
    proposed := new.template;
  end if;
  if public.is_player_not_officer(row_guild) then
    select date_trunc('week', now() at time zone gu.timezone)::date into this_week
      from public.guilds gu where gu.id = row_guild;
    select t.template into stored from public.availability_templates t
      where t.guild_id = row_guild and t.member_id = row_member;
    if public.checkin_deadline(row_guild, this_week) <= now()
       and not exists (
         select 1 from public.checkins c
         where c.guild_id = row_guild and c.week = this_week and c.member_id = row_member
       )
       and public.template_for_week(stored, this_week) is distinct from public.template_for_week(proposed, this_week) then
      raise exception '% Your usual schedule fills it in, so change the schedule from next week instead.',
        public.closed_week_message(this_week) using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger availability_templates_deadline before insert or update or delete on public.availability_templates
  for each row execute function public.enforce_template_deadline();

revoke execute on function public.checkin_deadline, public.is_player_not_officer,
  public.enforce_checkin_deadline, public.enforce_template_deadline from public, anon, authenticated;

-- Templates may now carry the schedule they replaced (one level, older than `fromWeek`).
create or replace function public.valid_availability_template(t jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  if jsonb_typeof(t) is distinct from 'object'
    or jsonb_typeof(t -> 'timezone') is distinct from 'string'
    or not exists (select 1 from pg_catalog.pg_timezone_names where name = t ->> 'timezone')
    or jsonb_typeof(t -> 'fromWeek') is distinct from 'string'
    or extract(isodow from (t ->> 'fromWeek')::date) <> 1
    or jsonb_typeof(t -> 'dayStartHour') is distinct from 'number'
    or (t ->> 'dayStartHour')::numeric not between 0 and 23
    or (t ->> 'dayStartHour')::numeric <> trunc((t ->> 'dayStartHour')::numeric)
    or jsonb_typeof(t -> 'slotsPerDay') is distinct from 'number'
    or (t ->> 'slotsPerDay')::numeric not between 1 and 48
    or (t ->> 'slotsPerDay')::numeric <> trunc((t ->> 'slotsPerDay')::numeric)
    or jsonb_typeof(t -> 'slots') is distinct from 'array' then return false; end if;
  if t ? 'previous' and (
    jsonb_typeof(t -> 'previous') is distinct from 'object'
    or t -> 'previous' ? 'previous'
    or not public.valid_availability_template(t -> 'previous')
    or (t #>> '{previous,fromWeek}')::date >= (t ->> 'fromWeek')::date
  ) then return false; end if;
  return jsonb_array_length(t -> 'slots') <= 336 and not exists (
    select 1 from jsonb_array_elements(t -> 'slots') s
    where jsonb_typeof(s) is distinct from 'number'
      or (s #>> '{}')::numeric < 0
      or (s #>> '{}')::numeric >= 7 * (t ->> 'slotsPerDay')::numeric
      or (s #>> '{}')::numeric <> trunc((s #>> '{}')::numeric)
  );
exception when others then return false;
end $$;

-- Room for a template plus the one it replaced.
alter table public.availability_templates drop constraint availability_templates_template_check;
alter table public.availability_templates add constraint availability_templates_template_check
  check (public.valid_availability_template(template) and pg_column_size(template) < 24000);

-- Keep in step with the newest migration's timestamp (checked by src/lib/schema-version.test.js).
create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$
  select '20261011120000'::text
$$;
