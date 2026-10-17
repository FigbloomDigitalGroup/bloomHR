-- Leave discipline (FIG-881): absences, failure to notify, missing leave documents, and warnings for them.
--
-- HR asked for disciplinary action on failures of communication: 1. inexcusable absence, 2. failure to notify,
-- 3. leave applied for without the proof document.
--
--   leave_absences                       one record of an employee's absence over a date range:
--     kind                               'unexcused_absence' (away from work without permission or a valid reason) or
--                                        'failed_to_notify' (didn't tell anyone in time: a conduct record)
--     days                               working days in the range: the employee's work week less holidays
--                                        (leave_days_for), worked out again when the dates change
--     status                             'recorded', or 'excused' by HR later (a document turned up...), optionally
--                                        turned into an approved leave application of a type HR picks
--   record_absence(...)                  HR ('leaves' or 'employees' module) or the employee's supervisor
--   excuse_absence(...) / delete_absence HR; the person who recorded it may also remove it while it is not excused
--   leave_absences_list(since)           what the signed-in user may see: HR everything, a supervisor their team
--   The employee sees their own records (RLS) and is told when one is recorded or excused (employment_update).
--
--   company_payroll_settings.deduct_unexcused_absence   (default on) days of 'unexcused_absence' that are not excused
--                                        come off pay like unpaid leave, at the same day's pay
--                                        (leave_daily_rate_basis), before tax: absence_pay_deductions('YYYY-MM').
--                                        'failed_to_notify' is never deducted by itself.
--
--   overdue_leave_documents()            leave applications (not rejected or cancelled, starting in the last 90 days)
--                                        whose required document is missing: needed with the application, or
--                                        due N days after the leave starts and now past that day; for HR
--   leave_document_overdue               an HR-facing notification, once per application, when it becomes overdue:
--                                        made by check_overdue_leave_documents() (HR opening the page) and a daily
--                                        pg_cron job (best effort). leave_document_overdue_notices remembers which.
--
--   warnings.absence_id / warnings.leave_application_id   the record a warning was issued for.
--   issue_discipline_warning(...)        HR (or the Disciplinary module) issues the warning for one of these records;
--                                        the existing warnings trigger notifies (and emails) the employee.
--   leave_discipline_counts()            per employee, the last 12 months: unexcused absences and days, failures to
--                                        notify, applications whose document went overdue, warnings.

-- ---------------------------------------------------------------------------------------------
-- 1. notification type (HR-facing): every value from 20261018000000_hr_alerts.sql, plus leave_document_overdue
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
  'leave_document_overdue'
));

create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested', 'contract_signed', 'leave_exhausted', 'casual_limit', 'leave_document_overdue')
$$;

-- who is emailed each (20261017600000): leave alerts go to people who run leave; casual workers to payroll
create or replace function public.hr_alert_modules(p_type text) returns text[] language sql immutable as $$
  select case
    when p_type in ('leave_recommended', 'leave_exhausted', 'leave_document_overdue') then array['leaves']
    when p_type = 'application_received' then array['recruitment']
    when p_type = 'loan_requested' then array['payroll']
    when p_type = 'casual_limit' then array['work-records', 'payroll']
    -- contract_expiring, probation_expiring, contract_signed, exit_requested, and any HR-facing type added later
    else array['employees', 'hr-lifecycle']
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. who may do what
-- ---------------------------------------------------------------------------------------------
-- HR for leave discipline: people who run leave or employees
create or replace function public.manages_leave_discipline() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_module('leaves', 'employees')
$$;
revoke all on function public.manages_leave_discipline() from public, anon;
grant execute on function public.manages_leave_discipline() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. absences
-- ---------------------------------------------------------------------------------------------
create table if not exists public.leave_absences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null,
  kind text not null check (kind in ('unexcused_absence', 'failed_to_notify')),
  start_date date not null,
  end_date date not null,
  days numeric not null default 0,
  note text check (note is null or char_length(note) <= 2000),
  status text not null default 'recorded' check (status in ('recorded', 'excused')),
  recorded_by uuid default auth.uid() references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  excused_by uuid references auth.users(id) on delete set null,
  excused_at timestamptz,
  excuse_note text check (excuse_note is null or char_length(excuse_note) <= 2000),
  leave_application_id uuid references public.leave_application(id) on delete set null,
  check (end_date >= start_date and end_date - start_date <= 366),
  foreign key (tenant_id, employee_number) references public.employees(tenant_id, "Employee Number")
    on update cascade on delete cascade
);
create index if not exists leave_absences_tenant_dates on public.leave_absences (tenant_id, start_date, end_date);
create index if not exists leave_absences_tenant_employee on public.leave_absences (tenant_id, employee_number);

alter table public.leave_absences enable row level security;
drop policy if exists tenant_isolation on public.leave_absences;
create policy tenant_isolation on public.leave_absences as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- read: HR, the employee's supervisor, the employee. Changes only through the functions below.
drop policy if exists involved_select on public.leave_absences;
create policy involved_select on public.leave_absences for select to authenticated
  using ((select public.manages_leave_discipline())
         or employee_number in (select public.supervised_employee_numbers())
         or employee_number = (select public.current_employee_number()));
revoke all on public.leave_absences from anon;
revoke insert, update, delete, truncate on public.leave_absences from authenticated;

drop trigger if exists audit_leave_absences on public.leave_absences;
create trigger audit_leave_absences after insert or update or delete on public.leave_absences
  for each row execute function public.audit_row_change();

-- days are always the working days in the range (the employee's work week less holidays)
create or replace function public.leave_absences_days() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.days := public.leave_days_for(new.tenant_id, new.employee_number, new.start_date, new.end_date, false);
  return new;
end $$;
revoke all on function public.leave_absences_days() from public, anon, authenticated;
drop trigger if exists leave_absences_days on public.leave_absences;
create trigger leave_absences_days before insert or update of start_date, end_date, employee_number on public.leave_absences
  for each row execute function public.leave_absences_days();

-- "2 Oct 2026" or "2 Oct - 4 Oct 2026"
create or replace function public.leave_absence_dates(p_start date, p_end date) returns text
language sql immutable as $$
  select case when p_start = p_end then to_char(p_start, 'FMDD Mon YYYY')
              else to_char(p_start, 'FMDD Mon') || ' - ' || to_char(p_end, 'FMDD Mon YYYY') end
$$;

create or replace function public.leave_absence_kind_label(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'unexcused_absence' then 'Unexcused absence' when 'failed_to_notify' then 'Failure to notify' else p_kind end
$$;

/**
 * Records an absence: HR or the employee's supervisor. Not in the future, at least one working day, not over the
 * employee's approved leave (for an unexcused absence), and not overlapping another of the same kind still recorded.
 */
create or replace function public.record_absence(
  p_employee text, p_kind text, p_start date, p_end date, p_note text default null
) returns public.leave_absences
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_emp text := btrim(coalesce(p_employee, ''));
  r public.leave_absences;
begin
  if v_tenant is null or not (public.manages_leave_discipline() or public.supervises(v_emp)) then
    raise exception 'Only HR or the employee''s supervisor can record an absence' using errcode = '42501';
  end if;
  if v_emp = coalesce(public.current_employee_number(), '') then
    raise exception 'You can''t record an absence for yourself' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.tenant_id = v_tenant and e."Employee Number" = v_emp) then
    raise exception 'No such employee' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('unexcused_absence', 'failed_to_notify') then
    raise exception 'Choose unexcused absence or failure to notify' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'The last day can''t be before the first' using errcode = '22023';
  end if;
  if p_end > current_date then
    raise exception 'An absence can''t be recorded for days still to come' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'Record at most a year at a time' using errcode = '22023';
  end if;
  if public.leave_days_for(v_tenant, v_emp, p_start, p_end, false) <= 0 then
    raise exception 'Those days are not working days for this employee (days off or public holidays)' using errcode = '22023';
  end if;
  if p_kind = 'unexcused_absence' and exists (
    select 1 from public.leave_application a
    where a.tenant_id = v_tenant and a."Employee Number" = v_emp and lower(btrim(coalesce(a.status, ''))) = 'approved'
      and public.leave_parse_date(a."Start Date") <= p_end and public.leave_parse_date(a."End Date") >= p_start) then
    raise exception 'This employee has approved leave on some of those days' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.leave_absences x
    where x.tenant_id = v_tenant and x.employee_number = v_emp and x.kind = p_kind and x.status = 'recorded'
      and x.start_date <= p_end and x.end_date >= p_start) then
    raise exception 'An overlapping % is already recorded', lower(public.leave_absence_kind_label(p_kind)) using errcode = '23505';
  end if;

  insert into public.leave_absences (tenant_id, employee_number, kind, start_date, end_date, note, recorded_by)
  values (v_tenant, v_emp, p_kind, p_start, p_end, nullif(btrim(left(coalesce(p_note, ''), 2000)), ''), auth.uid())
  returning * into r;

  perform public.notify_employee_number(v_tenant, v_emp, 'employment_update',
    public.leave_absence_kind_label(p_kind) || ' recorded',
    case when p_kind = 'unexcused_absence'
      then 'An unexcused absence was recorded for ' || public.leave_absence_dates(p_start, p_end) || ' (' || trim_scale(r.days)
           || case when r.days = 1 then ' working day' else ' working days' end || ').'
           || ' If you have a reason or a document, give it to HR: an excused absence is not deducted from pay.'
      else 'A failure to notify was recorded for ' || public.leave_absence_dates(p_start, p_end)
           || '. Please tell your supervisor or HR in time when you can''t come to work.'
    end || coalesce(' Note: ' || nullif(btrim(p_note), ''), ''));
  return r;
end $$;
revoke all on function public.record_absence(text, text, date, date, text) from public, anon;
grant execute on function public.record_absence(text, text, date, date, text) to authenticated;

/**
 * HR excuses a recorded absence (it is then not deducted). With a leave type, it also becomes an approved leave
 * application for the same days (needs the Leave module), counted against that leave's balance.
 */
create or replace function public.excuse_absence(p_id uuid, p_note text default null, p_leave_type text default null)
returns public.leave_absences
language plpgsql security definer set search_path = public as $$
declare
  r public.leave_absences;
  e public.employees;
  v_leave uuid;
  v_type text := nullif(btrim(coalesce(p_leave_type, '')), '');
begin
  if not public.manages_leave_discipline() then
    raise exception 'Only HR can excuse an absence' using errcode = '42501';
  end if;
  select * into r from public.leave_absences where id = p_id and tenant_id = public.current_tenant_id() for update;
  if r.id is null then
    raise exception 'No such absence' using errcode = '22023';
  end if;
  if r.status = 'excused' then
    raise exception 'This absence is already excused' using errcode = '22023';
  end if;
  if v_type is not null then
    if not public.has_module('leaves') then
      raise exception 'Only people with the Leave module can turn an absence into leave' using errcode = '42501';
    end if;
    if not exists (select 1 from public.leave_types t where t.tenant_id = r.tenant_id and t.name = v_type) then
      raise exception 'No such leave type' using errcode = '22023';
    end if;
    select * into e from public.employees where tenant_id = r.tenant_id and "Employee Number" = r.employee_number;
    insert into public.leave_application (tenant_id, "Employee Number", name, "Leave Type", "Start Date", "End Date", status,
                                          reason, "Office Branch")
    values (r.tenant_id, r.employee_number,
      coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), r.employee_number), v_type,
      to_char(r.start_date, 'YYYY-MM-DD'), to_char(r.end_date, 'YYYY-MM-DD'), 'approved',
      'Excused absence' || coalesce(': ' || nullif(btrim(p_note), ''), ''), e."Office")
    returning id into v_leave;
  end if;

  update public.leave_absences
  set status = 'excused', excused_by = auth.uid(), excused_at = now(),
      excuse_note = nullif(btrim(left(coalesce(p_note, ''), 2000)), ''), leave_application_id = v_leave
  where id = r.id returning * into r;

  perform public.notify_employee_number(r.tenant_id, r.employee_number, 'employment_update',
    public.leave_absence_kind_label(r.kind) || ' excused',
    'Your ' || lower(public.leave_absence_kind_label(r.kind)) || ' on ' || public.leave_absence_dates(r.start_date, r.end_date)
    || ' has been excused' || case when v_type is not null then ' and recorded as ' || v_type else '' end || '.'
    || coalesce(' Note: ' || r.excuse_note, ''));
  return r;
end $$;
revoke all on function public.excuse_absence(uuid, text, text) from public, anon;
grant execute on function public.excuse_absence(uuid, text, text) to authenticated;

-- removes a record made by mistake: HR, or whoever recorded it while it is not excused
create or replace function public.delete_absence(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.leave_absences;
begin
  select * into r from public.leave_absences where id = p_id and tenant_id = public.current_tenant_id();
  if r.id is null then
    raise exception 'No such absence' using errcode = '22023';
  end if;
  if not public.manages_leave_discipline()
     and not (r.recorded_by = auth.uid() and r.status = 'recorded' and public.supervises(r.employee_number)) then
    raise exception 'Only HR, or whoever recorded it, can remove this absence' using errcode = '42501';
  end if;
  delete from public.leave_absences where id = r.id;
end $$;
revoke all on function public.delete_absence(uuid) from public, anon;
grant execute on function public.delete_absence(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. warnings for these records
-- ---------------------------------------------------------------------------------------------
alter table public.warnings add column if not exists absence_id uuid references public.leave_absences(id) on delete set null;
alter table public.warnings add column if not exists leave_application_id uuid references public.leave_application(id) on delete set null;
create index if not exists warnings_absence_idx on public.warnings (absence_id) where absence_id is not null;
create index if not exists warnings_leave_application_idx on public.warnings (leave_application_id) where leave_application_id is not null;

/**
 * Issues a warning for an absence record (p_absence) or a leave application whose document is missing (p_leave):
 * HR or the Disciplinary module. The warning is for that record's employee and linked to it; the warnings trigger
 * notifies the employee (warning_issued, always emailed).
 */
create or replace function public.issue_discipline_warning(
  p_absence uuid, p_leave uuid, p_type text, p_severity text, p_message text
) returns public.warnings
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_emp text;
  w public.warnings;
begin
  if v_tenant is null or not (public.manages_leave_discipline() or public.has_module('staffcheck')) then
    raise exception 'Only HR can issue warnings' using errcode = '42501';
  end if;
  if (p_absence is null) = (p_leave is null) then
    raise exception 'Issue the warning for one absence or one leave application' using errcode = '22023';
  end if;
  if p_absence is not null then
    select employee_number into v_emp from public.leave_absences where id = p_absence and tenant_id = v_tenant;
    if v_emp is null then
      raise exception 'No such absence' using errcode = '22023';
    end if;
  else
    select "Employee Number" into v_emp from public.leave_application where id = p_leave and tenant_id = v_tenant;
    if v_emp is null then
      raise exception 'No such leave application' using errcode = '22023';
    end if;
  end if;
  if v_emp = coalesce(public.current_employee_number(), '') then
    raise exception 'You can''t issue a warning to yourself' using errcode = '42501';
  end if;
  if coalesce(p_severity, '') not in ('low', 'medium', 'high') then
    raise exception 'Severity is low, medium or high' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_message, '')), '') is null or char_length(p_message) > 5000 then
    raise exception 'Write the warning message (up to 5000 characters)' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_type, '')), '') is null or char_length(p_type) > 120 then
    raise exception 'Give the warning a type' using errcode = '22023';
  end if;

  insert into public.warnings (tenant_id, employee_id, type, severity, message, issued_at, absence_id, leave_application_id)
  values (v_tenant, v_emp, btrim(p_type), p_severity, btrim(p_message), current_date, p_absence, p_leave)
  returning * into w;
  return w;
end $$;
revoke all on function public.issue_discipline_warning(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.issue_discipline_warning(uuid, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. what HR and supervisors see
-- ---------------------------------------------------------------------------------------------
create or replace function public.leave_discipline_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'manage', public.manages_leave_discipline(),
    'leaves', public.has_module('leaves'),
    'warn', public.manages_leave_discipline() or public.has_module('staffcheck'),
    'supervised', coalesce((select jsonb_agg(n order by n) from public.supervised_employee_numbers() n), '[]'::jsonb))
$$;
revoke all on function public.leave_discipline_access() from public, anon;
grant execute on function public.leave_discipline_access() to authenticated;

-- the absences the signed-in user may see (HR: all; a supervisor: their team), from p_since (default a year ago)
create or replace function public.leave_absences_list(p_since date default null)
returns table (
  id uuid, employee_number text, employee_name text, kind text, start_date date, end_date date, days numeric,
  note text, status text, recorded_by uuid, recorded_by_name text, recorded_at timestamptz, excused_at timestamptz,
  excuse_note text, leave_application_id uuid, warnings integer, last_warning_at date
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_hr boolean := public.manages_leave_discipline();
begin
  if v_tenant is null then
    raise exception 'Sign in to a company first' using errcode = '42501';
  end if;
  return query
  select x.id, x.employee_number,
         coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), x.employee_number),
         x.kind, x.start_date, x.end_date, trim_scale(x.days), x.note, x.status, x.recorded_by,
         coalesce(nullif(btrim(concat_ws(' ', re."First Name", re."Last Name")), ''), u.email::text),
         x.recorded_at, x.excused_at, x.excuse_note, x.leave_application_id,
         (select count(*)::int from public.warnings w where w.tenant_id = v_tenant and w.absence_id = x.id),
         (select max(w.issued_at) from public.warnings w where w.tenant_id = v_tenant and w.absence_id = x.id)
  from public.leave_absences x
  left join public.employees e on e.tenant_id = x.tenant_id and e."Employee Number" = x.employee_number
  left join auth.users u on u.id = x.recorded_by
  left join lateral (
    select ee."First Name", ee."Last Name" from public.employees ee
    join public.user_profiles up on up.tenant_id = v_tenant and up.user_id = x.recorded_by
    where ee.tenant_id = v_tenant and lower(ee."Work Email") = lower(up.email) limit 1) re on true
  where x.tenant_id = v_tenant
    and x.end_date >= coalesce(p_since, (current_date - interval '12 months')::date)
    and (v_hr or x.employee_number in (select public.supervised_employee_numbers()))
  order by x.start_date desc, x.recorded_at desc;
end $$;
revoke all on function public.leave_absences_list(date) from public, anon;
grant execute on function public.leave_absences_list(date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. unexcused absence in payroll
-- ---------------------------------------------------------------------------------------------
alter table public.company_payroll_settings add column if not exists deduct_unexcused_absence boolean not null default true;

-- per employee, the month's days of unexcused absence (recorded, not excused), their working days that month (for
-- the 'working_days' day's pay), and the records behind them. Nothing when the company doesn't deduct them.
create or replace function public.absence_pay_deductions(p_period text)
returns table (
  employee_number text,
  absence_days numeric,
  month_working_days numeric,
  absences jsonb
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_first date;
  v_last date;
begin
  if v_tenant is null or not public.has_module('payroll') then
    raise exception 'Only payroll can see absence deductions' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Pay period "%" should look like 2026-09 (year-month)', coalesce(p_period, '') using errcode = '22023';
  end if;
  if not coalesce((select s.deduct_unexcused_absence from public.company_payroll_settings s where s.tenant_id = v_tenant), true) then
    return;
  end if;
  v_first := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_last := (v_first + interval '1 month' - interval '1 day')::date;

  return query
  with counted as (
    select x.id, x.employee_number as emp, x.start_date as s, x.end_date as e,
           public.leave_days_for(v_tenant, x.employee_number, greatest(x.start_date, v_first), least(x.end_date, v_last), false) as d
    from public.leave_absences x
    where x.tenant_id = v_tenant and x.kind = 'unexcused_absence' and x.status = 'recorded'
      and x.start_date <= v_last and x.end_date >= v_first
  )
  select c.emp,
         trim_scale(sum(c.d)),
         public.leave_days_for(v_tenant, c.emp, v_first, v_last, false),
         jsonb_agg(jsonb_build_object(
           'id', c.id, 'start_date', to_char(c.s, 'YYYY-MM-DD'), 'end_date', to_char(c.e, 'YYYY-MM-DD'),
           'days_in_month', trim_scale(c.d)) order by c.s, c.id)
  from counted c
  where c.d > 0
  group by c.emp
  order by c.emp;
end $$;
revoke all on function public.absence_pay_deductions(text) from public, anon;
grant execute on function public.absence_pay_deductions(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. leave documents overdue
-- ---------------------------------------------------------------------------------------------
-- each missing document on a company's leave applications (not rejected or cancelled) that started in the last 90
-- days: the leave type's document when it was needed with the application (due the day it was applied for), or
-- after the leave started and now past its last day; the follow-up document past its last day. The same rules as
-- src/lib/leaveDocuments.ts.
create or replace function public.leave_documents_overdue_for(p_tenant uuid, p_today date default current_date)
returns table (
  leave_id uuid, employee_number text, employee_name text, leave_type text, start_date date, end_date date,
  leave_status text, days numeric, document_kind text, document_name text, due_date date
)
language sql stable security definer set search_path = public as $$
  with apps as (
    select a.id, a.tenant_id, a."Employee Number" as emp, btrim(coalesce(a."Leave Type", '')) as leave_type,
           public.leave_parse_date(a."Start Date") as s, public.leave_parse_date(a."End Date") as e,
           coalesce(a.status, 'pending') as status, coalesce(a.days, 0)::numeric as days,
           a.document_path, a.followup_document_path, coalesce(a.time_added::date, public.leave_parse_date(a."Start Date")) as applied
    from public.leave_application a
    where a.tenant_id = p_tenant
      and lower(btrim(coalesce(a.status, ''))) not in ('rejected', 'cancelled')
      and nullif(btrim(a."Employee Number"), '') is not null
  )
  select apps.id, apps.emp,
         coalesce(nullif(btrim(concat_ws(' ', emp."First Name", emp."Last Name")), ''), apps.emp),
         apps.leave_type, apps.s, apps.e, apps.status, trim_scale(apps.days), d.kind, d.name, d.due
  from apps
  join public.leave_types t on t.tenant_id = apps.tenant_id and t.name = apps.leave_type
  join public.current_leave_policies p on p.leave_type_id = t.id
  left join public.employees emp on emp.tenant_id = apps.tenant_id and emp."Employee Number" = apps.emp
  cross join lateral (values
    ('main', p.document_name,
      case when p.document_when = 'after' then apps.s + p.document_within_days else least(apps.applied, apps.s) end,
      p.document_name is not null and apps.document_path is null and apps.days > p.document_if_longer_than,
      p.document_when = 'with_application'),
    ('followup', p.followup_document_name, apps.s + p.followup_within_days,
      p.followup_document_name is not null and apps.followup_document_path is null,
      false)
  ) as d(kind, name, due, missing, at_once)
  where apps.s is not null and apps.s >= p_today - 90
    and d.missing and (d.at_once or p_today > d.due)
  order by d.due, apps.emp, apps.id, d.kind
$$;
revoke all on function public.leave_documents_overdue_for(uuid, date) from public, anon, authenticated;

-- which applications HR has been told about (one notification each)
create table if not exists public.leave_document_overdue_notices (
  leave_id uuid primary key references public.leave_application(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_number text not null,
  notified_at timestamptz not null default now()
);
create index if not exists leave_document_overdue_notices_tenant on public.leave_document_overdue_notices (tenant_id, employee_number);
alter table public.leave_document_overdue_notices enable row level security;
drop policy if exists tenant_isolation on public.leave_document_overdue_notices;
create policy tenant_isolation on public.leave_document_overdue_notices as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists hr_select on public.leave_document_overdue_notices;
create policy hr_select on public.leave_document_overdue_notices for select to authenticated
  using ((select public.manages_leave_discipline()));
revoke all on public.leave_document_overdue_notices from anon;
revoke insert, update, delete, truncate on public.leave_document_overdue_notices from authenticated;

-- tells HR (once per application) about each newly overdue document in one company; how many it told
create or replace function public.leave_documents_overdue_notify(p_tenant uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
  e public.employees;
begin
  for r in
    select distinct on (o.leave_id) o.* from public.leave_documents_overdue_for(p_tenant) o
    where not exists (select 1 from public.leave_document_overdue_notices x where x.leave_id = o.leave_id)
    order by o.leave_id, o.due_date
  loop
    insert into public.leave_document_overdue_notices (leave_id, tenant_id, employee_number)
    values (r.leave_id, p_tenant, r.employee_number)
    on conflict (leave_id) do nothing;
    if not found then
      continue;
    end if;
    select * into e from public.employees where tenant_id = p_tenant and "Employee Number" = r.employee_number;
    insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date)
    values (p_tenant, r.employee_number, r.employee_name, e."Work Email", 'leave_document_overdue', 'Leave document overdue',
      r.employee_name || '''s ' || r.leave_type || ' (' || public.leave_absence_dates(r.start_date, coalesce(r.end_date, r.start_date))
      || ') has no ' || coalesce(r.document_name, 'document') || ': it was due '
      || case when r.document_kind = 'main' and r.due_date <= r.start_date then 'with the application'
              else 'by ' || to_char(r.due_date, 'FMDD Mon YYYY') end
      || '. Follow it up, or issue a warning, in Leave discipline.',
      r.due_date);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.leave_documents_overdue_notify(uuid) from public, anon, authenticated;

-- HR opening the page: tells HR about anything newly overdue in their company
create or replace function public.check_overdue_leave_documents() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if public.current_tenant_id() is null or not public.manages_leave_discipline() then
    raise exception 'Only HR can check leave documents' using errcode = '42501';
  end if;
  return public.leave_documents_overdue_notify(public.current_tenant_id());
end $$;
revoke all on function public.check_overdue_leave_documents() from public, anon;
grant execute on function public.check_overdue_leave_documents() to authenticated;

-- the daily job: every company
create or replace function public.notify_overdue_leave_documents_all() returns integer
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  n integer := 0;
begin
  for t in select distinct a.tenant_id from public.leave_application a loop
    begin
      n := n + public.leave_documents_overdue_notify(t);
    exception when others then
      raise warning 'overdue leave documents skipped for company %: %', t, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.notify_overdue_leave_documents_all() from public, anon, authenticated;

-- the list for HR, with any warnings issued for each application
create or replace function public.overdue_leave_documents()
returns table (
  leave_id uuid, employee_number text, employee_name text, leave_type text, start_date date, end_date date,
  leave_status text, days numeric, document_kind text, document_name text, due_date date,
  warnings integer, last_warning_at date
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not public.manages_leave_discipline() then
    raise exception 'Only HR can see overdue leave documents' using errcode = '42501';
  end if;
  return query
  select o.*,
         (select count(*)::int from public.warnings w where w.tenant_id = v_tenant and w.leave_application_id = o.leave_id),
         (select max(w.issued_at) from public.warnings w where w.tenant_id = v_tenant and w.leave_application_id = o.leave_id)
  from public.leave_documents_overdue_for(v_tenant) o;
end $$;
revoke all on function public.overdue_leave_documents() from public, anon;
grant execute on function public.overdue_leave_documents() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. per employee, the last 12 months
-- ---------------------------------------------------------------------------------------------
create or replace function public.leave_discipline_counts()
returns table (
  employee_number text, employee_name text, unexcused_absences integer, unexcused_days numeric,
  failed_to_notify integer, missing_documents integer, warnings integer
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_hr boolean := public.manages_leave_discipline();
  v_since date := (current_date - interval '12 months')::date;
begin
  if v_tenant is null then
    raise exception 'Sign in to a company first' using errcode = '42501';
  end if;
  return query
  with people as (
    select x.employee_number as emp from public.leave_absences x
    where x.tenant_id = v_tenant and x.status = 'recorded' and x.end_date >= v_since
    union
    select n.employee_number from public.leave_document_overdue_notices n
    where n.tenant_id = v_tenant and n.notified_at >= v_since
  ), scoped as (
    select p.emp from people p
    where v_hr or p.emp in (select public.supervised_employee_numbers())
  )
  select s.emp,
         coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), s.emp),
         (select count(*)::int from public.leave_absences x where x.tenant_id = v_tenant and x.employee_number = s.emp
            and x.kind = 'unexcused_absence' and x.status = 'recorded' and x.end_date >= v_since),
         (select coalesce(trim_scale(sum(x.days)), 0) from public.leave_absences x where x.tenant_id = v_tenant
            and x.employee_number = s.emp and x.kind = 'unexcused_absence' and x.status = 'recorded' and x.end_date >= v_since),
         (select count(*)::int from public.leave_absences x where x.tenant_id = v_tenant and x.employee_number = s.emp
            and x.kind = 'failed_to_notify' and x.status = 'recorded' and x.end_date >= v_since),
         (select count(*)::int from public.leave_document_overdue_notices n where n.tenant_id = v_tenant
            and n.employee_number = s.emp and n.notified_at >= v_since),
         (select count(*)::int from public.warnings w where w.tenant_id = v_tenant and w.employee_id = s.emp
            and w.issued_at >= v_since)
  from scoped s
  left join public.employees e on e.tenant_id = v_tenant and e."Employee Number" = s.emp
  order by 3 desc, 5 desc, 6 desc, 2;
end $$;
revoke all on function public.leave_discipline_counts() from public, anon;
grant execute on function public.leave_discipline_counts() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 9. scheduling (best effort): overdue documents every morning (05:30 UTC, 08:30 in Nairobi)
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('leave-documents-overdue-daily', '30 5 * * *', $c$select public.notify_overdue_leave_documents_all();$c$);
  else
    raise notice 'pg_cron is not available: HR is told about overdue leave documents when they open Leave discipline.';
  end if;
end $$;

notify pgrst, 'reload schema';
