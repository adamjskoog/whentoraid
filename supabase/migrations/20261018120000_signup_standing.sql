-- Where a Discord sign-up stands, so the bot can tell a player privately that their role is full
-- and they are on the bench. Same rule as signupLineup in supabase/functions/_shared/signup-lineup.js:
-- players coming (signed or late) fill each role in sign-up order up to the raid's target for it
-- (0 means no limit); later ones are benched. Called only by the raid-interactions Edge Function,
-- right after signup_from_discord saved this player's sign-up.
create function public.signup_standing(p_delivery_id uuid, p_discord_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.discord_deliveries; m public.members; o record; mine record; target int;
begin
  select * into d from public.discord_deliveries where id = p_delivery_id and kind = 'signup';
  if not found then return null; end if;
  select * into m from public.members where guild_id = d.guild_id and discord_id = p_discord_id;
  if not found then return null; end if;
  select x.role, x.place into mine from (
    select s.member_id, c.role,
      row_number() over (partition by c.role order by s.signed_at, s.member_id) as place
    from public.raid_signups s
    left join public.characters c on c.guild_id = s.guild_id and c.id = s.character_id
    where s.guild_id = d.guild_id and s.week = d.week and s.raid_id = d.raid_id and s.status in ('signed', 'late')
  ) x where x.member_id = m.id;
  if not found or mine.role is null then return null; end if;
  select * into o from public.raid_occurrence(d.guild_id, d.week, d.raid_id);
  target := coalesce((o.targets ->> (array_position(array['Tank', 'Healer', 'DPS'], mine.role) - 1))::int, 0);
  return jsonb_build_object('role', mine.role, 'place', mine.place, 'target', target,
    'bench', target > 0 and mine.place > target);
end $$;

revoke execute on function public.signup_standing(uuid, text) from public, anon, authenticated;
grant execute on function public.signup_standing(uuid, text) to service_role;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261018120000'::text $$;
