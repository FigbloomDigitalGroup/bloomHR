-- Deleting an employee (HR): for records added by mistake, test data, or people who never started. Someone who was
-- paid is terminated instead, because their approved payslips must be kept.
--
-- delete_employee(id, confirm):
--   confirm = false   says what would happen, deleting nothing: why it can't be deleted (if so), whether the
--                     employee has a login in this company, and how many documents and leave applications go with them
--   confirm = true    deletes: draft payslips and leave applications (the one table that would otherwise stop the
--                     delete), the employee (contacts, next of kin, documents, referees, health records, policy
--                     acceptances, onboarding history... go with it), and cancels their pending invitations. Returns the
--                     files to remove from storage and their login, which an administrator can then remove from the
--                     company (DELETE /api/admin/users/:id).
-- Refused for: people without the employees module, your own record, and anyone with payslips in an approved or paid
-- month. Audited (the employees audit trigger records the deleted row).

create or replace function public.delete_employee(p_employee uuid, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
  locked integer;
  login uuid;
  files text[];
  leave_count integer;
  documents integer;
  reason text;
begin
  if not public.has_module('employees') then
    raise exception 'Only HR can delete employees' using errcode = '42501';
  end if;
  select * into e from public.employees where id = p_employee and tenant_id = public.current_tenant_id();
  if e.id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  select count(*) into locked
  from public.salary_history h join public.payroll_runs r on r.id = h.run_id
  where h.tenant_id = e.tenant_id and h.employee_id = e."Employee Number" and r.status in ('approved', 'paid');

  if e."Employee Number" = public.current_employee_number() then
    reason := 'You can''t delete your own employee record';
  elsif locked > 0 then
    reason := 'They have payslips in approved payroll months, which must be kept. Terminate them instead.';
  end if;

  select u.id into login
  from auth.users u join public.memberships m on m.user_id = u.id and m.tenant_id = e.tenant_id
  where lower(u.email) = lower(btrim(coalesce(e."Work Email", '')))
  limit 1;

  select array_agg(x.file_path) into files from (
    select d.file_path from public.employee_documents d where d.employee_id = e.id
    union all
    select f.file_path from public.employee_health_files f join public.employee_health_records r on r.id = f.record_id
    where r.employee_id = e.id
  ) x;
  select count(*) into documents from public.employee_documents d where d.employee_id = e.id;
  select count(*) into leave_count from public.leave_application l where l.tenant_id = e.tenant_id and l."Employee Number" = e."Employee Number";

  if not p_confirm then
    return jsonb_build_object(
      'employee_number', e."Employee Number",
      'name', btrim(concat_ws(' ', e."First Name", e."Middle Name", e."Last Name")),
      'blocked', reason,
      'has_login', login is not null,
      'documents', documents,
      'leave_applications', leave_count
    );
  end if;

  if reason is not null then
    raise exception '%', reason using errcode = '42501';
  end if;

  delete from public.salary_history where tenant_id = e.tenant_id and employee_id = e."Employee Number";
  delete from public.leave_application where tenant_id = e.tenant_id and "Employee Number" = e."Employee Number";
  update public.invitations set status = 'revoked'
  where tenant_id = e.tenant_id and lower(email) = lower(btrim(coalesce(e."Work Email", ''))) and status = 'pending';
  delete from public.employees where id = e.id;

  return jsonb_build_object(
    'employee_number', e."Employee Number",
    'login_user_id', login,
    'files', coalesce(to_jsonb(files), '[]'::jsonb)
  );
end $$;

revoke all on function public.delete_employee(uuid, boolean) from public, anon;
grant execute on function public.delete_employee(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
