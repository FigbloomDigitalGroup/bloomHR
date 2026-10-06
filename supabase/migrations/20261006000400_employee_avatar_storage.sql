-- Profile pictures: who may put them in the "employeeavatar" storage bucket.
--
-- Saving a picture in the staff portal (Bio Data) failed with "new row violates row-level security policy": storage
-- refuses every upload that no policy allows, and nothing allowed this one. Pictures also all went to one shared folder
-- (profile_images/EMP-001.png), so two companies with an EMP-001 would have overwritten each other.
--
-- Pictures now live in a folder per company:  <company id>/profile_images/<employee number>.<ext>
-- and a login may add, replace or remove:
--   * a picture in its OWN company's folder, and
--   * only its own (the file is named after the login's employee number), unless it manages employees (HR, admin...).
-- Reading stays public (the bucket is public, so the picture URLs stored on employees keep working), and the folders of
-- the old layout keep being served as before.
--
-- Skipped where there is no storage schema (the test database).

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public) values ('employeeavatar', 'employeeavatar', true)
  on conflict (id) do nothing;

  drop policy if exists employeeavatar_tenant_select on storage.objects;
  drop policy if exists employeeavatar_tenant_insert on storage.objects;
  drop policy if exists employeeavatar_tenant_update on storage.objects;
  drop policy if exists employeeavatar_tenant_delete on storage.objects;

  -- the API needs to see an object to replace or remove it
  create policy employeeavatar_tenant_select on storage.objects for select to authenticated
    using (bucket_id = 'employeeavatar' and (storage.foldername(name))[1] = (select public.current_tenant_id())::text);

  create policy employeeavatar_tenant_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'employeeavatar'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and ((select public.can_write_employees())
           or regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select public.current_employee_number()))
    );

  create policy employeeavatar_tenant_update on storage.objects for update to authenticated
    using (
      bucket_id = 'employeeavatar'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and ((select public.can_write_employees())
           or regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select public.current_employee_number()))
    )
    with check (
      bucket_id = 'employeeavatar'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    );

  create policy employeeavatar_tenant_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'employeeavatar'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and ((select public.can_write_employees())
           or regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select public.current_employee_number()))
    );
end $$;
