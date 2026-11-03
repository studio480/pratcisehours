-- ═══════════════════════════════════════════════════════════
-- Practise Hours · Studio Room — push notifications (step 2 of setup)
-- Paste into Supabase → SQL Editor → New query → Run.
-- Replace PASTE_WEBHOOK_SECRET_HERE with your PH_WEBHOOK_SECRET.
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════

-- One row per phone/laptop that has turned notifications on, tagged with who uses it
create table if not exists public.push_subs (
  endpoint    text primary key,
  who         text not null check (who in ('Abdullah','Marcus','Fatih')),
  sub         jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "team only" on public.push_subs;
create policy "team only" on public.push_subs
  for all to authenticated
  using      ((auth.jwt() ->> 'email') = 'studio@indiebycinema.com')
  with check ((auth.jwt() ->> 'email') = 'studio@indiebycinema.com');

-- 9am Dubai morning digest (05:00 UTC), sent by the notify function
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'ph-morning-digest') then
    perform cron.unschedule('ph-morning-digest');
  end if;
end $$;
select cron.schedule(
  'ph-morning-digest',
  '0 5 * * *',
  $job$
  select net.http_post(
    url     := 'https://qpvyrqxnpzvcpbjuwqun.supabase.co/functions/v1/notify',
    headers := '{"Content-Type": "application/json", "x-ph-secret": "PASTE_WEBHOOK_SECRET_HERE"}'::jsonb,
    body    := '{"type": "digest"}'::jsonb
  );
  $job$
);

-- Fire the notify function whenever something is added or changed
-- (does the same job as a Dashboard "Database Webhook", set up in SQL instead)
create or replace function public.ph_notify_items() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  perform net.http_post(
    url     := 'https://qpvyrqxnpzvcpbjuwqun.supabase.co/functions/v1/notify',
    headers := '{"Content-Type": "application/json", "x-ph-secret": "PASTE_WEBHOOK_SECRET_HERE"}'::jsonb,
    body    := jsonb_build_object(
      'type', TG_OP, 'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(NEW),
      'old_record', case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end)
  );
  return NEW;
end $fn$;
drop trigger if exists ph_notify_items on public.items;
create trigger ph_notify_items after insert or update on public.items
  for each row execute function public.ph_notify_items();
