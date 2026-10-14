-- Connecting the WhenToRaid bot to a Discord server. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a3', 'officer3@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a3', 'discord', '631111111111111111', '{"sub": "631111111111111111"}', now(), now(), now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('role', 'service_role', true),
         set_config('request.jwt.claims', '{"role": "service_role"}', true)
$$;

create temp table t (guild uuid);
grant select, insert, update on t to authenticated, service_role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
insert into t (guild) values (public.create_guild(
  '{"name": "Connect", "timezone": "UTC", "dayStartHour": 17, "slotsPerDay": 14,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}'));
select is((select count(*) from public.get_guild_discord((select guild from t))), 0::bigint,
  'nothing is connected at first');

-- Only the Edge Function, after Discord confirmed the server, can link one.
select throws_ok($$ select public.link_discord_server((select guild from t), '744444444444444444', 'Mine') $$,
  '42501', null, 'an officer cannot link a server directly');
select throws_ok($$ select * from public.guild_discord_servers $$,
  '42501', null, 'officers cannot read linked servers directly');
select public.set_guild_discord((select guild from t),
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-0123', false, '');

reset role;
create temp table before as select revision from public.guild_revisions where guild_id = (select guild from t);
grant select on before to service_role;
select pg_temp.as_worker();
select lives_ok($$ select public.link_discord_server((select guild from t), '744444444444444444', 'After Hours') $$,
  'the worker links the server Discord confirmed');
select throws_ok($$ select public.link_discord_server((select guild from t), '12', 'Bad') $$,
  '22023', null, 'a malformed server id is refused');
reset role;
select is((select discord_server_id from public.guilds where id = (select guild from t)), '744444444444444444',
  'buttons route to the linked server');
select is((select revision from public.guild_revisions where guild_id = (select guild from t)),
  (select revision + 1 from before), 'open browsers reload instead of saving the old server id');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select results_eq($$ select server_id, server_name, webhook_url <> '' from public.get_guild_discord((select guild from t)) $$,
  $$ values ('744444444444444444'::text, 'After Hours'::text, true) $$,
  'officers see the connected server next to their webhook');
select public.set_guild_discord((select guild from t),
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-0123', false, '755555555555555555');

-- Reconnecting to the same server keeps the channel; another server drops it and keeps the webhook.
reset role;
select pg_temp.as_worker();
select public.link_discord_server((select guild from t), '744444444444444444', 'After Hours (renamed)');
reset role;
select is((select channel_id from public.guild_discord where guild_id = (select guild from t)), '755555555555555555',
  'the same server keeps its bot channel');
select pg_temp.as_worker();
select public.link_discord_server((select guild from t), '766666666666666666', 'Other');
reset role;
select results_eq($$ select channel_id, webhook_url is not null from public.guild_discord where guild_id = (select guild from t) $$,
  $$ values (''::text, true) $$, 'another server drops the bot channel and keeps the webhook');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select public.set_guild_discord((select guild from t), '', false, '777777777777777777');
reset role;
select pg_temp.as_worker();
select public.link_discord_server((select guild from t), '788888888888888888', 'Third');
reset role;
select is((select count(*) from public.guild_discord where guild_id = (select guild from t)), 0::bigint,
  'a bot-only channel in the old server is removed');
select is((select server_id from public.guild_discord_servers where guild_id = (select guild from t)), '788888888888888888',
  'the newest server is the connected one');

select * from finish();
rollback;
