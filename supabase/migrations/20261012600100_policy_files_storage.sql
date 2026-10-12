-- Company policy files (20261012600000) live in the private "documents" bucket under <company>/<HR login>/policies/.
-- HR already uploads there (its own folder); now every signed-in member of the company may open them, so employees
-- can read what they accept. Other documents in the bucket stay as 20261007000100 set them.
-- Skipped where there is no storage schema (the test database).

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  drop policy if exists documents_policies_select on storage.objects;
  create policy documents_policies_select on storage.objects for select to authenticated
    using (
      bucket_id = 'documents'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[3] = 'policies'
      and exists (select 1 from public.company_policy_versions v where v.file_path = name)
    );
end $$;
