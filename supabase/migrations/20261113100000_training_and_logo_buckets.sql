-- Storage buckets the app uploads to that no migration ever created: training-documents and training-videos (the
-- Training page: videos, thumbnails and documents, which staff open by their public URL) and company-logo (Company
-- profile, top bar).
--
-- Since 31 October the databases are self-hosted, and a bucket exists there only if a migration made it (or it was
-- copied from Supabase Cloud). Production has no training buckets, so uploading training material fails for every
-- company; staging had no training buckets and has no company-logo bucket, so logo uploads fail there.
--
-- Each bucket is made, public, where it is missing (the app stores and opens these files by their public URL); a bucket
-- that already exists is left as it is.
--
-- Training files: reading is public (the bucket is); a login with the Training module may add, replace and remove them,
-- as it may the training_documents and training_videos rows (module_access, 20261014400000). The app saves them as
-- <category>/<uuid>.<ext>, thumbnails/<uuid>.<ext> and documents/<uuid>.<ext>, with no company folder, so these
-- policies can't limit a company to its own files; random file names keep companies from colliding.
--
-- company-logo keeps the policies both servers already have (copied from Cloud): they are created here only where
-- missing, unchanged, so a new database gets the same.
--
-- Skipped where there is no storage schema (the test database).

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public) values
    ('training-documents', 'training-documents', true),
    ('training-videos', 'training-videos', true),
    ('company-logo', 'company-logo', true)
  on conflict (id) do nothing;

  drop policy if exists training_files_select on storage.objects;
  drop policy if exists training_files_insert on storage.objects;
  drop policy if exists training_files_update on storage.objects;
  drop policy if exists training_files_delete on storage.objects;

  -- the API needs to see an object to replace or remove it
  create policy training_files_select on storage.objects for select to authenticated
    using (bucket_id in ('training-documents', 'training-videos') and (select public.has_any_module('training')));

  create policy training_files_insert on storage.objects for insert to authenticated
    with check (bucket_id in ('training-documents', 'training-videos') and (select public.has_any_module('training')));

  create policy training_files_update on storage.objects for update to authenticated
    using (bucket_id in ('training-documents', 'training-videos') and (select public.has_any_module('training')))
    with check (bucket_id in ('training-documents', 'training-videos') and (select public.has_any_module('training')));

  create policy training_files_delete on storage.objects for delete to authenticated
    using (bucket_id in ('training-documents', 'training-videos') and (select public.has_any_module('training')));

  -- company-logo: as on production
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'company-logo public read') then
    create policy "company-logo public read" on storage.objects for select
      using (bucket_id = 'company-logo');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'company-logo authenticated insert') then
    create policy "company-logo authenticated insert" on storage.objects for insert
      with check (bucket_id = 'company-logo' and auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'company-logo authenticated update') then
    create policy "company-logo authenticated update" on storage.objects for update
      using (bucket_id = 'company-logo' and auth.role() = 'authenticated')
      with check (bucket_id = 'company-logo' and auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'company-logo authenticated delete') then
    create policy "company-logo authenticated delete" on storage.objects for delete
      using (bucket_id = 'company-logo' and auth.role() = 'authenticated');
  end if;
end $$;
