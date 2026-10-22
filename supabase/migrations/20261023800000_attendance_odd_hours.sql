-- Every scan of a day, and clock-ins at odd hours (FIG-1199).
--
-- A door scanner's first punch of a Nairobi day is the clock-in and its latest the clock-out (20261023600000), so a
-- punch at 12:01 am is the clock-in for that new day, while the day before keeps the clock-out it had. HR couldn't see
-- the punches behind a day, and nobody was told when someone clocked in in the middle of the night. Now:
--
--   attendance_settings.odd_hours_until     a clock-in at or after midnight and before this time is "odd hours"
--                                           (default 05:00; 00:00 = never; at most 12:00). HR (manages_attendance) and
--                                           Settings change it, like the rest of the row. A company with no settings row
--                                           yet can save it on its own: the row's tracking_from is then filled with the
--                                           day attendance already counted from (attendance_tracking_from).
--   attendance_logs.flag, flag_at           "Clocked in at 12:01 am, before 5:00 am" while the day's clock-in is in that
--                                           window, and when that was found. Worked out by one trigger whenever the
--                                           clock-in, the source or the day changes, so the app (attendance_punch), a
--                                           scanner (attendance_scanner_apply) and an earlier scanner punch moving the
--                                           clock-in all flag a day without each being changed. HR correcting a day
--                                           (source 'hr') clears it; the old portal-open rows ('legacy') are never
--                                           flagged. A later change to the setting applies to clock-ins from then on.
--   attendance_logs.flag_notified_at        when HR and admins were told. The first time a day is flagged, an HR alert
--                                           'attendance_odd_hours' is written to hr_notifications ("Odd-hours clock-in:
--                                           Amina Otieno (FBL-000006) clocked in at 12:01 am on Fri 23 Oct."): it shows
--                                           in the HR bell (the people who read HR notifications, admins included) and
--                                           is emailed, by the existing HR alert emails (queue_hr_alert_emails,
--                                           hr_alert_recipients), to admins and the roles with the Employees or HR
--                                           Lifecycle module: the people who manage attendance. Once per day: a later
--                                           scan doesn't tell them again. Nothing is sent for days before the company's
--                                           attendance_tracking_from. Days already recorded are flagged once, quietly.
--   attendance_days_for / attendance_days   20261023400000's / 20261023300000's, plus the day's flag and "counted" (two
--                                           new last columns, so both are dropped and created again with the same
--                                           grants; kpi_attendance_measure and attendance_today_for read them by column
--                                           name and keep working). And days before attendance_tracking_from now count
--                                           for nothing: no status at all (not off, holiday, leave, present, late or
--                                           absent), no minutes late and no flag, counted = false; the clock-in,
--                                           clock-out, hours and source still show. Before, such a day was only kept
--                                           from being 'absent', so a scanner's first, part-day scans came out late
--                                           and the KPI measures counted them; they count only present, late and
--                                           absent, so those days now drop out.
--   attendance_day_scans(employee, day)     everything behind one person's day, in time order: each scanner punch (the
--                                           scanner's name; clock-in, clock-out, in between, held back or not applied
--                                           yet, with the reason: 'clock_ahead', 'hr_corrected'), and the record's own
--                                           clock-in and clock-out when no scanner punch explains them: from the app
--                                           ('app') or HR's correction ('hr'). An app clock-in that a scanner punch moved
--                                           earlier isn't kept anywhere, so it can't be shown. Same access as
--                                           attendance_days: HR everyone, a manager their reports, staff themselves.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the setting
-- ---------------------------------------------------------------------------------------------
alter table public.attendance_settings add column if not exists odd_hours_until time not null default '05:00';
alter table public.attendance_settings drop constraint if exists attendance_settings_odd_hours_check;
alter table public.attendance_settings add constraint attendance_settings_odd_hours_check
  check (odd_hours_until between '00:00'::time and '12:00'::time);

-- (20261023400000's, plus: a new row without tracking_from counts from the day attendance already counted from)
create or replace function public.attendance_settings_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
  elsif new.tracking_from is null then
    new.tracking_from := public.attendance_tracking_from(new.tenant_id);
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.attendance_settings_rules() from public, anon, authenticated;

-- the company's odd-hours limit (05:00 when it has no settings row)
create or replace function public.attendance_odd_hours_until(p_tenant uuid) returns time
language sql stable security definer set search_path = public as $$
  select coalesce((select s.odd_hours_until from public.attendance_settings s where s.tenant_id = p_tenant), '05:00'::time)
$$;
revoke all on function public.attendance_odd_hours_until(uuid) from public, anon, authenticated;

-- "00:01" -> "12:01 am", "13:05" -> "1:05 pm": the app's clock times (clockLabel in src/lib/attendance.ts)
create or replace function public.attendance_clock_label(p time) returns text
language sql immutable as $$
  select format('%s:%s %s',
    case when extract(hour from p)::int % 12 = 0 then 12 else extract(hour from p)::int % 12 end,
    lpad(extract(minute from p)::int::text, 2, '0'),
    case when extract(hour from p) < 12 then 'am' else 'pm' end)
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. the flag on the day
-- ---------------------------------------------------------------------------------------------
-- what a day's clock-in says, or null: in [00:00, the company's limit) on the day itself, for app and scanner days
create or replace function public.attendance_odd_hours_flag(p_tenant uuid, p_source text, p_day date, p_in timestamptz)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_until time;
  v_local timestamp := p_in at time zone 'Africa/Nairobi';
begin
  if p_in is null or p_day is null or p_source in ('hr', 'legacy') or v_local::date <> p_day then
    return null;
  end if;
  v_until := public.attendance_odd_hours_until(p_tenant);
  if v_local::time >= v_until then
    return null;
  end if;
  return format('Clocked in at %s, before %s',
    public.attendance_clock_label(date_trunc('minute', v_local)::time), public.attendance_clock_label(v_until));
end $$;
revoke all on function public.attendance_odd_hours_flag(uuid, text, date, timestamptz) from public, anon, authenticated;

-- the columns; the first time only, the days already recorded are flagged without telling anyone (they are history)
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'attendance_logs' and column_name = 'flag') then
    alter table public.attendance_logs add column flag text;
    alter table public.attendance_logs add column flag_at timestamptz;
    alter table public.attendance_logs add column flag_notified_at timestamptz;
    update public.attendance_logs a
    set flag = public.attendance_odd_hours_flag(a.tenant_id, a.source, a.work_date, a.login_time),
        flag_at = now(),
        flag_notified_at = now()
    where a.source in ('app', 'scanner')
      and public.attendance_odd_hours_flag(a.tenant_id, a.source, a.work_date, a.login_time) is not null;
  end if;
end $$;

-- Worked out again only when the clock-in, the source or the day changes (a clock-out leaves it as it is). Named to run
-- after attendance_logs_fill_day, which fills the day.
create or replace function public.attendance_logs_odd_hours() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_flag text;
begin
  if tg_op = 'UPDATE' and new.login_time is not distinct from old.login_time and new.source is not distinct from old.source
     and new.work_date is not distinct from old.work_date then
    return new;
  end if;
  v_flag := public.attendance_odd_hours_flag(new.tenant_id, new.source, new.work_date, new.login_time);
  if tg_op = 'INSERT' then
    new.flag_at := case when v_flag is not null then now() end;
  elsif v_flag is distinct from old.flag then
    new.flag_at := case when v_flag is not null then now() end;
  else
    new.flag_at := old.flag_at;
  end if;
  new.flag := v_flag;
  return new;
end $$;
revoke all on function public.attendance_logs_odd_hours() from public, anon, authenticated;
drop trigger if exists attendance_logs_odd_hours on public.attendance_logs;
create trigger attendance_logs_odd_hours before insert or update on public.attendance_logs
  for each row execute function public.attendance_logs_odd_hours();

-- ---------------------------------------------------------------------------------------------
-- 3. telling HR and admins, once per day
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
  'attendance_odd_hours'
));

-- (20261021700000's list, plus attendance_odd_hours: for HR, never shown or emailed to the employee it is about;
-- hr_alert_modules sends it to the employees and hr-lifecycle modules, its default for HR-facing types, and admins)
create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested', 'contract_signed', 'leave_exhausted', 'casual_limit', 'leave_document_overdue',
                    'contribution_requested', 'onboarding_followups_overdue', 'attendance_odd_hours')
$$;

create or replace function public.attendance_logs_odd_hours_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
  who text;
begin
  -- days before attendance counts: nobody is told
  if new.work_date < coalesce(public.attendance_tracking_from(new.tenant_id), new.work_date) then
    return null;
  end if;
  select * into e from public.employees x
  where x.tenant_id = new.tenant_id and x."Employee Number" = new.employee_number
  limit 1;
  who := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), new.employee_number);
  insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date)
  values (new.tenant_id, new.employee_number, who, e."Work Email", 'attendance_odd_hours', 'Odd-hours clock-in',
    format('Odd-hours clock-in: %s (%s) clocked in at %s on %s.', who, new.employee_number,
      public.attendance_clock_label(date_trunc('minute', new.login_time at time zone 'Africa/Nairobi')::time),
      to_char(new.work_date, 'Dy FMDD Mon')),
    new.work_date);
  update public.attendance_logs set flag_notified_at = now() where id = new.id;
  return null;
end $$;
revoke all on function public.attendance_logs_odd_hours_notify() from public, anon, authenticated;
drop trigger if exists attendance_logs_odd_hours_notify on public.attendance_logs;
create trigger attendance_logs_odd_hours_notify after insert or update on public.attendance_logs
  for each row when (new.flag is not null and new.flag_notified_at is null)
  execute function public.attendance_logs_odd_hours_notify();

-- ---------------------------------------------------------------------------------------------
-- 4. the days, with their flag
-- ---------------------------------------------------------------------------------------------
-- (20261023400000's, plus the flag and "counted": a day before attendance_tracking_from counts for nothing)
drop function if exists public.attendance_days_for(uuid, date, date, text, date);
create function public.attendance_days_for(
  p_tenant uuid, p_from date, p_to date, p_employee text default null, p_today date default null
) returns table (
  employee_number text, day date, status text, clock_in timestamptz, clock_out timestamptz, hours numeric,
  late_minutes integer, source text, note text, flag text, counted boolean
)
language sql stable security definer set search_path = public as $$
  with people as (
    select e."Employee Number" as emp,
           public.employee_start_date(e."Start Date") as hired,
           public.employee_start_date(e."Termination Date") as left_on,
           public.employee_country(p_tenant, e."Employee Number") as country,
           s.work_days, s.start_time, s.grace_minutes
    from public.employees e
    cross join lateral public.work_schedule_for(p_tenant, e."Employee Number") s
    where e.tenant_id = p_tenant
      and (p_employee is null or e."Employee Number" = p_employee)
      and coalesce(e.worker_kind, 'employee') <> 'casual'
      -- still here, or left during (or after) the range
      and (lower(coalesce(e."Status", 'active')) not in ('terminated', 'inactive')
           or public.employee_start_date(e."Termination Date") >= p_from)
  ),
  days as (
    select g::date as day from generate_series(p_from, p_to, interval '1 day') g
  ),
  counting as (
    select public.attendance_tracking_from(p_tenant) as from_day
  ),
  grid as (
    select p.*, d.day,
           (extract(isodow from d.day)::smallint = any (p.work_days)) as working,
           public.is_holiday(p_tenant, p.country, d.day) as holiday,
           exists (
             select 1 from public.leave_application l
             where l.tenant_id = p_tenant and l."Employee Number" = p.emp
               and lower(coalesce(l.status, '')) = 'approved'
               and public.leave_parse_date(l."Start Date") <= d.day
               and public.leave_parse_date(l."End Date") >= d.day
           ) as on_leave,
           a.login_time, a.logout_time, a.source, a.note, a.flag,
           date_trunc('minute', a.login_time at time zone 'Africa/Nairobi') as in_local
    from people p
    cross join days d
    left join public.attendance_logs a
      on a.tenant_id = p_tenant and a.employee_number = p.emp and a.work_date = d.day and a.source <> 'legacy'
    where (p.hired is null or d.day >= p.hired)
      and (p.left_on is null or d.day <= p.left_on)
  )
  select g.emp,
         g.day,
         case
           -- before attendance counts: nothing (not off, holiday, leave, present, late or absent)
           when not g.counted then null
           when not g.working then 'off'
           when g.holiday then 'holiday'
           when g.on_leave then 'leave'
           when g.login_time is not null then
             case when g.in_local > g.day + g.start_time + make_interval(mins => g.grace_minutes) then 'late' else 'present' end
           when g.day < coalesce(p_today, (now() at time zone 'Africa/Nairobi')::date) then 'absent'
           else null
         end,
         g.login_time,
         g.logout_time,
         case when g.login_time is not null and g.logout_time is not null
              then round((extract(epoch from (g.logout_time - g.login_time)) / 3600.0)::numeric, 2) end,
         case
           when g.login_time is null or not g.counted then null
           when g.working and not g.holiday and not g.on_leave
                and g.in_local > g.day + g.start_time + make_interval(mins => g.grace_minutes)
             then (extract(epoch from (g.in_local - (g.day + g.start_time))) / 60)::integer
           else 0
         end,
         g.source,
         g.note,
         case when g.counted then g.flag end,
         g.counted
  from (select x.*, (c.from_day is null or x.day >= c.from_day) as counted from grid x cross join counting c) g
  order by g.emp, g.day
$$;
revoke all on function public.attendance_days_for(uuid, date, date, text, date) from public, anon, authenticated;

-- (20261023300000's, plus the flag and counted)
drop function if exists public.attendance_days(date, date, text);
create function public.attendance_days(p_from date, p_to date, p_employee text default null)
returns table (
  employee_number text, day date, status text, clock_in timestamptz, clock_out timestamptz, hours numeric,
  late_minutes integer, source text, note text, flag text, counted boolean
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
  v_all boolean := true;
  v_me text;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a start date on or before the end date' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Choose a range of a year or less' using errcode = '22023';
  end if;
  if auth.uid() is not null then
    if v_tenant is null then
      raise exception 'Sign in first' using errcode = '42501';
    end if;
    v_all := public.sees_attendance();
    if not v_all then
      v_me := public.current_employee_number();
      if p_employee is not null and p_employee is distinct from v_me
         and p_employee not in (select public.supervised_employee_numbers()) then
        raise exception 'You can see your own attendance and your team''s only' using errcode = '42501';
      end if;
    end if;
  end if;
  return query
    select d.employee_number, d.day, d.status, d.clock_in, d.clock_out, d.hours, d.late_minutes, d.source, d.note, d.flag, d.counted
    from public.attendance_days_for(v_tenant, p_from, p_to, p_employee, null) d
    where v_all
       or d.employee_number = v_me
       or d.employee_number in (select public.supervised_employee_numbers());
end $$;
revoke all on function public.attendance_days(date, date, text) from public, anon;
grant execute on function public.attendance_days(date, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. every scan behind one day
-- ---------------------------------------------------------------------------------------------
-- One person's day (a Nairobi day), in time order. via: 'scanner' (scanner_name says which), 'app' or 'hr' (the
-- record's own clock-in or clock-out, when no applied scanner punch is at that moment). kind: 'clock_in', 'clock_out',
-- 'between' (a scan that is neither), 'held' (kept but not counted; reason 'clock_ahead' or 'hr_corrected') or
-- 'waiting' (matched, not applied yet).
create or replace function public.attendance_day_scans(p_employee text, p_date date)
returns table (punched_at timestamptz, via text, scanner_name text, kind text, reason text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
  v_start timestamptz;
  r public.attendance_logs;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_employee is null or p_date is null then
    raise exception 'Choose a person and a day' using errcode = '22023';
  end if;
  if not public.sees_attendance() and p_employee is distinct from public.current_employee_number()
     and p_employee not in (select public.supervised_employee_numbers()) then
    raise exception 'You can see your own attendance and your team''s only' using errcode = '42501';
  end if;
  v_start := p_date::timestamp at time zone 'Africa/Nairobi';
  select * into r from public.attendance_logs a
  where a.tenant_id = v_tenant and a.employee_number = p_employee and a.work_date = p_date and a.source <> 'legacy';

  return query
  with punches as (
    select x.punched_at as t, d.name, x.applied_at, x.skipped_reason
    from public.attendance_scanner_punches x
    join public.attendance_devices d on d.id = x.device_id
    where x.tenant_id = v_tenant and x.employee_number = p_employee
      and x.punched_at >= v_start and x.punched_at < v_start + interval '1 day'
  ),
  entries as (
    select p.t, 'scanner'::text as via, p.name as scanner_name,
           case
             when p.skipped_reason is not null then 'held'
             when p.applied_at is null then 'waiting'
             when p.t = r.login_time then 'clock_in'
             when p.t = r.logout_time then 'clock_out'
             else 'between'
           end as kind,
           p.skipped_reason as reason,
           0 as pos
    from punches p
    union all
    select r.login_time, r.source, null, 'clock_in', null, 1
    where r.login_time is not null
      and not exists (select 1 from punches p where p.applied_at is not null and p.skipped_reason is null and p.t = r.login_time)
    union all
    select r.logout_time, r.source, null, 'clock_out', null, 1
    where r.logout_time is not null
      and not exists (select 1 from punches p where p.applied_at is not null and p.skipped_reason is null and p.t = r.logout_time)
  )
  select e.t, e.via, e.scanner_name, e.kind, e.reason
  from entries e
  order by e.t, e.pos, e.scanner_name;
end $$;
revoke all on function public.attendance_day_scans(text, date) from public, anon;
grant execute on function public.attendance_day_scans(text, date) to authenticated, service_role;

notify pgrst, 'reload schema';
