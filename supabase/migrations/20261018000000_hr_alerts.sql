-- Two more alerts for HR (FIG-879, FIG-893), in the HR bell and by email (FIG-890):
--
--   leave_exhausted   an employee has used all their sick leave (half-pay days included) and all their annual leave for
--                     the year. HR said the employer may then consider releasing them; the alert only informs.
--                     Sent once per employee per year, when the leave that uses the last day is approved.
--   casual_limit      a casual worker is close to the limit of continuous casual work (Employment Act s.37); raised by
--                     the casual workers feature.
-- Both are HR-facing: not shown to, or emailed to, the employee they are about.

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
  'leave_exhausted', 'casual_limit'
));

create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested', 'contract_signed', 'leave_exhausted', 'casual_limit')
$$;

-- who is emailed each (20261017600000): leave alerts go to people who run leave; casual workers to payroll
create or replace function public.hr_alert_modules(p_type text) returns text[] language sql immutable as $$
  select case
    when p_type in ('leave_recommended', 'leave_exhausted') then array['leaves']
    when p_type = 'application_received' then array['recruitment']
    when p_type = 'loan_requested' then array['payroll']
    when p_type = 'casual_limit' then array['work-records', 'payroll']
    -- contract_expiring, probation_expiring, contract_signed, exit_requested, and any HR-facing type added later
    else array['employees', 'hr-lifecycle']
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- all sick and annual leave used
-- ---------------------------------------------------------------------------------------------

-- days left of the employee's leave types whose name starts with p_prefix (null when none is limited)
create or replace function public.leave_left_of_kind(p_tenant uuid, p_employee text, p_prefix text, p_year integer)
returns numeric
language sql stable security definer set search_path = public as $$
  select sum(public.leave_available(p_tenant, p_employee, t.id, p_year, 0))
  from public.leave_types t
  join public.current_leave_policies p on p.leave_type_id = t.id
  where t.tenant_id = p_tenant and t.name ilike p_prefix || '%' and p.accrual_method in ('annual', 'monthly_cumulative')
$$;
revoke all on function public.leave_left_of_kind(uuid, text, text, integer) from public, anon, authenticated;

create or replace function public.leave_application_exhausted_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_start date := public.leave_parse_date(new."Start Date");
  v_year integer;
  v_sick numeric;
  v_annual numeric;
  e public.employees;
  who text;
begin
  if lower(coalesce(new.status, '')) <> 'approved' or (tg_op = 'UPDATE' and lower(coalesce(old.status, '')) = 'approved')
     or v_start is null or new."Leave Type" !~* '^(sick|annual)' then
    return null;
  end if;
  v_year := extract(year from v_start)::int;
  v_sick := public.leave_left_of_kind(new.tenant_id, new."Employee Number", 'sick', v_year);
  v_annual := public.leave_left_of_kind(new.tenant_id, new."Employee Number", 'annual', v_year);
  if v_sick is null or v_annual is null or v_sick > 0 or v_annual > 0 then
    return null;
  end if;
  if exists (select 1 from public.hr_notifications n
             where n.tenant_id = new.tenant_id and n.employee_number = new."Employee Number"
               and n.notification_type = 'leave_exhausted' and n.end_date = make_date(v_year, 12, 31)) then
    return null;
  end if;
  select * into e from public.employees where tenant_id = new.tenant_id and "Employee Number" = new."Employee Number";
  who := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), new."Employee Number");
  insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date)
  values (new.tenant_id, new."Employee Number", who, e."Work Email", 'leave_exhausted', 'All sick and annual leave used',
    who || ' has used all their sick leave (half-pay days included) and all their annual leave for ' || v_year
    || '. Any more time off would be unpaid or outside policy: talk to them about next steps.',
    make_date(v_year, 12, 31));
  return null;
end $$;
drop trigger if exists leave_application_exhausted_alert on public.leave_application;
-- named to run after leave_application_balance, which takes the days
create trigger leave_application_exhausted_alert after insert or update of status on public.leave_application
  for each row execute function public.leave_application_exhausted_alert();

notify pgrst, 'reload schema';
