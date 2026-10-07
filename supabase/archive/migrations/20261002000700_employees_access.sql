-- FIG-657, tier 1, batch 3: the employees table.
--
-- employees holds salaries, allowances, ID/tax/bank details and personal contacts, and about fifty
-- screens read it. Until now any signed-in user could read and rewrite all of it through the API.
--
-- New rules:
--   * READ: roles that work with employee data (any of the modules listed below) read every row; every
--     other login (in practice STAFF) reads only its own row. Colleague lookups that staff screens need
--     (chat, task assignment, birthdays, dropdown options...) go through employee_directory, a view of
--     the non-sensitive columns.
--   * WRITE: only the modules that edit employees may insert, update or delete. An employee may update
--     their own row, but a trigger limits that to personal and statutory details: a change to pay,
--     job, organisation, status or contract columns is rejected. (Clients often send the whole row back;
--     unchanged values are fine.)
--   * The restrictive tenant_isolation policy still confines everything to the caller's company.

-- Modules that may change other people's employee records.
create or replace function public.can_write_employees()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_module('employees', 'payroll', 'hr-lifecycle', 'assign-managers', 'phone-approvals')
$$;

-- Modules that may read every employee row (screens that work with employee data).
create or replace function public.can_read_employees()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_module(
    'employees', 'recruitment', 'leaves', 'performance', 'training', 'assign-managers', 'staffcheck',
    'hr-lifecycle', 'payroll', 'expenses', 'salaryadmin', 'asset', 'mpesa-zap', 'reports', 'phone-approvals',
    'adminconfirm', 'incident-reports', 'settings', 'sms', 'email-portal', 'ai-assistant')
$$;

revoke all on function public.can_write_employees() from public, anon;
revoke all on function public.can_read_employees() from public, anon;
grant execute on function public.can_write_employees() to authenticated, service_role;
grant execute on function public.can_read_employees() to authenticated, service_role;

-- Policies -------------------------------------------------------------------------------------
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'employees' and policyname <> 'tenant_isolation'
  loop
    execute format('drop policy %I on public.employees', pol.policyname);
  end loop;
end $$;

create policy module_select on public.employees for select to authenticated
  using ((select public.can_read_employees()));
create policy own_select on public.employees for select to authenticated
  using ("Employee Number" = (select public.current_employee_number()));

create policy module_insert on public.employees for insert to authenticated
  with check (public.has_any_module('employees', 'payroll'));
create policy module_update on public.employees for update to authenticated
  using ((select public.can_write_employees())) with check ((select public.can_write_employees()));
create policy own_update on public.employees for update to authenticated
  using ("Employee Number" = (select public.current_employee_number()))
  with check ("Employee Number" = (select public.current_employee_number()));
create policy module_delete on public.employees for delete to authenticated
  using (public.has_module('employees'));

-- An employee editing their own row may only change personal and statutory details ---------------
create or replace function public.guard_employee_self_update()
returns trigger
language plpgsql
as $$
declare
  k text;
  allowed text[] := array[
    'First Name', 'Middle Name', 'Last Name', 'Personal Mobile', 'Alternative Mobile Number', 'Personal Email',
    'Date of Birth', 'Gender', 'Marital Status', 'Country', 'Postal Address', 'Postal Code', 'Postal Location',
    'City', 'Area', 'Road', 'House Number', 'passport_number', 'blood_group', 'religion',
    'Type of Identification', 'ID Number', 'Profile Image',
    'Tax PIN', 'NHIF Number', 'SHIF Number', 'NSSF Number', 'WIBA', 'Pension Start Date', 'Employee AVC',
    'Employer AVC', 'Pension Deduction', 'NSSF Deduction', 'NHIF Deduction', 'Housing Levy Deduction',
    'Tax Exempted', 'Disability Cert No', 'NITA', 'NITA Deductions', 'HELB', 'HELB option'
  ];
begin
  -- the backend (service role / migrations) and people who manage employees are not limited
  if auth.uid() is null or public.can_write_employees() then
    return new;
  end if;

  for k in
    select o.key from jsonb_each(to_jsonb(old)) o
    join jsonb_each(to_jsonb(new)) n on n.key = o.key
    where o.value is distinct from n.value
  loop
    if k <> all (allowed) then
      raise exception 'You can only change your own personal details (not "%")', k
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists employees_guard_self_update on public.employees;
create trigger employees_guard_self_update
  before update on public.employees
  for each row execute function public.guard_employee_self_update();

-- The directory: colleague lookups without pay, ID, tax, bank or personal contact details --------
-- Runs with the owner's rights (so it can read rows the caller's own policies hide) and applies the
-- tenant filter itself.
do $$
declare
  wanted text[] := array[
    'Employee Number', 'Employee Id', 'First Name', 'Middle Name', 'Last Name', 'Work Email', 'Work Mobile',
    'Job Title', 'Job Level', 'Job Group', 'Employee Type', 'Entity', 'Status', 'Town', 'Branch', 'Office', 'Area',
    'Manager', 'manager_email', 'regional_manager', 'Leave Approver', 'Alternate Approver',
    'second_level_leave_approver', 'alternate_second_level_approver', 'Date of Birth', 'Start Date', 'Profile Image'
  ];
  c text;
  cols text := 'e.tenant_id';
begin
  -- a column missing from this database is exposed as NULL so the view shape stays the same
  foreach c in array wanted loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'employees' and column_name = c) then
      cols := cols || format(', e.%I', c);
    else
      cols := cols || format(', null::text as %I', c);
    end if;
  end loop;
  execute 'drop view if exists public.employee_directory';
  execute format(
    'create view public.employee_directory with (security_barrier = true) as '
    'select %s from public.employees e where e.tenant_id = (select public.current_tenant_id())', cols);
end $$;

revoke all on public.employee_directory from public, anon;
grant select on public.employee_directory to authenticated, service_role;

notify pgrst, 'reload schema';
