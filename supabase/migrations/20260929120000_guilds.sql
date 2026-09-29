-- WhenToRaid: guilds shared between players, signed in with Discord.
--
-- Access rule: a signed-in user is a guild member when a member row carries their Discord user ID.
-- The ID comes from auth.identities (written by Supabase Auth from Discord's OAuth response), never
-- from user_metadata, which users can edit. Officers invite players by adding their Discord ID.
--
-- Ids are text so guilds created in the browser-only version (and their backups) keep their ids.

-- Shape checks for jsonb written by clients. Every player's browser renders these values, so a
-- malformed value written through the API must be refused rather than break other players' pages.

create function public.valid_ranges(r jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(r) = 'array' and jsonb_array_length(r) <= 400 and not exists (
    select 1 from jsonb_array_elements(r) e
    where jsonb_typeof(e) is distinct from 'object'
       or jsonb_typeof(e -> 'start') is distinct from 'number'
       or jsonb_typeof(e -> 'end') is distinct from 'number'
       or (e ->> 'start')::numeric >= (e ->> 'end')::numeric
  )
$$;

create function public.valid_string_list(r jsonb, max_items int) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(r) = 'array' and jsonb_array_length(r) <= max_items and not exists (
    select 1 from jsonb_array_elements(r) e
    where jsonb_typeof(e) is distinct from 'string' or char_length(e #>> '{}') > 64
  )
$$;

create function public.valid_team(r jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(r) = 'array' and jsonb_array_length(r) <= 40 and not exists (
    select 1 from jsonb_array_elements(r) e
    where jsonb_typeof(e) is distinct from 'object'
       or jsonb_typeof(e -> 'memberId') is distinct from 'string'
       or jsonb_typeof(e -> 'characterId') is distinct from 'string'
       or (e ->> 'role') is null or (e ->> 'role') not in ('Tank', 'Healer', 'DPS')
  )
$$;

create function public.valid_settings(s jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(s) = 'object'
    and jsonb_typeof(s -> 'targets') = 'array'
    and jsonb_array_length(s -> 'targets') = 3
    and not exists (
      select 1 from jsonb_array_elements(s -> 'targets') t
      where jsonb_typeof(t) is distinct from 'number' or (t #>> '{}')::numeric not between 0 and 40
    )
    and jsonb_typeof(s -> 'durationSlots') = 'number'
    and (s ->> 'durationSlots')::numeric between 1 and 48
    and (
      jsonb_typeof(s -> 'checkinDeadline') is null
      or jsonb_typeof(s -> 'checkinDeadline') = 'null'
      or (
        jsonb_typeof(s -> 'checkinDeadline' -> 'day') = 'number'
        and jsonb_typeof(s -> 'checkinDeadline' -> 'minutes') = 'number'
      )
    )
$$;

create table public.guilds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  timezone text not null check (char_length(timezone) between 1 and 64),
  day_start_hour int not null check (day_start_hour between 0 and 23),
  slots_per_day int not null check (slots_per_day between 1 and 48),
  -- { targets: number[3], durationSlots: number, checkinDeadline: { day, minutes } | null }
  settings jsonb not null check (public.valid_settings(settings) and pg_column_size(settings) < 2000),
  discord_server_id text not null default '' check (discord_server_id ~ '^\d{0,20}$'),
  officer_role_ids text not null default '' check (officer_role_ids ~ '^[\d, ]*$' and char_length(officer_role_ids) <= 400),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table public.members (
  guild_id uuid not null references public.guilds on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  name text not null check (char_length(btrim(name)) between 1 and 30),
  discord_id text not null default '' check (discord_id ~ '^(\d{17,20})?$'),
  is_officer boolean not null default false,
  -- Member list order: the optimizer breaks ties in favor of earlier members.
  position int not null default 0,
  primary key (guild_id, id)
);

create unique index members_one_row_per_discord_user
  on public.members (guild_id, discord_id)
  where discord_id <> '';

create table public.characters (
  guild_id uuid not null,
  id text not null check (char_length(id) between 1 and 64),
  member_id text not null,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  realm text not null check (char_length(btrim(realm)) between 1 and 60),
  spec text not null check (char_length(btrim(spec)) between 1 and 40),
  class text not null check (
    class in ('Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Shaman', 'Mage', 'Warlock', 'Druid')
  ),
  role text not null check (role in ('Tank', 'Healer', 'DPS')),
  main boolean not null default false,
  position int not null default 0,
  primary key (guild_id, id),
  foreign key (guild_id, member_id) references public.members (guild_id, id) on delete cascade
);

create table public.checkins (
  guild_id uuid not null,
  week date not null check (extract(isodow from week) = 1),
  member_id text not null,
  checked_in boolean not null default false,
  -- UTC ms intervals [{ start, end }] and declined character ids.
  ranges jsonb not null default '[]' check (public.valid_ranges(ranges) and pg_column_size(ranges) < 20000),
  declined jsonb not null default '[]' check (public.valid_string_list(declined, 20) and pg_column_size(declined) < 4000),
  primary key (guild_id, week, member_id),
  foreign key (guild_id, member_id) references public.members (guild_id, id) on delete cascade
);

create table public.plans (
  guild_id uuid not null references public.guilds on delete cascade,
  week date not null check (extract(isodow from week) = 1),
  start bigint not null,
  team jsonb not null check (public.valid_team(team) and pg_column_size(team) < 20000),
  locked jsonb not null default '[]' check (public.valid_string_list(locked, 40) and pg_column_size(locked) < 4000),
  attendance jsonb not null default '{}' check (jsonb_typeof(attendance) = 'object' and pg_column_size(attendance) < 4000),
  cancelled boolean not null default false,
  primary key (guild_id, week)
);

create index characters_member on public.characters (guild_id, member_id);
create index checkins_member on public.checkins (guild_id, member_id);

-- Identity helpers. SECURITY DEFINER so policies on members can call them without recursing
-- into members' own policies; each reads only rows for the caller's own Discord identity.

create function public.my_discord_id() returns text
language sql stable security definer set search_path = ''
as $$
  select i.provider_id from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'discord'
  order by i.created_at
  limit 1
$$;

create function public.my_member_id(g uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select m.id from public.members m
  where m.guild_id = g and m.discord_id <> '' and m.discord_id = public.my_discord_id()
$$;

create function public.is_guild_member(g uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.my_member_id(g) is not null $$;

create function public.is_guild_officer(g uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.guild_id = g and m.is_officer and m.discord_id <> '' and m.discord_id = public.my_discord_id()
  )
$$;

-- A guild must keep an officer who can sign in, or nobody could manage it again.
-- Deferred to commit, so an officer can hand over the role in one transaction.
create function public.keep_an_officer() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.guilds g where g.id = old.guild_id)
     and not exists (
       select 1 from public.members m
       where m.guild_id = old.guild_id and m.is_officer and m.discord_id <> ''
     ) then
    raise exception 'A guild needs at least one officer with a Discord ID.'
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

create constraint trigger members_keep_an_officer
  after update or delete on public.members
  deferrable initially deferred
  for each row execute function public.keep_an_officer();

-- Limits that keep one player from flooding a guild. Pages load whole guilds, so unbounded rows
-- would slow everyone down. Upserts of an existing row are not counted against a cap, since
-- BEFORE INSERT triggers also fire for ON CONFLICT updates.
create function public.enforce_guild_limits() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'guilds' then
    if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
      raise exception 'Unknown timezone.' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'members' then
    if (select count(*) from public.members m where m.guild_id = new.guild_id and m.id <> new.id) >= 200 then
      raise exception 'A guild can have at most 200 players.' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'characters' then
    if (select count(*) from public.characters c
        where c.guild_id = new.guild_id and c.member_id = new.member_id and c.id <> new.id) >= 20 then
      raise exception 'A player can have at most 20 characters.' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'checkins' then
    if new.week not between current_date - 400 and current_date + 400 then
      raise exception 'Check-ins must be for a week within a year of today.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

create trigger guilds_limits before insert or update on public.guilds
  for each row execute function public.enforce_guild_limits();
create trigger members_limits before insert on public.members
  for each row execute function public.enforce_guild_limits();
create trigger characters_limits before insert or update of member_id on public.characters
  for each row execute function public.enforce_guild_limits();
create trigger checkins_limits before insert or update of week on public.checkins
  for each row execute function public.enforce_guild_limits();

-- Creating a guild makes the caller its first officer, tied to their Discord identity.
-- The rest of the guild (other members, characters, weeks) is then written under officer policies.
create function public.create_guild(guild jsonb, member jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  discord text := public.my_discord_id();
  new_guild_id uuid;
begin
  if discord is null then
    raise exception 'Sign in with Discord to create a guild.' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.guilds g where g.created_by = auth.uid()) >= 10 then
    raise exception 'You can create at most 10 guilds.' using errcode = 'check_violation';
  end if;

  insert into public.guilds (name, timezone, day_start_hour, slots_per_day, settings, discord_server_id, officer_role_ids)
  values (
    guild ->> 'name',
    guild ->> 'timezone',
    (guild ->> 'dayStartHour')::int,
    (guild ->> 'slotsPerDay')::int,
    guild -> 'settings',
    coalesce(guild ->> 'discordServerId', ''),
    coalesce(guild ->> 'officerRoleIds', '')
  )
  returning id into new_guild_id;

  insert into public.members (guild_id, id, name, discord_id, is_officer, position)
  values (new_guild_id, member ->> 'id', member ->> 'name', discord, true, coalesce((member ->> 'position')::int, 0));

  return new_guild_id;
end
$$;

revoke execute on function public.my_discord_id, public.my_member_id, public.is_guild_member,
  public.is_guild_officer, public.create_guild from public, anon;
revoke execute on function public.keep_an_officer, public.enforce_guild_limits from public, anon, authenticated;
grant execute on function public.my_discord_id, public.my_member_id, public.is_guild_member,
  public.is_guild_officer, public.create_guild to authenticated;

-- Row-level security. Nothing is visible to signed-out visitors.

alter table public.guilds enable row level security;
alter table public.members enable row level security;
alter table public.characters enable row level security;
alter table public.checkins enable row level security;
alter table public.plans enable row level security;

revoke all on public.guilds, public.members, public.characters, public.checkins, public.plans from anon;
revoke truncate, references, trigger on public.guilds, public.members, public.characters, public.checkins,
  public.plans from authenticated;
-- Officers edit a guild's settings, never its id, creator, or creation time: the creator counts
-- toward the per-account guild limit in create_guild.
revoke insert, update on public.guilds from authenticated;
grant update (name, timezone, day_start_hour, slots_per_day, settings, discord_server_id, officer_role_ids)
  on public.guilds to authenticated;

create policy "members read their guild" on public.guilds
  for select to authenticated using (public.is_guild_member(id));
create policy "officers edit their guild" on public.guilds
  for update to authenticated using (public.is_guild_officer(id)) with check (public.is_guild_officer(id));
create policy "officers delete their guild" on public.guilds
  for delete to authenticated using (public.is_guild_officer(id));

create policy "members read the roster" on public.members
  for select to authenticated using (public.is_guild_member(guild_id));
create policy "officers add players" on public.members
  for insert to authenticated with check (public.is_guild_officer(guild_id));
create policy "officers edit players" on public.members
  for update to authenticated using (public.is_guild_officer(guild_id)) with check (public.is_guild_officer(guild_id));
create policy "officers remove players" on public.members
  for delete to authenticated using (public.is_guild_officer(guild_id));

-- Players manage their own characters and check-ins; officers manage everyone's ("Act as").
create policy "members read characters" on public.characters
  for select to authenticated using (public.is_guild_member(guild_id));
create policy "players and officers add characters" on public.characters
  for insert to authenticated
  with check (public.is_guild_officer(guild_id) or member_id = public.my_member_id(guild_id));
create policy "players and officers edit characters" on public.characters
  for update to authenticated
  using (public.is_guild_officer(guild_id) or member_id = public.my_member_id(guild_id))
  with check (public.is_guild_officer(guild_id) or member_id = public.my_member_id(guild_id));
create policy "players and officers delete characters" on public.characters
  for delete to authenticated
  using (public.is_guild_officer(guild_id) or member_id = public.my_member_id(guild_id));

create policy "members read check-ins" on public.checkins
  for select to authenticated using (public.is_guild_member(guild_id));
create policy "players and officers add check-ins" on public.checkins
  for insert to authenticated
  with check (public.is_guild_officer(guild_id) or member_id = public.my_member_id(guild_id));
create policy "players and officers edit check-ins" on public.checkins
  for update to authenticated
  using (public.is_guild_officer(guild_id) or member_id = public.my_member_id(guild_id))
  with check (public.is_guild_officer(guild_id) or member_id = public.my_member_id(guild_id));
create policy "players and officers delete check-ins" on public.checkins
  for delete to authenticated
  using (public.is_guild_officer(guild_id) or member_id = public.my_member_id(guild_id));

create policy "members read plans" on public.plans
  for select to authenticated using (public.is_guild_member(guild_id));
create policy "officers add plans" on public.plans
  for insert to authenticated with check (public.is_guild_officer(guild_id));
create policy "officers edit plans" on public.plans
  for update to authenticated using (public.is_guild_officer(guild_id)) with check (public.is_guild_officer(guild_id));
create policy "officers delete plans" on public.plans
  for delete to authenticated using (public.is_guild_officer(guild_id));

-- Live updates for everyone viewing the guild. Realtime applies the policies above.
alter publication supabase_realtime add table public.guilds, public.members, public.characters,
  public.checkins, public.plans;
