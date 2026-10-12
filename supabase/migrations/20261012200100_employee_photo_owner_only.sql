-- Profile pictures are uploaded by the employee only (FIG-765). 20261006000400 let anyone who manages employees put a
-- picture in any colleague's file; now only the employee can add or replace theirs:
--
--   <company id>/profile_images/<employee number>.<ext>   the employee whose number it is may add and replace it;
--                                                         they and people who manage employees may remove it
--
-- Reading is unchanged (public bucket). Skipped where there is no storage schema (the test database).

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  drop policy if exists employeeavatar_tenant_insert on storage.objects;
  drop policy if exists employeeavatar_tenant_update on storage.objects;
  drop policy if exists employeeavatar_tenant_delete on storage.objects;

  create policy employeeavatar_tenant_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'employeeavatar'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select public.current_employee_number())
    );

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

  create policy employeeavatar_tenant_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'employeeavatar'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and ((select public.can_write_employees())
           or regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select public.current_employee_number()))
    );
end $$;
