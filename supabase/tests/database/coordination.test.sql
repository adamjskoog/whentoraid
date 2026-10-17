-- Availability kinds, raid rules and schedules, and Discord response buttons. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a2', 'officer2@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', 'player2@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a2', 'discord', '611111111111111111', '{"sub": "611111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', 'discord', '622222222222222222', '{"sub": "622222222222222222"}', now(), now(), now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('role', 'service_role', true),
         set_config('request.jwt.claims', '{"role": "service_role"}', true)
$$;

create temp table t (guild uuid, week date, start_ms bigint, revision bigint, job jsonb);
grant select, insert, update on t to authenticated, service_role;
insert into t (week, start_ms) values (
  date_trunc('week', now() at time zone 'America/Los_Angeles')::date + 7,
  (extract(epoch from now() + interval '8 days') * 1000)::bigint);

create function pg_temp.save(changes jsonb) returns void language plpgsql as $$
declare r bigint;
begin
  r := public.apply_guild_changes((select guild from t), (select revision from t), changes);
  update t set revision = r;
end $$;
create function pg_temp.checkin(availability jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('table','checkins','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id', t.guild, 'week', t.week, 'member_id', 'm-player', 'checked_in', true,
      'ranges', '[]'::jsonb, 'declined', '[]'::jsonb, 'raid_preferences', '{}'::jsonb, 'availability', availability))))
  from t
$$;
create function pg_temp.settings(raid_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('table','guilds','kind','update','rows', jsonb_build_array(
    to_jsonb(g) || jsonb_build_object('settings', jsonb_build_object('checkinDeadline', null, 'raids', jsonb_build_array(
      jsonb_build_object('id','raid-20','name','20-player Raid','size',20,'targets','[2,4,14]'::jsonb,'durationSlots',6) || raid_extra))))))
  from public.guilds g where g.id = (select guild from t)
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
update t set guild = public.create_guild(
  '{"name": "Coordination", "timezone": "America/Los_Angeles", "dayStartHour": 17, "slotsPerDay": 14,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}'), revision = 0;
select pg_temp.save(jsonb_build_array(
  jsonb_build_object('table','members','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select guild from t),'id','m-player','name','Nova',
      'discord_id','622222222222222222','is_officer',false,'position',1))),
  jsonb_build_object('table','characters','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select guild from t),'id','c-main','member_id','m-player',
      'name','Starfall','realm','Whitemane','spec','Frost','class','Mage','role','DPS','main',true,'retired',false,'position',0)))));

-- Availability kinds round-trip through the atomic save and are validated server-side.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select pg_temp.save(pg_temp.checkin(jsonb_build_object(
  'tentative', '[{"start": 1, "end": 2}]'::jsonb, 'absent', jsonb_build_array((select week from t)::text)))) $$,
  'a player saves tentative times and an absence');
reset role;
select is((select availability -> 'tentative' from public.checkins where guild_id = (select guild from t)),
  '[{"start": 1, "end": 2}]'::jsonb, 'tentative times are stored');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select pg_temp.save(pg_temp.checkin('{"tentative": [{"start": 5, "end": 2}]}')) $$,
  '23514', null, 'reversed tentative times are refused');
select throws_ok($$ select pg_temp.save(pg_temp.checkin(jsonb_build_object('absent', jsonb_build_array(((select week from t) + 9)::text)))) $$,
  '23514', null, 'an absence outside the check-in week is refused');
select throws_ok($$ select pg_temp.save(pg_temp.checkin('{"maybe": []}')) $$,
  '23514', null, 'unknown availability fields are refused');

-- Rows from clients older than the availability column still save, and keep stored availability.
select lives_ok($$ select pg_temp.save(jsonb_build_array(jsonb_build_object('table','checkins','kind','upsert','rows', jsonb_build_array(
  jsonb_build_object('guild_id', (select guild from t), 'week', (select week from t), 'member_id', 'm-player', 'checked_in', true,
    'ranges', '[]'::jsonb, 'declined', '[]'::jsonb, 'raid_preferences', '{}'::jsonb))))) $$,
  'a check-in without the availability column saves');
reset role;
select is((select availability -> 'tentative' from public.checkins where guild_id = (select guild from t)),
  '[{"start": 1, "end": 2}]'::jsonb, 'and keeps the availability already stored');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select pg_temp.save(jsonb_build_array(jsonb_build_object('table','checkins','kind','upsert','rows', jsonb_build_array(
  jsonb_build_object('guild_id', (select guild from t), 'week', (select week from t) + 7, 'member_id', 'm-player', 'checked_in', true,
    'ranges', '[]'::jsonb, 'declined', '[]'::jsonb, 'raid_preferences', '{}'::jsonb))))) $$,
  'a new check-in from an older client saves');
reset role;
select is((select availability from public.checkins where guild_id = (select guild from t) and week = (select week from t) + 7),
  '{}'::jsonb, 'with empty availability');

-- Raid rules and weekly schedules.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ select pg_temp.save(pg_temp.settings(jsonb_build_object(
  'rules', '{"classLimits": {"Mage": 2}, "priority": "mains", "requiredUtilities": [{"id": "control", "name": "Control", "eligible": [{"class": "Mage", "spec": "Frost"}, {"class": "Warlock"}]}]}'::jsonb,
  'series', '{"startDate": "2026-10-05", "endDate": "2027-10-04", "day": 1, "minutes": 1140, "timezone": "America/Los_Angeles", "exceptions": {"2026-10-12": {"cancelled": true}}, "changes": [{"fromWeek": "2026-11-02", "day": 2, "minutes": 1200}]}'::jsonb))) $$,
  'officers save composition rules and a weekly schedule');
select throws_ok($$ select pg_temp.save(pg_temp.settings('{"rules": {"classLimits": {"Mage": 41}}}')) $$,
  '23514', null, 'a class limit above the raid size is refused');
select throws_ok($$ select pg_temp.save(pg_temp.settings('{"rules": {"requiredUtilities": [{"id": "x", "name": "X", "eligible": [{"class": "Mage", "spec": "Holy"}]}]}}')) $$,
  '23514', null, 'a specialization of another class is refused');
select throws_ok($$ select pg_temp.save(pg_temp.settings('{"rules": {"priority": "gear"}}')) $$,
  '23514', null, 'an unknown roster priority is refused');
select throws_ok($$ select pg_temp.save(pg_temp.settings('{"series": {"startDate": "2026-10-05", "endDate": "2027-11-09", "day": 0, "minutes": 1140, "timezone": "America/Los_Angeles"}}')) $$,
  '23514', null, 'a schedule longer than a year is refused');
select throws_ok($$ select pg_temp.save(pg_temp.settings('{"series": {"startDate": "2026-10-05", "endDate": "2026-11-09", "day": 0, "minutes": 1141, "timezone": "America/Los_Angeles"}}')) $$,
  '23514', null, 'a start time off the half hour is refused');
select throws_ok($$ select pg_temp.save(pg_temp.settings('{"series": {"startDate": "2026-10-05", "endDate": "2026-11-09", "day": 0, "minutes": 1140, "timezone": "America/Los_Angeles", "exceptions": {"2026-10-06": {"cancelled": true}}}}')) $$,
  '23514', null, 'an exception that is not a week is refused');
select throws_ok($$ select pg_temp.save(pg_temp.settings('{"series": {"timezone": "America/Los_Angeles"}}')) $$,
  '23514', null, 'a schedule without dates or a time is refused');
select throws_ok($$ select pg_temp.save(pg_temp.settings('{"series": {"startDate": "2026-10-05", "endDate": "2026-11-09", "day": 0, "minutes": 1140, "timezone": "America/Los_Angeles", "changes": [{"day": 1, "minutes": 60}]}}')) $$,
  '23514', null, 'a schedule change without a starting week is refused');
select throws_ok($$ select pg_temp.save(pg_temp.settings('{"series": {"startDate": "2026-10-05", "endDate": "2026-11-09", "day": 0, "minutes": 1140, "timezone": "America/Los_Angeles", "exceptions": {"2026-10-12": {"day": 1}}}}')) $$,
  '23514', null, 'a moved week without a time is refused');
select throws_ok($$ select pg_temp.save(pg_temp.settings('{"rules": {"requiredUtilities": [{"name": "X", "eligible": [{"class": "Mage"}]}]}}')) $$,
  '23514', null, 'a required utility without an identifier is refused');

-- Bot channels and Discord responses.
select throws_ok($$ select public.set_guild_discord((select guild from t), '', false, '12') $$,
  '22023', null, 'a malformed channel id is refused');
select public.set_guild_discord((select guild from t), '', true, '733333333333333333');
select is((select channel_id from public.get_guild_discord((select guild from t))), '733333333333333333',
  'officers set a bot channel without a webhook');
select pg_temp.save(jsonb_build_array(
  jsonb_build_object('table','guilds','kind','update','rows', jsonb_build_array(
    (select to_jsonb(g) || '{"discord_server_id": "744444444444444444"}'::jsonb from public.guilds g where g.id = (select guild from t)))),
  jsonb_build_object('table','plans','kind','upsert','rows', jsonb_build_array(jsonb_build_object(
    'guild_id', (select guild from t), 'week', (select week from t), 'raid_id', 'raid-20', 'start', (select start_ms from t),
    'team', '[{"memberId":"m-player","characterId":"c-main","role":"DPS"}]'::jsonb, 'locked', '[]'::jsonb,
    'attendance', '{}'::jsonb, 'cancelled', false,
    'published', jsonb_build_object('start', (select start_ms from t), 'end', (select start_ms from t) + 10800000,
      'publishedAt', 1000, 'day', 1, 'startSlot', 2, 'raidName', '20-player Raid', 'targets', '[2,4,14]'::jsonb,
      'team', '[{"memberId":"m-player","characterId":"c-main","role":"DPS"}]'::jsonb))))));
select public.queue_discord_delivery((select guild from t), (select week from t), 'raid-20');
select pg_temp.as_worker();
update t set job = public.claim_discord_delivery((select guild from t));
select is((select job ->> 'channel_id' from t), '733333333333333333', 'the worker receives the bot channel');
select public.checkpoint_discord_delivery((select (job->>'id')::uuid from t), (select (job->>'lease_token')::uuid from t),
  '["755555555555555555"]');
select public.finish_discord_delivery((select (job->>'id')::uuid from t), (select (job->>'lease_token')::uuid from t),
  (select (job->>'version')::bigint from t));

create function pg_temp.press(discord_id text, server text, channel text, message text, version bigint, status text)
returns jsonb language sql as $$
  select public.respond_to_discord_raid('766666666666666666', discord_id, server, channel, message,
    (select (job->>'id')::uuid from t), version, status)
$$;
select is(pg_temp.press('622222222222222222', '744444444444444444', '733333333333333333', '755555555555555555', 1, 'confirmed') ->> 'outcome',
  'saved', 'a rostered player confirms from Discord');
select is((select status from public.raid_responses where guild_id = (select guild from t)), 'confirmed',
  'and the response is stored');
select is(pg_temp.press('622222222222222222', '744444444444444444', '733333333333333333', '755555555555555555', 1, 'confirmed') ->> 'outcome',
  'duplicate', 'the same signed press cannot be applied twice');
select is(pg_temp.press('611111111111111111', '744444444444444444', '733333333333333333', '755555555555555555', 1, 'confirmed') ->> 'outcome',
  'not-rostered', 'an officer who is not rostered cannot respond');
select is(pg_temp.press('699999999999999999', '744444444444444444', '733333333333333333', '755555555555555555', 1, 'confirmed') ->> 'outcome',
  'not-member', 'a stranger cannot respond');
select is(pg_temp.press('622222222222222222', '744444444444444444', '733333333333333333', '755555555555555555', 0, 'unavailable') ->> 'outcome',
  'stale', 'a press on an outdated post is refused');
select is(pg_temp.press('622222222222222222', '788888888888888888', '733333333333333333', '755555555555555555', 1, 'unavailable') ->> 'outcome',
  'unknown', 'a press from another Discord server is refused');

select is(public.respond_to_discord_raid('766666666666666667', '622222222222222222',
  '744444444444444444', '733333333333333333', '755555555555555555',
  (select (job->>'id')::uuid from t), 1, 'tentative') ->> 'outcome',
  'saved', 'a rostered player can answer tentative from Discord');
select is((select status from public.raid_responses where guild_id = (select guild from t)), 'tentative',
  'the Discord tentative response replaces the earlier confirmation');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select pg_temp.press('622222222222222222', '744444444444444444', '733333333333333333', '755555555555555555', 1, 'confirmed') $$,
  '42501', null, 'signed-in users cannot call the Discord response function');

select * from finish();
rollback;
