-- Usual schedules, per-raid preferences, and published rosters. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create temp table template as select '{"timezone":"America/Los_Angeles","fromWeek":"2026-09-28",
  "dayStartHour":17,"slotsPerDay":14,"slots":[0,1,2,97]}'::jsonb as value;
create temp table snapshot as select '{"start":1000,"end":2000,"publishedAt":3000,"day":0,"startSlot":2,
  "raidName":"20-player Raid","team":[],"targets":[2,4,14]}'::jsonb as value;

select ok(public.valid_availability_template((select value from template)), 'accepts a usual schedule');
select ok(not public.valid_availability_template(jsonb_set((select value from template), '{slots,0}', '98')),
  'rejects a slot past the end of the week');
select ok(not public.valid_availability_template(jsonb_set((select value from template), '{timezone}', '"Mars/Base"')),
  'rejects an unknown time zone');
select ok(not public.valid_availability_template(jsonb_set((select value from template), '{fromWeek}', '"2026-09-29"')),
  'rejects a schedule that does not start on a Monday');

select ok(public.valid_published_plan(null), 'a plan need not be published');
select ok(public.valid_published_plan((select value from snapshot)), 'accepts a published snapshot');
select ok(not public.valid_published_plan(jsonb_set((select value from snapshot), '{targets}', '[2,4]')),
  'rejects a snapshot without three role targets');

select ok(public.valid_raid_preferences('{"raid-10-1":{"participating":false,"declined":["c1"]}}'),
  'accepts per-raid preferences');
select ok(not public.valid_raid_preferences('{"Raid 1":{"participating":true,"declined":[]}}'),
  'rejects malformed raid IDs');

-- An officer's guild with one linked player.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'player@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000c1', 'outsider@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'discord', '511111111111111111', '{"sub": "511111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', 'discord', '522222222222222222', '{"sub": "522222222222222222"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c1', 'discord', '533333333333333333', '{"sub": "533333333333333333"}', now(), now(), now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;

create temp table g (id uuid);
grant select, insert on g, template to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
insert into g select public.create_guild(
  '{"name": "Templates", "timezone": "America/Los_Angeles", "dayStartHour": 17, "slotsPerDay": 14,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}'
);
insert into public.members (guild_id, id, name, discord_id, position) values
  ((select id from g), 'm-player', 'Nova', '522222222222222222', 1);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$
  insert into public.availability_templates (guild_id, member_id, template)
  values ((select id from g), 'm-player', (select value from template))
$$, 'a player saves their own usual schedule');
select throws_ok($$
  insert into public.availability_templates (guild_id, member_id, template)
  values ((select id from g), 'm-officer', (select value from template))
$$, '42501', null, 'a player cannot save someone else''s schedule');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.availability_templates), 1, 'officers see guild schedules');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.availability_templates), 0, 'outsiders see no schedules');

select * from finish();
rollback;
