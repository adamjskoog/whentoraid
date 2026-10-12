-- Joining a guild through an invite link. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'claimer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000c1', 'newcomer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000d1', 'late@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'discord', '511111111111111111', '{"sub": "511111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', 'discord', '522222222222222222', '{"sub": "522222222222222222"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c1', 'discord', '533333333333333333', '{"sub": "533333333333333333"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', 'discord', '544444444444444444', '{"sub": "544444444444444444"}', now(), now(), now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;

create temp table g (id uuid, code text);
grant select, insert, update on g to authenticated;

-- The officer creates a guild listing Nova (not yet linked) and a second, unlinked officer.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
insert into g (id) select public.create_guild(
  '{"name": "Joiners", "timezone": "UTC", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}'
);
select public.apply_guild_changes((select id from g), 0,
  jsonb_build_array(jsonb_build_object('table','members','kind','upsert','rows',
    jsonb_build_array(
      jsonb_build_object('guild_id',(select id from g),'id','m-nova','name','Nova','discord_id','',
        'is_officer',false,'position',1),
      jsonb_build_object('guild_id',(select id from g),'id','m-coofficer','name','Kit','discord_id','',
        'is_officer',true,'position',2)))));

select is(public.current_guild_invite((select id from g)), null, 'a guild starts without an invite link');
update g set code = public.guild_invite_code(id);
select matches((select code from g), '^[a-f0-9]{32}$', 'an officer creates an invite code');
select is(public.guild_invite_code((select id from g)), (select code from g), 'asking again returns the same code');

-- Without the code nothing is visible; with it, only the guild name and unclaimed players.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select * from public.invite_details('00000000000000000000000000000000') $$,
  'P0002', 'This invite link no longer works. Ask an officer for a new one.', 'a wrong code reveals nothing');
select throws_ok($$ select public.guild_invite_code((select id from g)) $$, '42501', null,
  'a non-member cannot create invite codes');
select is((select open_players from public.invite_details((select code from g))),
  '[{"id": "m-nova", "name": "Nova"}]'::jsonb, 'unclaimed players are offered, officers never');

-- Claiming a listed player links it to the caller's Discord account.
select is(public.join_guild((select code from g), 'm-nova', null), (select id from g), 'a player claims Nova');
select is((select discord_id from public.members where id = 'm-nova'), '522222222222222222', 'Nova is linked');
select is((select revision from public.guild_revisions where guild_id = (select id from g)), 2::bigint,
  'joining advances the guild revision');
select ok((select already_member from public.invite_details((select code from g))), 'joining twice is harmless');

-- A second player cannot claim Nova or an officer, but can join as a new player.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.join_guild((select code from g), 'm-nova', null) $$, 'P0001', null,
  'a claimed player cannot be claimed again');
select throws_ok($$ select public.join_guild((select code from g), 'm-coofficer', null) $$, 'P0001', null,
  'an officer cannot be claimed');
select lives_ok($$ select public.join_guild((select code from g), null, '  Wren  ') $$, 'a new player joins');
select is((select name from public.members where discord_id = '533333333333333333'), 'Wren',
  'the new player is listed under their name');

-- Resetting the link ends the old one.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select isnt(public.guild_invite_code((select id from g), true), (select code from g), 'reset makes a new code');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$ select public.join_guild((select code from g), null, 'Late') $$, 'P0002', null,
  'the old link no longer works');

select * from finish();
rollback;
