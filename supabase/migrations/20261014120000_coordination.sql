-- Coordination improvements: preferred/tentative availability and absences on check-ins, optional
-- per-raid composition rules and weekly schedules, and Discord response buttons on rosters the
-- WhenToRaid bot posts. Nothing here sends a message or enables delivery by itself.

-- ---------------------------------------------------------------------------------------------
-- Check-in availability kinds. `availability` holds { preferred?, tentative?, absent? }: UTC ranges
-- for the first two (mirrors Checkin in src/lib/model.js) and up to seven dates inside the week.
create function public.valid_checkin_availability(a jsonb, w date) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(a) is distinct from 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(a) k where k not in ('preferred', 'tentative', 'absent')) then
    return false;
  end if;
  if a ? 'preferred' and not public.valid_ranges(a -> 'preferred') then return false; end if;
  if a ? 'tentative' and not public.valid_ranges(a -> 'tentative') then return false; end if;
  if a ? 'absent' then
    if jsonb_typeof(a -> 'absent') is distinct from 'array' or jsonb_array_length(a -> 'absent') > 7 then
      return false;
    end if;
    if exists (
      select 1 from jsonb_array_elements(a -> 'absent') d
      where jsonb_typeof(d) is distinct from 'string'
         or (d #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$'
         or (d #>> '{}')::date not between w and w + 6
    ) then return false; end if;
  end if;
  return true;
exception when others then return false;
end $$;

alter table public.checkins add column availability jsonb not null default '{}'
  check (public.valid_checkin_availability(availability, week) and pg_column_size(availability) < 40000);

-- ---------------------------------------------------------------------------------------------
-- Optional raid composition rules and weekly schedules inside guild settings. Mirrors
-- validateCompositionRules (src/lib/composition-rules.js) and validateRaidSeries (src/lib/raid-series.js).
create function public.valid_class_spec(c text, s text) returns boolean
language sql immutable set search_path = '' as $$
  select case c
    when 'Warrior' then s is null or s in ('Arms', 'Fury', 'Protection')
    when 'Paladin' then s is null or s in ('Holy', 'Protection', 'Retribution')
    when 'Hunter' then s is null or s in ('Beast Mastery', 'Marksmanship', 'Survival')
    when 'Rogue' then s is null or s in ('Assassination', 'Combat', 'Subtlety')
    when 'Priest' then s is null or s in ('Discipline', 'Holy', 'Shadow')
    when 'Shaman' then s is null or s in ('Elemental', 'Enhancement', 'Restoration')
    when 'Mage' then s is null or s in ('Arcane', 'Fire', 'Frost')
    when 'Warlock' then s is null or s in ('Affliction', 'Demonology', 'Destruction')
    when 'Druid' then s is null or s in ('Balance', 'Feral Combat', 'Restoration')
    else false
  end
$$;

create function public.valid_raid_rules(r jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare u jsonb; seen text[] := '{}';
begin
  if jsonb_typeof(r) is distinct from 'object' then return false; end if;
  if r ? 'classLimits' and (
    jsonb_typeof(r -> 'classLimits') is distinct from 'object'
    or exists (select 1 from jsonb_each(r -> 'classLimits') e
      where not public.valid_class_spec(e.key, null) or jsonb_typeof(e.value) is distinct from 'number'
        or (e.value #>> '{}')::numeric not between 0 and 40
        or (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric))
  ) then return false; end if;
  if r ? 'priority' and coalesce(r ->> 'priority', '') not in ('fairness', 'mains', 'preferred') then
    return false;
  end if;
  if r ? 'requiredUtilities' then
    if jsonb_typeof(r -> 'requiredUtilities') is distinct from 'array'
       or jsonb_array_length(r -> 'requiredUtilities') > 6 then return false; end if;
    for u in select value from jsonb_array_elements(r -> 'requiredUtilities') loop
      -- A missing field makes a comparison NULL, not true; coalesce treats that as invalid.
      if coalesce(jsonb_typeof(u) is distinct from 'object'
         or jsonb_typeof(u -> 'id') is distinct from 'string'
         or not public.valid_entity_id(u ->> 'id') or (u ->> 'id') = any(seen)
         or jsonb_typeof(u -> 'name') is distinct from 'string'
         or char_length(btrim(u ->> 'name')) not between 1 and 40
         or jsonb_typeof(u -> 'eligible') is distinct from 'array'
         or jsonb_array_length(u -> 'eligible') not between 1 and 20
         or exists (select 1 from jsonb_array_elements(u -> 'eligible') e
           where jsonb_typeof(e) is distinct from 'object'
              or (e ? 'spec' and jsonb_typeof(e -> 'spec') is distinct from 'string')
              or not public.valid_class_spec(e ->> 'class', e ->> 'spec')), true) then
        return false;
      end if;
      seen := array_append(seen, u ->> 'id');
    end loop;
  end if;
  return true;
exception when others then return false;
end $$;

-- Missing fields make comparisons NULL rather than false, so every check below is coalesced:
-- a NULL validity is invalid.
create function public.valid_series_time(t jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(t -> 'day') = 'number' and jsonb_typeof(t -> 'minutes') = 'number'
    and (t ->> 'day')::numeric in (0, 1, 2, 3, 4, 5, 6)
    and (t ->> 'minutes')::numeric >= 0 and (t ->> 'minutes')::numeric < 2880
    and (t ->> 'minutes')::numeric % 30 = 0, false)
$$;

create function public.valid_raid_series(s jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  if coalesce(jsonb_typeof(s) is distinct from 'object' or not public.valid_series_time(s)
     or jsonb_typeof(s -> 'startDate') is distinct from 'string'
     or jsonb_typeof(s -> 'endDate') is distinct from 'string'
     or jsonb_typeof(s -> 'timezone') is distinct from 'string'
     or (s ->> 'startDate') !~ '^\d{4}-\d{2}-\d{2}$' or (s ->> 'endDate') !~ '^\d{4}-\d{2}-\d{2}$'
     or (s ->> 'endDate')::date < (s ->> 'startDate')::date
     or (s ->> 'endDate')::date - (s ->> 'startDate')::date >= 366
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = s ->> 'timezone'), true) then
    return false;
  end if;
  if s ? 'changes' and coalesce(
    jsonb_typeof(s -> 'changes') is distinct from 'array' or jsonb_array_length(s -> 'changes') > 52
    or exists (select 1 from jsonb_array_elements(s -> 'changes') c
      where coalesce(not public.valid_series_time(c)
        or jsonb_typeof(c -> 'fromWeek') is distinct from 'string'
        or extract(isodow from (c ->> 'fromWeek')::date) <> 1, true)), true
  ) then return false; end if;
  if s ? 'exceptions' and coalesce(
    jsonb_typeof(s -> 'exceptions') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(s -> 'exceptions')) > 52
    or exists (select 1 from jsonb_each(s -> 'exceptions') e
      where coalesce(e.key !~ '^\d{4}-\d{2}-\d{2}$' or extract(isodow from e.key::date) <> 1
        or jsonb_typeof(e.value) is distinct from 'object'
        or (e.value ? 'cancelled' and jsonb_typeof(e.value -> 'cancelled') is distinct from 'boolean')
        -- A moved week needs both a day and a time, as in validateRaidSeries.
        or ((e.value ? 'day' or e.value ? 'minutes') and not public.valid_series_time(e.value)), true)), true
  ) then return false; end if;
  return true;
exception when others then return false;
end $$;

create function public.valid_raid_extensions(settings jsonb) returns boolean
language sql stable set search_path = '' as $$
  select not exists (
    select 1 from jsonb_array_elements(settings -> 'raids') r
    where (r ? 'rules' and not public.valid_raid_rules(r -> 'rules'))
       or (r ? 'series' and not public.valid_raid_series(r -> 'series'))
  )
$$;
alter table public.guilds add constraint guilds_raid_extensions_valid
  check (public.valid_raid_extensions(settings) and pg_column_size(settings) < 100000);

-- ---------------------------------------------------------------------------------------------
-- Atomic saves write the new check-in column. Unchanged apart from the checkins columns.
create or replace function public.apply_guild_changes(
  p_guild_id uuid, p_revision bigint, p_ops jsonb
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  op jsonb;
  row_data jsonb;
  key_data jsonb;
  table_name text;
  columns_sql text;
  values_sql text;
  keys_sql text;
  updates_sql text;
  statement_sql text;
  changed int;
  next_revision bigint;
  is_officer boolean;
  own_member_id text;
  existing_member_id text;
begin
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) not between 1 and 30 then
    raise exception 'Invalid guild change batch.' using errcode = '22023';
  end if;
  next_revision := public.claim_guild_revision(p_guild_id, p_revision);
  perform set_config('whentoraid.atomic_write', 'on', true);
  is_officer := public.is_guild_officer(p_guild_id);
  own_member_id := public.my_member_id(p_guild_id);

  for op in select value from jsonb_array_elements(p_ops) loop
    table_name := op ->> 'table';
    case table_name
      when 'guilds' then
        columns_sql := 'id,name,timezone,day_start_hour,slots_per_day,settings,discord_server_id,officer_role_ids';
        keys_sql := 'id';
        updates_sql := 'name=data.name, timezone=data.timezone, day_start_hour=data.day_start_hour, slots_per_day=data.slots_per_day, settings=data.settings, discord_server_id=data.discord_server_id, officer_role_ids=data.officer_role_ids';
      when 'members' then
        columns_sql := 'guild_id,id,name,discord_id,is_officer,position';
        keys_sql := 'guild_id,id';
        updates_sql := 'name=excluded.name, discord_id=excluded.discord_id, is_officer=excluded.is_officer, position=excluded.position';
      when 'characters' then
        columns_sql := 'guild_id,id,member_id,name,realm,spec,class,role,main,retired,position';
        keys_sql := 'guild_id,id';
        updates_sql := 'member_id=excluded.member_id, name=excluded.name, realm=excluded.realm, spec=excluded.spec, class=excluded.class, role=excluded.role, main=excluded.main, retired=excluded.retired, position=excluded.position';
      when 'availability_templates' then
        columns_sql := 'guild_id,member_id,template';
        keys_sql := 'guild_id,member_id';
        updates_sql := 'template=excluded.template';
      when 'checkins' then
        columns_sql := 'guild_id,week,member_id,checked_in,ranges,declined,raid_preferences,availability';
        keys_sql := 'guild_id,week,member_id';
        updates_sql := 'checked_in=excluded.checked_in, ranges=excluded.ranges, declined=excluded.declined, raid_preferences=excluded.raid_preferences, availability=excluded.availability';
      when 'plans' then
        columns_sql := 'guild_id,week,raid_id,start,team,locked,attendance,cancelled,published';
        keys_sql := 'guild_id,week,raid_id';
        updates_sql := 'start=excluded.start, team=excluded.team, locked=excluded.locked, attendance=excluded.attendance, cancelled=excluded.cancelled, published=excluded.published';
      else
        raise exception 'Unknown guild table.' using errcode = '22023';
    end case;
    -- Check-in rows from clients older than this migration carry no availability: keep what is
    -- stored, so their edits never erase preferred, tentative or away days.
    values_sql := case when table_name = 'checkins'
      then replace(columns_sql, ',availability', ',coalesce(r.availability, (select c.availability from public.checkins c'
        || ' where c.guild_id = r.guild_id and c.week = r.week and c.member_id = r.member_id), ''{}''::jsonb)')
      else columns_sql end;

    if op ->> 'kind' in ('upsert', 'update') then
      if jsonb_typeof(op -> 'rows') is distinct from 'array'
         or jsonb_array_length(op -> 'rows') not between 1 and 10000 then
        raise exception 'Invalid guild rows.' using errcode = '22023';
      end if;
      for row_data in select value from jsonb_array_elements(op -> 'rows') loop
        if (table_name = 'guilds' and row_data ->> 'id' is distinct from p_guild_id::text)
           or (table_name <> 'guilds' and row_data ->> 'guild_id' is distinct from p_guild_id::text) then
          raise exception 'Guild row belongs to another guild.' using errcode = '42501';
        end if;
        if table_name in ('guilds', 'members', 'plans') and not is_officer then
          raise exception 'You do not have permission to change this guild row.' using errcode = '42501';
        end if;
        if table_name in ('characters', 'availability_templates', 'checkins') and not is_officer then
          if row_data ->> 'member_id' is distinct from own_member_id then
            raise exception 'You do not have permission to change this guild row.' using errcode = '42501';
          end if;
          if table_name = 'characters' then
            select c.member_id into existing_member_id from public.characters c
              where c.guild_id = p_guild_id and c.id = row_data ->> 'id';
            if found and existing_member_id is distinct from own_member_id then
              raise exception 'You do not have permission to change this guild row.' using errcode = '42501';
            end if;
          end if;
        end if;
      end loop;
      if table_name = 'guilds' then
        if op ->> 'kind' <> 'update' then
          raise exception 'Guild creation uses create_guild.' using errcode = '22023';
        end if;
        statement_sql := format(
          'update public.guilds g set %s from jsonb_populate_recordset(null::public.guilds, $1) data where g.id = data.id and g.id = $2',
          updates_sql
        );
        execute statement_sql using op -> 'rows', p_guild_id;
        get diagnostics changed = row_count;
        if changed <> jsonb_array_length(op -> 'rows') then
          raise exception 'Guild update was refused.' using errcode = '42501';
        end if;
      else
        statement_sql := format(
          'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) r on conflict (%s) do update set %s',
          table_name, columns_sql, values_sql, table_name, keys_sql, updates_sql
        );
        execute statement_sql using op -> 'rows';
      end if;
    elsif op ->> 'kind' = 'delete' and table_name <> 'guilds' then
      if jsonb_typeof(op -> 'keys') is distinct from 'array'
         or jsonb_array_length(op -> 'keys') not between 1 and 10000 then
        raise exception 'Invalid guild keys.' using errcode = '22023';
      end if;
      for key_data in select value from jsonb_array_elements(op -> 'keys') loop
        if key_data ->> 'guild_id' is distinct from p_guild_id::text then
          raise exception 'Guild key belongs to another guild.' using errcode = '42501';
        end if;
        if table_name in ('members', 'plans') and not is_officer then
          raise exception 'You do not have permission to delete this guild row.' using errcode = '42501';
        end if;
        if table_name in ('availability_templates', 'checkins') and not is_officer
           and key_data ->> 'member_id' is distinct from own_member_id then
          raise exception 'You do not have permission to delete this guild row.' using errcode = '42501';
        end if;
        if table_name = 'characters' and not is_officer then
          select c.member_id into existing_member_id from public.characters c
            where c.guild_id = p_guild_id and c.id = key_data ->> 'id';
          if found and existing_member_id is distinct from own_member_id then
            raise exception 'You do not have permission to delete this guild row.' using errcode = '42501';
          end if;
        end if;
        if table_name in ('members', 'characters') then
          statement_sql := format('delete from public.%I where guild_id = $1 and id = $2', table_name);
          execute statement_sql using p_guild_id, key_data ->> 'id';
          get diagnostics changed = row_count;
          if changed = 0 then
            statement_sql := format('select count(*) from public.%I where guild_id = $1 and id = $2', table_name);
            execute statement_sql into changed using p_guild_id, key_data ->> 'id';
            if changed > 0 then raise exception 'Guild delete was refused.' using errcode = '42501'; end if;
          end if;
        elsif table_name = 'availability_templates' then
          delete from public.availability_templates
            where guild_id = p_guild_id and member_id = key_data ->> 'member_id';
          get diagnostics changed = row_count;
          if changed = 0 then
            select count(*) into changed from public.availability_templates
              where guild_id = p_guild_id and member_id = key_data ->> 'member_id';
            if changed > 0 then raise exception 'Guild delete was refused.' using errcode = '42501'; end if;
          end if;
        elsif table_name = 'checkins' then
          delete from public.checkins where guild_id = p_guild_id
            and week = (key_data ->> 'week')::date and member_id = key_data ->> 'member_id';
          get diagnostics changed = row_count;
          if changed = 0 then
            select count(*) into changed from public.checkins where guild_id = p_guild_id
              and week = (key_data ->> 'week')::date and member_id = key_data ->> 'member_id';
            if changed > 0 then raise exception 'Guild delete was refused.' using errcode = '42501'; end if;
          end if;
        else
          delete from public.plans where guild_id = p_guild_id
            and week = (key_data ->> 'week')::date and raid_id = key_data ->> 'raid_id';
          get diagnostics changed = row_count;
          if changed = 0 then
            select count(*) into changed from public.plans where guild_id = p_guild_id
              and week = (key_data ->> 'week')::date and raid_id = key_data ->> 'raid_id';
            if changed > 0 then raise exception 'Guild delete was refused.' using errcode = '42501'; end if;
          end if;
        end if;
      end loop;
    else
      raise exception 'Invalid guild operation.' using errcode = '22023';
    end if;
  end loop;
  return next_revision;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Rosters posted by the WhenToRaid bot. A guild posts through a channel webhook (as before) or,
-- when the server operator has configured the bot, into a channel id; only bot messages can carry
-- response buttons. Deliveries are fingerprinted by their target so changing it never edits or
-- duplicates messages in the old channel.
alter table public.guild_discord add column channel_id text not null default ''
  check (channel_id = '' or channel_id ~ '^\d{17,20}$');
alter table public.guild_discord alter column webhook_url drop not null;
alter table public.guild_discord add constraint guild_discord_has_target
  check (webhook_url is not null or channel_id <> '');

create function public.discord_target(webhook_url text, channel_id text) returns text
language sql immutable set search_path = '' as $$
  select case when coalesce(channel_id, '') <> '' then 'bot:' || channel_id else webhook_url end
$$;

drop function public.get_guild_discord(uuid);
create function public.get_guild_discord(p_guild_id uuid)
returns table (webhook_url text, mention_players boolean, posts jsonb, channel_id text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_guild_officer(p_guild_id);
  return query select coalesce(d.webhook_url, ''), d.mention_players, d.posts, d.channel_id
    from public.guild_discord d where d.guild_id = p_guild_id;
end $$;

drop function public.set_guild_discord(uuid, text, boolean);
create function public.set_guild_discord(
  p_guild_id uuid, p_webhook_url text, p_mention_players boolean, p_channel_id text default ''
) returns void language plpgsql security definer set search_path = '' as $$
declare
  hook text := nullif(btrim(coalesce(p_webhook_url, '')), '');
  channel text := btrim(coalesce(p_channel_id, ''));
begin
  perform public.require_guild_officer(p_guild_id);
  if hook is null and channel = '' then
    delete from public.guild_discord where guild_id = p_guild_id;
    return;
  end if;
  if hook is not null and not public.valid_webhook_url(hook) then
    raise exception 'That is not a Discord webhook URL.' using errcode = '22023';
  end if;
  if channel <> '' and channel !~ '^\d{17,20}$' then
    raise exception 'A Discord channel ID is 17 to 20 digits.' using errcode = '22023';
  end if;
  insert into public.guild_discord (guild_id, webhook_url, mention_players, channel_id)
  values (p_guild_id, hook, coalesce(p_mention_players, false), channel)
  on conflict (guild_id) do update set
    mention_players = excluded.mention_players,
    -- Messages posted to another target cannot be edited through this one.
    posts = case when public.discord_target(guild_discord.webhook_url, guild_discord.channel_id)
      = public.discord_target(excluded.webhook_url, excluded.channel_id) then guild_discord.posts else '{}' end,
    webhook_url = excluded.webhook_url,
    channel_id = excluded.channel_id;
end $$;
revoke execute on function public.get_guild_discord(uuid), public.set_guild_discord(uuid, text, boolean, text)
  from public, anon;
grant execute on function public.get_guild_discord(uuid), public.set_guild_discord(uuid, text, boolean, text)
  to authenticated;

create or replace function public.enqueue_roster_delivery(g uuid,w date,r text,snapshot jsonb,cancelled boolean,withdrawn boolean,action text default 'post')
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; d public.guild_discord; k text := w::text||'/'||r; fingerprint text;
begin
  select * into d from public.guild_discord where guild_id=g;
  if not found then raise exception 'Set a Discord channel in Guild settings first.' using errcode='22023'; end if;
  fingerprint := md5(public.discord_target(d.webhook_url, d.channel_id));
  insert into public.discord_deliveries(guild_id,delivery_key,week,raid_id,kind,action,payload,webhook_fingerprint,message_ids)
  values(g,k,w,r,'roster',action,public.raid_delivery_payload(g,w,r,snapshot,cancelled,withdrawn),fingerprint,coalesce(d.posts->k,'[]'))
  on conflict(guild_id,delivery_key) do update set payload=excluded.payload,action=excluded.action,version=discord_deliveries.version+1,
    status=case when discord_deliveries.status in ('sending','uncertain') then discord_deliveries.status else 'pending' end,
    message_ids=case when discord_deliveries.webhook_fingerprint=excluded.webhook_fingerprint then discord_deliveries.message_ids else excluded.message_ids end,
    webhook_fingerprint=excluded.webhook_fingerprint,attempts=0,next_attempt_at=now(),last_error=null,updated_at=now()
  returning id into result;
  return result;
end $$;

create or replace function public.capture_raid_publication() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.plans; prior public.plans; e jsonb; gu public.guilds; k text; cancel boolean;
begin
  if tg_op='DELETE' then p:=old; p.published:=null; p.cancelled:=true; prior:=old;
  else p:=new; if tg_op='UPDATE' then prior:=old; end if; end if;
  if tg_op='UPDATE' and p.published is not distinct from prior.published and p.cancelled=prior.cancelled then return new; end if;
  select * into gu from public.guilds where id=p.guild_id;
  cancel:=p.cancelled or p.published is null;
  update public.raid_calendar_events ce set cancelled=true,sequence=sequence+1,updated_at=now()
  where ce.guild_id=p.guild_id and ce.week=p.week and ce.raid_id=p.raid_id and not ce.cancelled
    and (cancel or not exists(select 1 from jsonb_array_elements(p.published->'team') x where x->>'memberId'=ce.member_id));
  if not cancel then
    for e in select * from jsonb_array_elements(p.published->'team') loop
      insert into public.raid_calendar_events(guild_id,member_id,week,raid_id,start_ms,end_ms,title,description)
      select p.guild_id,e->>'memberId',p.week,p.raid_id,(p.published->>'start')::numeric::bigint,(p.published->>'end')::numeric::bigint,
        gu.name||' · '||(p.published->>'raidName'),coalesce(c.name,m.name)||' · '||(e->>'role')
      from public.members m left join public.characters c on c.guild_id=p.guild_id and c.id=e->>'characterId'
      where m.guild_id=p.guild_id and m.id=e->>'memberId'
      on conflict(guild_id,member_id,week,raid_id) do update set start_ms=excluded.start_ms,end_ms=excluded.end_ms,title=excluded.title,
        description=excluded.description,cancelled=false,sequence=raid_calendar_events.sequence+1,updated_at=now();
    end loop;
  end if;
  k:=p.week::text||'/'||p.raid_id;
  if exists(select 1 from public.guild_discord d where d.guild_id=p.guild_id and (d.posts ? k or exists(
      select 1 from public.discord_deliveries q where q.guild_id=p.guild_id and q.delivery_key=k and q.action<>'delete'
        and q.webhook_fingerprint=md5(public.discord_target(d.webhook_url, d.channel_id))))) then
    perform public.enqueue_roster_delivery(p.guild_id,p.week,p.raid_id,coalesce(p.published,prior.published),p.cancelled,p.published is null);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.claim_discord_delivery(p_guild_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.discord_deliveries; hook public.guild_discord;
begin
  update public.discord_deliveries set status='uncertain',last_error='Delivery was interrupted. Check Discord before retrying.',lease_token=null,lease_until=null
    where status='sending' and lease_until<now() and (p_guild_id is null or guild_id=p_guild_id);
  for d in select * from public.discord_deliveries q where q.status='pending' and q.next_attempt_at<=now()
    and (p_guild_id is null or q.guild_id=p_guild_id)
    and not exists(select 1 from public.discord_deliveries busy where busy.guild_id=q.guild_id and busy.status='sending')
    order by q.next_attempt_at for update skip locked limit 50 loop
    if not pg_try_advisory_xact_lock(hashtextextended(d.guild_id::text,0)) then continue; end if;
    if exists(select 1 from public.discord_deliveries busy where busy.guild_id=d.guild_id and busy.status='sending') then continue; end if;
    select * into hook from public.guild_discord where guild_id=d.guild_id;
    if not found or md5(public.discord_target(hook.webhook_url, hook.channel_id))<>d.webhook_fingerprint then
      update public.discord_deliveries set status='failed',last_error='The Discord channel changed. Post the roster again.',updated_at=now() where id=d.id;
      continue;
    end if;
    update public.discord_deliveries set status='sending',lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',attempts=attempts+1,updated_at=now()
      where id=d.id returning * into d;
    return to_jsonb(d)||jsonb_build_object('webhook_url',hook.webhook_url,'channel_id',hook.channel_id,'mention_players',hook.mention_players);
  end loop;
  return null;
end $$;

create or replace function public.checkpoint_discord_delivery(p_id uuid,p_lease uuid,p_message_ids jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.discord_deliveries;
begin
  select * into d from public.discord_deliveries where id=p_id and lease_token=p_lease and status='sending' for update;
  if not found then raise exception 'Delivery lease expired.' using errcode='40001'; end if;
  if not public.valid_discord_posts(jsonb_build_object(d.week::text||'/'||coalesce(d.raid_id,'reminder'),p_message_ids)) and p_message_ids<>'[]' then
    raise exception 'Invalid message identifiers.' using errcode='22023';
  end if;
  update public.discord_deliveries set message_ids=p_message_ids,lease_until=now()+interval '10 minutes' where id=p_id;
  if d.kind='roster' then
    update public.guild_discord set posts=(
      select coalesce(jsonb_object_agg(e.key,e.value),'{}') from jsonb_each(case when p_message_ids='[]' then posts-d.delivery_key
        else jsonb_set(posts,array[d.delivery_key],p_message_ids) end) e where left(e.key,10)::date >= current_date-90)
      where guild_id=d.guild_id and md5(public.discord_target(webhook_url, channel_id))=d.webhook_fingerprint;
  end if;
end $$;

create or replace function public.enqueue_due_raid_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare s record; p record; w date; k text; deadline timestamptz;
begin
  delete from public.discord_deliveries where kind<>'roster' and status in ('sent','failed') and updated_at<now()-interval '30 days';
  for s in select rs.*,g.timezone,md5(public.discord_target(d.webhook_url,d.channel_id)) as fingerprint
    from public.raid_reminder_settings rs join public.guilds g on g.id=rs.guild_id
    join public.guild_discord d on d.guild_id=rs.guild_id where rs.checkin_enabled or rs.upcoming_enabled
    for update of rs skip locked loop
    w:=date_trunc('week',now() at time zone s.timezone)::date;
    deadline:=public.checkin_deadline(s.guild_id,w);
    if s.checkin_enabled and s.next_checkin_at<=now() and (deadline is null or deadline>now()) then
      k:='checkin:'||w::text||':'||floor(extract(epoch from now())/(s.interval_hours*3600))::text;
      insert into public.discord_deliveries(guild_id,delivery_key,week,kind,payload,webhook_fingerprint)
      values(s.guild_id,k,w,'checkin','{}',s.fingerprint) on conflict(guild_id,delivery_key) do nothing;
      update public.raid_reminder_settings set next_checkin_at=now()+make_interval(hours=>s.interval_hours) where guild_id=s.guild_id;
    end if;
    if s.upcoming_enabled then
      for p in select * from public.plans where guild_id=s.guild_id and published is not null and not cancelled
        and (published->>'start')::numeric>extract(epoch from now())*1000
        and (published->>'start')::numeric<=extract(epoch from now()+make_interval(hours=>s.lead_hours))*1000 loop
        k:='upcoming:'||p.week::text||'/'||p.raid_id||':'||(p.published->>'start');
        insert into public.discord_deliveries(guild_id,delivery_key,week,raid_id,kind,payload,webhook_fingerprint)
        values(s.guild_id,k,p.week,p.raid_id,'upcoming','{}',s.fingerprint) on conflict(guild_id,delivery_key) do nothing;
      end loop;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Presses already applied, so a replayed signed request cannot overwrite a newer answer. Discord
-- rejects requests older than five minutes, so a day of history is plenty.
create table public.discord_interactions (
  id text primary key check (id ~ '^\d{17,20}$'),
  received_at timestamptz not null default now()
);
alter table public.discord_interactions enable row level security;
revoke all on public.discord_interactions from public, anon, authenticated;

-- A Discord button press, called only by the raid-interactions Edge Function after it verified
-- Discord's signature. Every identifier comes from the signed interaction. The message must be the
-- guild's current bot post for this delivery version, in the guild's Discord server and channel,
-- and the presser must be a rostered member of the current published roster.
create function public.respond_to_discord_raid(
  p_interaction_id text, p_discord_id text, p_discord_guild_id text, p_channel_id text,
  p_message_id text, p_delivery_id uuid, p_version bigint, p_status text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.discord_deliveries; g public.guilds; hook public.guild_discord; m public.members;
  p public.plans; current_assignment text;
begin
  if p_interaction_id !~ '^\d{17,20}$' or p_discord_id !~ '^\d{17,20}$' or p_discord_guild_id !~ '^\d{17,20}$'
     or p_channel_id !~ '^\d{17,20}$' or p_message_id !~ '^\d{17,20}$'
     or p_status is null or p_status not in ('confirmed', 'unavailable') then
    raise exception 'Invalid Discord response.' using errcode = '22023';
  end if;
  select * into d from public.discord_deliveries where id = p_delivery_id and kind = 'roster';
  if not found then return jsonb_build_object('outcome', 'unknown'); end if;
  select * into g from public.guilds where id = d.guild_id;
  select * into hook from public.guild_discord where guild_id = d.guild_id;
  if g.discord_server_id is distinct from p_discord_guild_id or hook.channel_id is distinct from p_channel_id
     or d.webhook_fingerprint <> md5('bot:' || p_channel_id) or not (d.message_ids ? p_message_id) then
    return jsonb_build_object('outcome', 'unknown');
  end if;
  if d.version <> p_version then return jsonb_build_object('outcome', 'stale'); end if;
  select * into m from public.members where guild_id = d.guild_id and discord_id = p_discord_id;
  if not found then return jsonb_build_object('outcome', 'not-member'); end if;
  select * into p from public.plans where guild_id = d.guild_id and week = d.week and raid_id = d.raid_id for share;
  if p.published is null or p.cancelled or (p.published ->> 'start')::numeric <= extract(epoch from now()) * 1000 then
    return jsonb_build_object('outcome', 'closed');
  end if;
  current_assignment := public.raid_assignment(p.published, m.id);
  if current_assignment is null then return jsonb_build_object('outcome', 'not-rostered'); end if;
  delete from public.discord_interactions where received_at < now() - interval '1 day';
  insert into public.discord_interactions (id) values (p_interaction_id) on conflict (id) do nothing;
  if not found then return jsonb_build_object('outcome', 'duplicate'); end if;
  insert into public.raid_responses (guild_id,week,raid_id,member_id,publication,assignment,status,note,updated_at)
    values (d.guild_id,d.week,d.raid_id,m.id,p.published ->> 'publishedAt',current_assignment,p_status,'',now())
  on conflict (guild_id,week,raid_id,member_id) do update set publication=excluded.publication,
    -- A note written in the app stays while the assignment is the same.
    note=case when raid_responses.assignment=excluded.assignment then raid_responses.note else '' end,
    assignment=excluded.assignment,status=excluded.status,updated_at=excluded.updated_at;
  return jsonb_build_object('outcome', 'saved', 'status', p_status, 'raidName', p.published ->> 'raidName');
end $$;

revoke execute on function public.respond_to_discord_raid(text,text,text,text,text,uuid,bigint,text)
  from public, anon, authenticated;
grant execute on function public.respond_to_discord_raid(text,text,text,text,text,uuid,bigint,text) to service_role;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261014120000'::text $$;
