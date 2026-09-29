-- Row-level security for guilds. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- Four Discord users: an officer, a player in the guild, an outsider, and someone whose
-- editable user_metadata claims the player's Discord ID.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-00000000000b', 'player@example.test', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'outsider@example.test', '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'spoofer@example.test', '{"provider_id": "222222222222222222"}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000000a', 'discord', '111111111111111111', '{"sub": "111111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000b', 'discord', '222222222222222222', '{"sub": "222222222222222222"}', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000c', 'discord', '333333333333333333', '{"sub": "333333333333333333"}', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000d', 'discord', '444444444444444444', '{"sub": "444444444444444444"}', now(), now(), now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.act_as_anon() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role": "anon"}', true)
$$;

-- The officer creates a guild, then adds a player linked by Discord ID and one not linked yet.
create temp table g (id uuid);
create temp table other_guild (id uuid);
grant select, insert on g, other_guild to authenticated, anon;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into g select public.create_guild(
  '{"name": "Night Shift", "timezone": "America/New_York", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"targets": [2, 4, 14], "durationSlots": 6, "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}'
);

select ok((select is_officer from public.members where id = 'm-officer'), 'the creator is the first officer');
select is((select discord_id from public.members where id = 'm-officer'), '111111111111111111',
  'the creator is linked by their Discord identity');

select lives_ok($$
  insert into public.members (guild_id, id, name, discord_id, position) values
    ((select id from g), 'm-player', 'Nova', '222222222222222222', 1),
    ((select id from g), 'm-unlinked', 'Briar', '', 2);
  insert into public.characters (guild_id, id, member_id, name, realm, spec, class, role, main) values
    ((select id from g), 'c-player', 'm-player', 'Starfall', 'Whitemane', 'Frost', 'Mage', 'DPS', true),
    ((select id from g), 'c-unlinked', 'm-unlinked', 'Thorn', 'Whitemane', 'Arms', 'Warrior', 'DPS', true);
  insert into public.plans (guild_id, week, start, team) values ((select id from g), (date_trunc('week', current_date)::date), 1, '[]');
$$, 'officers add players, characters, and plans');

-- The player.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.guilds), 1, 'a player sees their guild');
select is((select count(*)::int from public.members), 3, 'a player sees the roster');
select lives_ok($$
  insert into public.checkins (guild_id, week, member_id, checked_in, ranges)
  values ((select id from g), (date_trunc('week', current_date)::date), 'm-player', true, '[{"start": 1, "end": 2}]')
$$, 'a player checks themselves in');
select throws_ok($$
  insert into public.checkins (guild_id, week, member_id, checked_in)
  values ((select id from g), (date_trunc('week', current_date)::date), 'm-unlinked', true)
$$, '42501', null, 'a player cannot check in someone else');
select lives_ok($$
  insert into public.characters (guild_id, id, member_id, name, realm, spec, class, role)
  values ((select id from g), 'c-alt', 'm-player', 'Emberfall', 'Whitemane', 'Fire', 'Mage', 'DPS')
$$, 'a player adds their own character');
select throws_ok($$
  insert into public.characters (guild_id, id, member_id, name, realm, spec, class, role)
  values ((select id from g), 'c-sneaky', 'm-unlinked', 'Sneak', 'Whitemane', 'Combat', 'Rogue', 'DPS')
$$, '42501', null, 'a player cannot add characters for someone else');
select throws_ok($$
  update public.characters set member_id = 'm-unlinked' where id = 'c-alt'
$$, '42501', null, 'a player cannot give their character to someone else');
update public.characters set name = 'Renamed' where id = 'c-unlinked';
select is((select name from public.characters where id = 'c-unlinked'), 'Thorn',
  'a player cannot edit someone else''s character');
update public.guilds set name = 'Hijacked';
select is((select name from public.guilds), 'Night Shift', 'a player cannot edit guild settings');
update public.members set is_officer = true where id = 'm-player';
select ok(not (select is_officer from public.members where id = 'm-player'), 'a player cannot promote themselves');
select throws_ok($$
  insert into public.plans (guild_id, week, start, team) values ((select id from g), (date_trunc('week', current_date)::date + 7), 1, '[]')
$$, '42501', null, 'a player cannot change the roster');
delete from public.members where id = 'm-unlinked';
select is((select count(*)::int from public.members), 3, 'a player cannot remove players');

-- The outsider and the spoofer see nothing and can change nothing.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.guilds), 0, 'an outsider sees no guild');
select is((select count(*)::int from public.checkins), 0, 'an outsider sees no check-ins');
select throws_ok($$
  insert into public.members (guild_id, id, name, discord_id)
  values ((select id from g), 'm-me', 'Intruder', '333333333333333333')
$$, '42501', null, 'an outsider cannot add themselves');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.members), 0,
  'claiming a Discord ID in user_metadata grants nothing');

select pg_temp.act_as_anon();
select throws_ok($$ select count(*) from public.guilds $$, '42501', null, 'signed-out visitors cannot read guilds');
select throws_ok($$ select public.create_guild('{}', '{}') $$, '42501', null, 'signed-out visitors cannot create guilds');

-- Shape and size limits apply to everyone.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok($$
  update public.checkins set ranges = '[null, "x"]' where member_id = 'm-player'
$$, '23514', null, 'malformed availability is refused');
select throws_ok($$
  update public.checkins set ranges = '[{"start": 5, "end": 1}]' where member_id = 'm-player'
$$, '23514', null, 'availability that ends before it starts is refused');
select throws_ok($$
  insert into public.checkins (guild_id, week, member_id, checked_in)
  values ((select id from g), (date_trunc('week', current_date)::date + 7 * 200), 'm-player', true)
$$, '23514', null, 'check-ins years ahead are refused');

-- Another guild, created by the outsider.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
insert into other_guild select public.create_guild(
  '{"name": "Other Guild", "timezone": "Europe/London", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"targets": [2, 4, 14], "durationSlots": 6, "checkinDeadline": null}}',
  '{"id": "m-other", "name": "Kai"}'
);

-- Officers.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok($$
  insert into public.members (guild_id, id, name)
  values ((select id from other_guild), 'm-spy', 'Spy')
$$, '42501', null, 'an officer cannot add players to another guild');
select throws_ok($$
  update public.guilds set created_by = null
$$, '42501', null, 'officers cannot change who created a guild');
select throws_ok($$
  update public.guilds set timezone = 'Mars/Olympus'
$$, '23514', 'Unknown timezone.', 'an unknown timezone is refused');
select throws_ok($$
  update public.guilds set settings = '{"targets": "lots"}'
$$, '23514', null, 'malformed settings are refused');
select throws_ok($$
  select public.enforce_guild_limits()
$$, '42501', null, 'trigger functions cannot be called directly');
select lives_ok($$
  update public.checkins set checked_in = false where member_id = 'm-player'
$$, 'officers edit anyone''s check-in (Act as)');
set constraints all immediate;
select throws_ok($$
  update public.members set is_officer = false where id = 'm-officer'
$$, '23514', 'A guild needs at least one officer with a Discord ID.', 'the last officer cannot step down');
select lives_ok($$
  delete from public.guilds where id = (select id from g)
$$, 'an officer can delete the guild, even though that removes every officer');

select * from finish();
rollback;
