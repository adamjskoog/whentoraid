-- Retiring ("deleting") characters. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'player@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'discord', '511111111111111111', '{"sub": "511111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', 'discord', '522222222222222222', '{"sub": "522222222222222222"}', now(), now(), now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;

create temp table g (id uuid);
grant select, insert on g to authenticated;

-- The officer creates a guild, adds the player with two characters, and rosters the alt.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
insert into g select public.create_guild(
  '{"name": "Retirees", "timezone": "UTC", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}'
);
insert into public.members (guild_id, id, name, discord_id, position)
  values ((select id from g), 'm-player', 'Nova', '522222222222222222', 1);
insert into public.characters (guild_id, id, member_id, name, realm, spec, class, role, main) values
  ((select id from g), 'c-main', 'm-player', 'Starfall', 'Whitemane', 'Frost', 'Mage', 'DPS', true),
  ((select id from g), 'c-alt', 'm-player', 'Emberfall', 'Whitemane', 'Holy', 'Priest', 'Healer', false);
insert into public.plans (guild_id, week, start, team)
  values ((select id from g), '2026-10-05', 1,
          '[{"memberId": "m-player", "characterId": "c-alt", "role": "Healer"}]');

-- The player retires the rostered alt.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$
  update public.characters set retired = true where id = 'c-alt'
$$, 'a player retires their own character');
select ok((select retired from public.characters where id = 'c-alt'), 'the character is retired');
select is((select team -> 0 ->> 'characterId' from public.plans), 'c-alt', 'the roster still names it');

-- Only active characters count toward the 20-character cap.
select lives_ok($$
  insert into public.characters (guild_id, id, member_id, name, realm, spec, class, role)
  select (select id from g), 'c-' || n, 'm-player', 'Alt' || n, 'Whitemane', 'Arms', 'Warrior', 'DPS'
  from generate_series(1, 19) n
$$, 'a retired character frees its place under the cap');
select throws_ok($$
  update public.characters set retired = false where id = 'c-alt'
$$, '23514', 'A player can have at most 20 characters.', 'bringing one back cannot pass the cap');
select throws_ok($$
  insert into public.characters (guild_id, id, member_id, name, realm, spec, class, role)
  values ((select id from g), 'c-21', 'm-player', 'Alt21', 'Whitemane', 'Arms', 'Warrior', 'DPS')
$$, '23514', 'A player can have at most 20 characters.', 'nor can a 21st active character');

select * from finish();
rollback;
