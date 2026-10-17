-- Raid-Helper-style sign-up posts: occurrences, queueing, Discord sign-ups written into check-ins,
-- and the scheduler. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a3', 'officer3@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000b3', 'player3@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'outsider3@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a3', 'discord', '631111111111111111', '{"sub": "631111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b3', 'discord', '641111111111111111', '{"sub": "641111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c3', 'discord', '691111111111111111', '{"sub": "691111111111111111"}', now(), now(), now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('role', 'service_role', true),
         set_config('request.jwt.claims', '{"role": "service_role"}', true)
$$;

-- `week` is this week; the raid starts in two days, so it is upcoming whatever today is.
-- `next_week` holds the scheduled raid (Wednesday 8 pm guild time).
create temp table t (guild uuid, week date, next_week date, start_ms bigint, revision bigint, job jsonb, signup uuid,
  signed_at timestamptz, version bigint);
grant select, insert, update on t to authenticated, service_role;
insert into t (week, next_week, start_ms) values (
  date_trunc('week', now() at time zone 'America/Los_Angeles')::date,
  date_trunc('week', now() at time zone 'America/Los_Angeles')::date + 7,
  (extract(epoch from date_trunc('hour', now()) + interval '2 days') * 1000)::bigint);

create function pg_temp.save(changes jsonb) returns void language plpgsql as $$
declare r bigint;
begin
  r := public.apply_guild_changes((select guild from t), (select revision from t), changes);
  update t set revision = r;
end $$;
create function pg_temp.plan(p_start bigint, p_cancelled boolean) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('table','plans','kind','upsert','rows', jsonb_build_array(jsonb_build_object(
    'guild_id', t.guild, 'week', t.week, 'raid_id', 'raid-20', 'start', p_start, 'team', '[]'::jsonb,
    'locked', '[]'::jsonb, 'attendance', '{}'::jsonb, 'cancelled', p_cancelled, 'published', null))))
  from t
$$;
create function pg_temp.signup(interaction text, discord_id text, status text, character_id text default null,
  message text default '755555555555555556') returns jsonb language sql as $$
  select public.signup_from_discord(interaction, discord_id, '744444444444444445', '733333333333333334', message,
    (select signup from t), status, character_id)
$$;
create function pg_temp.window_ranges() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('start', start_ms, 'end', start_ms + 10800000)) from t
$$;
-- A sign-up bumps the guild revision; tests that save afterwards start from the current one.
create function pg_temp.sync_revision() returns void language sql as $$
  update t set revision = (select revision from public.guild_revisions where guild_id = t.guild)
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
update t set guild = public.create_guild(jsonb_build_object(
  'name', 'Sign-ups', 'timezone', 'America/Los_Angeles', 'dayStartHour', 17, 'slotsPerDay', 14,
  'settings', jsonb_build_object('checkinDeadline', null, 'raids', jsonb_build_array(
    jsonb_build_object('id', 'raid-20', 'name', '20-player Raid', 'size', 20, 'targets', '[2,4,14]'::jsonb, 'durationSlots', 6),
    jsonb_build_object('id', 'raid-10', 'name', '10-player Raid', 'size', 10, 'targets', '[1,2,7]'::jsonb, 'durationSlots', 6,
      'series', jsonb_build_object('startDate', (select week from t) - 7, 'endDate', (select week from t) + 60,
        'day', 2, 'minutes', 1200, 'timezone', 'America/Los_Angeles'))))),
  '{"id": "m-officer", "name": "Sam"}'), revision = 0;
select pg_temp.save(jsonb_build_array(
  jsonb_build_object('table','members','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select guild from t),'id','m-player','name','Nova',
      'discord_id','641111111111111111','is_officer',false,'position',1),
    jsonb_build_object('guild_id',(select guild from t),'id','m-solo','name','Brick',
      'discord_id','651111111111111111','is_officer',false,'position',2))),
  jsonb_build_object('table','characters','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select guild from t),'id','c-mage','member_id','m-player',
      'name','Starfall','realm','Whitemane','spec','Frost','class','Mage','role','DPS','main',true,'retired',false,'position',0),
    jsonb_build_object('guild_id',(select guild from t),'id','c-priest','member_id','m-player',
      'name','Hallow','realm','Whitemane','spec','Holy','class','Priest','role','Healer','main',false,'retired',false,'position',1),
    jsonb_build_object('guild_id',(select guild from t),'id','c-war','member_id','m-solo',
      'name','Bulwark','realm','Whitemane','spec','Protection','class','Warrior','role','Tank','main',true,'retired',false,'position',2))),
  jsonb_build_object('table','availability_templates','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select guild from t),'member_id','m-solo','template', jsonb_build_object(
      'timezone','America/Los_Angeles','dayStartHour',17,'slotsPerDay',14,'fromWeek',(select week from t),'slots','[2,3]'::jsonb))))));
select pg_temp.save(pg_temp.plan((select start_ms from t), false));

-- Occurrences and schedule expansion (internal helpers: not callable by signed-in users).
reset role;
select results_eq($$ select start_ms, end_ms, cancelled, published from public.raid_occurrence((select guild from t), (select week from t), 'raid-20') $$,
  $$ select (select start_ms from t), (select start_ms from t) + 10800000, false, false $$,
  'a draft plan sets the raid time');
select is((select start_ms from public.raid_occurrence((select guild from t), (select next_week from t), 'raid-10')),
  (extract(epoch from (((select next_week from t) + 2)::timestamp + interval '20 hours') at time zone 'America/Los_Angeles') * 1000)::bigint,
  'a weekly schedule sets the raid time when there is no plan');
select is((select count(*)::int from public.raid_occurrence((select guild from t), (select week from t) + 70, 'raid-10')), 0,
  'there is no occurrence after the schedule ends');
select is(public.template_ranges(jsonb_build_object('timezone','America/Los_Angeles','dayStartHour',17,'slotsPerDay',14,
    'fromWeek',(select week from t),'slots','[2,3]'::jsonb), (select week from t)),
  jsonb_build_array(jsonb_build_object(
    'start', (extract(epoch from ((select week from t)::timestamp + interval '18 hours') at time zone 'America/Los_Angeles') * 1000)::bigint,
    'end', (extract(epoch from ((select week from t)::timestamp + interval '19 hours') at time zone 'America/Los_Angeles') * 1000)::bigint)),
  'a usual schedule expands into merged UTC ranges');

-- Officers queue a post; it needs the bot channel.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.queue_signup_post((select guild from t), (select week from t), 'raid-20') $$,
  '22023', null, 'a sign-up post needs a bot channel');
select public.set_guild_discord((select guild from t), '', false, '733333333333333334');
select pg_temp.save(jsonb_build_array(jsonb_build_object('table','guilds','kind','update','rows', jsonb_build_array(
  (select to_jsonb(g) || '{"discord_server_id": "744444444444444445"}'::jsonb from public.guilds g where g.id = (select guild from t))))));
select throws_ok($$ select public.queue_signup_post((select guild from t), (select week from t), 'raid-404') $$,
  '22023', null, 'a raid without a time cannot be posted');
select throws_ok($$ select public.queue_signup_post((select guild from t), (select week from t) + 1, 'raid-20') $$,
  '22023', null, 'a week must start on Monday');
update t set signup = public.queue_signup_post((select guild from t), (select week from t), 'raid-20');
select isnt((select signup from t), null, 'officers queue a sign-up post');
select is((select posted from public.get_signup_post((select guild from t), (select week from t), 'raid-20')), false,
  'which is not posted yet');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$ select public.queue_signup_post((select guild from t), (select week from t), 'raid-20') $$,
  '42501', null, 'players cannot queue sign-up posts');

-- The worker sends it.
select pg_temp.as_worker();
update t set job = public.claim_discord_delivery((select guild from t));
select is((select job ->> 'kind' from t), 'signup', 'the worker claims the sign-up post');
select is(public.raid_signup_payload((select (job->>'id')::uuid from t), (select (job->>'lease_token')::uuid from t))
    - 'guildId' - 'week' - 'start' - 'end',
  '{"raidId": "raid-20", "guildName": "Sign-ups", "raidName": "20-player Raid", "targets": [2, 4, 14],
    "cancelled": false, "published": false, "closed": false, "signups": []}'::jsonb,
  'the post shows the raid and no sign-ups yet');
select public.checkpoint_discord_delivery((select (job->>'id')::uuid from t), (select (job->>'lease_token')::uuid from t),
  '["755555555555555556"]');
select public.finish_discord_delivery((select (job->>'id')::uuid from t), (select (job->>'lease_token')::uuid from t),
  (select (job->>'version')::bigint from t));

-- Sign-ups from Discord.
select is(pg_temp.signup('766666666666666601', '641111111111111111', 'signed', null, '799999999999999999') ->> 'outcome',
  'unknown', 'a press on another message is refused');
select is(pg_temp.signup('766666666666666602', '699999999999999999', 'signed') ->> 'outcome',
  'not-member', 'a stranger cannot sign up');
select is(pg_temp.signup('766666666666666603', '641111111111111111', 'signed') -> 'characters' -> 0 ->> 'id',
  'c-mage', 'a player with two characters is asked to choose, main first');
select is(pg_temp.signup('766666666666666604', '641111111111111111', 'signed', 'c-war') ->> 'outcome',
  'bad-character', 'a player cannot sign up with someone else''s character');
reset role;
select pg_temp.sync_revision();
select pg_temp.as_worker();
select is(pg_temp.signup('766666666666666605', '641111111111111111', 'signed', 'c-priest') ->> 'character',
  'Hallow', 'the player signs up with the chosen character');
reset role;
select results_eq($$ select status, character_id, after_deadline from public.raid_signups where member_id = 'm-player' $$,
  $$ values ('signed', 'c-priest', false) $$, 'the sign-up is recorded');
select is((select ranges from public.checkins where guild_id = (select guild from t) and member_id = 'm-player'),
  pg_temp.window_ranges(), 'the raid time becomes the player''s availability');
select is((select raid_preferences -> 'raid-20' from public.checkins where guild_id = (select guild from t) and member_id = 'm-player'),
  '{"participating": true, "declined": ["c-mage"]}'::jsonb, 'only the chosen character is offered for that raid');
select ok((select revision from public.guild_revisions where guild_id = (select guild from t)) > (select revision from t),
  'the guild revision moves on, so open apps reload instead of overwriting');
select results_eq($$ select status, version from public.discord_deliveries where id = (select signup from t) $$,
  $$ values ('pending'::text, 2::bigint) $$, 'the post is queued to show the new sign-up');
update t set signed_at = (select signed_at from public.raid_signups where member_id = 'm-player');

select pg_temp.as_worker();
select is(pg_temp.signup('766666666666666605', '641111111111111111', 'late', 'c-priest') ->> 'outcome',
  'duplicate', 'the same signed press cannot be applied twice');
select is(pg_temp.signup('766666666666666606', '641111111111111111', 'tentative') ->> 'outcome', 'saved',
  'the player switches to tentative');
reset role;
select results_eq($$ select status, character_id, signed_at = (select signed_at from t) from public.raid_signups where member_id = 'm-player' $$,
  $$ values ('tentative', 'c-priest', true) $$, 'keeping the character and their place');
select is((select ranges from public.checkins where guild_id = (select guild from t) and member_id = 'm-player'), '[]'::jsonb,
  'the raid time is no longer firm');
select is((select availability -> 'tentative' from public.checkins where guild_id = (select guild from t) and member_id = 'm-player'),
  pg_temp.window_ranges(), 'it is tentative instead');
select pg_temp.sync_revision();
select pg_temp.as_worker();
select is(pg_temp.signup('766666666666666699', '641111111111111111', 'tentative') ->> 'outcome', 'saved',
  'pressing the same answer again is acknowledged');
reset role;
select is((select revision from public.guild_revisions where guild_id = (select guild from t)), (select revision from t),
  'but writes nothing, so open apps do not reload');

select pg_temp.as_worker();
select is(pg_temp.signup('766666666666666607', '641111111111111111', 'absent') ->> 'outcome', 'saved', 'the player reports absent');
reset role;
select is((select raid_preferences -> 'raid-20' ->> 'participating' from public.checkins where guild_id = (select guild from t) and member_id = 'm-player'),
  'false', 'and is not offered for that raid');

select pg_temp.as_worker();
select is(pg_temp.signup('766666666666666608', '651111111111111111', 'late') ->> 'character', 'Bulwark',
  'a player with one character signs up late without choosing');
reset role;
select is((select ranges from public.checkins where guild_id = (select guild from t) and member_id = 'm-solo'),
  public.multirange_to_ranges(public.ranges_to_multirange(public.template_ranges(
    (select template from public.availability_templates where member_id = 'm-solo'), (select week from t)))
    + public.ranges_to_multirange(pg_temp.window_ranges())),
  'their usual schedule is kept alongside the raid time');

select pg_temp.as_worker();
update t set job = public.claim_discord_delivery((select guild from t));
select is((select jsonb_agg(s ->> 'status') from jsonb_array_elements(
    public.raid_signup_payload((select (job->>'id')::uuid from t), (select (job->>'lease_token')::uuid from t)) -> 'signups') s),
  '["absent", "late"]'::jsonb, 'the post lists sign-ups in order; reporting absent moves a player to the back');
select public.finish_discord_delivery((select (job->>'id')::uuid from t), (select (job->>'lease_token')::uuid from t),
  (select (job->>'version')::bigint from t));

-- Members see the week's sign-ups; outsiders do not.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from public.get_raid_signups((select guild from t), (select week from t))), 2,
  'guild members see the sign-ups');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ select * from public.get_raid_signups((select guild from t), (select week from t)) $$,
  '42501', null, 'outsiders cannot');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$ select pg_temp.signup('766666666666666609', '641111111111111111', 'signed', 'c-mage') $$,
  '42501', null, 'signed-in users cannot call the Discord sign-up function');

-- After the weekly check-in deadline, sign-ups still count and are flagged.
reset role;
select pg_temp.sync_revision();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select pg_temp.save(jsonb_build_array(jsonb_build_object('table','guilds','kind','update','rows', jsonb_build_array(
  (select to_jsonb(g) || jsonb_build_object('settings', g.settings || '{"checkinDeadline": {"day": 0, "minutes": 0}}'::jsonb)
    from public.guilds g where g.id = (select guild from t))))));
select pg_temp.as_worker();
select is(pg_temp.signup('766666666666666610', '641111111111111111', 'signed', 'c-mage') ->> 'afterDeadline', 'true',
  'a sign-up after the deadline is accepted and flagged');

-- Cancelling the raid updates the post and closes sign-ups.
reset role;
select pg_temp.sync_revision();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select pg_temp.save(pg_temp.plan((select start_ms from t), true));
reset role;
select is((select status from public.discord_deliveries where id = (select signup from t)), 'pending',
  'a cancelled raid queues an update of its post');
select pg_temp.as_worker();
select is(pg_temp.signup('766666666666666611', '641111111111111111', 'signed', 'c-mage') ->> 'outcome', 'closed',
  'sign-ups for a cancelled raid are refused');

-- The scheduler posts raids inside the lead time and closes raids that started.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select public.set_raid_reminders((select guild from t), '{"signup_enabled": true, "signup_lead_days": 14}');
select is((public.get_raid_reminders((select guild from t)) ->> 'signup_lead_days')::int, 14,
  'officers turn sign-up posts on with a lead time');
select pg_temp.as_worker();
select public.enqueue_due_raid_reminders();
reset role;
select is((select count(*)::int from public.discord_deliveries where guild_id = (select guild from t)
  and delivery_key = 'signup:' || (select next_week from t)::text || '/raid-10'), 1,
  'a scheduled raid inside the lead time gets a sign-up post');
select is((select count(*)::int from public.discord_deliveries where guild_id = (select guild from t)
  and kind = 'signup' and raid_id = 'raid-20' and delivery_key <> 'signup:' || (select week from t)::text || '/raid-20'), 0,
  'a cancelled raid does not get a new post');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select pg_temp.save(pg_temp.plan((extract(epoch from now() - interval '1 hour') * 1000)::bigint, false));
select pg_temp.as_worker();
select public.enqueue_due_raid_reminders();
reset role;
select is((select payload from public.discord_deliveries where id = (select signup from t)), '{"closed": true}'::jsonb,
  'a raid that started has its post closed');
update t set version = (select version from public.discord_deliveries where id = (select signup from t));
select pg_temp.as_worker();
select is(pg_temp.signup('766666666666666612', '641111111111111111', 'signed', 'c-mage') ->> 'outcome', 'closed',
  'and sign-ups are refused');
select public.enqueue_due_raid_reminders();
reset role;
select is((select version from public.discord_deliveries where id = (select signup from t)), (select version from t),
  'closing happens once');

select * from finish();
rollback;
