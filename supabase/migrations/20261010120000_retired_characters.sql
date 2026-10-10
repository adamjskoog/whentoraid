-- "Delete character" retires it instead. Rosters, published rosters, and attendance keep pointing
-- at the character, and players may not write plans, so a real delete that cleaned those up would
-- be refused. Retiring changes only the player's own character rows.
alter table public.characters add column retired boolean not null default false;

-- Same limits as before, except the 20-character cap counts only active characters. Retired ones
-- still count toward a larger cap, so retiring cannot be used to store unlimited rows.
create or replace function public.enforce_guild_limits() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'guilds' then
    if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
      raise exception 'Unknown timezone.' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'members' then
    if (select count(*) from public.members m where m.guild_id = new.guild_id and m.id <> new.id) >= 200 then
      raise exception 'A guild can have at most 200 players.' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'characters' then
    if not new.retired and (select count(*) from public.characters c
        where c.guild_id = new.guild_id and c.member_id = new.member_id and c.id <> new.id
          and not c.retired) >= 20 then
      raise exception 'A player can have at most 20 characters.' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.characters c
        where c.guild_id = new.guild_id and c.member_id = new.member_id and c.id <> new.id) >= 100 then
      raise exception 'A player can have at most 100 characters, counting deleted ones.'
        using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'checkins' then
    if new.week not between current_date - 400 and current_date + 400 then
      raise exception 'Check-ins must be for a week within a year of today.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

-- Bringing a retired character back must respect the active cap too.
drop trigger characters_limits on public.characters;
create trigger characters_limits before insert or update of member_id, retired on public.characters
  for each row execute function public.enforce_guild_limits();
