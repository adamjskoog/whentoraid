-- One revision per guild serializes app writes. All client writes go through the RPC below.
create table public.guild_revisions (
  guild_id uuid primary key references public.guilds(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0)
);
insert into public.guild_revisions (guild_id) select id from public.guilds;

create function public.init_guild_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.guild_revisions (guild_id) values (new.id);
  return new;
end $$;
create trigger guild_revision_created after insert on public.guilds
  for each row execute function public.init_guild_revision();
revoke execute on function public.init_guild_revision from public, anon, authenticated;

alter table public.guild_revisions enable row level security;
revoke all on public.guild_revisions from anon, authenticated;
grant select (guild_id, revision) on public.guild_revisions to authenticated;
create policy "members read guild revision" on public.guild_revisions
  for select to authenticated using (public.is_guild_member(guild_id));

-- Clients may not set or rewind a revision directly. The compare-and-swap helper is called in
-- the same transaction as apply_guild_changes; a later failure rolls this increment back.
create function public.claim_guild_revision(p_guild_id uuid, p_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare next_revision bigint;
begin
  if not public.is_guild_member(p_guild_id) then
    raise exception 'You are not a guild member.' using errcode = '42501';
  end if;
  update public.guild_revisions
     set revision = revision + 1
   where guild_id = p_guild_id and revision = p_revision
   returning revision into next_revision;
  if next_revision is null then
    raise exception 'This guild changed in another window. Your edit was not saved.'
      using errcode = '40001';
  end if;
  return next_revision;
end $$;
revoke execute on function public.claim_guild_revision(uuid, bigint) from public, anon, authenticated;

-- The RPC call is one Postgres transaction. A failed permission check, constraint, or stale
-- revision rolls back the revision and every earlier row in the batch.
create function public.apply_guild_changes(
  p_guild_id uuid, p_revision bigint, p_ops jsonb
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  op jsonb;
  row_data jsonb;
  key_data jsonb;
  table_name text;
  columns_sql text;
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
  -- A rollback may temporarily re-enable legacy table writes with revision triggers.
  -- Those triggers must not increment the revision for rows in this atomic batch.
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
        columns_sql := 'guild_id,week,member_id,checked_in,ranges,declined,raid_preferences';
        keys_sql := 'guild_id,week,member_id';
        updates_sql := 'checked_in=excluded.checked_in, ranges=excluded.ranges, declined=excluded.declined, raid_preferences=excluded.raid_preferences';
      when 'plans' then
        columns_sql := 'guild_id,week,raid_id,start,team,locked,attendance,cancelled,published';
        keys_sql := 'guild_id,week,raid_id';
        updates_sql := 'start=excluded.start, team=excluded.team, locked=excluded.locked, attendance=excluded.attendance, cancelled=excluded.cancelled, published=excluded.published';
      else
        raise exception 'Unknown guild table.' using errcode = '22023';
    end case;

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
          'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (%s) do update set %s',
          table_name, columns_sql, columns_sql, table_name, keys_sql, updates_sql
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

revoke execute on function public.apply_guild_changes(uuid, bigint, jsonb) from public, anon;
grant execute on function public.apply_guild_changes(uuid, bigint, jsonb) to authenticated;

-- Create and populate a guild in the same transaction. Every imported row is bound to the new
-- guild ID here; callers cannot use this SECURITY DEFINER entry point to write another guild.
create function public.create_online_guild(p_guild jsonb, p_member jsonb, p_rows jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
  table_name text;
  entries jsonb;
  bound_rows jsonb;
  operations jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'object' then
    raise exception 'Invalid guild upload.' using errcode = '22023';
  end if;
  new_id := public.create_guild(p_guild, p_member);
  foreach table_name in array array['members', 'characters', 'availability_templates', 'checkins', 'plans'] loop
    entries := p_rows -> table_name;
    if entries is not null then
      if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) > 10000 then
        raise exception 'Invalid guild upload rows.' using errcode = '22023';
      end if;
      if jsonb_array_length(entries) > 0 then
        select jsonb_agg(value || jsonb_build_object('guild_id', new_id))
          into bound_rows from jsonb_array_elements(entries);
        operations := operations || jsonb_build_array(
          jsonb_build_object('table', table_name, 'kind', 'upsert', 'rows', bound_rows)
        );
      end if;
    end if;
  end loop;
  if jsonb_array_length(operations) > 0 then
    perform public.apply_guild_changes(new_id, 0, operations);
  end if;
  return new_id;
end $$;
revoke execute on function public.create_online_guild(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_online_guild(jsonb, jsonb, jsonb) to authenticated;

-- The old table grants bypass the revision check, including guilds' column-level UPDATE grants.
revoke insert, update, delete on public.guilds, public.members, public.characters,
  public.availability_templates, public.checkins, public.plans from authenticated;
revoke update (name, timezone, day_start_hour, slots_per_day, settings, discord_server_id, officer_role_ids)
  on public.guilds from authenticated;

-- Public version marker contains no guild data. Deployment checks it before publishing a
-- Supabase-enabled frontend, so a missing production migration blocks that deployment.
create function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$
  select '20261010160000'::text
$$;
revoke execute on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;
