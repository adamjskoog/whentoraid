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
select public.apply_guild_changes((select id from g), 0,
  jsonb_build_array(
    jsonb_build_object('table','members','kind','upsert','rows',
      jsonb_build_array(jsonb_build_object('guild_id',(select id from g),'id','m-player',
        'name','Nova','discord_id','522222222222222222','is_officer',false,'position',1))),
    jsonb_build_object('table','characters','kind','upsert','rows',
      jsonb_build_array(
        jsonb_build_object('guild_id',(select id from g),'id','c-main','member_id','m-player',
          'name','Starfall','realm','Whitemane','spec','Frost','class','Mage','role','DPS',
          'main',true,'retired',false,'position',0),
        jsonb_build_object('guild_id',(select id from g),'id','c-alt','member_id','m-player',
          'name','Emberfall','realm','Whitemane','spec','Holy','class','Priest','role','Healer',
          'main',false,'retired',false,'position',1))),
    jsonb_build_object('table','plans','kind','upsert','rows',
      jsonb_build_array(jsonb_build_object('guild_id',(select id from g),'week','2026-10-05',
        'raid_id','raid-20','start',1,
        'team','[{"memberId":"m-player","characterId":"c-alt","role":"Healer"}]'::jsonb,
        'locked','[]'::jsonb,'attendance','{}'::jsonb,'cancelled',false,'published',null)))
  ));

-- The player retires the rostered alt.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$
  select public.apply_guild_changes((select id from g), 1,
    jsonb_build_array(jsonb_build_object('table','characters','kind','upsert','rows',
      jsonb_build_array((select to_jsonb(c) || '{"retired":true}'::jsonb
        from public.characters c where c.id = 'c-alt')))))
$$, 'a player retires their own character');
select ok((select retired from public.characters where id = 'c-alt'), 'the character is retired');
select is((select team -> 0 ->> 'characterId' from public.plans), 'c-alt', 'the roster still names it');

-- Only active characters count toward the 20-character cap.
select lives_ok($$
  select public.apply_guild_changes((select id from g), 2,
    jsonb_build_array(jsonb_build_object('table','characters','kind','upsert','rows',
      (select jsonb_agg(jsonb_build_object('guild_id',(select id from g),'id','c-' || n,
        'member_id','m-player','name','Alt' || n,'realm','Whitemane','spec','Arms',
        'class','Warrior','role','DPS','main',false,'retired',false,'position',n))
        from generate_series(1,19) n))))
$$, 'a retired character frees its place under the cap');
select throws_ok($$
  select public.apply_guild_changes((select id from g), 3,
    jsonb_build_array(jsonb_build_object('table','characters','kind','upsert','rows',
      jsonb_build_array((select to_jsonb(c) || '{"retired":false}'::jsonb
        from public.characters c where c.id = 'c-alt')))))
$$, '23514', 'A player can have at most 20 characters.', 'bringing one back cannot pass the cap');
select throws_ok($$
  select public.apply_guild_changes((select id from g), 3,
    jsonb_build_array(jsonb_build_object('table','characters','kind','upsert','rows',
      jsonb_build_array(jsonb_build_object('guild_id',(select id from g),'id','c-21',
        'member_id','m-player','name','Alt21','realm','Whitemane','spec','Arms',
        'class','Warrior','role','DPS','main',false,'retired',false,'position',21)))))
$$, '23514', 'A player can have at most 20 characters.', 'nor can a 21st active character');

select * from finish();
rollback;
