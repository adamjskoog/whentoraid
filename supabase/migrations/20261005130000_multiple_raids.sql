-- A guild shares check-ins, but each raid has its own composition and weekly plan.
alter table public.plans add column raid_id text not null default 'raid-20'
  check (raid_id ~ '^[a-z0-9-]{1,64}$');
alter table public.plans drop constraint plans_pkey;
alter table public.plans add primary key (guild_id, week, raid_id);

-- Keep legacy fields while the old settings check is still in place.
update public.guilds set settings = settings || jsonb_build_object('raids', jsonb_build_array(
  jsonb_build_object('id', 'raid-10-1', 'name', '10-player Raid 1', 'size', 10, 'targets', '[2,2,6]'::jsonb, 'durationSlots', least(6, (settings ->> 'durationSlots')::numeric)),
  jsonb_build_object('id', 'raid-10-2', 'name', '10-player Raid 2', 'size', 10, 'targets', '[2,2,6]'::jsonb, 'durationSlots', least(6, (settings ->> 'durationSlots')::numeric)),
  jsonb_build_object('id', 'raid-20', 'name', '20-player Raid',
    'size', (select sum((t #>> '{}')::numeric) from jsonb_array_elements(settings -> 'targets') t),
    'targets', settings -> 'targets', 'durationSlots', settings -> 'durationSlots')
));

create or replace function public.valid_settings(s jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  raid jsonb;
  target jsonb;
  total numeric;
  seen text[] := '{}';
begin
  if jsonb_typeof(s) is distinct from 'object'
     or jsonb_typeof(s -> 'raids') is distinct from 'array' then return false; end if;
  if jsonb_array_length(s -> 'raids') not between 1 and 10 then return false; end if;
  for raid in select * from jsonb_array_elements(s -> 'raids') loop
    if jsonb_typeof(raid) is distinct from 'object'
       or jsonb_typeof(raid -> 'id') is distinct from 'string'
       or (raid ->> 'id') !~ '^[a-z0-9-]{1,64}$'
       or (raid ->> 'id') = any(seen)
       or jsonb_typeof(raid -> 'name') is distinct from 'string'
       or char_length(btrim(raid ->> 'name')) not between 1 and 60
       or jsonb_typeof(raid -> 'size') is distinct from 'number'
       or (raid ->> 'size')::numeric not between 1 and 40
       or (raid ->> 'size')::numeric <> trunc((raid ->> 'size')::numeric)
       or jsonb_typeof(raid -> 'durationSlots') is distinct from 'number'
       or (raid ->> 'durationSlots')::numeric not in (2,3,4,5,6,7,8)
       or jsonb_typeof(raid -> 'targets') is distinct from 'array' then return false; end if;
    if jsonb_array_length(raid -> 'targets') <> 3 then return false; end if;
    total := 0;
    for target in select * from jsonb_array_elements(raid -> 'targets') loop
      if jsonb_typeof(target) is distinct from 'number'
         or (target #>> '{}')::numeric not between 0 and 40
         or (target #>> '{}')::numeric <> trunc((target #>> '{}')::numeric) then return false; end if;
      total := total + (target #>> '{}')::numeric;
    end loop;
    if total <> (raid ->> 'size')::numeric then return false; end if;
    seen := array_append(seen, raid ->> 'id');
  end loop;
  if s ? 'checkinDeadline' and s -> 'checkinDeadline' <> 'null'::jsonb then
    if jsonb_typeof(s -> 'checkinDeadline') is distinct from 'object'
       or jsonb_typeof(s -> 'checkinDeadline' -> 'day') is distinct from 'number'
       or jsonb_typeof(s -> 'checkinDeadline' -> 'minutes') is distinct from 'number' then return false; end if;
  end if;
  return true;
exception when others then return false;
end
$$;

update public.guilds set settings = settings - 'targets' - 'durationSlots';
