-- Discord delivery outbox, calendar feeds and reminders. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'player@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000c1', 'second@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'discord', '511111111111111111', '{"sub": "511111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', 'discord', '522222222222222222', '{"sub": "522222222222222222"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c1', 'discord', '533333333333333333', '{"sub": "533333333333333333"}', now(), now(), now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('role', 'service_role', true),
         set_config('request.jwt.claims', '{"role": "service_role"}', true)
$$;

-- Everything shared between roles in this test.
create temp table t (guild uuid, week date, start_ms bigint, end_ms bigint, job jsonb, token text, revision bigint);
grant select, insert, update on t to authenticated, service_role;
insert into t (week, start_ms, end_ms) values (
  date_trunc('week', now() at time zone 'America/Los_Angeles')::date,
  (extract(epoch from now() + interval '2 hours') * 1000)::bigint,
  (extract(epoch from now() + interval '5 hours') * 1000)::bigint);

create function pg_temp.plan_row(team jsonb, published_at bigint, cancelled boolean default false, shift bigint default 0)
returns jsonb language sql as $$
  select jsonb_build_object('table','plans','kind','upsert','rows', jsonb_build_array(jsonb_build_object(
    'guild_id', t.guild, 'week', t.week, 'raid_id', 'raid-20', 'start', t.start_ms + shift, 'team', team,
    'locked', '[]'::jsonb, 'attendance', '{}'::jsonb, 'cancelled', cancelled,
    'published', jsonb_build_object('start', t.start_ms + shift, 'end', t.end_ms + shift, 'publishedAt', published_at,
      'day', 0, 'startSlot', 2, 'raidName', '20-player Raid', 'team', team, 'targets', '[2,4,14]'::jsonb))))
  from t
$$;
create function pg_temp.save(changes jsonb) returns void language plpgsql as $$
declare r bigint;
begin
  r := public.apply_guild_changes((select guild from t), (select revision from t), changes);
  update t set revision = r;
end $$;

create temp table team as select
  '[{"memberId":"m-player","characterId":"c-main","role":"DPS"},{"memberId":"m-second","characterId":"c-second","role":"Healer"}]'::jsonb as pair,
  '[{"memberId":"m-player","characterId":"c-main","role":"DPS"}]'::jsonb as one;
grant select on team to authenticated, service_role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
update t set guild = public.create_guild(
  '{"name": "Delivery", "timezone": "America/Los_Angeles", "dayStartHour": 17, "slotsPerDay": 14,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}'), revision = 0;
select pg_temp.save(jsonb_build_array(
  jsonb_build_object('table','members','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select guild from t),'id','m-player','name','Nova',
      'discord_id','522222222222222222','is_officer',false,'position',1),
    jsonb_build_object('guild_id',(select guild from t),'id','m-second','name','Rook',
      'discord_id','533333333333333333','is_officer',false,'position',2))),
  jsonb_build_object('table','characters','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select guild from t),'id','c-main','member_id','m-player',
      'name','Starfall','realm','Whitemane','spec','Frost','class','Mage','role','DPS','main',true,'retired',false,'position',0),
    jsonb_build_object('guild_id',(select guild from t),'id','c-second','member_id','m-second',
      'name','Mender','realm','Whitemane','spec','Holy','class','Priest','role','Healer','main',true,'retired',false,'position',0)))));

-- Without a channel, publishing queues nothing.
select pg_temp.save(jsonb_build_array(pg_temp.plan_row((select pair from team), 1000)));
reset role;
select is((select count(*)::int from public.discord_deliveries), 0, 'no channel, no delivery');
select is((select count(*)::int from public.raid_calendar_events where not cancelled and guild_id = (select guild from t)), 2,
  'publishing adds a calendar event for each rostered player');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.set_guild_discord((select guild from t),
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123', true);

-- Players cannot post; officers queue the first post.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.queue_discord_delivery((select guild from t), (select week from t), 'raid-20') $$,
  '42501', null, 'players cannot post rosters');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.queue_discord_delivery((select guild from t), (select week from t), 'raid-20') $$,
  'an officer queues the published roster');
select is((select status from public.get_discord_deliveries((select guild from t), (select week from t), 'raid-20')),
  'pending', 'the officer sees it pending');

-- Officers and players cannot run the worker.
select throws_ok($$ select public.claim_discord_delivery(null) $$, '42501', null, 'officers cannot claim deliveries');

-- The worker claims, records the message, and finishes.
select pg_temp.as_worker();
update t set job = public.claim_discord_delivery((select guild from t));
select is((select job ->> 'status' from t), 'sending', 'the worker claims the job');
select is((select job ->> 'webhook_url' from t),
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123', 'the claim carries the webhook');
select is((select jsonb_array_length(job -> 'payload' -> 'team') from t), 2, 'the payload lists the roster');
select is(public.claim_discord_delivery((select guild from t)), null, 'one delivery at a time per guild');
select throws_ok($$ select public.checkpoint_discord_delivery((select (job->>'id')::uuid from t), gen_random_uuid(), '["1300000000000000001"]') $$,
  '40001', null, 'a stale lease cannot record messages');
select lives_ok($$ select public.checkpoint_discord_delivery((select (job->>'id')::uuid from t),
  (select (job->>'lease_token')::uuid from t), '["1300000000000000001"]') $$, 'the worker records the message id');
select public.finish_discord_delivery((select (job->>'id')::uuid from t), (select (job->>'lease_token')::uuid from t),
  (select (job->>'version')::bigint from t));
select is((select status from public.discord_deliveries), 'sent', 'the delivery is sent');
select is((select posts -> ((select week from t)::text || '/raid-20') from public.guild_discord where guild_id = (select guild from t)),
  '["1300000000000000001"]'::jsonb, 'the channel remembers the message');

-- Republishing a posted roster queues an edit of the same message automatically.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.save(jsonb_build_array(pg_temp.plan_row((select one from team), 2000)));
reset role;
select is((select status || ':' || version || ':' || (message_ids ->> 0) from public.discord_deliveries),
  'pending:2:1300000000000000001', 'a republish queues an edit of the posted message');
select is((select count(*)::int from public.raid_calendar_events where cancelled and member_id = 'm-second'), 1,
  'a player removed from the roster gets a cancelled calendar event');

-- A failure retries with backoff, then gives up for an officer to retry.
select pg_temp.as_worker();
update t set job = public.claim_discord_delivery(null);
select public.finish_discord_delivery((select (job->>'id')::uuid from t), (select (job->>'lease_token')::uuid from t),
  (select (job->>'version')::bigint from t), 'Discord returned 500.');
select is((select status || ':' || last_error from public.discord_deliveries), 'pending:Discord returned 500.',
  'a failed send waits to retry');
select ok((select next_attempt_at > now() from public.discord_deliveries), 'with a delay');
select is(public.claim_discord_delivery(null), null, 'and is not claimed again before then');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.retry_discord_delivery((select guild from t), (select (job->>'id')::uuid from t)) $$,
  'an officer can retry now');

-- Personal calendar feeds.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
update t set token = public.create_raid_calendar((select guild from t));
select pg_temp.as_worker();
select is((select jsonb_array_length(public.read_raid_calendar((select token from t)))), 1,
  'the feed holds only the player''s own assignment');
select is(public.read_raid_calendar(repeat('0', 64)), null, 'an unknown token reads nothing');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select public.revoke_raid_calendar((select guild from t));
select pg_temp.as_worker();
select is(public.read_raid_calendar((select token from t)), null, 'a revoked feed reads nothing');

-- Reminders are officer settings, off by default, and skip players who confirmed.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.get_raid_reminders((select guild from t)) $$, '42501', null, 'players cannot read reminder settings');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select is((public.get_raid_reminders((select guild from t)) ->> 'upcoming_enabled')::boolean, false, 'reminders start off');
select public.set_raid_reminders((select guild from t), '{"upcoming_enabled": true, "lead_hours": 24, "only_unconfirmed": true}');
select pg_temp.as_worker();
select public.enqueue_due_raid_reminders();
select public.enqueue_due_raid_reminders();
select is((select count(*)::int from public.discord_deliveries where kind = 'upcoming'), 1,
  'an upcoming raid gets one reminder, however often the scheduler runs');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select public.save_raid_response((select guild from t), (select week from t), 'raid-20', '2000', 'confirmed');
-- Settle the pending roster edit first, so the reminder is the next job.
select pg_temp.as_worker();
update public.discord_deliveries set status = 'sent' where kind = 'roster';
update t set job = public.claim_discord_delivery(null);
select is((select jsonb_array_length(public.raid_reminder_payload((select (job->>'id')::uuid from t),
  (select (job->>'lease_token')::uuid from t)) -> 'recipients')), 0, 'a confirmed player is not reminded');

-- A finished send leaves no backoff behind it.
select public.finish_discord_delivery((select (job->>'id')::uuid from t), (select (job->>'lease_token')::uuid from t),
  (select (job->>'version')::bigint from t));
select ok((select next_attempt_at <= now() from public.discord_deliveries where id = (select (job->>'id')::uuid from t)),
  'no backoff after a successful send');

-- Posting a raid that was never saved is refused cleanly.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.queue_discord_delivery((select guild from t), (select week from t), 'raid-missing') $$,
  '22023', null, 'a raid with no saved plan cannot be posted');

-- An uncertain send stays uncertain through a republish, so it is never sent twice.
reset role;
update public.discord_deliveries set status = 'uncertain' where kind = 'roster';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.save(jsonb_build_array(pg_temp.plan_row((select pair from team), 3000)));
reset role;
select is((select status from public.discord_deliveries where kind = 'roster'), 'uncertain',
  'a republish does not resend an uncertain post');

-- After switching to another channel, old raids are not posted there unasked.
update public.discord_deliveries set status = 'sent' where kind = 'roster';
create temp table before_switch as select version from public.discord_deliveries where kind = 'roster';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.set_guild_discord((select guild from t),
  'https://discord.com/api/webhooks/223456789012345678/zyxwvutsrqponmlkjihgfedcba0123', true);
select pg_temp.save(jsonb_build_array(pg_temp.plan_row((select one from team), 4000)));
reset role;
select is((select status from public.discord_deliveries where kind = 'roster'), 'sent',
  'a republish after a channel switch queues nothing');
select is((select version from public.discord_deliveries where kind = 'roster'), (select version from before_switch),
  'and leaves the old delivery untouched');

select * from finish();
rollback;
