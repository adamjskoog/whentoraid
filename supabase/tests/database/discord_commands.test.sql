begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.guilds (id, name, timezone, day_start_hour, slots_per_day, discord_server_id, settings)
select id::uuid, name, 'UTC', 17, 14, '810000000000000001', jsonb_build_object('checkinDeadline', null,
  'raids', jsonb_build_array(jsonb_build_object('id','raid-10','name','Raid night','size',4,
    'targets','[1,1,2]'::jsonb,'durationSlots',6),
    jsonb_build_object('id','secret','name','Officer draft','size',4,'targets','[1,1,2]'::jsonb,'durationSlots',6)))
from (values ('00000000-0000-0000-0000-00000000c001','Command guild'),
             ('00000000-0000-0000-0000-00000000c002','Other guild')) t(id,name);
insert into public.members (guild_id, id, name, discord_id, is_officer, position)
select g.id, 'm-' || n, 'Player ' || n, '82000000000000000' || n, n = 1, n
from public.guilds g cross join generate_series(1, 3) n
where g.id in ('00000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-00000000c002');
insert into public.characters (guild_id, id, member_id, name, realm, spec, class, role, main, position)
select '00000000-0000-0000-0000-00000000c001', 'c-' || n, 'm-' || n, 'Tank ' || n,
  'Realm', 'Protection', 'Warrior', 'Tank', true, n from generate_series(1,3) n;
insert into public.guild_discord_servers (guild_id, server_id) values
  ('00000000-0000-0000-0000-00000000c001', '810000000000000001');
insert into public.guild_discord (guild_id, channel_id) values
  ('00000000-0000-0000-0000-00000000c001', '830000000000000001'),
  ('00000000-0000-0000-0000-00000000c002', '830000000000000002');

create temp table clock as select date_trunc('week',now())::date as week,
  (extract(epoch from now() + interval '1 day') * 1000)::bigint as start;
insert into public.plans (guild_id, week, raid_id, start, team, locked, attendance, cancelled)
select '00000000-0000-0000-0000-00000000c001', week, raid, start, '[]', '[]', '{}', false
from clock cross join (values ('raid-10'), ('secret')) r(raid);

create function pg_temp.overview(who text default '820000000000000002', channel text default '830000000000000001', server text default '810000000000000001')
returns jsonb language sql as $$ select public.discord_raid_overview(who,server,channel) $$;
create function pg_temp.raid(who text default '820000000000000002') returns jsonb language sql as $$
  select e from jsonb_array_elements(pg_temp.overview(who) -> 'raids') e where e ->> 'raidId' = 'raid-10'
$$;

select is(pg_temp.overview('829999999999999999'), '{"outcome":"not-member"}'::jsonb, 'strangers see no guild data');
select is(pg_temp.overview('820000000000000002','830000000000000001','819999999999999999'), '{"outcome":"not-member"}'::jsonb, 'membership cannot cross Discord servers');
select throws_ok($$ select pg_temp.overview(null) $$, '22023', null, 'null identity is rejected');
select is(jsonb_array_length(pg_temp.overview() -> 'raids'), 0, 'members cannot discover unannounced drafts');
select is(jsonb_array_length(pg_temp.overview('820000000000000001') -> 'raids'), 2, 'officers can see their drafts');

insert into public.discord_deliveries (id, guild_id, delivery_key, week, raid_id, kind, payload, webhook_fingerprint, message_ids)
select '00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-00000000c001', 'signup:' || week || '/raid-10',
  week, 'raid-10', 'signup', '{}', md5('bot:830000000000000001'), '["840000000000000001"]' from clock;
select is(jsonb_array_length(pg_temp.overview() -> 'raids'), 1, 'a posted signup is visible while unannounced drafts stay private');
select is(pg_temp.raid() ->> 'signupMessageId', '840000000000000001', 'the overview links the existing post');
update public.discord_deliveries set message_ids = '["840000000000000001","840000000000000002"]'
  where id = '00000000-0000-0000-0000-00000000cd01';
select is(pg_temp.raid() ->> 'signupMessageId', '840000000000000002', 'signup links open the final continuation where the buttons live');
select ok(not (pg_temp.raid() ? 'confirmed'), 'players do not receive officer response aggregates');

insert into public.raid_signups (guild_id, week, raid_id, member_id, status, character_id, signed_at, after_deadline)
select '00000000-0000-0000-0000-00000000c001', week, 'raid-10', 'm-' || n,
  case when n = 3 then 'tentative' else 'signed' end, 'c-' || n, now(), n = 2
from clock cross join generate_series(1,3) n;
select is(pg_temp.raid() -> 'mine' ->> 'bench', 'true', 'equal signup timestamps break ties by member ID');
select is(pg_temp.raid() -> 'signups' -> 0 ->> 'name', 'Tank 1', 'roster lists include the full character name');
select is(pg_temp.raid() -> 'signups' -> 0 ->> 'player', 'Player 1', 'roster lists include the player name alongside the character');
select is(pg_temp.raid() -> 'signups' -> 2 ->> 'status', 'tentative', 'tentative players remain in the complete named list');
select ok(not (pg_temp.raid() -> 'signups' -> 0 ? 'discordId'), 'roster lists do not expose Discord account IDs');
select is(pg_temp.raid() -> 'mine' ->> 'place', '2', 'the personal queue place agrees with the lineup');
select is(pg_temp.raid() -> 'mine' ->> 'afterDeadline', 'true', 'late check-in changes are explained');
select is(pg_temp.raid('820000000000000003') -> 'mine' ->> 'bench', 'false', 'tentative players do not hold a bench place');
update public.raid_signups set spec = 'Fury', role = 'DPS' where guild_id = '00000000-0000-0000-0000-00000000c001' and member_id = 'm-2';
select is(pg_temp.raid() -> 'mine' ->> 'role', 'DPS', 'the raid-specific role wins over the saved character role');
select is(pg_temp.raid() -> 'mine' ->> 'bench', 'false', 'switching into an open role removes the provisional bench');

update public.plans p set published = jsonb_build_object('start', p.start, 'end', p.start + 10800000,
  'day',0,'startSlot',0,'raidName','Published raid','publishedAt',1,'targets','[1,1,2]'::jsonb,
  'team','[{"memberId":"m-1","characterId":"c-1","role":"Tank"},{"memberId":"m-2","characterId":"c-2","role":"DPS"}]'::jsonb)
where guild_id = '00000000-0000-0000-0000-00000000c001' and raid_id = 'raid-10';
insert into public.raid_responses (guild_id,week,raid_id,member_id,publication,assignment,status)
select guild_id,week,raid_id,'m-2','1',public.raid_assignment(published,'m-2'),'confirmed'
from public.plans where guild_id = '00000000-0000-0000-0000-00000000c001' and raid_id = 'raid-10';
select is(pg_temp.raid() -> 'mine' ->> 'rostered', 'true', 'published assignments are distinguished from signups');
select is(pg_temp.raid() -> 'mine' ->> 'response', 'confirmed', 'the player sees their valid confirmation');
select is(pg_temp.raid() -> 'roster' -> 1 ->> 'name', 'Tank 2', 'published roster names come from the selected characters');
select is(pg_temp.raid() -> 'roster' -> 1 ->> 'role', 'DPS', 'the published assignment overrides the saved character role');
select ok(not (pg_temp.raid() -> 'roster' -> 1 ? 'response'), 'another player cannot read individual roster confirmations');
select is(pg_temp.raid('820000000000000001') ->> 'confirmed', '1', 'officers see confirmed assignments');
select is(pg_temp.raid('820000000000000001') ->> 'unconfirmed', '1', 'officers see unanswered assignments');
select is(pg_temp.raid('820000000000000001') -> 'rosterCounts', '[1,0,1]'::jsonb, 'published role counts expose a healer shortage');
update public.raid_responses set status = 'tentative'
where guild_id = '00000000-0000-0000-0000-00000000c001' and member_id = 'm-2';
select is(pg_temp.raid() -> 'mine' ->> 'response', 'tentative', 'the player sees their tentative response');
select ok(not (pg_temp.raid() ? 'tentative'), 'tentative confirmation totals stay officer-only');
select is(pg_temp.raid('820000000000000001') ->> 'tentative', '1', 'officers see tentative assignments separately');
select is(pg_temp.raid('820000000000000001') ->> 'confirmed', '0', 'tentative is not a confirmation');
select is(pg_temp.raid('820000000000000001') ->> 'unconfirmed', '1', 'tentative is not an unanswered response');
update public.plans set published = jsonb_set(published,'{team,1,role}','"Healer"')
where guild_id = '00000000-0000-0000-0000-00000000c001' and raid_id = 'raid-10';
select is(pg_temp.raid() -> 'mine' ->> 'response', null, 'an old confirmation is invalid after the assignment changes');
select is(pg_temp.raid('820000000000000001') ->> 'unconfirmed', '2', 'a stale answer counts as awaiting confirmation');

-- Reconnecting a channel must not link old messages, even when the raid stays public.
update public.guild_discord set channel_id = '830000000000000009' where guild_id = '00000000-0000-0000-0000-00000000c001';
select is(pg_temp.raid() ->> 'signupMessageId', null, 'stale-channel message links are omitted');
update public.guild_discord set channel_id = '830000000000000001' where guild_id = '00000000-0000-0000-0000-00000000c001';
update public.plans set cancelled = true where guild_id = '00000000-0000-0000-0000-00000000c001' and raid_id = 'raid-10';
select is(jsonb_array_length(pg_temp.overview() -> 'raids'), 0, 'cancelled raids disappear from upcoming commands');
update public.plans set cancelled = false, published = null, start = (extract(epoch from now() - interval '1 hour') * 1000)::bigint
where guild_id = '00000000-0000-0000-0000-00000000c001' and raid_id = 'raid-10';
select is(jsonb_array_length(pg_temp.overview() -> 'raids'), 0, 'already-started raids are omitted');
update public.plans set start = (extract(epoch from now() + interval '29 days') * 1000)::bigint
where guild_id = '00000000-0000-0000-0000-00000000c001' and raid_id = 'raid-10';
select is(jsonb_array_length(pg_temp.overview() -> 'raids'), 0, 'the four-week horizon is enforced');

-- A manually typed server ID alone must not connect a second guild.
select is(pg_temp.overview('820000000000000002','830000000000000099') ->> 'guildId', '00000000-0000-0000-0000-00000000c001', 'unverified server IDs never become candidates');
insert into public.guild_discord_servers (guild_id,server_id) values ('00000000-0000-0000-0000-00000000c002','810000000000000001');
select is(pg_temp.overview('820000000000000002','830000000000000099'), '{"outcome":"ambiguous"}'::jsonb, 'multiple memberships need a connected channel');
select is(pg_temp.overview() ->> 'guildId', '00000000-0000-0000-0000-00000000c001', 'the connected channel resolves the correct guild');
select is(pg_temp.overview('820000000000000002','830000000000000002') ->> 'guildId', '00000000-0000-0000-0000-00000000c002', 'the other connected channel resolves its own guild');
update public.guild_discord set channel_id = '830000000000000001' where guild_id = '00000000-0000-0000-0000-00000000c002';
select is(pg_temp.overview(), '{"outcome":"ambiguous"}'::jsonb, 'shared channels never select an arbitrary guild');

set local role authenticated;
select throws_ok($$ select public.discord_raid_overview('820000000000000001','810000000000000001','830000000000000001') $$, '42501', null, 'authenticated clients cannot impersonate signed Discord users');
set local role anon;
select throws_ok($$ select public.discord_raid_overview('820000000000000001','810000000000000001','830000000000000001') $$, '42501', null, 'anonymous callers cannot access the overview');
set local role service_role;
select lives_ok($$ select public.discord_raid_overview('820000000000000001','810000000000000001','830000000000000001') $$, 'the signed-interaction worker can call the overview');
reset role;
-- Every continuation must be checkpointed, including the last message which carries the buttons.
update public.discord_deliveries set status = 'sending', lease_token = '00000000-0000-0000-0000-00000000cc01',
  message_ids = '[]' where id = '00000000-0000-0000-0000-00000000cd01';
select lives_ok($$ select public.checkpoint_discord_delivery('00000000-0000-0000-0000-00000000cd01',
  '00000000-0000-0000-0000-00000000cc01',
  (select jsonb_agg((840000000000000000::bigint + n)::text) from generate_series(1,12) n)) $$,
  'a full named list can checkpoint all twelve continuation messages');
select is((select jsonb_array_length(message_ids) from public.discord_deliveries where id = '00000000-0000-0000-0000-00000000cd01'), 12,
  'all continuation receipts are retained for updates and cleanup');
select ok(not public.valid_discord_posts(jsonb_build_object('2026-10-12/raid-10',
  (select jsonb_agg((840000000000000000::bigint + n)::text) from generate_series(1,21) n))), 'continuation receipts stay bounded');
select * from finish();
rollback;
