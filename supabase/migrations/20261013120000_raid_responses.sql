-- Players confirm a published assignment or report a late problem. Kept apart from check-ins,
-- so a response after the check-in deadline never reopens availability.
create table public.raid_responses (
  guild_id uuid not null,
  week date not null,
  raid_id text not null,
  member_id text not null,
  publication text not null,
  -- The player's assignment when they answered: character|role|start|end. A response stays
  -- current across republishing while this is unchanged, so swapping one player does not ask
  -- everyone else to confirm again; a new time or role does.
  assignment text not null,
  status text not null check (status in ('confirmed', 'unavailable')),
  note text not null default '' check (char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  primary key (guild_id, week, raid_id, member_id),
  foreign key (guild_id, member_id) references public.members(guild_id, id) on delete cascade
);
alter table public.raid_responses enable row level security;
revoke all on public.raid_responses from public, anon, authenticated;

create function public.raid_assignment(p_published jsonb, p_member_id text) returns text
language sql immutable set search_path = '' as $$
  select (e ->> 'characterId') || '|' || (e ->> 'role') || '|' || (p_published ->> 'start') || '|' || (p_published ->> 'end')
  from jsonb_array_elements(coalesce(p_published -> 'team', '[]')) e where e ->> 'memberId' = p_member_id limit 1
$$;

-- Only responses that still match the player's assignment in the current published roster.
create function public.get_raid_responses(p_guild_id uuid, p_week date, p_raid_id text)
returns setof public.raid_responses language sql stable security definer set search_path = '' as $$
  select r.* from public.raid_responses r
  join public.plans p on p.guild_id = r.guild_id and p.week = r.week and p.raid_id = r.raid_id
  where r.guild_id = p_guild_id and r.week = p_week and r.raid_id = p_raid_id
    and p.published is not null and not p.cancelled
    and r.assignment = public.raid_assignment(p.published, r.member_id)
    and (public.is_guild_officer(p_guild_id) or r.member_id = public.my_member_id(p_guild_id))
$$;

create function public.save_raid_response(p_guild_id uuid, p_week date, p_raid_id text, p_publication text, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare m text := public.my_member_id(p_guild_id); p public.plans; current_assignment text;
begin
  if m is null then raise exception 'Sign in as a member of this guild.' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('confirmed','unavailable') or char_length(coalesce(p_note,'')) > 500 then
    raise exception 'Choose a response and keep the note to 500 characters.' using errcode = '22023';
  end if;
  select * into p from public.plans where guild_id = p_guild_id and week = p_week and raid_id = p_raid_id for share;
  if p.published is null or p.cancelled or p.published ->> 'publishedAt' is distinct from p_publication then
    raise exception 'The published roster changed. Refresh it before responding.' using errcode = '40001';
  end if;
  current_assignment := public.raid_assignment(p.published, m);
  if current_assignment is null then
    raise exception 'Only rostered players can respond.' using errcode = '42501';
  end if;
  -- Deliberately separate from check-ins: late changes remain possible after their deadline.
  insert into public.raid_responses (guild_id,week,raid_id,member_id,publication,assignment,status,note,updated_at)
    values (p_guild_id,p_week,p_raid_id,m,p_publication,current_assignment,p_status,btrim(coalesce(p_note,'')),now())
  on conflict (guild_id,week,raid_id,member_id) do update set publication=excluded.publication,assignment=excluded.assignment,
    status=excluded.status,note=excluded.note,updated_at=excluded.updated_at;
end $$;

revoke execute on function public.get_raid_responses(uuid,date,text),public.save_raid_response(uuid,date,text,text,text,text) from public,anon;
revoke execute on function public.raid_assignment(jsonb,text) from public,anon,authenticated;
grant execute on function public.get_raid_responses(uuid,date,text),public.save_raid_response(uuid,date,text,text,text,text) to authenticated;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261013120000'::text $$;
