-- Possible absences: Leave discipline fed from attendance.
--
-- Attendance (attendance_days_for) marks a working day "absent" when there is no clock-in, no approved leave and no
-- public holiday. Leave discipline (20261018700000) only knew the absences HR or a supervisor recorded by hand. Now the
-- absent days come to Leave discipline as a list to review. Nothing is ever recorded by itself: pay changes only when
-- someone clicks Record (record_absence, exactly as by hand).
--
--   possible_absences_for(tenant, today)   every possible absence in a company (internal): each person's days that
--                                           attendance_days_for calls 'absent' (so: a working day of their attendance
--                                           schedule, from the company's "Count attendance from" and their start date,
--                                           to their last day; no clock-in; no approved leave; not a public holiday;
--                                           never a casual worker), in the lookback window (the company's setting,
--                                           default 60 days) up to yesterday (today may still be in progress), less
--                                           the days that have
--                                             - a missed-scan request pending or approved,
--                                             - a scanner punch attendance kept but did not count as a clock-in
--                                               (an exit punch waiting for a clock-in, a break or overtime key),
--                                             - a leave_absences record over them (either kind, recorded or excused),
--                                             - a dismissal over them.
--                                           Consecutive absent days are one entry: the days between them that are off
--                                           (not a working day) or a public holiday don't break it, so Fri and Mon
--                                           with a weekend between are one entry; anything else (a day at work, leave,
--                                           a day taken out by the rules above) does. With each entry: whether a leave
--                                           application not yet decided covers any of it, and the notice the employee
--                                           was sent about it (if any).
--   possible_absences()                    what the signed-in user may see: HR (manages_leave_discipline) all, a
--                                           supervisor their team (supervised_employee_numbers); never their own.
--   leave_absence_dismissals               "not an absence", with a required reason: HR or the supervisor, through
--                                           dismiss_possible_absence(...) only. Dismissed days never come back.
--   leave_discipline_settings              per company, changed by HR (manages_leave_discipline) through
--                                           set_possible_absence_settings(...):
--                                             lookback_days         how far back the list looks (default 60, 7-180)
--                                             notify_employees      the employee notice (below); default off
--                                             notify_from           the day the notice was switched on: only absences
--                                                                   on or after it are noticed, never the backlog
--                                             reply_working_days    the reply is due this many of the person's working
--                                                                   days after the notice (default 2, 1-10)
--   possible_absence_notices               one per person per absence entry: the day the employee was told and the
--                                           day the reply is due. When the entry grows (the next day is absent too)
--                                           the notice's dates grow with it; no new message. At most one message per
--                                           person per day (new entries found the same day go in one message).
--   possible_absences_notify(tenant, today) the morning job, per company: HR is told how many there are (one HR alert
--                                           'possible_absences', when there are any), each supervisor how many in
--                                           their team ('possible_absences_team'), and, with the notice on, each
--                                           person with a new entry ('possible_absence': in the staff portal bell and
--                                           by email, like the other employee notifications). Once a day each.
--                                           The notice is only a notice: no record, no warning, no pay change.
--   pg_cron 'possible-absences-daily'      every morning at 04:45 UTC (07:45 in Nairobi), best effort.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. notification types: every value from 20261025400000_payments_to_make.sql, plus three
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
  'possible_absences', 'possible_absences_team', 'possible_absence'
));

-- (20261025400000's list, plus possible_absences: for HR, never shown in an employee's bell)
create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested', 'contract_signed', 'leave_exhausted', 'casual_limit', 'leave_document_overdue',
                    'contribution_requested', 'onboarding_followups_overdue', 'attendance_odd_hours', 'missed_scan_requested',
                    'payment_due', 'requisition_requested', 'possible_absences')
$$;

-- (20261025400000's list, plus the employee's notice: they have a deadline)
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
    'missed_scan_requested', 'requisition_requested',
    -- for finance: a payment is waiting
    'payment_due')
$$;

-- (20261025400000's, plus possible_absences to the people who run leave discipline: Leave or Employees)
create or replace function public.hr_alert_modules(p_type text) returns text[] language sql immutable as $$
  select case
    when p_type in ('leave_recommended', 'leave_exhausted', 'leave_document_overdue') then array['leaves']
    when p_type = 'possible_absences' then array['leaves', 'employees']
    when p_type = 'application_received' then array['recruitment']
    when p_type in ('loan_requested', 'contribution_requested') then array['payroll']
    when p_type = 'casual_limit' then array['work-records', 'payroll']
    when p_type = 'payment_due' then array['payments']
    when p_type = 'requisition_requested' then array['requisitions']
    -- contract_expiring, probation_expiring, contract_signed, exit_requested, and any HR-facing type added later
    else array['employees', 'hr-lifecycle']
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. the settings
-- ---------------------------------------------------------------------------------------------
create table if not exists public.leave_discipline_settings (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  lookback_days integer not null default 60 check (lookback_days between 7 and 180),
  notify_employees boolean not null default false,
  notify_from date,
  reply_working_days integer not null default 2 check (reply_working_days between 1 and 10),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.leave_discipline_settings enable row level security;
drop policy if exists tenant_isolation on public.leave_discipline_settings;
create policy tenant_isolation on public.leave_discipline_settings as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists members_read on public.leave_discipline_settings;
create policy members_read on public.leave_discipline_settings for select to authenticated using (true);
revoke all on public.leave_discipline_settings from anon;
revoke insert, update, delete, truncate on public.leave_discipline_settings from authenticated;

drop trigger if exists audit_leave_discipline_settings on public.leave_discipline_settings;
create trigger audit_leave_discipline_settings after insert or update or delete on public.leave_discipline_settings
  for each row execute function public.audit_row_change();

-- today in Nairobi (the app's clock)
create or replace function public.nairobi_today() returns date language sql stable as $$
  select (now() at time zone 'Africa/Nairobi')::date
$$;

-- a company's settings, with the defaults when it has none
create or replace function public.possible_absence_settings_for(p_tenant uuid)
returns table (lookback_days integer, notify_employees boolean, notify_from date, reply_working_days integer)
language sql stable security definer set search_path = public as $$
  select coalesce(s.lookback_days, 60), coalesce(s.notify_employees, false), s.notify_from, coalesce(s.reply_working_days, 2)
  from (select 1) one
  left join public.leave_discipline_settings s on s.tenant_id = p_tenant
$$;
revoke all on function public.possible_absence_settings_for(uuid) from public, anon, authenticated;

create or replace function public.possible_absence_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('lookback_days', s.lookback_days, 'notify_employees', s.notify_employees,
                            'notify_from', s.notify_from, 'reply_working_days', s.reply_working_days)
  from public.possible_absence_settings_for(public.current_tenant_id()) s
$$;
revoke all on function public.possible_absence_settings() from public, anon;
grant execute on function public.possible_absence_settings() to authenticated;

/**
 * HR changes the settings. Switching the employee notice on stores today as notify_from: only absences from today on
 * are noticed (never the backlog). Switching it off and on again starts from the new day.
 */
create or replace function public.set_possible_absence_settings(
  p_lookback_days integer, p_notify_employees boolean, p_reply_working_days integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_was boolean;
  v_from date;
begin
  if v_tenant is null or not public.manages_leave_discipline() then
    raise exception 'Only HR can change the possible absence settings' using errcode = '42501';
  end if;
  if p_lookback_days is null or p_lookback_days not between 7 and 180 then
    raise exception 'Look back between 7 and 180 days' using errcode = '22023';
  end if;
  if p_reply_working_days is null or p_reply_working_days not between 1 and 10 then
    raise exception 'Give between 1 and 10 working days to reply' using errcode = '22023';
  end if;
  select s.notify_employees, s.notify_from into v_was, v_from from public.leave_discipline_settings s where s.tenant_id = v_tenant;
  if coalesce(p_notify_employees, false) and not coalesce(v_was, false) then
    v_from := public.nairobi_today();
  end if;
  insert into public.leave_discipline_settings (tenant_id, lookback_days, notify_employees, notify_from, reply_working_days,
                                                updated_by, updated_at)
  values (v_tenant, p_lookback_days, coalesce(p_notify_employees, false), v_from, p_reply_working_days, auth.uid(), now())
  on conflict (tenant_id) do update
    set lookback_days = excluded.lookback_days, notify_employees = excluded.notify_employees,
        notify_from = excluded.notify_from, reply_working_days = excluded.reply_working_days,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return public.possible_absence_settings();
end $$;
revoke all on function public.set_possible_absence_settings(integer, boolean, integer) from public, anon;
grant execute on function public.set_possible_absence_settings(integer, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. dismissals
-- ---------------------------------------------------------------------------------------------
create table if not exists public.leave_absence_dismissals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null,
  start_date date not null,
  end_date date not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 2000),
  dismissed_by uuid default auth.uid() references auth.users(id) on delete set null,
  dismissed_at timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 366),
  foreign key (tenant_id, employee_number) references public.employees(tenant_id, "Employee Number")
    on update cascade on delete cascade
);
create index if not exists leave_absence_dismissals_tenant_employee
  on public.leave_absence_dismissals (tenant_id, employee_number, start_date, end_date);

alter table public.leave_absence_dismissals enable row level security;
drop policy if exists tenant_isolation on public.leave_absence_dismissals;
create policy tenant_isolation on public.leave_absence_dismissals as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- read: HR and the employee's supervisor (a review note, not the employee's record). Changes only through the function.
drop policy if exists involved_select on public.leave_absence_dismissals;
create policy involved_select on public.leave_absence_dismissals for select to authenticated
  using ((select public.manages_leave_discipline())
         or employee_number in (select public.supervised_employee_numbers()));
revoke all on public.leave_absence_dismissals from anon;
revoke insert, update, delete, truncate on public.leave_absence_dismissals from authenticated;

drop trigger if exists audit_leave_absence_dismissals on public.leave_absence_dismissals;
create trigger audit_leave_absence_dismissals after insert or update or delete on public.leave_absence_dismissals
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- 4. notices sent to employees
-- ---------------------------------------------------------------------------------------------
create table if not exists public.possible_absence_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_number text not null,
  start_date date not null,
  end_date date not null,
  notified_on date not null,
  reply_by date not null,
  notification_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  foreign key (tenant_id, employee_number) references public.employees(tenant_id, "Employee Number")
    on update cascade on delete cascade
);
create index if not exists possible_absence_notices_tenant_employee
  on public.possible_absence_notices (tenant_id, employee_number, start_date, end_date);

alter table public.possible_absence_notices enable row level security;
drop policy if exists tenant_isolation on public.possible_absence_notices;
create policy tenant_isolation on public.possible_absence_notices as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists involved_select on public.possible_absence_notices;
create policy involved_select on public.possible_absence_notices for select to authenticated
  using ((select public.manages_leave_discipline())
         or employee_number in (select public.supervised_employee_numbers())
         or employee_number = (select public.current_employee_number()));
revoke all on public.possible_absence_notices from anon;
revoke insert, update, delete, truncate on public.possible_absence_notices from authenticated;

drop trigger if exists audit_possible_absence_notices on public.possible_absence_notices;
create trigger audit_possible_absence_notices after insert or update or delete on public.possible_absence_notices
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- 5. the list
-- ---------------------------------------------------------------------------------------------
create or replace function public.possible_absences_for(p_tenant uuid, p_today date)
returns table (
  employee_number text, employee_name text, start_date date, end_date date, days integer, absent_days date[],
  pending_leave boolean, notified_on date, reply_by date
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_back integer := (select s.lookback_days from public.possible_absence_settings_for(p_tenant) s);
  v_to date := p_today - 1;
  v_from date := p_today - v_back;
begin
  if p_tenant is null or p_today is null then
    return;
  end if;
  return query
  with d as (
    select a.employee_number as emp, a.day, a.status
    from public.attendance_days_for(p_tenant, v_from, v_to, null, p_today) a
  ),
  marked as (
    select d.emp, d.day,
           case
             when d.status = 'absent'
                  and not exists (
                    select 1 from public.attendance_missed_scan_requests r
                    where r.tenant_id = p_tenant and r.employee_number = d.emp and r.work_date = d.day
                      and r.status in ('pending', 'approved'))
                  and not exists (
                    select 1 from public.attendance_scanner_punches x
                    where x.tenant_id = p_tenant and x.employee_number = d.emp
                      and (x.punched_at at time zone 'Africa/Nairobi')::date = d.day
                      and (x.skipped_reason in ('no_clock_in', 'break', 'overtime')
                           or (x.applied_at is null and x.skipped_reason is null)))
                  and not exists (
                    select 1 from public.leave_absences x
                    where x.tenant_id = p_tenant and x.employee_number = d.emp and d.day between x.start_date and x.end_date)
                  and not exists (
                    select 1 from public.leave_absence_dismissals x
                    where x.tenant_id = p_tenant and x.employee_number = d.emp and d.day between x.start_date and x.end_date)
               then 'absent'
             when d.status in ('off', 'holiday') then 'between'
             else 'break'
           end as kind
    from d
  ),
  grouped as (
    select m.*, sum(case when m.kind = 'break' then 1 else 0 end) over (partition by m.emp order by m.day) as grp
    from marked m
  ),
  entries as (
    select g.emp, min(g.day) as s, max(g.day) as e, count(*)::int as n, array_agg(g.day order by g.day) as ds
    from grouped g
    where g.kind = 'absent'
    group by g.emp, g.grp
  )
  select en.emp,
         coalesce(nullif(btrim(concat_ws(' ', emp."First Name", emp."Last Name")), ''), en.emp),
         en.s, en.e, en.n, en.ds,
         exists (
           select 1 from public.leave_application l
           where l.tenant_id = p_tenant and l."Employee Number" = en.emp
             and lower(btrim(coalesce(l.status, 'pending'))) not in ('approved', 'rejected', 'cancelled', 'declined')
             and public.leave_parse_date(l."Start Date") <= en.e and public.leave_parse_date(l."End Date") >= en.s),
         nt.notified_on, nt.reply_by
  from entries en
  left join public.employees emp on emp.tenant_id = p_tenant and emp."Employee Number" = en.emp
  left join lateral (
    select x.notified_on, x.reply_by from public.possible_absence_notices x
    where x.tenant_id = p_tenant and x.employee_number = en.emp and x.start_date <= en.e and x.end_date >= en.s
    order by x.notified_on desc limit 1) nt on true
  order by en.s, en.emp;
end $$;
revoke all on function public.possible_absences_for(uuid, date) from public, anon, authenticated;

-- what the signed-in user may see: HR everything, a supervisor their team; never their own
create or replace function public.possible_absences()
returns table (
  employee_number text, employee_name text, start_date date, end_date date, days integer, absent_days date[],
  pending_leave boolean, notified_on date, reply_by date
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
  v_hr boolean := public.manages_leave_discipline();
  v_me text := coalesce(public.current_employee_number(), '');
begin
  if v_tenant is null then
    raise exception 'Sign in to a company first' using errcode = '42501';
  end if;
  return query
  select p.* from public.possible_absences_for(v_tenant, public.nairobi_today()) p
  where p.employee_number <> v_me
    and (v_hr or p.employee_number in (select public.supervised_employee_numbers()))
  order by p.start_date desc, p.employee_name;
end $$;
revoke all on function public.possible_absences() from public, anon;
grant execute on function public.possible_absences() to authenticated;

/**
 * "Not an absence": HR or the employee's supervisor, with a reason, for days in the past. The days don't come back on
 * the list. Nothing is recorded and nobody is told.
 */
create or replace function public.dismiss_possible_absence(p_employee text, p_start date, p_end date, p_reason text)
returns public.leave_absence_dismissals
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_emp text := btrim(coalesce(p_employee, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  r public.leave_absence_dismissals;
begin
  if v_tenant is null or not (public.manages_leave_discipline() or public.supervises(v_emp)) then
    raise exception 'Only HR or the employee''s supervisor can dismiss a possible absence' using errcode = '42501';
  end if;
  if v_emp = coalesce(public.current_employee_number(), '') then
    raise exception 'You can''t dismiss your own absence' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.tenant_id = v_tenant and e."Employee Number" = v_emp) then
    raise exception 'No such employee' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'The last day can''t be before the first' using errcode = '22023';
  end if;
  if p_end >= public.nairobi_today() then
    raise exception 'Only past days can be dismissed' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'Dismiss at most a year at a time' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Say why this is not an absence' using errcode = '22023';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'Keep the reason to 2000 characters' using errcode = '22023';
  end if;
  insert into public.leave_absence_dismissals (tenant_id, employee_number, start_date, end_date, reason, dismissed_by)
  values (v_tenant, v_emp, p_start, p_end, v_reason, auth.uid())
  returning * into r;
  return r;
end $$;
revoke all on function public.dismiss_possible_absence(text, date, date, text) from public, anon;
grant execute on function public.dismiss_possible_absence(text, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. the morning job
-- ---------------------------------------------------------------------------------------------
-- the day a reply is due: p_n of the person's working days (their attendance schedule, less public holidays) after p_from
create or replace function public.possible_absence_reply_by(p_tenant uuid, p_employee text, p_from date, p_n integer)
returns date
language plpgsql stable security definer set search_path = public as $$
declare
  v_days smallint[] := (select s.work_days from public.work_schedule_for(p_tenant, p_employee) s);
  v_country text := public.employee_country(p_tenant, p_employee);
  d date := p_from;
  k integer := 0;
begin
  while k < greatest(coalesce(p_n, 0), 0) and d < p_from + 60 loop
    d := d + 1;
    if extract(isodow from d)::smallint = any (v_days) and not public.is_holiday(p_tenant, v_country, d) then
      k := k + 1;
    end if;
  end loop;
  return d;
end $$;
revoke all on function public.possible_absence_reply_by(uuid, text, date, integer) from public, anon, authenticated;

-- "Mon 3 Nov"
create or replace function public.possible_absence_day(p_day date) returns text language sql immutable as $$
  select to_char(p_day, 'Dy FMDD Mon')
$$;

-- "Mon 3 Nov", "Mon 3 Nov and Tue 4 Nov", "Mon 3 Nov, Tue 4 Nov and Wed 5 Nov"; more than 4: "Mon 3 Nov to Mon 10 Nov
-- (6 working days)"
create or replace function public.possible_absence_days_text(p_days date[]) returns text language sql immutable as $$
  select case
    when cardinality(p_days) = 1 then public.possible_absence_day(p_days[1])
    when cardinality(p_days) <= 4 then
      array_to_string((select array_agg(public.possible_absence_day(x) order by x) from unnest(p_days[1:cardinality(p_days) - 1]) x), ', ')
      || ' and ' || public.possible_absence_day(p_days[cardinality(p_days)])
    else public.possible_absence_day(p_days[1]) || ' to ' || public.possible_absence_day(p_days[cardinality(p_days)])
         || ' (' || cardinality(p_days) || ' working days)'
  end
$$;

/**
 * One company's morning: HR and each supervisor are told how many possible absences there are (once a day, only when
 * there are any); with the notice switched on, each person with a new possible absence since the day it was switched
 * on is told once (an entry that grows keeps its notice). How many notifications it made.
 */
create or replace function public.possible_absences_notify(p_tenant uuid, p_today date default public.nairobi_today())
returns integer
language plpgsql security definer set search_path = public as $$
declare
  s record;
  r record;
  g record;
  n integer := 0;
  v_total integer;
  v_notice uuid;
  v_new jsonb;
  v_days date[];
  v_reply date;
  v_id bigint;
  v_deduct boolean;
  e public.employees;
begin
  select * into s from public.possible_absence_settings_for(p_tenant);
  create temporary table if not exists pg_temp.possible_absences_today (
    employee_number text, employee_name text, start_date date, end_date date, days integer, absent_days date[],
    pending_leave boolean, notified_on date, reply_by date
  ) on commit drop;
  delete from pg_temp.possible_absences_today;
  insert into pg_temp.possible_absences_today select * from public.possible_absences_for(p_tenant, p_today);

  -- HR: the company's count
  select count(*) into v_total from pg_temp.possible_absences_today;
  if v_total > 0 and not exists (
      select 1 from public.hr_notifications h
      where h.tenant_id = p_tenant and h.notification_type = 'possible_absences' and h.end_date = p_today) then
    insert into public.hr_notifications (tenant_id, employee_number, employee_name, notification_type, title, message, end_date)
    values (p_tenant, '', null, 'possible_absences',
      v_total || case when v_total = 1 then ' possible absence' else ' possible absences' end || ' to review',
      'Attendance has ' || v_total || case when v_total = 1 then ' possible absence' else ' possible absences' end
      || ' (working days with no clock-in, no leave and no holiday) to review in Leave discipline. Record or dismiss each;'
      || ' nothing is recorded until you do.',
      p_today);
    n := n + 1;
  end if;

  -- each supervisor: their team's count
  for r in
    select sup."Employee Number" as sup_emp, sup."Work Email" as sup_email,
           nullif(btrim(concat_ws(' ', sup."First Name", sup."Last Name")), '') as sup_name, count(distinct (p.employee_number, p.start_date))::int as c
    from pg_temp.possible_absences_today p
    join public.employees w on w.tenant_id = p_tenant and w."Employee Number" = p.employee_number
    join public.employees sup on sup.tenant_id = p_tenant and sup."Employee Number" <> w."Employee Number"
      and (lower(btrim(sup."Work Email")) in (lower(btrim(w.manager_email)), lower(btrim(w.regional_manager)))
           or sup.id = w.reports_to_id)
    group by sup."Employee Number", sup."Work Email", sup."First Name", sup."Last Name"
  loop
    if not exists (
        select 1 from public.hr_notifications h
        where h.tenant_id = p_tenant and h.notification_type = 'possible_absences_team'
          and h.employee_number = r.sup_emp and h.end_date = p_today) then
      insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date)
      values (p_tenant, r.sup_emp, r.sup_name, r.sup_email, 'possible_absences_team',
        r.c || case when r.c = 1 then ' possible absence' else ' possible absences' end || ' in your team',
        'Attendance has ' || r.c || case when r.c = 1 then ' possible absence' else ' possible absences' end
        || ' in your team to review in Leave discipline: working days with no clock-in, no leave and no holiday.',
        p_today);
      n := n + 1;
    end if;
  end loop;

  -- each person: the notice, from the day it was switched on
  if not s.notify_employees or s.notify_from is null then
    return n;
  end if;
  v_deduct := coalesce((select c.deduct_unexcused_absence from public.company_payroll_settings c where c.tenant_id = p_tenant), true);
  for r in select distinct p.employee_number as emp from pg_temp.possible_absences_today p loop
    v_new := '[]'::jsonb;
    for g in
      select p.start_date, p.end_date,
             array(select x from unnest(p.absent_days) x where x >= s.notify_from order by x) as ds
      from pg_temp.possible_absences_today p
      where p.employee_number = r.emp and p.end_date >= s.notify_from
      order by p.start_date
    loop
      -- the days before the switch-on are the backlog: never noticed
      v_notice := null;
      select x.id into v_notice from public.possible_absence_notices x
      where x.tenant_id = p_tenant and x.employee_number = r.emp
        and x.start_date <= g.end_date and x.end_date >= g.ds[1]
      order by x.notified_on desc limit 1;
      if v_notice is not null then
        -- the same absence, grown: the notice's dates grow, no new message
        update public.possible_absence_notices
        set start_date = least(start_date, g.ds[1]), end_date = greatest(end_date, g.end_date), updated_at = now()
        where id = v_notice and (start_date > g.ds[1] or end_date < g.end_date);
      else
        v_new := v_new || jsonb_build_object('s', g.ds[1], 'e', g.end_date, 'ds', to_jsonb(g.ds));
      end if;
    end loop;

    -- at most one message per person per day
    if jsonb_array_length(v_new) = 0 or exists (
        select 1 from public.possible_absence_notices x
        where x.tenant_id = p_tenant and x.employee_number = r.emp and x.notified_on = p_today) then
      continue;
    end if;
    select * into e from public.employees where tenant_id = p_tenant and "Employee Number" = r.emp;
    select array_agg(d::date order by d::date) into v_days
    from jsonb_array_elements(v_new) j, jsonb_array_elements_text(j -> 'ds') d;
    v_reply := public.possible_absence_reply_by(p_tenant, r.emp, p_today, s.reply_working_days);

    insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date)
    values (p_tenant, r.emp, nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), e."Work Email", 'possible_absence',
      'No clock-in on ' || case when cardinality(v_days) = 1 then public.possible_absence_day(v_days[1]) else 'some working days' end,
      'We have no clock-in for you on ' || public.possible_absence_days_text(v_days) || ' and no approved leave.'
      || ' If you were at work or on leave, submit a missed-scan request or a leave application by '
      || to_char(v_reply, 'Dy FMDD Mon') || '. Otherwise it may be recorded as an unexcused absence, which '
      || case when v_deduct then 'is unpaid and ' else '' end || 'can lead to disciplinary action.',
      v_reply)
    returning id into v_id;

    insert into public.possible_absence_notices (tenant_id, employee_number, start_date, end_date, notified_on, reply_by, notification_id)
    select p_tenant, r.emp, (j ->> 's')::date, (j ->> 'e')::date, p_today, v_reply, v_id
    from jsonb_array_elements(v_new) j;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.possible_absences_notify(uuid, date) from public, anon, authenticated;

-- the daily job: every company
create or replace function public.notify_possible_absences_all() returns integer
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  n integer := 0;
begin
  for t in select x.id from public.tenants x loop
    begin
      n := n + public.possible_absences_notify(t, public.nairobi_today());
    exception when others then
      raise warning 'possible absences skipped for company %: %', t, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.notify_possible_absences_all() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('possible-absences-daily', '45 4 * * *', $c$select public.notify_possible_absences_all();$c$);
  else
    raise notice 'pg_cron is not available: possible absences are listed in Leave discipline, without the morning notifications.';
  end if;
end $$;

notify pgrst, 'reload schema';
