-- FIG-657, tier 1, batch 2: tables that staff also use for their own records.
--
-- Same model as batch 1 (a role reaches the table through the module permissions of the screens that
-- use it), plus: an employee may always work with THEIR OWN rows, as the Staff Portal needs. "Own"
-- means the row's employee number is the one of the employee whose Work Email is the caller's login
-- email - the same exact match the Staff Portal itself uses to find a staff member.
--
-- Staff may only create rows in their initial state (a new advance/loan request is 'Pending', never
-- already approved or paid), and anonymous incident reports cannot be linked to anyone.

-- The caller's employee number, or NULL when the login is not linked to an employee.
create or replace function public.current_employee_number()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select e."Employee Number"
  from public.employees e
  join auth.users u on u.id = auth.uid()
  where e.tenant_id = (select public.current_tenant_id())
    and e."Work Email" = u.email
  limit 1
$$;

revoke all on function public.current_employee_number() from public, anon;
grant execute on function public.current_employee_number() to authenticated, service_role;

-- Start from a clean slate on these tables: drop every policy except the tenant rule.
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array[
    'payroll_records', 'payroll_records_current', 'salary_history', 'salary_advance', 'loan_requests',
    'warnings', 'incident_reports', 'phone_number_change_requests', 'dependents', 'emergency_contact'
  ] loop
    continue when to_regclass(format('public.%I', t)) is null;
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t and policyname <> 'tenant_isolation'
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end $$;

-- Policies, created only on tables that exist in this database.
-- payroll: finance staff see everything, an employee sees their own payslips (read-only).
-- salary advances / loans: approvers manage them, an employee reads their own and files a new Pending one
--   (the /loanadmin screen has no module of its own).
-- warnings: issued by staffcheck users, an employee can read their own.
-- incident reports: reviewers see all; an employee sees their own identified reports and files new ones
--   (anonymous ones carry no employee number, so nobody but a reviewer can read them back).
-- phone number change requests: approvers handle them, an employee files one and may cancel a pending one.
-- dependents / emergency contact: HR edits them, the employee maintains their own.
do $$
declare
  p record;
begin
  for p in
    select * from (values
      ('payroll_records', $q$create policy module_access on public.payroll_records for all to authenticated
  using (public.has_any_module('payroll', 'hr-lifecycle')) with check (public.has_any_module('payroll', 'hr-lifecycle'))$q$),
      ('payroll_records', $q$create policy own_select on public.payroll_records for select to authenticated
  using ("Employee ID" = (select public.current_employee_number()))$q$),
      ('payroll_records_current', $q$create policy module_access on public.payroll_records_current for all to authenticated
  using (public.has_any_module('payroll', 'hr-lifecycle')) with check (public.has_any_module('payroll', 'hr-lifecycle'))$q$),
      ('payroll_records_current', $q$create policy own_select on public.payroll_records_current for select to authenticated
  using ("Employee ID" = (select public.current_employee_number()))$q$),
      ('salary_history', $q$create policy module_access on public.salary_history for all to authenticated
  using (public.has_any_module('payroll', 'hr-lifecycle')) with check (public.has_any_module('payroll', 'hr-lifecycle'))$q$),
      ('salary_history', $q$create policy own_select on public.salary_history for select to authenticated
  using (employee_id = (select public.current_employee_number()))$q$),
      ('salary_advance', $q$create policy module_access on public.salary_advance for all to authenticated
  using (public.has_any_module('salaryadmin', 'payroll', 'reports'))
  with check (public.has_any_module('salaryadmin', 'payroll', 'reports'))$q$),
      ('salary_advance', $q$create policy own_select on public.salary_advance for select to authenticated
  using ("Employee Number" = (select public.current_employee_number()))$q$),
      ('salary_advance', $q$create policy own_insert on public.salary_advance for insert to authenticated
  with check (
    "Employee Number" = (select public.current_employee_number())
    and coalesce(status, 'Pending') = 'Pending'
    and payment_processed is distinct from 'true'
  )$q$),
      ('loan_requests', $q$create policy module_access on public.loan_requests for all to authenticated
  using (public.has_any_module('salaryadmin', 'settings', 'payroll'))
  with check (public.has_any_module('salaryadmin', 'settings', 'payroll'))$q$),
      ('loan_requests', $q$create policy own_select on public.loan_requests for select to authenticated
  using ("Employee Number" = (select public.current_employee_number()))$q$),
      ('loan_requests', $q$create policy own_insert on public.loan_requests for insert to authenticated
  with check (
    "Employee Number" = (select public.current_employee_number())
    and coalesce(status, 'Pending') = 'Pending'
  )$q$),
      ('warnings', $q$create policy module_access on public.warnings for all to authenticated
  using (public.has_any_module('staffcheck')) with check (public.has_any_module('staffcheck'))$q$),
      ('warnings', $q$create policy own_select on public.warnings for select to authenticated
  using (employee_id = (select public.current_employee_number()))$q$),
      ('incident_reports', $q$create policy module_access on public.incident_reports for all to authenticated
  using (public.has_any_module('incident-reports')) with check (public.has_any_module('incident-reports'))$q$),
      ('incident_reports', $q$create policy own_select on public.incident_reports for select to authenticated
  using (is_anonymous = false and employee_number = (select public.current_employee_number()))$q$),
      ('incident_reports', $q$create policy own_insert on public.incident_reports for insert to authenticated
  with check (
    coalesce(status, 'new') = 'new'
    and reviewed_by is null and admin_notes is null
    and (
      (is_anonymous and employee_number is null)
      or (not is_anonymous and employee_number = (select public.current_employee_number()))
    )
  )$q$),
      ('phone_number_change_requests', $q$create policy module_access on public.phone_number_change_requests for all to authenticated
  using (public.has_any_module('phone-approvals')) with check (public.has_any_module('phone-approvals'))$q$),
      ('phone_number_change_requests', $q$create policy own_select on public.phone_number_change_requests for select to authenticated
  using (employee_number = (select public.current_employee_number()))$q$),
      ('phone_number_change_requests', $q$create policy own_insert on public.phone_number_change_requests for insert to authenticated
  with check (employee_number = (select public.current_employee_number()) and coalesce(status, 'pending') = 'pending')$q$),
      ('phone_number_change_requests', $q$create policy own_cancel on public.phone_number_change_requests for delete to authenticated
  using (employee_number = (select public.current_employee_number()) and status = 'pending')$q$),
      ('dependents', $q$create policy module_access on public.dependents for all to authenticated
  using (public.has_any_module('employees')) with check (public.has_any_module('employees'))$q$),
      ('dependents', $q$create policy own_all on public.dependents for all to authenticated
  using ("Employee Number" = (select public.current_employee_number()))
  with check ("Employee Number" = (select public.current_employee_number()))$q$),
      ('emergency_contact', $q$create policy module_access on public.emergency_contact for all to authenticated
  using (public.has_any_module('employees')) with check (public.has_any_module('employees'))$q$),
      ('emergency_contact', $q$create policy own_all on public.emergency_contact for all to authenticated
  using ("Employee Number" = (select public.current_employee_number()))
  with check ("Employee Number" = (select public.current_employee_number()))$q$)
    ) as v(tbl, sql)
  loop
    continue when to_regclass(format('public.%I', p.tbl)) is null;
    execute p.sql;
  end loop;
end $$;

notify pgrst, 'reload schema';
