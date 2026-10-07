-- Staff documents, expense receipts and CVs: private storage, per company.
--
-- These buckets were public and had no storage policies. Anyone holding a link could open an employee's ID card, KRA
-- certificate or contract, links were easy to guess (documents/<email name>/id_front_<time>.jpg), and nothing kept one
-- company's files from another's (two companies with a "john@" shared one folder). The buckets are now private: files
-- are opened through short-lived signed links, and storage only signs a link for someone these policies allow.
--
--   documents          <company id>/<login id>/<type>_<time>.<ext>
--                      the owner may add, see and remove their files; people who manage employees may see them, and
--                      remove them if they may edit employees
--   expense-receipts   <company id>/receipts/<random>.<ext>
--                      people with the Expenses module may add, see and remove their company's receipts
--   resumes            uploaded by the careers site (public/<file>); a recruiter may open a CV only when it belongs to
--                      one of their own company's job applications (job_applications' RLS keeps that to the company)
--
-- Files saved under the old layout are moved by scripts/move_private_files.mjs (run once with the service-role key).
-- Skipped where there is no storage schema (the test database applies this to a stand-in).

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public) values
    ('documents', 'documents', false),
    ('expense-receipts', 'expense-receipts', false),
    ('resumes', 'resumes', false)
  on conflict (id) do update set public = false;

  drop policy if exists documents_select on storage.objects;
  drop policy if exists documents_insert on storage.objects;
  drop policy if exists documents_delete on storage.objects;
  drop policy if exists expense_receipts_select on storage.objects;
  drop policy if exists expense_receipts_insert on storage.objects;
  drop policy if exists expense_receipts_delete on storage.objects;
  drop policy if exists resumes_select on storage.objects;

  -- documents ------------------------------------------------------------------------------------------------
  create policy documents_select on storage.objects for select to authenticated
    using (
      bucket_id = 'documents'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and ((storage.foldername(name))[2] = (select auth.uid())::text
           or (select public.has_any_module('employees', 'hr-lifecycle')))
    );

  create policy documents_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'documents'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[2] = (select auth.uid())::text
    );

  create policy documents_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'documents'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and ((storage.foldername(name))[2] = (select auth.uid())::text
           or (select public.can_write_employees()))
    );

  -- expense receipts -----------------------------------------------------------------------------------------
  create policy expense_receipts_select on storage.objects for select to authenticated
    using (
      bucket_id = 'expense-receipts'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (select public.has_any_module('expenses'))
    );

  create policy expense_receipts_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'expense-receipts'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[2] = 'receipts'
      and (select public.has_any_module('expenses'))
    );

  create policy expense_receipts_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'expense-receipts'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (select public.has_any_module('expenses'))
    );

  -- resumes (read only here; uploads are the careers site's business) ----------------------------------------
  create policy resumes_select on storage.objects for select to authenticated
    using (
      bucket_id = 'resumes'
      and (select public.has_any_module('recruitment'))
      and exists (
        select 1 from public.job_applications ja
        where storage.objects.name = 'public/' || ja.resume_file_name
           -- the stored link ends in /resumes/<path> (before any ?query); compared exactly, not with LIKE wildcards
           or right(split_part(ja.resume_file_url, '?', 1), length(storage.objects.name) + 9) = '/resumes/' || storage.objects.name
      )
    );
end $$;
