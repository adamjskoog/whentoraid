-- Authenticated reads use RLS; writes must use the revision RPC.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-00000000000b', 'player@example.test', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'outsider@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000000a', 'discord', '111111111111111111', '{"sub":"111111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000b', 'discord', '222222222222222222', '{"sub":"222222222222222222"}', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000c', 'discord', '333333333333333333', '{"sub":"333333333333333333"}', now(), now(), now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;
create temp table g (id uuid);
grant select, insert on g to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into g select public.create_guild(
  '{"name":"Night Shift","timezone":"UTC","dayStartHour":18,"slotsPerDay":12,
    "settings":{"raids":[{"id":"raid-20","name":"20-player Raid","size":20,
      "targets":[2,4,14],"durationSlots":6}],"checkinDeadline":null}}',
  '{"id":"m-officer","name":"Sam"}'
);
select ok((select is_officer from public.members where id = 'm-officer'), 'creator becomes officer');
select is((select revision::int from public.guild_revisions where guild_id = (select id from g)), 0,
  'new guild starts at revision zero');
select throws_ok($$
  insert into public.members (guild_id, id, name) values ((select id from g), 'm-direct', 'Direct')
$$, '42501', null, 'officer cannot bypass the RPC with a direct insert');
select throws_ok($$
  update public.guilds set name = 'Direct' where id = (select id from g)
$$, '42501', null, 'column-level guild update grant is gone');
select throws_ok($$
  select public.claim_guild_revision((select id from g), 0)
$$, '42501', null, 'caller cannot claim a revision separately');

select lives_ok($$
  select public.apply_guild_changes((select id from g), 0,
    jsonb_build_array(
      jsonb_build_object('table','members','kind','upsert','rows',
        jsonb_build_array(jsonb_build_object('guild_id',(select id from g),'id','m-player',
          'name','Nova','discord_id','222222222222222222','is_officer',false,'position',1))),
      jsonb_build_object('table','characters','kind','upsert','rows',
        jsonb_build_array(jsonb_build_object('guild_id',(select id from g),'id','c-player',
          'member_id','m-player','name','Starfall','realm','Whitemane','spec','Frost',
          'class','Mage','role','DPS','main',true,'retired',false,'position',0),
        jsonb_build_object('guild_id',(select id from g),'id','c-officer',
          'member_id','m-officer','name','Guardian','realm','Whitemane','spec','Arms',
          'class','Warrior','role','Tank','main',true,'retired',false,'position',0)))
    ))
$$, 'officer writes multiple tables in one RPC');
select is((select revision::int from public.guild_revisions where guild_id = (select id from g)), 1,
  'successful batch advances revision once');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.members), 2, 'player reads guild roster');
select lives_ok($$
  select public.apply_guild_changes((select id from g), 1,
    jsonb_build_array(jsonb_build_object('table','checkins','kind','upsert','rows',
      jsonb_build_array(jsonb_build_object('guild_id',(select id from g),
        'week',date_trunc('week',current_date)::date,'member_id','m-player',
        'checked_in',true,'ranges','[]'::jsonb,'declined','[]'::jsonb,
        'raid_preferences','{}'::jsonb)))))
$$, 'player saves their own check-in through the RPC');
select throws_ok($$
  select public.apply_guild_changes((select id from g), 2,
    jsonb_build_array(jsonb_build_object('table','checkins','kind','upsert','rows',
      jsonb_build_array(jsonb_build_object('guild_id',(select id from g),
        'week',date_trunc('week',current_date)::date,'member_id','m-officer',
        'checked_in',true,'ranges','[]'::jsonb,'declined','[]'::jsonb,
        'raid_preferences','{}'::jsonb)))))
$$, '42501', null, 'player cannot save another member’s check-in');
select throws_ok($$
  select public.apply_guild_changes((select id from g), 2,
    jsonb_build_array(jsonb_build_object('table','characters','kind','upsert','rows',
      jsonb_build_array(jsonb_build_object('guild_id',(select id from g),'id','c-officer',
        'member_id','m-player','name','Stolen','realm','Whitemane','spec','Frost',
        'class','Mage','role','DPS','main',true,'retired',false,'position',0)))))
$$, '42501', null, 'player cannot transfer another member’s character to themselves');
select throws_ok($$
  select public.apply_guild_changes((select id from g), 2,
    jsonb_build_array(jsonb_build_object('table','characters','kind','delete','keys',
      jsonb_build_array(jsonb_build_object('guild_id',(select id from g),'id','c-officer')))))
$$, '42501', null, 'player cannot delete another member’s character');
select is((select revision::int from public.guild_revisions where guild_id = (select id from g)), 2,
  'rejected RPC does not advance revision');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok($$
  select public.apply_guild_changes((select id from g), 1,
    jsonb_build_array(jsonb_build_object('table','guilds','kind','update','rows',
      jsonb_build_array((select to_jsonb(guilds) from public.guilds where id = (select id from g))))))
$$, '40001', null, 'stale officer edit is rejected');
select lives_ok($$
  select public.apply_guild_changes((select id from g), 2,
    jsonb_build_array(jsonb_build_object('table','guilds','kind','update','rows',
      jsonb_build_array((select to_jsonb(guilds) || '{"name":"Renamed"}'::jsonb
        from public.guilds where id = (select id from g))))))
$$, 'officer updates guild through RPC');
select is((select name from public.guilds where id = (select id from g)), 'Renamed',
  'RPC update took effect');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.guilds), 0, 'outsider sees no guild');
select throws_ok($$
  select public.apply_guild_changes((select id from g), 3,
    '[{"table":"members","kind":"delete","keys":[{"id":"m-player"}]}]'::jsonb)
$$, '42501', null, 'outsider cannot write through RPC');

select * from finish();
rollback;
