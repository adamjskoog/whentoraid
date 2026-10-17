-- Spec pick at Discord sign-up: a spec chosen for one raid is stored on the sign-up and in the
-- check-in, benches by its role, and is cleared by choosing the saved spec or another character.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into public.guilds (id, name, timezone, day_start_hour, slots_per_day, discord_server_id, settings) values
  ('00000000-0000-0000-0000-00000000e001', 'Specs', 'UTC', 17, 14, '744444444444444445',
    jsonb_build_object('checkinDeadline', null, 'raids', jsonb_build_array(jsonb_build_object('id', 'raid-10',
      'name', '10-player Raid', 'size', 3, 'targets', '[1,2,0]'::jsonb, 'durationSlots', 6))));
insert into public.guild_discord (guild_id, webhook_url, channel_id) values
  ('00000000-0000-0000-0000-00000000e001', null, '733333333333333334');
insert into public.members (guild_id, id, name, discord_id, is_officer, position) values
  ('00000000-0000-0000-0000-00000000e001', 'm-druid', 'Mal', '700000000000000001', false, 0),
  ('00000000-0000-0000-0000-00000000e001', 'm-tank', 'Brick', '700000000000000002', false, 1);
insert into public.characters (guild_id, id, member_id, name, realm, spec, class, role, main, position) values
  ('00000000-0000-0000-0000-00000000e001', 'c-druid', 'm-druid', 'Malfurion', 'R', 'Restoration', 'Druid', 'Healer', true, 0),
  ('00000000-0000-0000-0000-00000000e001', 'c-mage', 'm-druid', 'Starfall', 'R', 'Frost', 'Mage', 'DPS', false, 1),
  ('00000000-0000-0000-0000-00000000e001', 'c-war', 'm-tank', 'Bulwark', 'R', 'Protection', 'Warrior', 'Tank', true, 2);
-- The raid starts in two days, so sign-ups are open whatever today is.
insert into public.plans (guild_id, week, raid_id, start, team, locked, attendance, cancelled, published) values
  ('00000000-0000-0000-0000-00000000e001', date_trunc('week', now() + interval '2 days')::date, 'raid-10',
    (extract(epoch from date_trunc('hour', now()) + interval '2 days') * 1000)::bigint, '[]', '[]', '{}', false, null);
insert into public.discord_deliveries (id, guild_id, delivery_key, week, raid_id, kind, payload, webhook_fingerprint, message_ids)
select '00000000-0000-0000-0000-00000000e0d1', '00000000-0000-0000-0000-00000000e001',
  'signup:' || p.week || '/raid-10', p.week, 'raid-10', 'signup', '{}', md5('bot:733333333333333334'), '["755555555555555556"]'
from public.plans p where p.guild_id = '00000000-0000-0000-0000-00000000e001';

create function pg_temp.signup(interaction text, discord_id text, status text, character_id text default null)
returns jsonb language sql as $$
  select public.signup_from_discord(interaction, discord_id, '744444444444444445', '733333333333333334',
    '755555555555555556', '00000000-0000-0000-0000-00000000e0d1', status, character_id)
$$;
create function pg_temp.spec(interaction text, discord_id text, spec text, role text) returns jsonb language sql as $$
  select public.signup_spec_from_discord(interaction, discord_id, '744444444444444445', '733333333333333334',
    '755555555555555556', '00000000-0000-0000-0000-00000000e0d1', spec, role)
$$;
create function pg_temp.mine() returns public.raid_signups language sql as $$
  select * from public.raid_signups where guild_id = '00000000-0000-0000-0000-00000000e001' and member_id = 'm-druid'
$$;
create function pg_temp.signed_as() returns jsonb language sql as $$
  select raid_preferences -> 'raid-10' -> 'signedAs' from public.checkins
  where guild_id = '00000000-0000-0000-0000-00000000e001' and member_id = 'm-druid'
$$;

-- The catalog matches the composition-rule spec check for every class.
select is((select count(*)::int from unnest(array['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Shaman', 'Mage',
    'Warlock', 'Druid']) c, jsonb_array_elements(public.class_spec_roles(c)) x
  where not public.valid_class_spec(c, x ->> 'spec')), 0, 'every offered spec is a real spec of its class');
select is(public.class_spec_roles('Druid') -> 1, '{"spec": "Feral Combat", "role": "Tank"}'::jsonb,
  'Feral Combat is offered as a tank and as DPS');

select pg_temp.signup('800000000000000001', '700000000000000002', 'signed');
select is(pg_temp.signup('800000000000000002', '700000000000000001', 'signed', 'c-druid')
    - 'guildId' - 'raidName' - 'afterDeadline' - 'specs',
  '{"outcome": "saved", "status": "signed", "character": "Malfurion", "class": "Druid", "spec": "Restoration", "role": "Healer"}'::jsonb,
  'a sign-up confirms the saved spec');
select is(jsonb_array_length(pg_temp.signup('800000000000000003', '700000000000000001', 'signed', 'c-druid') -> 'specs'), 4,
  'and lists the specs the character can change to');

select is(pg_temp.spec('800000000000000004', '700000000000000001', 'Feral Combat', 'Tank') ->> 'role', 'Tank',
  'choosing Feral Combat as a tank is saved');
select is((select (s.spec, s.role)::text from pg_temp.mine() s), '("Feral Combat",Tank)', 'on the sign-up');
select is(pg_temp.signed_as(), '{"characterId": "c-druid", "spec": "Feral Combat", "role": "Tank"}'::jsonb,
  'and in the check-in for the planner');
select is(public.signup_standing('00000000-0000-0000-0000-00000000e0d1', '700000000000000001'),
  '{"role": "Tank", "place": 2, "target": 1, "bench": true}'::jsonb, 'the bench follows the chosen role');
select is(pg_temp.spec('800000000000000004', '700000000000000001', 'Balance', 'DPS') ->> 'outcome', 'duplicate',
  'a replayed interaction changes nothing');

select is((pg_temp.signup('800000000000000005', '700000000000000001', 'late', 'c-druid') ->> 'spec'), 'Feral Combat',
  'moving to Late on the same character keeps the spec');
select is(pg_temp.signed_as() ->> 'spec', 'Feral Combat', 'in the check-in too');

select is(pg_temp.spec('800000000000000006', '700000000000000001', 'Restoration', 'Healer') ->> 'spec', 'Restoration',
  'choosing the saved spec again is saved');
select is((select s.spec from pg_temp.mine() s), null, 'and clears the raid spec');
select is(pg_temp.signed_as(), null, 'from the check-in as well');

select pg_temp.spec('800000000000000007', '700000000000000001', 'Balance', 'DPS');
select pg_temp.signup('800000000000000008', '700000000000000001', 'signed', 'c-mage');
select is((select (s.character_id, s.spec)::text from pg_temp.mine() s), '(c-mage,)',
  'changing character drops the spec chosen for the other one');
select is(pg_temp.spec('800000000000000009', '700000000000000001', 'Holy', 'Healer') ->> 'outcome', 'bad-spec',
  'a spec the class cannot play is refused');

select pg_temp.signup('800000000000000010', '700000000000000001', 'absent');
select is(pg_temp.spec('800000000000000011', '700000000000000001', 'Fire', 'DPS') ->> 'outcome', 'not-signed',
  'an absent player has no spec to change');

select is(public.valid_raid_preferences('{"raid-10": {"participating": true, "declined": [],
  "signedAs": {"characterId": "c-druid", "spec": "Holy", "role": "Wizard"}}}'), false,
  'check-ins refuse a raid spec with an unknown role');

set local role authenticated;
select throws_ok($$ select public.signup_spec_from_discord('800000000000000012', '700000000000000001',
  '744444444444444445', '733333333333333334', '755555555555555556', '00000000-0000-0000-0000-00000000e0d1', 'Fire', 'DPS') $$,
  '42501', null, 'signed-in users cannot call it');

select * from finish();
rollback;
