-- ═══════════════════════════════════════════════════════════
-- Practise Hours · Studio Room — Files (step 3 of setup)
-- Paste into Supabase → SQL Editor → New query → Run. Safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- Let the items table hold file records
alter table public.items drop constraint if exists items_kind_check;
alter table public.items add constraint items_kind_check
  check (kind in ('pin','event','brand','content','partner','task','file'));

-- A private storage bucket (50MB per file)
insert into storage.buckets (id, name, public, file_size_limit)
values ('studio-files', 'studio-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- Only the team login can upload, see, download or delete files in it
drop policy if exists "studio files team" on storage.objects;
create policy "studio files team" on storage.objects
  for all to authenticated
  using      (bucket_id = 'studio-files' and lower(auth.jwt() ->> 'email') = 'studio@indiebycinema.com')
  with check (bucket_id = 'studio-files' and lower(auth.jwt() ->> 'email') = 'studio@indiebycinema.com');
