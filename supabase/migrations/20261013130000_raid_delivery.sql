-- Durable Discord delivery, scheduled reminders and private calendar feeds.
-- Network calls happen only in the raid-dispatch Edge Function, never inside a transaction: saving
-- a plan writes an outbox row that becomes visible when the save commits. Reminders start disabled.
create table public.raid_calendar_tokens (
  guild_id uuid not null,
  member_id text not null,
  user_id uuid not null references auth.users on delete cascade,
  token_hash text not null unique,
  primary key (guild_id, member_id),
  foreign key (guild_id, member_id) references public.members(guild_id,id) on delete cascade
);
create table public.raid_calendar_events (
  guild_id uuid not null,
  member_id text not null,
  week date not null,
  raid_id text not null,
  start_ms bigint not null,
  end_ms bigint not null,
  title text not null,
  description text not null,
  cancelled boolean not null default false,
  sequence bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (guild_id,member_id,week,raid_id),
  foreign key (guild_id,member_id) references public.members(guild_id,id) on delete cascade
);
alter table public.raid_calendar_tokens enable row level security;
alter table public.raid_calendar_events enable row level security;
revoke all on public.raid_calendar_tokens,public.raid_calendar_events from public,anon,authenticated;

create function public.create_raid_calendar(p_guild_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare m text := public.my_member_id(p_guild_id); token text := encode(extensions.gen_random_bytes(32),'hex');
begin
  if m is null then raise exception 'Sign in as a member of this guild.' using errcode = '42501'; end if;
  insert into public.raid_calendar_tokens values(p_guild_id,m,auth.uid(),encode(extensions.digest(token,'sha256'),'hex'))
  on conflict(guild_id,member_id) do update set token_hash=excluded.token_hash,user_id=excluded.user_id;
  return token;
end $$;
create function public.revoke_raid_calendar(p_guild_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.raid_calendar_tokens where guild_id=p_guild_id and member_id=public.my_member_id(p_guild_id)
$$;
-- Called only by the calendar Edge Function. The raw token is not stored or logged.
create function public.read_raid_calendar(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.raid_calendar_tokens; result jsonb;
begin
  if p_token !~ '^[a-f0-9]{64}$' then return null; end if;
  select tok.* into t from public.raid_calendar_tokens tok
  join public.members m on m.guild_id=tok.guild_id and m.id=tok.member_id
  where tok.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and exists (
    select 1 from auth.identities i where i.user_id=tok.user_id and i.provider='discord' and i.provider_id=m.discord_id
  );
  if not found then return null; end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.start_ms),'[]') into result from public.raid_calendar_events e
  where e.guild_id=t.guild_id and e.member_id=t.member_id
    -- Recent and upcoming raids only, so a feed does not grow forever.
    and e.end_ms > extract(epoch from now() - interval '60 days') * 1000;
  return result;
end $$;

create table public.raid_reminder_settings (
  guild_id uuid primary key references public.guilds on delete cascade,
  checkin_enabled boolean not null default false,
  upcoming_enabled boolean not null default false,
  interval_hours int not null default 24 check(interval_hours in (6,12,24,48,72,168)),
  lead_hours int not null default 24 check(lead_hours between 1 and 72),
  only_unconfirmed boolean not null default true,
  next_checkin_at timestamptz not null default now()
);
alter table public.raid_reminder_settings enable row level security;
revoke all on public.raid_reminder_settings from public,anon,authenticated;
create function public.get_raid_reminders(p_guild_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_guild_officer(p_guild_id);
  select to_jsonb(s)-'guild_id'-'next_checkin_at' into result from public.raid_reminder_settings s where guild_id=p_guild_id;
  return coalesce(result,'{"checkin_enabled":false,"upcoming_enabled":false,"interval_hours":24,"lead_hours":24,"only_unconfirmed":true}');
end $$;
create function public.set_raid_reminders(p_guild_id uuid,p_settings jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_guild_officer(p_guild_id);
  insert into public.raid_reminder_settings(guild_id,checkin_enabled,upcoming_enabled,interval_hours,lead_hours,only_unconfirmed)
  values(p_guild_id,coalesce((p_settings->>'checkin_enabled')::boolean,false),coalesce((p_settings->>'upcoming_enabled')::boolean,false),
    coalesce((p_settings->>'interval_hours')::int,24),coalesce((p_settings->>'lead_hours')::int,24),coalesce((p_settings->>'only_unconfirmed')::boolean,true))
  on conflict(guild_id) do update set checkin_enabled=excluded.checkin_enabled,upcoming_enabled=excluded.upcoming_enabled,
    interval_hours=excluded.interval_hours,lead_hours=excluded.lead_hours,only_unconfirmed=excluded.only_unconfirmed;
end $$;

create table public.discord_deliveries (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references public.guilds on delete cascade,
  delivery_key text not null,
  week date not null,
  raid_id text,
  kind text not null check(kind in ('roster','checkin','upcoming')),
  action text not null default 'post' check(action in ('post','delete')),
  payload jsonb not null,
  webhook_fingerprint text not null,
  message_ids jsonb not null default '[]',
  version bigint not null default 1,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed','uncertain')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  unique(guild_id,delivery_key)
);
create index discord_deliveries_due on public.discord_deliveries(next_attempt_at) where status='pending';
alter table public.discord_deliveries enable row level security;
revoke all on public.discord_deliveries from public,anon,authenticated;

create function public.raid_delivery_payload(g uuid,w date,r text,snapshot jsonb,cancelled boolean default false,withdrawn boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('guildName',gu.name,'raidName',coalesce(snapshot->>'raidName','Raid'),'start',snapshot->'start',
    'cancelled',cancelled,'withdrawn',withdrawn,'team',coalesce((
      select jsonb_agg(jsonb_build_object('name',coalesce(c.name,m.name,'Player'),'role',e->>'role','discordId',m.discord_id))
      from jsonb_array_elements(coalesce(snapshot->'team','[]')) e
      left join public.members m on m.guild_id=g and m.id=e->>'memberId'
      left join public.characters c on c.guild_id=g and c.id=e->>'characterId'
    ),'[]')) from public.guilds gu where gu.id=g
$$;

create function public.enqueue_roster_delivery(g uuid,w date,r text,snapshot jsonb,cancelled boolean,withdrawn boolean,action text default 'post')
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; d public.guild_discord; k text := w::text||'/'||r;
begin
  select * into d from public.guild_discord where guild_id=g;
  if not found then raise exception 'Set a Discord channel in Guild settings first.' using errcode='22023'; end if;
  insert into public.discord_deliveries(guild_id,delivery_key,week,raid_id,kind,action,payload,webhook_fingerprint,message_ids)
  values(g,k,w,r,'roster',action,public.raid_delivery_payload(g,w,r,snapshot,cancelled,withdrawn),md5(d.webhook_url),coalesce(d.posts->k,'[]'))
  on conflict(guild_id,delivery_key) do update set payload=excluded.payload,action=excluded.action,version=discord_deliveries.version+1,
    -- An uncertain send stays uncertain until an officer checks Discord and retries, so it is never duplicated.
    status=case when discord_deliveries.status in ('sending','uncertain') then discord_deliveries.status else 'pending' end,
    message_ids=case when discord_deliveries.webhook_fingerprint=excluded.webhook_fingerprint then discord_deliveries.message_ids else excluded.message_ids end,
    webhook_fingerprint=excluded.webhook_fingerprint,attempts=0,next_attempt_at=now(),last_error=null,updated_at=now()
  returning id into result;
  return result;
end $$;

create function public.queue_discord_delivery(p_guild_id uuid,p_week date,p_raid_id text,p_action text default 'post') returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.plans;
begin
  perform public.require_guild_officer(p_guild_id);
  if p_action is null or p_action not in ('post','delete') then raise exception 'Invalid delivery action.' using errcode='22023'; end if;
  select * into p from public.plans where guild_id=p_guild_id and week=p_week and raid_id=p_raid_id for share;
  if not found then raise exception 'Save and publish this roster before posting it.' using errcode='22023'; end if;
  if p_action='post' and (p.published is null or p.cancelled) then
    raise exception 'Save and publish this roster before posting it.' using errcode='22023';
  end if;
  return public.enqueue_roster_delivery(p_guild_id,p_week,p_raid_id,p.published,coalesce(p.cancelled,false),p.published is null,p_action);
end $$;

create function public.get_discord_deliveries(p_guild_id uuid,p_week date,p_raid_id text)
returns table(id uuid,status text,action text,attempts int,last_error text,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_guild_officer(p_guild_id);
  return query select d.id,d.status,d.action,d.attempts,d.last_error,d.updated_at from public.discord_deliveries d
    where d.guild_id=p_guild_id and d.week=p_week and d.raid_id=p_raid_id and d.kind='roster';
end $$;
create function public.retry_discord_delivery(p_guild_id uuid,p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_guild_officer(p_guild_id);
  update public.discord_deliveries set status='pending',attempts=0,next_attempt_at=now(),last_error=null,updated_at=now()
    where guild_id=p_guild_id and id=p_id and status in ('failed','uncertain','pending');
end $$;

-- Changes to drafts/attendance never alter published deliveries. Commit makes the outbox visible.
create function public.capture_raid_publication() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.plans; prior public.plans; e jsonb; gu public.guilds; k text; cancel boolean;
begin
  if tg_op='DELETE' then p:=old; p.published:=null; p.cancelled:=true; prior:=old;
  else p:=new; if tg_op='UPDATE' then prior:=old; end if; end if;
  if tg_op='UPDATE' and p.published is not distinct from prior.published and p.cancelled=prior.cancelled then return new; end if;
  select * into gu from public.guilds where id=p.guild_id;
  cancel:=p.cancelled or p.published is null;
  -- Removed members retain cancellation tombstones so subscribed clients remove old assignments.
  update public.raid_calendar_events ce set cancelled=true,sequence=sequence+1,updated_at=now()
  where ce.guild_id=p.guild_id and ce.week=p.week and ce.raid_id=p.raid_id and not ce.cancelled
    and (cancel or not exists(select 1 from jsonb_array_elements(p.published->'team') x where x->>'memberId'=ce.member_id));
  if not cancel then
    for e in select * from jsonb_array_elements(p.published->'team') loop
      insert into public.raid_calendar_events(guild_id,member_id,week,raid_id,start_ms,end_ms,title,description)
      select p.guild_id,e->>'memberId',p.week,p.raid_id,(p.published->>'start')::numeric::bigint,(p.published->>'end')::numeric::bigint,
        gu.name||' · '||(p.published->>'raidName'),coalesce(c.name,m.name)||' · '||(e->>'role')
      from public.members m left join public.characters c on c.guild_id=p.guild_id and c.id=e->>'characterId'
      where m.guild_id=p.guild_id and m.id=e->>'memberId'
      on conflict(guild_id,member_id,week,raid_id) do update set start_ms=excluded.start_ms,end_ms=excluded.end_ms,title=excluded.title,
        description=excluded.description,cancelled=false,sequence=raid_calendar_events.sequence+1,updated_at=now();
    end loop;
  end if;
  k:=p.week::text||'/'||p.raid_id;
  -- Follow only a roster already posted (or being posted) to the channel connected now: after an
  -- officer switches channels, old raids are not posted to the new one unasked.
  if exists(select 1 from public.guild_discord d where d.guild_id=p.guild_id and (d.posts ? k or exists(
      select 1 from public.discord_deliveries q where q.guild_id=p.guild_id and q.delivery_key=k and q.action<>'delete'
        and q.webhook_fingerprint=md5(d.webhook_url)))) then
    perform public.enqueue_roster_delivery(p.guild_id,p.week,p.raid_id,coalesce(p.published,prior.published),p.cancelled,p.published is null);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger capture_raid_publication after insert or update or delete on public.plans for each row execute function public.capture_raid_publication();

-- Backfill calendar events for existing published rosters without queueing any network delivery.
insert into public.raid_calendar_events(guild_id,member_id,week,raid_id,start_ms,end_ms,title,description,cancelled)
select p.guild_id,m.id,p.week,p.raid_id,(p.published->>'start')::numeric::bigint,(p.published->>'end')::numeric::bigint,
  g.name||' · '||(p.published->>'raidName'),coalesce(c.name,m.name)||' · '||(e->>'role'),p.cancelled
from public.plans p join public.guilds g on g.id=p.guild_id
cross join lateral jsonb_array_elements(p.published->'team') e
join public.members m on m.guild_id=p.guild_id and m.id=e->>'memberId'
left join public.characters c on c.guild_id=p.guild_id and c.id=e->>'characterId'
where p.published is not null;

-- Service-only claims serialize each guild. A lost lease is ambiguous and needs human reconciliation.
create function public.claim_discord_delivery(p_guild_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.discord_deliveries; hook public.guild_discord;
begin
  update public.discord_deliveries set status='uncertain',last_error='Delivery was interrupted. Check Discord before retrying.',lease_token=null,lease_until=null
    where status='sending' and lease_until<now() and (p_guild_id is null or guild_id=p_guild_id);
  for d in select * from public.discord_deliveries q where q.status='pending' and q.next_attempt_at<=now()
    and (p_guild_id is null or q.guild_id=p_guild_id)
    and not exists(select 1 from public.discord_deliveries busy where busy.guild_id=q.guild_id and busy.status='sending')
    order by q.next_attempt_at for update skip locked limit 50 loop
    -- An advisory transaction lock also prevents two workers claiming different rows of the same guild.
    if not pg_try_advisory_xact_lock(hashtextextended(d.guild_id::text,0)) then continue; end if;
    if exists(select 1 from public.discord_deliveries busy where busy.guild_id=d.guild_id and busy.status='sending') then continue; end if;
    select * into hook from public.guild_discord where guild_id=d.guild_id;
    if hook.webhook_url is null or md5(hook.webhook_url)<>d.webhook_fingerprint then
      update public.discord_deliveries set status='failed',last_error='The Discord channel changed. Post the roster again.',updated_at=now() where id=d.id;
      continue;
    end if;
    update public.discord_deliveries set status='sending',lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',attempts=attempts+1,updated_at=now()
      where id=d.id returning * into d;
    return to_jsonb(d)||jsonb_build_object('webhook_url',hook.webhook_url,'mention_players',hook.mention_players);
  end loop;
  return null;
end $$;

create function public.checkpoint_discord_delivery(p_id uuid,p_lease uuid,p_message_ids jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.discord_deliveries;
begin
  select * into d from public.discord_deliveries where id=p_id and lease_token=p_lease and status='sending' for update;
  if not found then raise exception 'Delivery lease expired.' using errcode='40001'; end if;
  if not public.valid_discord_posts(jsonb_build_object(d.week::text||'/'||coalesce(d.raid_id,'reminder'),p_message_ids)) and p_message_ids<>'[]' then
    raise exception 'Invalid message identifiers.' using errcode='22023';
  end if;
  update public.discord_deliveries set message_ids=p_message_ids,lease_until=now()+interval '10 minutes' where id=p_id;
  if d.kind='roster' then
    update public.guild_discord set posts=(
      -- Same 90-day window as record_discord_post, so the column stays within its size limit.
      select coalesce(jsonb_object_agg(e.key,e.value),'{}') from jsonb_each(case when p_message_ids='[]' then posts-d.delivery_key
        else jsonb_set(posts,array[d.delivery_key],p_message_ids) end) e where left(e.key,10)::date >= current_date-90)
      where guild_id=d.guild_id and md5(webhook_url)=d.webhook_fingerprint;
  end if;
end $$;

create function public.finish_discord_delivery(p_id uuid,p_lease uuid,p_version bigint,p_error text default null,p_uncertain boolean default false,p_retry_seconds int default 0) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.discord_deliveries set
    status=case when p_uncertain then 'uncertain' when version<>p_version then 'pending' when p_error is null then 'sent' when attempts>=5 then 'failed' else 'pending' end,
    last_error=left(p_error,500),lease_token=null,lease_until=null,updated_at=now(),
    -- Back off only after an error; a newer version waiting behind a finished send goes straight away.
    next_attempt_at=case when p_error is null and not p_uncertain then now()
      else now()+make_interval(secs=>greatest(least(coalesce(p_retry_seconds,0),86400),least(3600,(30*power(2,attempts))::int))) end
  where id=p_id and lease_token=p_lease and status='sending';
end $$;

-- A scheduler calls this before dispatching. Unique keys make repeated ticks harmless.
create function public.enqueue_due_raid_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare s record; p record; w date; k text; deadline timestamptz;
begin
  -- Finished reminders are only kept long enough to deduplicate scheduler runs.
  delete from public.discord_deliveries where kind<>'roster' and status in ('sent','failed') and updated_at<now()-interval '30 days';
  for s in select rs.*,g.timezone,d.webhook_url from public.raid_reminder_settings rs join public.guilds g on g.id=rs.guild_id
    join public.guild_discord d on d.guild_id=rs.guild_id where rs.checkin_enabled or rs.upcoming_enabled
    for update of rs skip locked loop
    w:=date_trunc('week',now() at time zone s.timezone)::date;
    deadline:=public.checkin_deadline(s.guild_id,w);
    if s.checkin_enabled and s.next_checkin_at<=now() and (deadline is null or deadline>now()) then
      k:='checkin:'||w::text||':'||floor(extract(epoch from now())/(s.interval_hours*3600))::text;
      insert into public.discord_deliveries(guild_id,delivery_key,week,kind,payload,webhook_fingerprint)
      values(s.guild_id,k,w,'checkin','{}',md5(s.webhook_url)) on conflict(guild_id,delivery_key) do nothing;
      update public.raid_reminder_settings set next_checkin_at=now()+make_interval(hours=>s.interval_hours) where guild_id=s.guild_id;
    end if;
    if s.upcoming_enabled then
      for p in select * from public.plans where guild_id=s.guild_id and published is not null and not cancelled
        and (published->>'start')::numeric>extract(epoch from now())*1000
        and (published->>'start')::numeric<=extract(epoch from now()+make_interval(hours=>s.lead_hours))*1000 loop
        k:='upcoming:'||p.week::text||'/'||p.raid_id||':'||(p.published->>'start');
        insert into public.discord_deliveries(guild_id,delivery_key,week,raid_id,kind,payload,webhook_fingerprint)
        values(s.guild_id,k,p.week,p.raid_id,'upcoming','{}',md5(s.webhook_url)) on conflict(guild_id,delivery_key) do nothing;
      end loop;
    end if;
  end loop;
end $$;

-- Resolve reminder recipients at send time, so late check-ins and cancellations suppress old nudges.
create function public.raid_reminder_payload(p_id uuid,p_lease uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.discord_deliveries; s public.raid_reminder_settings; p public.plans; recipients jsonb; deadline timestamptz;
begin
  select * into d from public.discord_deliveries where id=p_id and lease_token=p_lease and status='sending';
  if not found then return null; end if;
  select * into s from public.raid_reminder_settings where guild_id=d.guild_id;
  if d.kind='checkin' then
    deadline:=public.checkin_deadline(d.guild_id,d.week);
    if not coalesce(s.checkin_enabled,false) or (deadline is not null and deadline<=now()) then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_object('name',m.name,'discordId',m.discord_id)),'[]') into recipients
      from public.members m where m.guild_id=d.guild_id and not exists(select 1 from public.checkins c
        where c.guild_id=d.guild_id and c.week=d.week and c.member_id=m.id and c.checked_in);
    return jsonb_build_object('kind','checkin','week',d.week,'recipients',recipients);
  end if;
  select * into p from public.plans where guild_id=d.guild_id and week=d.week and raid_id=d.raid_id;
  if not coalesce(s.upcoming_enabled,false) or p.published is null or p.cancelled or (p.published->>'start')::numeric<=extract(epoch from now())*1000 then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name',m.name,'discordId',m.discord_id)),'[]') into recipients
    from jsonb_array_elements(p.published->'team') e join public.members m on m.guild_id=d.guild_id and m.id=e->>'memberId'
    left join public.raid_responses r on r.guild_id=d.guild_id and r.week=d.week and r.raid_id=d.raid_id and r.member_id=m.id
      and r.assignment=public.raid_assignment(p.published,m.id)
    where r.status is distinct from 'unavailable' and (not s.only_unconfirmed or r.status is distinct from 'confirmed');
  return jsonb_build_object('kind','upcoming','raidName',p.published->>'raidName','start',p.published->'start','recipients',recipients);
end $$;

revoke execute on function
  public.create_raid_calendar(uuid),public.revoke_raid_calendar(uuid),public.get_raid_reminders(uuid),public.set_raid_reminders(uuid,jsonb),
  public.queue_discord_delivery(uuid,date,text,text),public.get_discord_deliveries(uuid,date,text),public.retry_discord_delivery(uuid,uuid)
  from public,anon;
grant execute on function
  public.create_raid_calendar(uuid),public.revoke_raid_calendar(uuid),public.get_raid_reminders(uuid),public.set_raid_reminders(uuid,jsonb),
  public.queue_discord_delivery(uuid,date,text,text),public.get_discord_deliveries(uuid,date,text),public.retry_discord_delivery(uuid,uuid)
  to authenticated;
-- Worker-only functions: callable with the service key from the Edge Functions, by no one else.
revoke execute on function public.read_raid_calendar(text),public.raid_delivery_payload(uuid,date,text,jsonb,boolean,boolean),
  public.enqueue_roster_delivery(uuid,date,text,jsonb,boolean,boolean,text),public.capture_raid_publication(),
  public.claim_discord_delivery(uuid),public.checkpoint_discord_delivery(uuid,uuid,jsonb),
  public.finish_discord_delivery(uuid,uuid,bigint,text,boolean,int),public.enqueue_due_raid_reminders(),public.raid_reminder_payload(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.read_raid_calendar(text),public.claim_discord_delivery(uuid),public.checkpoint_discord_delivery(uuid,uuid,jsonb),
  public.finish_discord_delivery(uuid,uuid,bigint,text,boolean,int),public.enqueue_due_raid_reminders(),public.raid_reminder_payload(uuid,uuid)
  to service_role;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261013130000'::text $$;
