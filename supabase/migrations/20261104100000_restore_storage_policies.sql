-- Puts back who may add, read, change and remove stored files (the policies on storage.objects).
--
-- The move to the self-hosted server (31 October) copied the database with `supabase db dump`, which leaves out
-- Supabase's own schemas, storage included: the buckets and file records came across as data, but none of the
-- policies on storage.objects did. The migration history was copied too, so the migrations that made those policies
-- count as applied and never ran there. With row-level security on and no policy, the server refused every upload
-- that was not made with the service key: onboarding documents ("new row violates row-level security policy"), the
-- October payslip PDFs, profile pictures, chat attachments, signatures.
--
-- Each policy is the latest version from the migration that last made it (named above it). Dropped and made again,
-- so this changes nothing where the policies are already right (Supabase Cloud, a fresh database). Skipped where there
-- is no storage schema (the test database).
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  -- from 20261006000400_employee_avatar_storage.sql
  drop policy if exists employeeavatar_tenant_select on storage.objects;
  create policy employeeavatar_tenant_select on storage.objects for select to authenticated
    using (bucket_id = 'employeeavatar' and (storage.foldername(name))[1] = (select public.current_tenant_id())::text);

  -- from 20261012200100_employee_photo_owner_only.sql
  drop policy if exists employeeavatar_tenant_insert on storage.objects;
  create policy employeeavatar_tenant_insert on storage.objects for insert to authenticated
    with check (
    bucket_id = 'employeeavatar'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select public.current_employee_number())
    );
  drop policy if exists employeeavatar_tenant_update on storage.objects;
  create policy employeeavatar_tenant_update on storage.objects for update to authenticated
    using (
    bucket_id = 'employeeavatar'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select public.current_employee_number())
    )
    with check (
    bucket_id = 'employeeavatar'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select public.current_employee_number())
    );
  drop policy if exists employeeavatar_tenant_delete on storage.objects;
  create policy employeeavatar_tenant_delete on storage.objects for delete to authenticated
    using (
    bucket_id = 'employeeavatar'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and ((select public.can_write_employees())
    or regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select public.current_employee_number()))
    );

  -- from 20261006000900_user_preferences.sql
  drop policy if exists useravatar_insert on storage.objects;
  create policy useravatar_insert on storage.objects for insert to authenticated
    with check (
    bucket_id = 'employeeavatar'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[2] = 'user_avatars'
    and regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select auth.uid())::text
    );
  drop policy if exists useravatar_update on storage.objects;
  create policy useravatar_update on storage.objects for update to authenticated
    using (
    bucket_id = 'employeeavatar'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[2] = 'user_avatars'
    and regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select auth.uid())::text
    )
    with check (
    bucket_id = 'employeeavatar'
    and (storage.foldername(name))[2] = 'user_avatars'
    and regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select auth.uid())::text
    );
  drop policy if exists useravatar_delete on storage.objects;
  create policy useravatar_delete on storage.objects for delete to authenticated
    using (
    bucket_id = 'employeeavatar'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[2] = 'user_avatars'
    and regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select auth.uid())::text
    );

  -- from 20261007000100_private_files_storage.sql
  drop policy if exists documents_select on storage.objects;
  create policy documents_select on storage.objects for select to authenticated
    using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and ((storage.foldername(name))[2] = (select auth.uid())::text
    or (select public.has_any_module('employees', 'hr-lifecycle')))
    );
  drop policy if exists documents_insert on storage.objects;
  create policy documents_insert on storage.objects for insert to authenticated
    with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
    );
  drop policy if exists documents_delete on storage.objects;
  create policy documents_delete on storage.objects for delete to authenticated
    using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and ((storage.foldername(name))[2] = (select auth.uid())::text
    or (select public.can_write_employees()))
    );
  drop policy if exists expense_receipts_select on storage.objects;
  create policy expense_receipts_select on storage.objects for select to authenticated
    using (
    bucket_id = 'expense-receipts'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.has_any_module('expenses'))
    );
  drop policy if exists expense_receipts_insert on storage.objects;
  create policy expense_receipts_insert on storage.objects for insert to authenticated
    with check (
    bucket_id = 'expense-receipts'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[2] = 'receipts'
    and (select public.has_any_module('expenses'))
    );
  drop policy if exists expense_receipts_delete on storage.objects;
  create policy expense_receipts_delete on storage.objects for delete to authenticated
    using (
    bucket_id = 'expense-receipts'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.has_any_module('expenses'))
    );

  -- from 20261016500000_careers_api.sql
  drop policy if exists resumes_select on storage.objects;
  create policy resumes_select on storage.objects for select to authenticated
    using (
    bucket_id = 'resumes'
    and (select public.has_any_module('recruitment'))
    and exists (
    select 1 from public.job_applications ja
    where storage.objects.name = 'public/' || ja.resume_file_name
    or storage.objects.name = ja.resume_file_url
    or right(split_part(ja.resume_file_url, '?', 1), length(storage.objects.name) + 9) = '/resumes/' || storage.objects.name
    )
    );

  -- from 20261012600100_policy_files_storage.sql
  drop policy if exists documents_policies_select on storage.objects;
  create policy documents_policies_select on storage.objects for select to authenticated
    using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[3] = 'policies'
    and exists (select 1 from public.company_policy_versions v where v.file_path = name)
    );

  -- from 20261015900000_recruitment_pipeline.sql
  drop policy if exists interview_transcripts_select on storage.objects;
  create policy interview_transcripts_select on storage.objects for select to authenticated
    using (
    bucket_id = 'interview-transcripts'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.has_any_module('recruitment'))
    );
  drop policy if exists interview_transcripts_insert on storage.objects;
  create policy interview_transcripts_insert on storage.objects for insert to authenticated
    with check (
    bucket_id = 'interview-transcripts'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.has_any_module('recruitment'))
    );
  drop policy if exists interview_transcripts_delete on storage.objects;
  create policy interview_transcripts_delete on storage.objects for delete to authenticated
    using (
    bucket_id = 'interview-transcripts'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.has_any_module('recruitment'))
    );

  -- from 20261017300000_leave_documents.sql
  drop policy if exists leave_documents_select on storage.objects;
  create policy leave_documents_select on storage.objects for select to authenticated
    using (
    bucket_id = 'leave-documents'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and ((storage.foldername(name))[2] = (select auth.uid())::text
    or (select public.has_any_module('leaves'))
    or exists (select 1 from public.leave_application a
    where a.document_path = storage.objects.name or a.followup_document_path = storage.objects.name))
    );
  drop policy if exists leave_documents_insert on storage.objects;
  create policy leave_documents_insert on storage.objects for insert to authenticated
    with check (
    bucket_id = 'leave-documents'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
    );
  drop policy if exists leave_documents_delete on storage.objects;
  create policy leave_documents_delete on storage.objects for delete to authenticated
    using (
    bucket_id = 'leave-documents'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
    );

  -- from 20261017400000_contract_signing.sql
  drop policy if exists employee_contracts_select on storage.objects;
  create policy employee_contracts_select on storage.objects for select to authenticated
    using (
    bucket_id = 'employee-contracts'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and ((select public.manages_contracts())
    or (storage.foldername(name))[2] in (select public.my_contract_ids()))
    );
  drop policy if exists employee_contracts_insert on storage.objects;
  create policy employee_contracts_insert on storage.objects for insert to authenticated
    with check (
    bucket_id = 'employee-contracts'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and array_length(storage.foldername(name), 1) = 2
    and ((select public.manages_contracts())
    or ((storage.foldername(name))[2] in (select public.my_open_contract_ids())
    and storage.filename(name) like 'signed-%'
    and lower(storage.filename(name)) like '%.pdf'))
    );
  drop policy if exists employee_contracts_delete on storage.objects;
  create policy employee_contracts_delete on storage.objects for delete to authenticated
    using (
    bucket_id = 'employee-contracts'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and ((select public.manages_contracts())
    or ((storage.foldername(name))[2] in (select public.my_open_contract_ids())
    and storage.filename(name) like 'signed-%'))
    );

  -- from 20261019000000_contributions_nita.sql
  drop policy if exists contribution_documents_select on storage.objects;
  create policy contribution_documents_select on storage.objects for select to authenticated
    using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.has_module('payroll'))
    and exists (select 1 from public.employee_contributions c where c.document_path = storage.objects.name)
    );

  -- from 20261019650000_task_oversight.sql
  drop policy if exists task_attachments_select on storage.objects;
  create policy task_attachments_select on storage.objects for select to authenticated
    using (
    bucket_id = 'task-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and ((select public.oversees_tasks())
    or (storage.foldername(name))[2] in (select x::text from public.my_task_ids() x))
    );

  -- from 20261019500000_task_visibility.sql
  drop policy if exists task_attachments_insert on storage.objects;
  create policy task_attachments_insert on storage.objects for insert to authenticated
    with check (
    bucket_id = 'task-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[2] in (select x::text from public.my_task_ids() x)
    );

  -- from 20261019200000_tasks.sql
  drop policy if exists task_attachments_delete on storage.objects;
  create policy task_attachments_delete on storage.objects for delete to authenticated
    using (
    bucket_id = 'task-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (owner = (select auth.uid())
    or exists (select 1 from public.tasks t where t.id::text = (storage.foldername(name))[2] and public.can_edit_task(t.id)))
    );

  -- from 20261019600000_payslip_email_digest.sql
  drop policy if exists payslip_pdfs_select on storage.objects;
  create policy payslip_pdfs_select on storage.objects for select to authenticated
    using (
    bucket_id = 'payslip-pdfs'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and ((select public.has_module('payroll')) or public.own_payslip_pdf(name))
    );
  drop policy if exists payslip_pdfs_insert on storage.objects;
  create policy payslip_pdfs_insert on storage.objects for insert to authenticated
    with check (
    bucket_id = 'payslip-pdfs'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.has_module('payroll'))
    );
  drop policy if exists payslip_pdfs_update on storage.objects;
  create policy payslip_pdfs_update on storage.objects for update to authenticated
    using (
    bucket_id = 'payslip-pdfs'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.has_module('payroll'))
    )
    with check (
    bucket_id = 'payslip-pdfs'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.has_module('payroll'))
    );
  drop policy if exists payslip_pdfs_delete on storage.objects;
  create policy payslip_pdfs_delete on storage.objects for delete to authenticated
    using (
    bucket_id = 'payslip-pdfs'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.has_module('payroll'))
    );

  -- from 20261020100000_piece_rate_staff.sql
  drop policy if exists work_files_select on storage.objects;
  create policy work_files_select on storage.objects for select to authenticated
    using (
    bucket_id = 'work-files'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and exists (select 1 from public.contract_jobs j where j.id::text = (storage.foldername(name))[2])
    );
  drop policy if exists work_files_insert on storage.objects;
  create policy work_files_insert on storage.objects for insert to authenticated
    with check (
    bucket_id = 'work-files'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and exists (select 1 from public.contract_jobs j where j.id::text = (storage.foldername(name))[2] and j.status = 'open')
    );
  drop policy if exists work_files_delete on storage.objects;
  create policy work_files_delete on storage.objects for delete to authenticated
    using (
    bucket_id = 'work-files'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and owner = (select auth.uid())
    );

  -- from 20261022800000_work_injury_cases.sql
  drop policy if exists documents_work_injuries_select on storage.objects;
  create policy documents_work_injuries_select on storage.objects for select to authenticated
    using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[3] = 'work-injuries'
    and (select public.has_any_module('incident-reports'))
    and exists (select 1 from public.work_injury_documents d where d.file_path = storage.objects.name)
    );
  drop policy if exists documents_work_injuries_delete on storage.objects;
  create policy documents_work_injuries_delete on storage.objects for delete to authenticated
    using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[3] = 'work-injuries'
    and (select public.has_any_module('incident-reports'))
    );

  -- from 20261026000000_exit_letters_signatures_documents.sql
  drop policy if exists signatures_own_select on storage.objects;
  create policy signatures_own_select on storage.objects for select to authenticated
    using (bucket_id = 'signatures'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text);
  drop policy if exists signatures_own_insert on storage.objects;
  create policy signatures_own_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'signatures'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 2
    and lower(storage.filename(name)) like '%.png');
  drop policy if exists signatures_own_delete on storage.objects;
  create policy signatures_own_delete on storage.objects for delete to authenticated
    using (bucket_id = 'signatures'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text);
  drop policy if exists generated_documents_select on storage.objects;
  create policy generated_documents_select on storage.objects for select to authenticated
    using (bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and ((select public.reads_generated_documents()) or owner = (select auth.uid())));
  drop policy if exists generated_documents_insert on storage.objects;
  create policy generated_documents_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and array_length(storage.foldername(name), 1) = 2
    and lower(storage.filename(name)) like '%.pdf');

  -- from 20261027300000_chat_replies_media.sql
  drop policy if exists chat_attachments_select on storage.objects;
  create policy chat_attachments_select on storage.objects for select to authenticated
    using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(objects.name))[1] = (select public.current_tenant_id())::text
    and exists (select 1 from public.channels c where c.id::text = (storage.foldername(objects.name))[2])
    );
  drop policy if exists chat_attachments_insert on storage.objects;
  create policy chat_attachments_insert on storage.objects for insert to authenticated
    with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(objects.name))[1] = (select public.current_tenant_id())::text
    and exists (select 1 from public.channels c where c.id::text = (storage.foldername(objects.name))[2])
    );
  drop policy if exists chat_attachments_delete on storage.objects;
  create policy chat_attachments_delete on storage.objects for delete to authenticated
    using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(objects.name))[1] = (select public.current_tenant_id())::text
    and owner = (select auth.uid())
    );
end $$;
