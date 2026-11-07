-- ═══════════════════════════════════════════════════════════
-- Practise Hours · Studio Room (admin) — database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- If you use a different shared login email, change it in the
-- two policies below AND in admin/index.html (CONFIG.teamEmail).
-- ═══════════════════════════════════════════════════════════

-- Everything on the board, calendar, brand, content, partners and tasks
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('pin','event','brand','content','partner','task','file')),
  title       text not null,
  data        jsonb not null default '{}'::jsonb,
  created_by  text not null check (created_by in ('Abdullah','Marcus','Fatih')),
  updated_by  text check (updated_by in ('Abdullah','Marcus','Fatih')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Who did what (feeds the live Activity column)
create table if not exists public.activity (
  id          uuid primary key default gen_random_uuid(),
  who         text not null check (who in ('Abdullah','Marcus','Fatih')),
  action      text not null,
  kind        text,
  title       text,
  created_at  timestamptz not null default now()
);

create index if not exists items_kind_idx on public.items (kind);
create index if not exists activity_created_idx on public.activity (created_at desc);

-- Lock both tables: only the shared team login can read or write.
alter table public.items    enable row level security;
alter table public.activity enable row level security;

drop policy if exists "team only" on public.items;
create policy "team only" on public.items
  for all to authenticated
  using      ((auth.jwt() ->> 'email') = 'studio@indiebycinema.com')
  with check ((auth.jwt() ->> 'email') = 'studio@indiebycinema.com');

drop policy if exists "team only" on public.activity;
create policy "team only" on public.activity
  for all to authenticated
  using      ((auth.jwt() ->> 'email') = 'studio@indiebycinema.com')
  with check ((auth.jwt() ->> 'email') = 'studio@indiebycinema.com');

-- Live updates: push changes to everyone who has the page open
-- (safe to re-run: only adds a table if it isn't already live)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'items') then
    alter publication supabase_realtime add table public.items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'activity') then
    alter publication supabase_realtime add table public.activity;
  end if;
end $$;
