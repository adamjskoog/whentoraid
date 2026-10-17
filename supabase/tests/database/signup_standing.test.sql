-- Where a Discord sign-up stands: roles fill in sign-up order up to the raid's targets, and later
-- sign-ups are benched. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.guilds (id, name, timezone, day_start_hour, slots_per_day, settings) values
  ('00000000-0000-0000-0000-00000000f001', 'Bench', 'UTC', 17, 14, jsonb_build_object('checkinDeadline', null,
    'raids', jsonb_build_array(jsonb_build_object('id', 'raid-10', 'name', '10-player Raid', 'size', 3,
      'targets', '[1,2,0]'::jsonb, 'durationSlots', 6))));
insert into public.members (guild_id, id, name, discord_id, is_officer, position)
select '00000000-0000-0000-0000-00000000f001', 'm-' || n, 'Player ' || n, '70000000000000000' || n, false, n
from generate_series(1, 6) n;
insert into public.characters (guild_id, id, member_id, name, realm, spec, class, role, main, position) values
  ('00000000-0000-0000-0000-00000000f001', 'c-1', 'm-1', 'Wall', 'R', 'Protection', 'Warrior', 'Tank', true, 0),
  ('00000000-0000-0000-0000-00000000f001', 'c-2', 'm-2', 'Bulwark', 'R', 'Protection', 'Warrior', 'Tank', true, 1),
  ('00000000-0000-0000-0000-00000000f001', 'c-3', 'm-3', 'Aegis', 'R', 'Protection', 'Paladin', 'Tank', true, 2),
  ('00000000-0000-0000-0000-00000000f001', 'c-4', 'm-4', 'Hallow', 'R', 'Holy', 'Priest', 'Healer', true, 3),
  ('00000000-0000-0000-0000-00000000f001', 'c-5', 'm-5', 'Starfall', 'R', 'Frost', 'Mage', 'DPS', true, 4);
insert into public.plans (guild_id, week, raid_id, start, team, locked, attendance, cancelled, published) values
  ('00000000-0000-0000-0000-00000000f001', '2030-01-07', 'raid-10', 1894305600000, '[]', '[]', '{}', false, null);
insert into public.discord_deliveries (id, guild_id, delivery_key, week, raid_id, kind, payload, webhook_fingerprint) values
  ('00000000-0000-0000-0000-00000000f0d1', '00000000-0000-0000-0000-00000000f001', 'signup:2030-01-07:raid-10',
    '2030-01-07', 'raid-10', 'signup', '{}', md5('bot:1')),
  ('00000000-0000-0000-0000-00000000f0d2', '00000000-0000-0000-0000-00000000f001', 'roster:2030-01-07:raid-10',
    '2030-01-07', 'raid-10', 'roster', '{}', md5('bot:1'));
-- Coming in this order: tanks 1, 2 (late) and 3, a healer and a DPS. Player 6 is only tentative.
insert into public.raid_signups (guild_id, week, raid_id, member_id, status, character_id, signed_at) values
  ('00000000-0000-0000-0000-00000000f001', '2030-01-07', 'raid-10', 'm-1', 'signed', 'c-1', '2030-01-01 10:00'),
  ('00000000-0000-0000-0000-00000000f001', '2030-01-07', 'raid-10', 'm-6', 'tentative', null, '2030-01-01 10:30'),
  ('00000000-0000-0000-0000-00000000f001', '2030-01-07', 'raid-10', 'm-2', 'late', 'c-2', '2030-01-01 11:00'),
  ('00000000-0000-0000-0000-00000000f001', '2030-01-07', 'raid-10', 'm-3', 'signed', 'c-3', '2030-01-01 12:00'),
  ('00000000-0000-0000-0000-00000000f001', '2030-01-07', 'raid-10', 'm-4', 'signed', 'c-4', '2030-01-01 13:00'),
  ('00000000-0000-0000-0000-00000000f001', '2030-01-07', 'raid-10', 'm-5', 'signed', 'c-5', '2030-01-01 14:00');

create function pg_temp.standing(discord_id text, delivery uuid default '00000000-0000-0000-0000-00000000f0d1')
returns jsonb language sql as $$ select public.signup_standing(delivery, discord_id) $$;

select is(pg_temp.standing('700000000000000001'), '{"role": "Tank", "place": 1, "target": 1, "bench": false}'::jsonb,
  'the first tank fills the only tank spot');
select is(pg_temp.standing('700000000000000002'), '{"role": "Tank", "place": 2, "target": 1, "bench": true}'::jsonb,
  'a later tank (even arriving late) is benched');
select is(pg_temp.standing('700000000000000003') ->> 'bench', 'true', 'the third tank is benched too');
select is(pg_temp.standing('700000000000000004') ->> 'bench', 'false', 'healers have room');
select is(pg_temp.standing('700000000000000005'), '{"role": "DPS", "place": 1, "target": 0, "bench": false}'::jsonb,
  'a target of 0 never benches');
select is(pg_temp.standing('700000000000000006'), null, 'a tentative player has no standing');
select is(pg_temp.standing('700000000000000001', '00000000-0000-0000-0000-00000000f0d2'), null,
  'only sign-up posts have standings');

set local role authenticated;
select throws_ok($$ select public.signup_standing('00000000-0000-0000-0000-00000000f0d1', '700000000000000001') $$,
  '42501', null, 'signed-in users cannot call it');

select * from finish();
rollback;
