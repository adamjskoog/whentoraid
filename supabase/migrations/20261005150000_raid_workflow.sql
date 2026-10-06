-- Player-owned recurring availability, per-raid check-in preferences, and published roster snapshots.
create function public.valid_availability_template(t jsonb) returns boolean
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
  return jsonb_array_length(t -> 'slots') <= 336 and not exists (
    select 1 from jsonb_array_elements(t -> 'slots') s
    where jsonb_typeof(s) is distinct from 'number'
      or (s #>> '{}')::numeric < 0
      or (s #>> '{}')::numeric >= 7 * (t ->> 'slotsPerDay')::numeric
      or (s #>> '{}')::numeric <> trunc((s #>> '{}')::numeric)
  );
exception when others then return false;
end $$;

create function public.valid_raid_preferences(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  return (select count(*) from jsonb_object_keys(p)) <= 10 and not exists (
    select 1 from jsonb_each(p) e where e.key !~ '^[a-z0-9-]{1,64}$'
      or jsonb_typeof(e.value) is distinct from 'object'
      or jsonb_typeof(e.value -> 'participating') is distinct from 'boolean'
      or not coalesce(public.valid_string_list(e.value -> 'declined', 20), false)
  );
exception when others then return false;
end $$;

create function public.valid_published_plan(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p = 'null'::jsonb then return true; end if;
  if jsonb_typeof(p) is distinct from 'object'
    or jsonb_typeof(p -> 'start') is distinct from 'number'
    or jsonb_typeof(p -> 'end') is distinct from 'number'
    or (p ->> 'end')::numeric <= (p ->> 'start')::numeric
    or jsonb_typeof(p -> 'publishedAt') is distinct from 'number'
    or jsonb_typeof(p -> 'day') is distinct from 'number'
    or (p ->> 'day')::numeric not between 0 and 6
    or jsonb_typeof(p -> 'startSlot') is distinct from 'number'
    or (p ->> 'startSlot')::numeric not between 0 and 48
    or jsonb_typeof(p -> 'raidName') is distinct from 'string'
    or char_length(btrim(p ->> 'raidName')) not between 1 and 60
    or not coalesce(public.valid_team(p -> 'team'), false)
    or jsonb_typeof(p -> 'targets') is distinct from 'array' then return false; end if;
  return jsonb_array_length(p -> 'targets') = 3 and not exists (
    select 1 from jsonb_array_elements(p -> 'targets') t
    where jsonb_typeof(t) is distinct from 'number' or (t #>> '{}')::numeric not between 0 and 40
      or (t #>> '{}')::numeric <> trunc((t #>> '{}')::numeric)
  );
exception when others then return false;
end $$;

alter table public.checkins add column raid_preferences jsonb not null default '{}'
  check (public.valid_raid_preferences(raid_preferences) and pg_column_size(raid_preferences) < 20000);
alter table public.plans add column published jsonb
  check (public.valid_published_plan(published) and pg_column_size(published) < 24000);

create table public.availability_templates (
  guild_id uuid not null,
  member_id text not null,
  template jsonb not null check (public.valid_availability_template(template) and pg_column_size(template) < 12000),
  primary key (guild_id, member_id),
  foreign key (guild_id, member_id) references public.members (guild_id, id) on delete cascade
);
alter table public.availability_templates enable row level security;
grant select, insert, update, delete on public.availability_templates to authenticated;
create policy "members read availability templates" on public.availability_templates
  for select to authenticated using (public.is_guild_member(guild_id));
create policy "players and officers add availability templates" on public.availability_templates
  for insert to authenticated with check (public.is_guild_officer(guild_id) or member_id = public.my_member_id(guild_id));
create policy "players and officers edit availability templates" on public.availability_templates
  for update to authenticated using (public.is_guild_officer(guild_id) or member_id = public.my_member_id(guild_id))
  with check (public.is_guild_officer(guild_id) or member_id = public.my_member_id(guild_id));
create policy "players and officers delete availability templates" on public.availability_templates
  for delete to authenticated using (public.is_guild_officer(guild_id) or member_id = public.my_member_id(guild_id));
alter publication supabase_realtime add table public.availability_templates;
