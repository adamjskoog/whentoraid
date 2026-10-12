-- Players confirm or report a problem with a published roster. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'player@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000c1', 'bench@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000d1', 'outsider@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'discord', '511111111111111111', '{"sub": "511111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', 'discord', '522222222222222222', '{"sub": "522222222222222222"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c1', 'discord', '533333333333333333', '{"sub": "533333333333333333"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', 'discord', '544444444444444444', '{"sub": "544444444444444444"}', now(), now(), now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;

create temp table g (id uuid);
grant select, insert on g to authenticated;

-- An officer publishes a roster with one player; a second player is on the bench.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
insert into g select public.create_guild(
  '{"name": "Responses", "timezone": "America/Los_Angeles", "dayStartHour": 17, "slotsPerDay": 14,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}'
);
select public.apply_guild_changes((select id from g), 0, jsonb_build_array(
  jsonb_build_object('table','members','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select id from g),'id','m-player','name','Nova',
      'discord_id','522222222222222222','is_officer',false,'position',1),
    jsonb_build_object('guild_id',(select id from g),'id','m-bench','name','Rook',
      'discord_id','533333333333333333','is_officer',false,'position',2))),
  jsonb_build_object('table','characters','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select id from g),'id','c-main','member_id','m-player',
      'name','Starfall','realm','Whitemane','spec','Frost','class','Mage','role','DPS',
      'main',true,'retired',false,'position',0))),
  jsonb_build_object('table','plans','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select id from g),'week','2026-10-05','raid_id','raid-20','start',1000,
      'team','[{"memberId":"m-player","characterId":"c-main","role":"DPS"}]'::jsonb,
      'locked','[]'::jsonb,'attendance','{}'::jsonb,'cancelled',false,
      'published','{"start":1000,"end":2000,"publishedAt":3000,"day":0,"startSlot":2,"raidName":"20-player Raid",
        "team":[{"memberId":"m-player","characterId":"c-main","role":"DPS"}],"targets":[2,4,14]}'::jsonb)))
));

create temp table revision_before as select revision from public.guild_revisions where guild_id = (select id from g);
grant select on revision_before to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.save_raid_response((select id from g), '2026-10-05', 'raid-20', '3000', 'confirmed') $$,
  'a rostered player confirms their place');
select lives_ok($$ select public.save_raid_response((select id from g), '2026-10-05', 'raid-20', '3000', 'unavailable', ' Sick ') $$,
  'and can change it to a late problem');
select throws_ok($$ select public.save_raid_response((select id from g), '2026-10-05', 'raid-20', '2999', 'confirmed') $$,
  '40001', null, 'a response to an earlier publication is refused');
select throws_ok($$ select public.save_raid_response((select id from g), '2026-10-05', 'raid-20', '3000', 'maybe') $$,
  '22023', null, 'only known statuses are accepted');
select throws_ok($$ select public.save_raid_response((select id from g), '2026-10-05', 'raid-20', '3000', 'unavailable', repeat('x', 501)) $$,
  '22023', null, 'notes are limited to 500 characters');
select is((select status || ':' || note from public.get_raid_responses((select id from g), '2026-10-05', 'raid-20')),
  'unavailable:Sick', 'the player reads back their own trimmed response');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.save_raid_response((select id from g), '2026-10-05', 'raid-20', '3000', 'confirmed') $$,
  '42501', null, 'a benched player cannot respond');
select is((select count(*)::int from public.get_raid_responses((select id from g), '2026-10-05', 'raid-20')), 0,
  'other players cannot read someone else''s note');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$ select public.save_raid_response((select id from g), '2026-10-05', 'raid-20', '3000', 'confirmed') $$,
  '42501', null, 'outsiders cannot respond');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.get_raid_responses((select id from g), '2026-10-05', 'raid-20')), 1,
  'officers read every response');
select is((select revision from public.guild_revisions where guild_id = (select id from g)),
  (select revision from revision_before), 'responding does not bump the guild revision');

-- Republishing with the player's assignment unchanged keeps their answer; a new time does not.
select public.apply_guild_changes((select id from g), (select revision from revision_before), jsonb_build_array(
  jsonb_build_object('table','plans','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select id from g),'week','2026-10-05','raid_id','raid-20','start',1000,
      'team','[{"memberId":"m-player","characterId":"c-main","role":"DPS"}]'::jsonb,
      'locked','[]'::jsonb,'attendance','{}'::jsonb,'cancelled',false,
      'published','{"start":1000,"end":2000,"publishedAt":4000,"day":0,"startSlot":2,"raidName":"20-player Raid",
        "team":[{"memberId":"m-player","characterId":"c-main","role":"DPS"}],"targets":[2,4,14]}'::jsonb)))
));
select is((select count(*)::int from public.get_raid_responses((select id from g), '2026-10-05', 'raid-20')), 1,
  'an unchanged assignment keeps its response after republishing');
select public.apply_guild_changes((select id from g), (select revision from revision_before) + 1, jsonb_build_array(
  jsonb_build_object('table','plans','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select id from g),'week','2026-10-05','raid_id','raid-20','start',1000,
      'team','[{"memberId":"m-player","characterId":"c-main","role":"DPS"}]'::jsonb,
      'locked','[]'::jsonb,'attendance','{}'::jsonb,'cancelled',false,
      'published','{"start":1500,"end":2500,"publishedAt":5000,"day":0,"startSlot":2,"raidName":"20-player Raid",
        "team":[{"memberId":"m-player","characterId":"c-main","role":"DPS"}],"targets":[2,4,14]}'::jsonb)))
));
select is((select count(*)::int from public.get_raid_responses((select id from g), '2026-10-05', 'raid-20')), 0,
  'a new session time asks the player again');

select public.apply_guild_changes((select id from g), (select revision from revision_before) + 2, jsonb_build_array(
  jsonb_build_object('table','plans','kind','upsert','rows', jsonb_build_array(
    jsonb_build_object('guild_id',(select id from g),'week','2026-10-05','raid_id','raid-20','start',1000,
      'team','[{"memberId":"m-player","characterId":"c-main","role":"DPS"}]'::jsonb,
      'locked','[]'::jsonb,'attendance','{}'::jsonb,'cancelled',true,
      'published','{"start":1000,"end":2000,"publishedAt":3000,"day":0,"startSlot":2,"raidName":"20-player Raid",
        "team":[{"memberId":"m-player","characterId":"c-main","role":"DPS"}],"targets":[2,4,14]}'::jsonb)))
));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.save_raid_response((select id from g), '2026-10-05', 'raid-20', '5000', 'confirmed') $$,
  '40001', null, 'a cancelled raid takes no responses');

reset role;
select ok(not has_function_privilege('anon', 'public.save_raid_response(uuid,date,text,text,text,text)', 'execute'),
  'signed-out visitors cannot respond');

select * from finish();
rollback;
