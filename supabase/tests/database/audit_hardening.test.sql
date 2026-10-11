-- Safe ids, check-in deadlines, and storage budgets. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000d1', 'player@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'discord', '611111111111111111', '{"sub": "611111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', 'discord', '622222222222222222', '{"sub": "622222222222222222"}', now(), now(), now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;

create temp table g (id uuid);
grant select, insert on g to authenticated;

-- Apply one operation at the guild's current revision.
create function pg_temp.apply(tbl text, kind text, items jsonb) returns bigint language sql as $$
  select public.apply_guild_changes((select id from g),
    (select revision from public.guild_revisions where guild_id = (select id from g)),
    jsonb_build_array(jsonb_build_object('table', tbl, 'kind', kind,
      case when kind = 'delete' then 'keys' else 'rows' end, items)))
$$;
create function pg_temp.week(offset_weeks int) returns date language sql as $$
  select (date_trunc('week', now() at time zone 'UTC')::date + 7 * offset_weeks)
$$;
create function pg_temp.checkin(member text, week date) returns jsonb language sql as $$
  select jsonb_build_object('guild_id', (select id from g), 'week', week, 'member_id', member,
    'checked_in', true, 'ranges', '[]'::jsonb, 'declined', '[]'::jsonb, 'raid_preferences', '{}'::jsonb)
$$;
create function pg_temp.template(member text, from_week date, previous jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('guild_id', (select id from g), 'member_id', member, 'template',
    jsonb_build_object('timezone', 'UTC', 'fromWeek', from_week, 'dayStartHour', 18,
      'slotsPerDay', 12, 'slots', '[1, 2]'::jsonb)
    || case when previous is null then '{}'::jsonb else jsonb_build_object('previous', previous) end)
$$;

-- Check-ins close at Monday 00:00 UTC, so this week and earlier are closed and next week is open.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
insert into g select public.create_guild(
  '{"name": "Deadlines", "timezone": "UTC", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}],
      "checkinDeadline": {"day": 0, "minutes": 0}}}',
  '{"id": "m-officer", "name": "Sam"}'
);
select pg_temp.apply('members', 'upsert', jsonb_build_array(jsonb_build_object('guild_id', (select id from g),
  'id', 'm-player', 'name', 'Nova', 'discord_id', '622222222222222222', 'is_officer', false, 'position', 1)));

-- Ids that every JavaScript object inherits are refused.
select throws_ok($$
  select pg_temp.apply('members', 'upsert', jsonb_build_array(jsonb_build_object('guild_id', (select id from g),
    'id', 'constructor', 'name', 'Proto', 'discord_id', '', 'is_officer', false, 'position', 2)))
$$, '23514', null, 'a member id named like a built-in is refused');
select throws_ok($$
  select pg_temp.apply('plans', 'upsert', jsonb_build_array(jsonb_build_object('guild_id', (select id from g),
    'week', pg_temp.week(1), 'raid_id', 'raid-20', 'start', 1, 'team', '[]'::jsonb, 'locked', '[]'::jsonb,
    'attendance', '{"m-player": "maybe"}'::jsonb, 'cancelled', false, 'published', null)))
$$, '23514', null, 'attendance values must be known options');

-- Players: open weeks only.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select lives_ok($$ select pg_temp.apply('checkins', 'upsert', jsonb_build_array(pg_temp.checkin('m-player', pg_temp.week(1)))) $$,
  'a player checks in for a week whose deadline is ahead');
select throws_like($$ select pg_temp.apply('checkins', 'upsert', jsonb_build_array(pg_temp.checkin('m-player', pg_temp.week(0)))) $$,
  'Check-ins for the week of % closed at the deadline.%', 'a player cannot check in after the deadline');
select throws_like($$ select pg_temp.apply('checkins', 'upsert', jsonb_build_array(pg_temp.checkin('m-player', pg_temp.week(-1)))) $$,
  '%closed at the deadline%', 'nor change a past week');

-- Usual schedules may not change what a closed week shows.
select lives_ok($$ select pg_temp.apply('availability_templates', 'upsert', jsonb_build_array(pg_temp.template('m-player', pg_temp.week(1)))) $$,
  'a schedule starting next week leaves the closed week alone');
select throws_like($$ select pg_temp.apply('availability_templates', 'upsert', jsonb_build_array(pg_temp.template('m-player', pg_temp.week(0)))) $$,
  '%usual schedule fills it in%', 'a schedule covering the closed week is refused');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select pg_temp.apply('availability_templates', 'upsert', jsonb_build_array(pg_temp.template('m-player', pg_temp.week(-1)))) $$,
  'an officer changes a player''s schedule after the deadline');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select lives_ok($$ select pg_temp.apply('availability_templates', 'upsert', jsonb_build_array(pg_temp.template('m-player', pg_temp.week(1),
    (select template from public.availability_templates where member_id = 'm-player')))) $$,
  'replacing it from next week, keeping it as previous, is allowed');
select throws_like($$ select pg_temp.apply('availability_templates', 'delete',
    jsonb_build_array(jsonb_build_object('guild_id', (select id from g), 'member_id', 'm-player'))) $$,
  '%usual schedule fills it in%', 'removing the schedule that fills the closed week is refused');

-- Officers still change closed weeks, and then the player's schedule no longer matters there.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select pg_temp.apply('checkins', 'upsert', jsonb_build_array(pg_temp.checkin('m-player', pg_temp.week(0)))) $$,
  'an officer checks a player in after the deadline');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select lives_ok($$ select pg_temp.apply('availability_templates', 'delete',
    jsonb_build_array(jsonb_build_object('guild_id', (select id from g), 'member_id', 'm-player'))) $$,
  'with a saved check-in for the closed week, the schedule can go');

-- A deadline must be whole numbers, or every player write in the guild would fail.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$
  select pg_temp.apply('guilds', 'update', jsonb_build_array((select to_jsonb(gu) || jsonb_build_object('settings',
    gu.settings || '{"checkinDeadline": {"day": 1.5, "minutes": 0}}'::jsonb) from public.guilds gu)))
$$, '23514', null, 'a fractional deadline day is refused');

-- Storage budget: about 10 MB of hard-to-compress rosters is more than one guild may keep.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
create temp table big_plans as
  select jsonb_agg(jsonb_build_object('guild_id', (select id from g), 'week', pg_temp.week(-n), 'raid_id', 'raid-20',
    'start', 1, 'locked', '[]'::jsonb, 'attendance', '{}'::jsonb, 'cancelled', false, 'published', null,
    'team', (select jsonb_agg(jsonb_build_object('memberId', 'm-player', 'characterId', 'c-' || e, 'role', 'DPS',
      'note', (select string_agg(md5(random()::text || n || e || k), '') from generate_series(1, 12) k)))
      from generate_series(1, 40) e))) as rows
  from generate_series(1, 700) n;
grant select on big_plans to authenticated;
select throws_ok($$ select pg_temp.apply('plans', 'upsert', (select rows from big_plans)) $$,
  '54000', 'This guild has reached its storage limit for raid plans.', 'one guild cannot store unbounded plans');
select is((select count(*)::int from public.plans), 0, 'the refused batch left nothing behind');

select * from finish();
rollback;
