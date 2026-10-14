-- Access checks run once per query, not once per row (FIG-819).
--
-- Most row-level security policies called the signed-in user's checks (has_module, has_any_module, is_own_employee,
-- manages_work, supervises, auth.uid() ...) bare, so Postgres ran them again for every row it looked at: a staff
-- member opening their notifications, leave or payslips had every row of the company's table checked, each check a
-- few lookups of its own. With companies of 5,000-20,000 employees that is far too slow. This migration recreates
-- those policies so that:
--   * a check that does not depend on the row is written (select public.has_module('payroll')): Postgres works it out
--     once per query and reuses the answer;
--   * a check that does depend on the row compares the row's column with something worked out once:
--       is_own_employee(employee_id)       -> employee_id = (select public.current_employee_id())
--       supervises(employee_number)        -> employee_number in (select public.supervised_employee_numbers())
--       payroll_run_published(run_id)      -> run_id in (select public.published_payroll_run_ids())
--     so an index on the column can be used.
-- Who can read or change what is exactly as before: each policy keeps its name, command, roles and conditions; only
-- how the conditions are evaluated changes (the old helpers stay, other code still calls them). The policies were
-- written out from the schema as it stands after every earlier migration. Policies that already wrapped their checks
-- are left as they are. The messaging checks is_dm_channel(channel_id) / channel_open_to_me(channel_id) are about the
-- row's channel and stay per row (they only run for an admin, or for a single new membership).
-- Also adds indexes for what the staff portal filters by: the employee's number (or id) within the company, and
-- salary_history by pay period for payroll's month views.
-- supabase/tests/rls_per_query_checks.test.ts fails if a policy calls one of these checks bare again.

-- ---------------------------------------------------------------------------------------------
-- 1. helpers: the signed-in user's answers, worked out once per query
-- ---------------------------------------------------------------------------------------------
-- the signed-in user's own employee record (id), in the current company; null if they have none
create or replace function public.current_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select e.id from public.employees e
  where e.tenant_id = public.current_tenant_id() and e."Employee Number" = public.current_employee_number()
$$;

-- the workers the signed-in user supervises (they are the worker's manager_email or regional_manager): the same
-- workers as supervises()
create or replace function public.supervised_employee_numbers() returns setof text
language sql stable security definer set search_path = public as $$
  select e."Employee Number" from public.employees e join auth.users u on u.id = auth.uid()
  where e.tenant_id = public.current_tenant_id()
    and lower(u.email) in (lower(btrim(e.manager_email)), lower(btrim(e.regional_manager)))
$$;

-- the current company's payroll runs that are approved or paid: the same runs as payroll_run_published()
create or replace function public.published_payroll_run_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select r.id from public.payroll_runs r
  where r.tenant_id = (select public.current_tenant_id()) and r.status in ('approved', 'paid')
$$;

revoke all on function public.current_employee_id() from public, anon;
revoke all on function public.supervised_employee_numbers() from public, anon;
revoke all on function public.published_payroll_run_ids() from public, anon;
grant execute on function public.current_employee_id() to authenticated, service_role;
grant execute on function public.supervised_employee_numbers() to authenticated, service_role;
grant execute on function public.published_payroll_run_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. indexes for what staff read by their own employee number (within their company)
-- ---------------------------------------------------------------------------------------------
create index if not exists leave_application_tenant_employee_idx on public.leave_application (tenant_id, "Employee Number");
create index if not exists salary_history_tenant_period_idx on public.salary_history (tenant_id, pay_period);
create index if not exists notifications_tenant_employee_idx on public.notifications (tenant_id, employee_number);
create index if not exists attendance_logs_tenant_employee_idx on public.attendance_logs (tenant_id, employee_number);
create index if not exists dependents_tenant_employee_idx on public.dependents (tenant_id, "Employee Number");
create index if not exists incident_reports_tenant_employee_idx on public.incident_reports (tenant_id, employee_number);
create index if not exists job_applications_tenant_employee_idx on public.job_applications (tenant_id, employee_number);
create index if not exists loan_requests_tenant_employee_idx on public.loan_requests (tenant_id, "Employee Number");
create index if not exists payroll_records_tenant_employee_idx on public.payroll_records (tenant_id, "Employee ID");
create index if not exists payroll_records_current_tenant_employee_idx on public.payroll_records_current (tenant_id, "Employee ID");
create index if not exists phone_number_change_requests_tenant_employee_idx on public.phone_number_change_requests (tenant_id, employee_number);
create index if not exists salary_advance_tenant_employee_idx on public.salary_advance (tenant_id, "Employee Number");
create index if not exists warnings_tenant_employee_idx on public.warnings (tenant_id, employee_id);
create index if not exists training_progress_tenant_employee_idx on public.training_progress (tenant_id, employee_number);

-- ---------------------------------------------------------------------------------------------
-- 3. the policies, checks evaluated once per query
-- ---------------------------------------------------------------------------------------------
drop policy if exists module_access on public.assets;
create policy module_access on public.assets for all to authenticated
  using ((select public.has_any_module('asset')))
  with check ((select public.has_any_module('asset')));

drop policy if exists module_access on public.attendance_logs;
create policy module_access on public.attendance_logs for all to authenticated
  using ((select public.has_any_module('employees', 'hr-lifecycle', 'reports')))
  with check ((select public.has_any_module('employees', 'hr-lifecycle', 'reports')));

drop policy if exists employees_read on public.audit_log;
create policy employees_read on public.audit_log for select to authenticated
  using (table_name in ('employees', 'emergency_contact', 'next_of_kin', 'employee_documents', 'employee_referees',
                        'employee_document_requirements', 'employee_health_records', 'employee_health_files',
                        'employee_health_consents', 'company_policies', 'company_policy_versions', 'policy_acceptances')
         and (select public.has_module('employees')));

drop policy if exists module_read on public.audit_log;
create policy module_read on public.audit_log for select to authenticated
  using ((select public.has_any_module('settings')));

drop policy if exists module_access on public.branch_performance;
create policy module_access on public.branch_performance for all to authenticated
  using ((select public.has_any_module('performance')))
  with check ((select public.has_any_module('performance')));

drop policy if exists own_membership on public.channel_members;
create policy own_membership on public.channel_members for all to authenticated
  using ((((user_id = (select auth.uid())) OR ((select public.current_user_role()) = 'ADMIN'::text)) AND (NOT public.is_dm_channel(channel_id))))
  with check (((NOT public.is_dm_channel(channel_id)) AND (((select public.current_user_role()) = 'ADMIN'::text) OR ((user_id = (select auth.uid())) AND public.channel_open_to_me(channel_id)))));

drop policy if exists own_membership_read on public.channel_members;
create policy own_membership_read on public.channel_members for select to authenticated
  using ((user_id = (select auth.uid())));

drop policy if exists create_channels on public.channels;
create policy create_channels on public.channels for insert to authenticated
  with check (((created_by = (select auth.uid())) AND (type IS DISTINCT FROM 'dm'::text) AND (NOT COALESCE(is_default, false)) AND ((select public.current_user_role()) = ANY (ARRAY['ADMIN'::text, 'HR'::text, 'MANAGER'::text]))));

drop policy if exists delete_channels on public.channels;
create policy delete_channels on public.channels for delete to authenticated
  using (((type IS DISTINCT FROM 'dm'::text) AND (NOT COALESCE(is_default, false)) AND ((created_by = (select auth.uid())) OR ((select public.current_user_role()) = 'ADMIN'::text))));

drop policy if exists manage_channels on public.channels;
create policy manage_channels on public.channels for update to authenticated
  using (((type IS DISTINCT FROM 'dm'::text) AND (NOT COALESCE(is_default, false)) AND ((created_by = (select auth.uid())) OR ((select public.current_user_role()) = 'ADMIN'::text))))
  with check (((type IS DISTINCT FROM 'dm'::text) AND (NOT COALESCE(is_default, false)) AND ((created_by = (select auth.uid())) OR ((select public.current_user_role()) = 'ADMIN'::text))));

drop policy if exists visible_channels on public.channels;
create policy visible_channels on public.channels for select to authenticated
  using (
CASE
    WHEN (type = 'dm'::text) THEN (EXISTS ( SELECT 1
       FROM channel_members m
      WHERE ((m.channel_id = channels.id) AND (m.user_id = (select auth.uid())))))
    ELSE ((COALESCE(is_private, false) = false) OR (created_by = (select auth.uid())) OR (job_title = (select public.current_job_title())) OR ((select public.current_user_role()) = 'ADMIN'::text) OR (EXISTS ( SELECT 1
       FROM channel_members m
      WHERE ((m.channel_id = channels.id) AND (m.user_id = (select auth.uid()))))))
END);

drop policy if exists module_access on public.client_visits;
create policy module_access on public.client_visits for all to authenticated
  using ((select public.has_any_module('performance')))
  with check ((select public.has_any_module('performance')));

drop policy if exists module_access on public.clients;
create policy module_access on public.clients for all to authenticated
  using ((select public.has_any_module('performance')))
  with check ((select public.has_any_module('performance')));

drop policy if exists hr_write on public.company_document_settings;
create policy hr_write on public.company_document_settings for all to authenticated
  using ((select public.has_module('employees')))
  with check ((select public.has_module('employees')));

drop policy if exists module_access on public.company_events;
create policy module_access on public.company_events for all to authenticated
  using ((select public.has_any_module('settings', 'employees', 'hr-lifecycle')))
  with check ((select public.has_any_module('settings', 'employees', 'hr-lifecycle')));

drop policy if exists module_access on public.company_logo;
create policy module_access on public.company_logo for all to authenticated
  using ((select public.has_any_module('settings')))
  with check ((select public.has_any_module('settings')));

drop policy if exists payroll_all on public.company_payroll_settings;
create policy payroll_all on public.company_payroll_settings for all to authenticated
  using ((select public.has_module('payroll')))
  with check ((select public.has_module('payroll')));

drop policy if exists hr_write on public.company_policies;
create policy hr_write on public.company_policies for all to authenticated
  using ((select public.has_module('employees')))
  with check ((select public.has_module('employees')));

drop policy if exists hr_publish on public.company_policy_versions;
create policy hr_publish on public.company_policy_versions for insert to authenticated
  with check ((select public.has_module('employees')));

drop policy if exists involved on public.contract_jobs;
create policy involved on public.contract_jobs for all to authenticated
  using (((select public.manages_work()) OR (employee_number in (select public.supervised_employee_numbers())) OR (employee_number = (select public.current_employee_number()))))
  with check (((select public.manages_work()) OR (employee_number in (select public.supervised_employee_numbers())) OR (employee_number = (select public.current_employee_number()))));

drop policy if exists module_access on public.deduction_types;
create policy module_access on public.deduction_types for all to authenticated
  using ((select public.has_module('payroll')))
  with check ((select public.has_module('payroll')));

drop policy if exists module_access on public.dependents;
create policy module_access on public.dependents for all to authenticated
  using ((select public.has_any_module('employees')))
  with check ((select public.has_any_module('employees')));

drop policy if exists module_access on public.email_logs;
create policy module_access on public.email_logs for all to authenticated
  using ((select public.has_any_module('employees', 'adminconfirm', 'email-portal', 'settings')))
  with check ((select public.has_any_module('employees', 'adminconfirm', 'email-portal', 'settings')));

drop policy if exists module_access on public.emergency_contact;
create policy module_access on public.emergency_contact for all to authenticated
  using ((select public.has_any_module('employees')))
  with check ((select public.has_any_module('employees')));

drop policy if exists module_access on public.employee_deductions;
create policy module_access on public.employee_deductions for all to authenticated
  using ((select public.has_module('payroll')))
  with check ((select public.has_module('payroll')));

drop policy if exists hr_all on public.employee_document_requirements;
create policy hr_all on public.employee_document_requirements for all to authenticated
  using ((select public.has_module('employees')))
  with check ((select public.has_module('employees')));

drop policy if exists own_read on public.employee_document_requirements;
create policy own_read on public.employee_document_requirements for select to authenticated
  using ((employee_id = (select public.current_employee_id())));

drop policy if exists hr_read on public.employee_documents;
create policy hr_read on public.employee_documents for select to authenticated
  using ((select public.has_any_module('employees', 'hr-lifecycle')));

drop policy if exists own_delete on public.employee_documents;
create policy own_delete on public.employee_documents for delete to authenticated
  using (((employee_id = (select public.current_employee_id())) AND (status <> 'accepted'::text)));

drop policy if exists own_insert on public.employee_documents;
create policy own_insert on public.employee_documents for insert to authenticated
  with check ((employee_id = (select public.current_employee_id())));

drop policy if exists own_read on public.employee_documents;
create policy own_read on public.employee_documents for select to authenticated
  using ((employee_id = (select public.current_employee_id())));

drop policy if exists own_all on public.employee_health_consents;
create policy own_all on public.employee_health_consents for all to authenticated
  using ((employee_id = (select public.current_employee_id())))
  with check ((employee_id = (select public.current_employee_id())));

drop policy if exists own_all on public.employee_health_files;
create policy own_all on public.employee_health_files for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM employee_health_records r
  WHERE ((r.id = employee_health_files.record_id) AND (r.employee_id = (select public.current_employee_id()))))))
  with check ((EXISTS ( SELECT 1
   FROM employee_health_records r
  WHERE ((r.id = employee_health_files.record_id) AND (r.employee_id = (select public.current_employee_id()))))));

drop policy if exists own_all on public.employee_health_records;
create policy own_all on public.employee_health_records for all to authenticated
  using ((employee_id = (select public.current_employee_id())))
  with check ((employee_id = (select public.current_employee_id())));

drop policy if exists hr_read on public.employee_onboarding_reviews;
create policy hr_read on public.employee_onboarding_reviews for select to authenticated
  using ((select public.has_module('employees')));

drop policy if exists module_access on public.employee_performance;
create policy module_access on public.employee_performance for all to authenticated
  using ((select public.has_any_module('performance')))
  with check ((select public.has_any_module('performance')));

drop policy if exists hr_read on public.employee_referees;
create policy hr_read on public.employee_referees for select to authenticated
  using ((select public.has_module('employees')));

drop policy if exists own_all on public.employee_referees;
create policy own_all on public.employee_referees for all to authenticated
  using ((employee_id = (select public.current_employee_id())))
  with check ((employee_id = (select public.current_employee_id())));

drop policy if exists module_delete on public.employees;
create policy module_delete on public.employees for delete to authenticated
  using ((select public.has_module('employees')));

drop policy if exists module_insert on public.employees;
create policy module_insert on public.employees for insert to authenticated
  with check ((select public.has_any_module('employees', 'payroll')));

drop policy if exists module_access on public.expenses;
create policy module_access on public.expenses for all to authenticated
  using ((select public.has_any_module('expenses')))
  with check ((select public.has_any_module('expenses')));

drop policy if exists module_access on public.holidays;
create policy module_access on public.holidays for all to authenticated
  using ((select public.has_any_module('leaves')))
  with check ((select public.has_any_module('leaves')));

drop policy if exists module_access on public.hr_contract_settings;
create policy module_access on public.hr_contract_settings for all to authenticated
  using ((select public.has_any_module('hr-lifecycle')))
  with check ((select public.has_any_module('hr-lifecycle')));

drop policy if exists module_access on public.hr_employment_status;
create policy module_access on public.hr_employment_status for all to authenticated
  using ((select public.has_any_module('hr-lifecycle')))
  with check ((select public.has_any_module('hr-lifecycle')));

drop policy if exists module_access on public.hr_leave_schedules;
create policy module_access on public.hr_leave_schedules for all to authenticated
  using ((select public.has_any_module('hr-lifecycle')))
  with check ((select public.has_any_module('hr-lifecycle')));

drop policy if exists module_access on public.hr_lifecycle_history;
create policy module_access on public.hr_lifecycle_history for all to authenticated
  using ((select public.has_any_module('hr-lifecycle')))
  with check ((select public.has_any_module('hr-lifecycle')));

drop policy if exists module_access on public.hr_notifications;
create policy module_access on public.hr_notifications for all to authenticated
  using ((select public.has_any_module('leaves', 'hr-lifecycle', 'employees')))
  with check ((select public.has_any_module('leaves', 'hr-lifecycle', 'employees')));

drop policy if exists module_access on public.hr_salary_advances;
create policy module_access on public.hr_salary_advances for all to authenticated
  using ((select public.has_any_module('hr-lifecycle')))
  with check ((select public.has_any_module('hr-lifecycle')));

drop policy if exists module_access on public.hr_suspensions;
create policy module_access on public.hr_suspensions for all to authenticated
  using ((select public.has_any_module('hr-lifecycle')))
  with check ((select public.has_any_module('hr-lifecycle')));

drop policy if exists module_access on public.hr_termination_interviews;
create policy module_access on public.hr_termination_interviews for all to authenticated
  using ((select public.has_any_module('hr-lifecycle')))
  with check ((select public.has_any_module('hr-lifecycle')));

drop policy if exists module_access on public.hr_terminations;
create policy module_access on public.hr_terminations for all to authenticated
  using ((select public.has_any_module('hr-lifecycle')))
  with check ((select public.has_any_module('hr-lifecycle')));

drop policy if exists module_access on public.incident_reports;
create policy module_access on public.incident_reports for all to authenticated
  using ((select public.has_any_module('incident-reports')))
  with check ((select public.has_any_module('incident-reports')));

drop policy if exists module_access on public.job_applications;
create policy module_access on public.job_applications for all to authenticated
  using ((select public.has_any_module('recruitment')))
  with check ((select public.has_any_module('recruitment')));

drop policy if exists module_access on public.job_positions;
create policy module_access on public.job_positions for all to authenticated
  using ((select public.has_any_module('recruitment')))
  with check ((select public.has_any_module('recruitment')));

drop policy if exists module_access on public.job_postings;
create policy module_access on public.job_postings for all to authenticated
  using ((select public.has_any_module('recruitment')))
  with check ((select public.has_any_module('recruitment')));

drop policy if exists module_access on public.kenya_branches;
create policy module_access on public.kenya_branches for all to authenticated
  using ((select public.has_any_module('settings')))
  with check ((select public.has_any_module('settings')));

drop policy if exists module_access on public.kenya_office_locations;
create policy module_access on public.kenya_office_locations for all to authenticated
  using ((select public.has_any_module('recruitment')))
  with check ((select public.has_any_module('recruitment')));

drop policy if exists module_access on public.leave_application;
create policy module_access on public.leave_application for all to authenticated
  using ((select public.has_any_module('leaves')))
  with check ((select public.has_any_module('leaves')));

drop policy if exists module_access on public.leave_balance_adjustments;
create policy module_access on public.leave_balance_adjustments for all to authenticated
  using ((select public.has_any_module('leaves')))
  with check ((select public.has_any_module('leaves')));

drop policy if exists module_access on public.leave_balances;
create policy module_access on public.leave_balances for all to authenticated
  using ((select public.has_any_module('leaves')))
  with check ((select public.has_any_module('leaves')));

drop policy if exists module_access on public.leave_entitlements;
create policy module_access on public.leave_entitlements for all to authenticated
  using ((select public.has_any_module('leaves')))
  with check ((select public.has_any_module('leaves')));

drop policy if exists module_access on public.leave_policies;
create policy module_access on public.leave_policies for all to authenticated
  using ((select public.has_any_module('leaves')))
  with check ((select public.has_any_module('leaves')));

drop policy if exists module_access on public.leave_types;
create policy module_access on public.leave_types for all to authenticated
  using ((select public.has_any_module('leaves')))
  with check ((select public.has_any_module('leaves')));

drop policy if exists module_access on public.loan_payments;
create policy module_access on public.loan_payments for all to authenticated
  using ((select public.has_any_module('performance')))
  with check ((select public.has_any_module('performance')));

drop policy if exists module_access on public.loan_requests;
create policy module_access on public.loan_requests for all to authenticated
  using ((select public.has_any_module('salaryadmin', 'settings', 'payroll')))
  with check ((select public.has_any_module('salaryadmin', 'settings', 'payroll')));

drop policy if exists module_access on public.loans;
create policy module_access on public.loans for all to authenticated
  using ((select public.has_any_module('performance')))
  with check ((select public.has_any_module('performance')));

drop policy if exists module_access on public.meeting_transcripts;
create policy module_access on public.meeting_transcripts for all to authenticated
  using ((select public.has_any_module('teams')))
  with check ((select public.has_any_module('teams')));

drop policy if exists add_reactions on public.message_reactions;
create policy add_reactions on public.message_reactions for insert to authenticated
  with check (((user_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE (m.id = message_reactions.message_id)))));

drop policy if exists remove_reactions on public.message_reactions;
create policy remove_reactions on public.message_reactions for delete to authenticated
  using ((user_id = (select auth.uid())));

drop policy if exists delete_messages on public.messages;
create policy delete_messages on public.messages for delete to authenticated
  using (((author_id = (select auth.uid())) OR (((select public.current_user_role()) = 'ADMIN'::text) AND (NOT public.is_dm_channel(channel_id)))));

drop policy if exists edit_messages on public.messages;
create policy edit_messages on public.messages for update to authenticated
  using (((author_id = (select auth.uid())) OR (((select public.current_user_role()) = 'ADMIN'::text) AND (NOT public.is_dm_channel(channel_id)))))
  with check (((author_id = (select auth.uid())) OR (((select public.current_user_role()) = 'ADMIN'::text) AND (NOT public.is_dm_channel(channel_id)))));

drop policy if exists send_messages on public.messages;
create policy send_messages on public.messages for insert to authenticated
  with check (((author_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM channels c
  WHERE (c.id = messages.channel_id)))));

drop policy if exists module_access on public.mfa_numbers;
create policy module_access on public.mfa_numbers for all to authenticated
  using ((select public.has_any_module('settings')))
  with check ((select public.has_any_module('settings')));

drop policy if exists module_access on public.mpesa_callbacks;
create policy module_access on public.mpesa_callbacks for all to authenticated
  using ((select public.has_any_module('mpesa-zap', 'salaryadmin')))
  with check ((select public.has_any_module('mpesa-zap', 'salaryadmin')));

drop policy if exists module_access on public.mpesa_transactions;
create policy module_access on public.mpesa_transactions for all to authenticated
  using ((select public.has_any_module('mpesa-zap', 'reports')))
  with check ((select public.has_any_module('mpesa-zap', 'reports')));

drop policy if exists module_access on public.next_of_kin;
create policy module_access on public.next_of_kin for all to authenticated
  using ((select public.has_module('employees')))
  with check ((select public.has_module('employees')));

drop policy if exists own_all on public.notification_preferences;
create policy own_all on public.notification_preferences for all to authenticated
  using ((employee_id = (select public.current_employee_id())))
  with check ((employee_id = (select public.current_employee_id())));

drop policy if exists delete_notifications on public.notifications;
create policy delete_notifications on public.notifications for delete to authenticated
  using (((employee_number = (select public.current_employee_number())) OR (select public.has_any_module('settings', 'employees'))));

drop policy if exists read_notifications on public.notifications;
create policy read_notifications on public.notifications for select to authenticated
  using (((employee_number = (select public.current_employee_number())) OR (select public.has_any_module('settings', 'employees'))));

drop policy if exists update_notifications on public.notifications;
create policy update_notifications on public.notifications for update to authenticated
  using (((employee_number = (select public.current_employee_number())) OR (select public.has_any_module('settings', 'employees'))))
  with check (((employee_number = (select public.current_employee_number())) OR (select public.has_any_module('settings', 'employees'))));

drop policy if exists module_access on public.payment_flows;
create policy module_access on public.payment_flows for all to authenticated
  using ((select public.has_any_module('payroll', 'mpesa-zap')))
  with check ((select public.has_any_module('payroll', 'mpesa-zap')));

drop policy if exists module_read on public.payroll_payments;
create policy module_read on public.payroll_payments for select to authenticated
  using ((select public.has_module('payroll')));

drop policy if exists module_access on public.payroll_records;
create policy module_access on public.payroll_records for all to authenticated
  using ((select public.has_any_module('payroll', 'hr-lifecycle')))
  with check ((select public.has_any_module('payroll', 'hr-lifecycle')));

drop policy if exists module_access on public.payroll_records_current;
create policy module_access on public.payroll_records_current for all to authenticated
  using ((select public.has_any_module('payroll', 'hr-lifecycle')))
  with check ((select public.has_any_module('payroll', 'hr-lifecycle')));

drop policy if exists module_read on public.payroll_runs;
create policy module_read on public.payroll_runs for select to authenticated
  using ((select public.has_any_module('payroll', 'hr-lifecycle')));

drop policy if exists module_write on public.payroll_runs;
create policy module_write on public.payroll_runs for all to authenticated
  using ((select public.has_module('payroll')))
  with check ((select public.has_module('payroll')));

drop policy if exists module_access on public.performance_targets;
create policy module_access on public.performance_targets for all to authenticated
  using ((select public.has_any_module('performance')))
  with check ((select public.has_any_module('performance')));

drop policy if exists module_access on public.phone_number_change_requests;
create policy module_access on public.phone_number_change_requests for all to authenticated
  using ((select public.has_any_module('phone-approvals')))
  with check ((select public.has_any_module('phone-approvals')));

drop policy if exists hr_read on public.policy_acceptances;
create policy hr_read on public.policy_acceptances for select to authenticated
  using ((select public.has_module('employees')));

drop policy if exists own_read on public.policy_acceptances;
create policy own_read on public.policy_acceptances for select to authenticated
  using ((employee_id = (select public.current_employee_id())));

drop policy if exists module_read on public.profiles;
create policy module_read on public.profiles for select to authenticated
  using ((select public.has_any_module('employees', 'settings')));

drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles for all to authenticated
  using ((id = (select auth.uid())))
  with check ((id = (select auth.uid())));

drop policy if exists module_access on public.regional_managers;
create policy module_access on public.regional_managers for all to authenticated
  using ((select public.has_any_module('assign-managers')))
  with check ((select public.has_any_module('assign-managers')));

drop policy if exists module_access on public.salary_advance;
create policy module_access on public.salary_advance for all to authenticated
  using ((select public.has_any_module('salaryadmin', 'payroll', 'reports')))
  with check ((select public.has_any_module('salaryadmin', 'payroll', 'reports')));

drop policy if exists module_access on public.salary_advance_payment_flows;
create policy module_access on public.salary_advance_payment_flows for all to authenticated
  using ((select public.has_any_module('salaryadmin')))
  with check ((select public.has_any_module('salaryadmin')));

drop policy if exists module_access on public.salary_advance_settings;
create policy module_access on public.salary_advance_settings for all to authenticated
  using ((select public.has_any_module('salaryadmin', 'settings')))
  with check ((select public.has_any_module('salaryadmin', 'settings')));

drop policy if exists module_access on public.salary_history;
create policy module_access on public.salary_history for all to authenticated
  using ((select public.has_any_module('payroll', 'hr-lifecycle')))
  with check ((select public.has_any_module('payroll', 'hr-lifecycle')));

drop policy if exists own_select on public.salary_history;
create policy own_select on public.salary_history for select to authenticated
  using (((employee_id = (select public.current_employee_number())) AND (run_id in (select public.published_payroll_run_ids()))));

drop policy if exists module_access on public.sender_id_configs;
create policy module_access on public.sender_id_configs for all to authenticated
  using ((select public.has_any_module('sms')))
  with check ((select public.has_any_module('sms')));

drop policy if exists module_access on public.sms_logs;
create policy module_access on public.sms_logs for all to authenticated
  using ((select public.has_any_module('sms', 'salaryadmin', 'employees', 'hr-lifecycle')))
  with check ((select public.has_any_module('sms', 'salaryadmin', 'employees', 'hr-lifecycle')));

drop policy if exists module_access on public.sms_templates;
create policy module_access on public.sms_templates for all to authenticated
  using ((select public.has_any_module('sms')))
  with check ((select public.has_any_module('sms')));

drop policy if exists module_access on public.staff_loans;
create policy module_access on public.staff_loans for all to authenticated
  using ((select public.has_any_module('reports', 'payroll')))
  with check ((select public.has_any_module('reports', 'payroll')));

drop policy if exists module_access on public.staff_signup_requests;
create policy module_access on public.staff_signup_requests for all to authenticated
  using ((select public.has_any_module('adminconfirm', 'employees')))
  with check ((select public.has_any_module('adminconfirm', 'employees')));

drop policy if exists module_access on public.statutory_deductions;
create policy module_access on public.statutory_deductions for all to authenticated
  using ((select public.has_any_module('reports', 'payroll')))
  with check ((select public.has_any_module('reports', 'payroll')));

drop policy if exists payroll_write on public.statutory_rates;
create policy payroll_write on public.statutory_rates for all to authenticated
  using (((tenant_id = (select public.current_tenant_id())) AND (select public.has_module('payroll'))))
  with check (((tenant_id = (select public.current_tenant_id())) AND (select public.has_module('payroll'))));

drop policy if exists module_access on public.statutory_settings;
create policy module_access on public.statutory_settings for all to authenticated
  using ((select public.has_any_module('payroll', 'reports')))
  with check ((select public.has_any_module('payroll', 'reports')));

drop policy if exists module_access on public.system_settings;
create policy module_access on public.system_settings for all to authenticated
  using ((select public.has_any_module('settings', 'adminconfirm', 'email-portal')))
  with check ((select public.has_any_module('settings', 'adminconfirm', 'email-portal')));

drop policy if exists module_access on public.termination_requests;
create policy module_access on public.termination_requests for all to authenticated
  using ((select public.has_any_module('employees', 'hr-lifecycle')))
  with check ((select public.has_any_module('employees', 'hr-lifecycle')));

drop policy if exists create_tasks on public.todos;
create policy create_tasks on public.todos for insert to authenticated
  with check ((user_id = (select auth.uid())));

drop policy if exists delete_tasks on public.todos;
create policy delete_tasks on public.todos for delete to authenticated
  using (((user_id = (select auth.uid())) OR ((select public.current_user_role()) = 'ADMIN'::text)));

drop policy if exists read_tasks on public.todos;
create policy read_tasks on public.todos for select to authenticated
  using (((COALESCE(is_private, false) = false) OR (user_id = (select auth.uid())) OR (assigne = (select auth.uid())) OR (assigned_to = ((select auth.uid()))::text)));

drop policy if exists update_tasks on public.todos;
create policy update_tasks on public.todos for update to authenticated
  using (((user_id = (select auth.uid())) OR (assigne = (select auth.uid())) OR (assigned_to = ((select auth.uid()))::text)))
  with check (((user_id = (select auth.uid())) OR (assigne = (select auth.uid())) OR (assigned_to = ((select auth.uid()))::text)));

drop policy if exists module_access on public.training_documents;
create policy module_access on public.training_documents for all to authenticated
  using ((select public.has_any_module('training')))
  with check ((select public.has_any_module('training')));

drop policy if exists module_access on public.training_progress;
create policy module_access on public.training_progress for all to authenticated
  using ((select public.has_any_module('training')))
  with check ((select public.has_any_module('training')));

drop policy if exists module_access on public.training_videos;
create policy module_access on public.training_videos for all to authenticated
  using ((select public.has_any_module('training')))
  with check ((select public.has_any_module('training')));

drop policy if exists own_state on public.user_channel_states;
create policy own_state on public.user_channel_states for all to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

drop policy if exists module_access on public.warnings;
create policy module_access on public.warnings for all to authenticated
  using ((select public.has_any_module('staffcheck')))
  with check ((select public.has_any_module('staffcheck')));

drop policy if exists involved on public.work_entries;
create policy involved on public.work_entries for all to authenticated
  using (((select public.manages_work()) OR (employee_number in (select public.supervised_employee_numbers())) OR (employee_number = (select public.current_employee_number()))))
  with check (((select public.manages_work()) OR (employee_number in (select public.supervised_employee_numbers())) OR (employee_number = (select public.current_employee_number()))));

drop policy if exists manage on public.work_types;
create policy manage on public.work_types for all to authenticated
  using ((select public.manages_work()))
  with check ((select public.manages_work()));
