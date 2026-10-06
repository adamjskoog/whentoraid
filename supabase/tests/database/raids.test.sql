begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create temp table raid_settings as select '{"raids":[
  {"id":"raid-10-1","name":"First raid","size":10,"targets":[2,2,6],"durationSlots":6},
  {"id":"raid-10-2","name":"Second raid","size":10,"targets":[1,3,6],"durationSlots":4},
  {"id":"raid-20","name":"Large raid","size":20,"targets":[2,4,14],"durationSlots":6}
],"checkinDeadline":null}'::jsonb as value;

select ok(public.valid_settings((select value from raid_settings)), 'accepts three independent compositions');
select ok(not public.valid_settings(jsonb_set((select value from raid_settings), '{raids,0,targets}', '[2,2,7]')), 'rejects incorrect raid totals');
select ok(not public.valid_settings(jsonb_set((select value from raid_settings), '{raids,1,id}', '"raid-10-1"')), 'rejects duplicate raid IDs');
select ok(not public.valid_settings(jsonb_set((select value from raid_settings), '{raids,0,targets}', '[1.5,2.5,6]')), 'rejects fractional role slots');
select ok(not public.valid_settings('{"raids":null}'), 'rejects malformed raid lists');

insert into public.guilds (id, name, timezone, day_start_hour, slots_per_day, settings)
select '88888888-0000-4000-8000-000000000001', 'Raids test', 'UTC', 12, 24, value from raid_settings;
select lives_ok($$
  insert into public.plans (guild_id, week, raid_id, start, team) values
  ('88888888-0000-4000-8000-000000000001', '2026-10-05', 'raid-10-1', 1000, '[]'),
  ('88888888-0000-4000-8000-000000000001', '2026-10-05', 'raid-10-2', 2000, '[]'),
  ('88888888-0000-4000-8000-000000000001', '2026-10-05', 'raid-20', 3000, '[]');
$$, 'stores all three plans in the same week');
select is((select count(*)::int from public.plans where guild_id = '88888888-0000-4000-8000-000000000001'), 3, 'one raid cannot replace another');
select * from finish();
rollback;
