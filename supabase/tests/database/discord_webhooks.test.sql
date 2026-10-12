-- The guild's Discord channel webhook. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'player@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000c1', 'stranger@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'discord', '511111111111111111', '{"sub": "511111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', 'discord', '522222222222222222', '{"sub": "522222222222222222"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c1', 'discord', '533333333333333333', '{"sub": "533333333333333333"}', now(), now(), now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;

create temp table g (id uuid);
grant select, insert on g to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
insert into g select public.create_guild(
  '{"name": "Posters", "timezone": "UTC", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}'
);
select public.apply_guild_changes((select id from g), 0,
  jsonb_build_array(jsonb_build_object('table','members','kind','upsert','rows',
    jsonb_build_array(jsonb_build_object('guild_id',(select id from g),'id','m-player',
      'name','Nova','discord_id','522222222222222222','is_officer',false,'position',1)))));

create temp table hook (url text);
insert into hook values ('https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-0123456789');
grant select on hook to authenticated;

select is((select count(*) from public.get_guild_discord((select id from g))), 0::bigint,
  'a guild starts without a Discord channel');
select throws_ok($$ select public.set_guild_discord((select id from g), 'https://evil.example/api/webhooks/1/x', false) $$,
  '22023', 'That is not a Discord webhook URL.', 'only Discord webhook URLs are accepted');
select lives_ok($$ select public.set_guild_discord((select id from g), (select url from hook), true) $$,
  'an officer sets the webhook');
select lives_ok($$ select public.record_discord_post((select id from g), to_char(current_date, 'YYYY-MM-DD') || '/raid-20',
  '["1300000000000000001", "1300000000000000002"]') $$, 'an officer records a post');
select is((select posts -> (to_char(current_date, 'YYYY-MM-DD') || '/raid-20') ->> 1 from public.get_guild_discord((select id from g))),
  '1300000000000000002', 'the post is remembered');

-- Players and strangers never see the webhook.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select * from public.get_guild_discord((select id from g)) $$,
  '42501', 'Only officers can manage the guild’s Discord channel.', 'a player cannot read the webhook');
select throws_ok($$ select public.set_guild_discord((select id from g), '', false) $$,
  '42501', null, 'a player cannot remove it');
select throws_ok($$ select * from public.guild_discord $$, '42501', null, 'nor read the table directly');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select * from public.get_guild_discord((select id from g)) $$,
  '42501', null, 'a stranger cannot read the webhook');

-- A new webhook forgets posts made through the old one; an empty URL removes the channel.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.set_guild_discord((select id from g),
  'https://discord.com/api/webhooks/223456789012345678/abcdefghijklmnopqrstuvwxyz_-0123456789', false);
select is((select posts from public.get_guild_discord((select id from g))), '{}'::jsonb,
  'changing the webhook forgets earlier posts');
select public.set_guild_discord((select id from g), '', false);
select is((select count(*) from public.get_guild_discord((select id from g))), 0::bigint, 'an empty URL removes it');
select throws_ok($$ select public.record_discord_post((select id from g), '2026-10-05/raid-20', '["1300000000000000001"]') $$,
  '22023', 'Set a Discord channel in Guild settings first.', 'posts need a channel');

select * from finish();
rollback;
