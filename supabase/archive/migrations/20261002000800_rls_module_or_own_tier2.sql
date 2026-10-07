-- FIG-657, tier 2: HR workflow tables.
--
-- Same model as tier 1 (see 20261002000500 and 20261002000600): a role reaches a table through the
-- module permissions of the screens that use it; an employee may also work with their own rows where
-- the Staff Portal needs it; the restrictive tenant_isolation policy still confines everything to the
-- caller's company. The blanket "any signed-in user can do everything" policy is removed.
--
--   leave_balances, leave_balance_adjustments          leaves
--   hr_employment_status, hr_leave_schedules,
--     hr_lifecycle_history, hr_contract_settings       hr-lifecycle
--   employee_performance, performance_targets          performance
--   job_positions                                      recruitment
--   leave_application        leaves; own: read, file a new Pending request (no recommendation set)
--   hr_notifications         leaves/hr-lifecycle/employees; own: read, mark as read
--   attendance_logs          employees/hr-lifecycle/reports; own: clock in/out and read
--   job_applications         recruitment; own: read, apply (pending), withdraw while pending
--   job_postings             everyone reads OPEN postings; recruitment manages
--   training_documents,
--     training_videos        everyone reads; training manages
--   training_progress        training; own: full control

-- Start from a clean slate: drop every policy except the tenant rule.
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array[
    'leave_application', 'leave_balances', 'leave_balance_adjustments', 'hr_employment_status',
    'hr_leave_schedules', 'hr_lifecycle_history', 'hr_notifications', 'hr_contract_settings',
    'attendance_logs', 'employee_performance', 'performance_targets', 'job_applications',
    'job_postings', 'job_positions', 'training_progress', 'training_documents', 'training_videos'
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
do $$
declare
  p record;
begin
  for p in
    select * from (values
      -- module-only tables
      ('leave_balances', $q$create policy module_access on public.leave_balances for all to authenticated
         using (public.has_any_module('leaves')) with check (public.has_any_module('leaves'))$q$),
      ('leave_balance_adjustments', $q$create policy module_access on public.leave_balance_adjustments for all to authenticated
         using (public.has_any_module('leaves')) with check (public.has_any_module('leaves'))$q$),
      ('hr_employment_status', $q$create policy module_access on public.hr_employment_status for all to authenticated
         using (public.has_any_module('hr-lifecycle')) with check (public.has_any_module('hr-lifecycle'))$q$),
      ('hr_leave_schedules', $q$create policy module_access on public.hr_leave_schedules for all to authenticated
         using (public.has_any_module('hr-lifecycle')) with check (public.has_any_module('hr-lifecycle'))$q$),
      ('hr_lifecycle_history', $q$create policy module_access on public.hr_lifecycle_history for all to authenticated
         using (public.has_any_module('hr-lifecycle')) with check (public.has_any_module('hr-lifecycle'))$q$),
      ('hr_contract_settings', $q$create policy module_access on public.hr_contract_settings for all to authenticated
         using (public.has_any_module('hr-lifecycle')) with check (public.has_any_module('hr-lifecycle'))$q$),
      ('employee_performance', $q$create policy module_access on public.employee_performance for all to authenticated
         using (public.has_any_module('performance')) with check (public.has_any_module('performance'))$q$),
      ('performance_targets', $q$create policy module_access on public.performance_targets for all to authenticated
         using (public.has_any_module('performance')) with check (public.has_any_module('performance'))$q$),
      ('job_positions', $q$create policy module_access on public.job_positions for all to authenticated
         using (public.has_any_module('recruitment')) with check (public.has_any_module('recruitment'))$q$),

      -- leave applications
      ('leave_application', $q$create policy module_access on public.leave_application for all to authenticated
         using (public.has_any_module('leaves')) with check (public.has_any_module('leaves'))$q$),
      ('leave_application', $q$create policy own_select on public.leave_application for select to authenticated
         using ("Employee Number" = (select public.current_employee_number()))$q$),
      ('leave_application', $q$create policy own_insert on public.leave_application for insert to authenticated
         with check (
           "Employee Number" = (select public.current_employee_number())
           and lower(coalesce(status, 'pending')) = 'pending'
           and recstatus is null and recommendation_notes is null
         )$q$),

      -- notifications: reviewers manage, the employee reads and marks their own as read
      ('hr_notifications', $q$create policy module_access on public.hr_notifications for all to authenticated
         using (public.has_any_module('leaves', 'hr-lifecycle', 'employees'))
         with check (public.has_any_module('leaves', 'hr-lifecycle', 'employees'))$q$),
      ('hr_notifications', $q$create policy own_select on public.hr_notifications for select to authenticated
         using (employee_number = (select public.current_employee_number()))$q$),
      ('hr_notifications', $q$create policy own_update on public.hr_notifications for update to authenticated
         using (employee_number = (select public.current_employee_number()))
         with check (employee_number = (select public.current_employee_number()))$q$),

      -- attendance: clocking in and out is the employee's own business
      ('attendance_logs', $q$create policy module_access on public.attendance_logs for all to authenticated
         using (public.has_any_module('employees', 'hr-lifecycle', 'reports'))
         with check (public.has_any_module('employees', 'hr-lifecycle', 'reports'))$q$),
      ('attendance_logs', $q$create policy own_select on public.attendance_logs for select to authenticated
         using (employee_number = (select public.current_employee_number()))$q$),
      ('attendance_logs', $q$create policy own_insert on public.attendance_logs for insert to authenticated
         with check (employee_number = (select public.current_employee_number()))$q$),
      ('attendance_logs', $q$create policy own_update on public.attendance_logs for update to authenticated
         using (employee_number = (select public.current_employee_number()))
         with check (employee_number = (select public.current_employee_number()))$q$),

      -- internal job board
      ('job_postings', $q$create policy module_access on public.job_postings for all to authenticated
         using (public.has_any_module('recruitment')) with check (public.has_any_module('recruitment'))$q$),
      ('job_postings', $q$create policy open_postings on public.job_postings for select to authenticated
         using (status = 'open')$q$),
      ('job_applications', $q$create policy module_access on public.job_applications for all to authenticated
         using (public.has_any_module('recruitment')) with check (public.has_any_module('recruitment'))$q$),
      ('job_applications', $q$create policy own_select on public.job_applications for select to authenticated
         using (employee_number = (select public.current_employee_number()))$q$),
      ('job_applications', $q$create policy own_insert on public.job_applications for insert to authenticated
         with check (
           employee_number = (select public.current_employee_number())
           and coalesce(status, 'pending') = 'pending'
           and reviewed_by is null and admin_notes is null
         )$q$),
      ('job_applications', $q$create policy own_withdraw on public.job_applications for update to authenticated
         using (employee_number = (select public.current_employee_number()) and status = 'pending')
         with check (employee_number = (select public.current_employee_number()) and status = 'withdrawn')$q$),

      -- training
      ('training_documents', $q$create policy module_access on public.training_documents for all to authenticated
         using (public.has_any_module('training')) with check (public.has_any_module('training'))$q$),
      ('training_documents', $q$create policy read_all on public.training_documents for select to authenticated
         using (true)$q$),
      ('training_videos', $q$create policy module_access on public.training_videos for all to authenticated
         using (public.has_any_module('training')) with check (public.has_any_module('training'))$q$),
      ('training_videos', $q$create policy read_all on public.training_videos for select to authenticated
         using (true)$q$),
      ('training_progress', $q$create policy module_access on public.training_progress for all to authenticated
         using (public.has_any_module('training')) with check (public.has_any_module('training'))$q$),
      ('training_progress', $q$create policy own_all on public.training_progress for all to authenticated
         using (employee_number = (select public.current_employee_number()))
         with check (employee_number = (select public.current_employee_number()))$q$)
    ) as v(tbl, sql)
  loop
    continue when to_regclass(format('public.%I', p.tbl)) is null;
    execute p.sql;
  end loop;
end $$;

notify pgrst, 'reload schema';
