-- Every five minutes, ask the raid-dispatch Edge Function to queue due reminders and send queued
-- Discord messages (including retries after a failure). It reads its address and shared secret
-- from Supabase Vault, so no secret is in this file; until both are set, the job does nothing.
--   select vault.create_secret('https://<project>.supabase.co/functions/v1/raid-dispatch', 'raid_dispatch_url');
--   select vault.create_secret('<the RAID_DISPATCH_SECRET Edge Function secret>', 'raid_dispatch_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function public.run_raid_dispatch() returns void
language plpgsql security definer set search_path = '' as $$
declare target text; secret text;
begin
  select decrypted_secret into target from vault.decrypted_secrets where name = 'raid_dispatch_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'raid_dispatch_secret';
  if target is null or secret is null then return; end if;
  perform net.http_post(
    url := target,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-raid-dispatch-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;
revoke execute on function public.run_raid_dispatch() from public, anon, authenticated;

select cron.schedule('raid-dispatch', '*/5 * * * *', 'select public.run_raid_dispatch()');

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261013140000'::text $$;
