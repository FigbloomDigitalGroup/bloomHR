-- Admins hear of every salary advance request as it is made.
--
-- A new advance goes to its company's approval chain (20261025700000), and only that step's approvers are told. Admins
-- are never on a "anyone with Salary Advance" step's list (they act as admins, not as approvers), so until now no admin
-- heard of a request until it was decided, if at all.
--
-- Now an advance that is waiting for a decision when it is made writes one HR alert, 'salary_advance_requested'
-- ("Salary advance requested"), as payment_due and requisition_requested do:
--   * it is HR-facing (hr_only_notification), so the employee who asked never sees it in their portal and is never
--     emailed it;
--   * it is emailed to the company's admins only (hr_alert_modules gives it no modules, so hr_alert_recipients
--     returns ADMIN logins alone), at their login's email, so admins with no employee record get it too. The step's
--     approvers are already told by the chain, so they are not sent it a second time;
--   * it shows in the admin bell like every other HR alert, and opens the Salary Advance screen.
-- An advance recorded as already approved (HR entering one) and quiet loads (app.approval_quiet) write nothing.

-- ---------------------------------------------------------------------------------------------
-- 1. the new type (20261118400000's list, plus salary_advance_requested)
-- ---------------------------------------------------------------------------------------------
alter table public.hr_notifications drop constraint if exists hr_notifications_notification_type_check;
alter table public.hr_notifications add constraint hr_notifications_notification_type_check check (notification_type in (
  'contract_expiring', 'probation_expiring', 'leave_recommended', 'leave_approved', 'leave_rejected', 'leave_year_end_reminder',
  'document_accepted', 'document_rejected', 'onboarding_approved', 'onboarding_changes_requested', 'photo_removed',
  'document_requested',
  'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
  'payslip_ready', 'salary_paid', 'expense_approved', 'expense_rejected', 'phone_change_approved', 'phone_change_rejected',
  'incident_update', 'warning_issued', 'suspended', 'reactivated', 'employment_update', 'leave_scheduled', 'policy_to_accept',
  'task_assigned', 'asset_assigned',
  -- every type added since the approval workflows (20261015800000) must stay in this list
  'approval_needed', 'approval_progress',
  'exit_requested', 'exit_approved', 'exit_declined',
  'application_received',
  'loan_requested', 'loan_disbursed', 'loan_repaid',
  'contract_sent', 'contract_sent_back', 'contract_accepted', 'contract_cancelled', 'contract_signed',
  'leave_exhausted', 'casual_limit',
  'leave_document_overdue',
  'contribution_requested',
  'company_digest',
  'onboarding_followups_overdue',
  'leave_reopened',
  'attendance_odd_hours',
  'missed_scan_requested', 'missed_scan_request', 'missed_scan_approved', 'missed_scan_declined',
  'payment_due', 'payment_made', 'requisition_requested', 'requisition_approved', 'requisition_rejected',
  'possible_absences', 'possible_absences_team', 'possible_absence',
  'loan_form_to_sign', 'loan_form_signed', 'loan_form_accepted', 'loan_form_sent_back',
  'loan_guarantor_asked', 'loan_guarantor_signed', 'loan_guarantor_declined',
  'loan_witness_asked', 'loan_witness_signed', 'loan_witness_declined',
  'salary_advance_requested'
));

-- ---------------------------------------------------------------------------------------------
-- 2. an HR alert, important, for admins only
-- ---------------------------------------------------------------------------------------------
-- (20261118200000's, plus salary_advance_requested)
create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested', 'contract_signed', 'leave_exhausted', 'casual_limit', 'leave_document_overdue',
                    'contribution_requested', 'onboarding_followups_overdue', 'attendance_odd_hours', 'missed_scan_requested',
                    'payment_due', 'requisition_requested', 'possible_absences', 'loan_form_signed',
                    'salary_advance_requested')
$$;

-- (20261106100000's, plus salary_advance_requested: a decision is waiting)
create or replace function public.important_notification(p_type text) returns boolean language sql immutable as $$
  select public.always_emailed(p_type) or p_type in (
    -- the employee's own
    'leave_approved', 'leave_rejected', 'leave_reopened', 'document_rejected', 'document_requested', 'onboarding_changes_requested',
    'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
    'loan_disbursed', 'salary_paid', 'expense_approved', 'expense_rejected', 'reactivated', 'employment_update',
    'policy_to_accept', 'task_assigned', 'approval_needed', 'exit_approved', 'exit_declined', 'contract_sent',
    'contract_sent_back', 'missed_scan_request', 'missed_scan_approved', 'missed_scan_declined',
    'payment_made', 'requisition_approved', 'requisition_rejected',
    'possible_absence',
    -- for HR: a decision is waiting
    'leave_recommended', 'exit_requested', 'loan_requested', 'contract_signed', 'contract_expiring', 'probation_expiring',
    'missed_scan_requested', 'requisition_requested', 'salary_advance_requested',
    -- for finance: a payment is waiting
    'payment_due')
$$;

-- (20261106100000's; salary_advance_requested names no module, so only ADMIN logins get it: the chain already tells
-- the people who approve advances)
create or replace function public.hr_alert_modules(p_type text) returns text[] language sql immutable as $$
  select case
    when p_type in ('leave_recommended', 'leave_exhausted', 'leave_document_overdue') then array['leaves']
    when p_type = 'possible_absences' then array['leaves', 'employees']
    when p_type = 'application_received' then array['recruitment']
    when p_type in ('loan_requested', 'contribution_requested') then array['payroll']
    when p_type = 'casual_limit' then array['work-records', 'payroll']
    when p_type = 'payment_due' then array['payments']
    when p_type = 'requisition_requested' then array['requisitions']
    when p_type = 'salary_advance_requested' then '{}'::text[]
    -- contract_expiring, probation_expiring, contract_signed, exit_requested, and any HR-facing type added later
    else array['employees', 'hr-lifecycle']
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. written when an advance is made waiting for a decision
-- ---------------------------------------------------------------------------------------------
create or replace function public.salary_advance_request_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.money_waiting_status('salary_advance', new.status)
     or coalesce(current_setting('app.approval_quiet', true), '') = 'on' then
    return null;
  end if;
  insert into public.hr_notifications (tenant_id, employee_number, employee_name, notification_type, title, message)
  values (new.tenant_id, coalesce(new."Employee Number", ''),
    coalesce(nullif(btrim(new."Full Name"), ''), public.employee_display_name(new.tenant_id, new."Employee Number")),
    'salary_advance_requested', 'Salary advance requested',
    public.approval_money_text('salary_advance', new.id) || ' was requested'
    || coalesce(' (' || nullif(btrim(new."Reason for Advance"), '') || ')', '')
    || '. It is waiting on its approvers in Salary Advance.');
  return null;
end $$;
revoke all on function public.salary_advance_request_alert() from public, anon, authenticated;

drop trigger if exists salary_advance_request_alert on public.salary_advance;
create trigger salary_advance_request_alert after insert on public.salary_advance
  for each row execute function public.salary_advance_request_alert();

notify pgrst, 'reload schema';
