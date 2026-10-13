-- Notifications for everything HR, managers and payroll do that concerns an employee (FIG-776), in the staff portal's
-- bell (hr_notifications), with HR's reason or notes where there are any:
--   salary advances and staff loans decided (and advances paid), payslips ready and salaries paid, expenses decided,
--   phone-number changes decided, incident reports updated, warnings issued, suspension and reactivation, employment
--   changes (probation, contract, promotion, transfer, salary revision...), leave scheduled by HR, a new or updated
--   policy to accept, a task assigned, an asset assigned.
-- Each is a trigger, so every way of doing it (the app, the M-Pesa callback server) notifies; never for what the
-- employee did themselves. Also: hr_notifications joins the realtime publication, so the bell updates live (warnings now
-- reach the bell as hr_notifications too, so they can be read and cleared like the rest).

alter table public.hr_notifications drop constraint if exists hr_notifications_notification_type_check;
alter table public.hr_notifications add constraint hr_notifications_notification_type_check check (notification_type in (
  'contract_expiring', 'probation_expiring', 'leave_recommended', 'leave_approved', 'leave_rejected', 'leave_year_end_reminder',
  'document_accepted', 'document_rejected', 'onboarding_approved', 'onboarding_changes_requested', 'photo_removed',
  'document_requested',
  'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
  'payslip_ready', 'salary_paid', 'expense_approved', 'expense_rejected', 'phone_change_approved', 'phone_change_rejected',
  'incident_update', 'warning_issued', 'suspended', 'reactivated', 'employment_update', 'leave_scheduled', 'policy_to_accept',
  'task_assigned', 'asset_assigned'
));

-- a notification for an employee by their number, in a company; nothing when the employee did it themselves
create or replace function public.notify_employee_number(p_tenant uuid, p_number text, p_type text, p_title text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
begin
  if coalesce(btrim(p_number), '') = '' or p_number = coalesce(public.current_employee_number(), '') then
    return;
  end if;
  select * into e from public.employees where tenant_id = p_tenant and "Employee Number" = btrim(p_number);
  if e.id is null then
    return;
  end if;
  perform public.notify_employee(e.id, p_type, p_title, p_message);
end $$;
revoke all on function public.notify_employee_number(uuid, text, text, text, text) from public, anon, authenticated;

-- "1,234.50"
create or replace function public.kes(p numeric) returns text language sql immutable as $$
  select 'KES ' || to_char(coalesce(p, 0), 'FM999,999,999,990.00')
$$;

-- " Reason: x." when there is a reason
create or replace function public.with_note(p_label text, p_note text) returns text language sql immutable as $$
  select coalesce(' ' || p_label || ': ' || nullif(btrim(p_note), '') || '.', '')
$$;

-- salary advances: approved, rejected, paid
create or replace function public.notify_salary_advance() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s text := lower(coalesce(new.status, ''));
  amount numeric := coalesce(new.admin_adjusted_amount, new."Amount Requested");
begin
  if s is not distinct from lower(coalesce(old.status, '')) then
    return new;
  end if;
  if s = 'approved' then
    perform public.notify_employee_number(new.tenant_id, new."Employee Number", 'salary_advance_approved', 'Salary advance approved',
      'Your salary advance of ' || public.kes(amount) || ' was approved.' || public.with_note('Notes', new.admin_notes));
  elsif s = 'rejected' then
    perform public.notify_employee_number(new.tenant_id, new."Employee Number", 'salary_advance_rejected', 'Salary advance not approved',
      'Your salary advance request of ' || public.kes(new."Amount Requested") || ' was not approved.'
      || public.with_note('Reason', coalesce(new.admin_notes, new.regional_manager_comment, new.regional_manager_notes, new.branch_manager_notes)));
  elsif s in ('paid', 'completed') then
    perform public.notify_employee_number(new.tenant_id, new."Employee Number", 'salary_advance_paid', 'Salary advance paid',
      'Your salary advance of ' || public.kes(amount) || ' has been paid.');
  end if;
  return new;
end $$;
drop trigger if exists salary_advance_notify on public.salary_advance;
create trigger salary_advance_notify after update of status on public.salary_advance
  for each row execute function public.notify_salary_advance();

-- staff loans: approved, rejected
create or replace function public.notify_loan_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s text := lower(coalesce(new.status, ''));
begin
  if s is not distinct from lower(coalesce(old.status, '')) then
    return new;
  end if;
  if s = 'approved' then
    perform public.notify_employee_number(new.tenant_id, new."Employee Number", 'loan_approved', 'Loan approved',
      'Your loan request of ' || public.kes(new."Loan Amount") || ' was approved.' || public.with_note('Notes', new.admin_notes));
  elsif s = 'rejected' then
    perform public.notify_employee_number(new.tenant_id, new."Employee Number", 'loan_rejected', 'Loan not approved',
      'Your loan request of ' || public.kes(new."Loan Amount") || ' was not approved.' || public.with_note('Reason', new.admin_notes));
  end if;
  return new;
end $$;
drop trigger if exists loan_requests_notify on public.loan_requests;
create trigger loan_requests_notify after update of status on public.loan_requests
  for each row execute function public.notify_loan_request();

-- payroll: the payslip is ready when the month is approved; the salary is paid when it is marked paid
create or replace function public.notify_payroll_run() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  h record;
  month text := to_char(to_date(new.pay_period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
begin
  if new.status is not distinct from old.status or new.status not in ('approved', 'paid') then
    return new;
  end if;
  for h in select distinct employee_id from public.salary_history where run_id = new.id loop
    if new.status = 'approved' then
      perform public.notify_employee_number(new.tenant_id, h.employee_id, 'payslip_ready', 'Payslip ready',
        'Your payslip for ' || month || ' is ready. Open Payslips to see it.');
    else
      perform public.notify_employee_number(new.tenant_id, h.employee_id, 'salary_paid', 'Salary paid',
        'Your salary for ' || month || ' has been paid.');
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists payroll_runs_notify on public.payroll_runs;
create trigger payroll_runs_notify after update of status on public.payroll_runs
  for each row execute function public.notify_payroll_run();

-- expenses: approved, rejected
create or replace function public.notify_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s text := lower(coalesce(new.status, ''));
  what text := coalesce(nullif(btrim(new.title), ''), 'expense') || ' (' || public.kes(new.amount) || ')';
begin
  if s is not distinct from lower(coalesce(old.status, '')) then
    return new;
  end if;
  if s = 'approved' then
    perform public.notify_employee_number(new.tenant_id, new.employee_id, 'expense_approved', 'Expense approved',
      'Your expense ' || what || ' was approved.');
  elsif s = 'rejected' then
    perform public.notify_employee_number(new.tenant_id, new.employee_id, 'expense_rejected', 'Expense not approved',
      'Your expense ' || what || ' was not approved.' || public.with_note('Reason', new.rejection_reason));
  end if;
  return new;
end $$;
drop trigger if exists expenses_notify on public.expenses;
create trigger expenses_notify after update of status on public.expenses
  for each row execute function public.notify_expense();

-- phone-number changes: approved, rejected
create or replace function public.notify_phone_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'approved' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'phone_change_approved', 'Phone number changed',
      'Your phone number was changed to ' || new.requested_phone || '.');
  elsif new.status = 'rejected' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'phone_change_rejected', 'Phone number change not approved',
      'Your request to change your phone number to ' || new.requested_phone || ' was not approved.' || public.with_note('Reason', new.admin_notes));
  end if;
  return new;
end $$;
drop trigger if exists phone_number_change_requests_notify on public.phone_number_change_requests;
create trigger phone_number_change_requests_notify after update of status on public.phone_number_change_requests
  for each row execute function public.notify_phone_change();

-- incident reports: the status changed (never for anonymous reports)
create or replace function public.notify_incident_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_anonymous or new.status is not distinct from old.status then
    return new;
  end if;
  perform public.notify_employee_number(new.tenant_id, new.employee_number, 'incident_update', 'Incident report updated',
    'Your incident report "' || new.title || '" is now ' || replace(new.status, '_', ' ') || '.'
    || public.with_note('Resolution', case when new.status in ('resolved', 'closed', 'dismissed') then new.resolution end)
    || public.with_note('Notes', new.admin_notes));
  return new;
end $$;
drop trigger if exists incident_reports_notify on public.incident_reports;
create trigger incident_reports_notify after update of status on public.incident_reports
  for each row execute function public.notify_incident_report();

-- warnings issued
create or replace function public.notify_warning() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_employee_number(new.tenant_id, new.employee_id, 'warning_issued',
    coalesce('Warning: ' || nullif(btrim(new.type), ''), 'Warning issued'),
    coalesce(nullif(btrim(new.message), ''), 'You have been issued a warning.'));
  return new;
end $$;
drop trigger if exists warnings_notify on public.warnings;
create trigger warnings_notify after insert on public.warnings
  for each row execute function public.notify_warning();

-- suspension and reactivation
create or replace function public.notify_suspension() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.is_active then
    perform public.notify_employee_number(new.tenant_id, new."Employee Number", 'suspended', 'You have been suspended',
      'You are suspended from ' || to_char(new.suspension_date, 'DD Mon YYYY')
      || coalesce(' until ' || to_char(new.reactivation_date, 'DD Mon YYYY'), '') || '.'
      || public.with_note('Reason', new.suspension_reason));
  elsif tg_op = 'UPDATE' and old.is_active and not new.is_active then
    perform public.notify_employee_number(new.tenant_id, new."Employee Number", 'reactivated', 'Suspension ended',
      'Your suspension has ended and your account is active again.');
  end if;
  return new;
end $$;
drop trigger if exists hr_suspensions_notify on public.hr_suspensions;
create trigger hr_suspensions_notify after insert or update of is_active on public.hr_suspensions
  for each row execute function public.notify_suspension();

-- employment changes recorded in the lifecycle history
create or replace function public.notify_lifecycle_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  what text := case new.event_type
    when 'probation_confirmed' then 'Your probation is complete and your employment is confirmed.'
    when 'probation_extended' then 'Your probation has been extended.'
    when 'contract_renewed' then 'Your contract has been renewed.'
    when 'contract_converted' then 'Your contract has been changed.'
    when 'promotion' then 'Congratulations, you have been promoted.'
    when 'branch_transfer' then 'You have been transferred to another branch.'
    when 'position_change' then 'Your position has changed.'
    when 'salary_revision' then 'Your salary has been revised.'
    when 'status_change' then 'Your employment status has changed.'
  end;
begin
  if what is not null then
    perform public.notify_employee_number(new.tenant_id, new."Employee Number", 'employment_update', 'Employment update',
      what || public.with_note('Notes', new.notes));
  end if;
  return new;
end $$;
drop trigger if exists hr_lifecycle_history_notify on public.hr_lifecycle_history;
create trigger hr_lifecycle_history_notify after insert on public.hr_lifecycle_history
  for each row execute function public.notify_lifecycle_event();

-- leave HR schedules for someone, or its decision
create or replace function public.notify_leave_schedule() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  span text := coalesce(nullif(btrim(new.leave_type), ''), 'Leave') || ' from ' || to_char(new.leave_start_date, 'DD Mon YYYY')
    || ' to ' || to_char(new.leave_end_date, 'DD Mon YYYY');
begin
  if tg_op = 'INSERT' then
    perform public.notify_employee_number(new.tenant_id, new."Employee Number", 'leave_scheduled', 'Leave scheduled',
      'HR scheduled ' || span || ' for you.' || public.with_note('Notes', new.notes));
  elsif new.status is distinct from old.status and new.status in ('Approved', 'Rejected') then
    perform public.notify_employee_number(new.tenant_id, new."Employee Number", 'leave_scheduled', 'Scheduled leave ' || lower(new.status),
      'Your scheduled ' || span || ' was ' || lower(new.status) || '.' || public.with_note('Notes', new.notes));
  end if;
  return new;
end $$;
drop trigger if exists hr_leave_schedules_notify on public.hr_leave_schedules;
create trigger hr_leave_schedules_notify after insert or update of status on public.hr_leave_schedules
  for each row execute function public.notify_leave_schedule();

-- a new or updated policy everyone must accept: everyone in the company who is not terminated
create or replace function public.notify_policy_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p public.company_policies;
  e record;
begin
  select * into p from public.company_policies where id = new.policy_id;
  if p.id is null or not p.required or not p.active then
    return new;
  end if;
  for e in select id from public.employees
           where tenant_id = new.tenant_id and "Termination Date" is null
             and coalesce(lower("Status"), '') not in ('terminated', 'inactive', 'resigned', 'dismissed') loop
    perform public.notify_employee(e.id, 'policy_to_accept',
      case when new.version = 1 then 'New policy to accept' else 'Updated policy to accept' end,
      'Please read and accept "' || p.title || '"' || case when new.version > 1 then ' (updated)' else '' end || ' in Onboarding.');
  end loop;
  return new;
end $$;
drop trigger if exists company_policy_versions_notify on public.company_policy_versions;
create trigger company_policy_versions_notify after insert on public.company_policy_versions
  for each row execute function public.notify_policy_version();

-- a task assigned to someone (assigned_to holds an employee number or a login id)
create or replace function public.notify_task_assigned() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := btrim(coalesce(new.assigned_to, ''));
begin
  if who = '' or (tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to) then
    return new;
  end if;
  if who ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select e."Employee Number" into who from public.employees e join auth.users u on lower(u.email) = lower(e."Work Email")
    where u.id = who::uuid and e.tenant_id = new.tenant_id limit 1;
  end if;
  perform public.notify_employee_number(new.tenant_id, who, 'task_assigned', 'New task',
    'You have been given a task: ' || coalesce(nullif(btrim(new.title), ''), 'untitled')
    || coalesce(', due ' || to_char(new.due_date, 'DD Mon YYYY'), '') || '.');
  return new;
end $$;
drop trigger if exists todos_notify on public.todos;
create trigger todos_notify after insert or update of assigned_to on public.todos
  for each row execute function public.notify_task_assigned();

-- an asset assigned to someone (assigned_to reads "First Last (Employee Number)")
create or replace function public.notify_asset_assigned() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := substring(coalesce(new.assigned_to, '') from '\(([^()]+)\)\s*$');
begin
  if who is null or (tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to) then
    return new;
  end if;
  perform public.notify_employee_number(new.tenant_id, who, 'asset_assigned', 'Asset assigned to you',
    concat_ws(' ', nullif(btrim(new.asset_name), ''), '(' || nullif(btrim(new.asset_tag), '') || ')') || ' is now assigned to you.');
  return new;
end $$;
drop trigger if exists assets_notify on public.assets;
create trigger assets_notify after insert or update of assigned_to on public.assets
  for each row execute function public.notify_asset_assigned();

-- the bell updates live
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hr_notifications') then
      alter publication supabase_realtime add table public.hr_notifications;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
