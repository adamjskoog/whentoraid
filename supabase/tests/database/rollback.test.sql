-- Verify the emergency legacy-write rollback within a transaction.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'rollback@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'discord', '555555555555555555',
    '{"sub":"555555555555555555"}', now(), now(), now());
create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;
create temp table g (id uuid);
grant select, insert on g to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
insert into g select public.create_guild(
  '{"name":"Rollback","timezone":"UTC","dayStartHour":18,"slotsPerDay":12,
    "settings":{"raids":[{"id":"raid-20","name":"20-player Raid","size":20,
      "targets":[2,4,14],"durationSlots":6}],"checkinDeadline":null}}',
  '{"id":"m-officer","name":"Sam"}'
);

reset role;
\ir ../rollback/20261010160000_restore_legacy_writes.psql
select ok(has_table_privilege('authenticated', 'public.members', 'INSERT'),
  'rollback restores legacy table grants');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
insert into public.members (guild_id, id, name, discord_id, position) values
  ((select id from g), 'm-player', 'Nova', '', 1);
select is((select revision::int from public.guild_revisions where guild_id = (select id from g)), 1,
  'legacy table write advances the revision');
-- The production RPC sets this locally before changing rows. Set it explicitly here so the
-- test also runs against an existing local database created before that function update.
select set_config('whentoraid.atomic_write', 'on', true);
select public.apply_guild_changes((select id from g), 1,
  jsonb_build_array(jsonb_build_object('table','guilds','kind','update','rows',
    jsonb_build_array((select to_jsonb(guilds) || '{"name":"Atomic"}'::jsonb
      from public.guilds where id = (select id from g))))));
select is((select revision::int from public.guild_revisions where guild_id = (select id from g)), 2,
  'atomic batch advances revision only once with legacy triggers installed');

reset role;
\ir ../rollback/20261010160000_reenforce_atomic_writes.psql
select ok(not has_table_privilege('authenticated', 'public.members', 'INSERT'),
  'forward rollout removes legacy direct-write permission again');

select * from finish();
rollback;
