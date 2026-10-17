-- Roster posts become cards like the signup post: each player's class, spec and player name, in the
-- published order, plus the published role targets for the role counts. The spec chosen at signup
-- applies when that signup matches the rostered character and role.
create or replace function public.raid_delivery_payload(g uuid,w date,r text,snapshot jsonb,cancelled boolean default false,withdrawn boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('guildName', gu.name, 'raidName', coalesce(snapshot->>'raidName', 'Raid'),
    'start', snapshot->'start', 'targets', coalesce(snapshot->'targets', '[0,0,0]'),
    'cancelled', cancelled, 'withdrawn', withdrawn, 'team', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(c.name, m.name, 'Player'), 'player', m.name,
        'class', c.class, 'role', e->>'role', 'discordId', m.discord_id,
        'spec', case when s.character_id = e->>'characterId' and s.role = e->>'role'
          then coalesce(s.spec, c.spec) else c.spec end) order by t.position)
      from jsonb_array_elements(coalesce(snapshot->'team', '[]')) with ordinality t(e, position)
      left join public.members m on m.guild_id = g and m.id = e->>'memberId'
      left join public.characters c on c.guild_id = g and c.id = e->>'characterId'
      left join public.raid_signups s on s.guild_id = g and s.week = w and s.raid_id = r and s.member_id = e->>'memberId'
    ), '[]')) from public.guilds gu where gu.id = g
$$;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261021120000'::text $$;
