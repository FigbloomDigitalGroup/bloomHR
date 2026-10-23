-- Missed-scan requests: "I forgot to scan", approved by the manager or HR (FIG-1201).
--
-- On 22 Oct Given came in at 7:59 and Joe at 8:43, but neither scanned on arrival: their first scans (10:54, 11:04) made
-- them hours late and HR corrected each day by hand. Correcting the clock-in mid-day also froze the day (a scanner punch
-- on a day HR corrected was skipped as 'hr_corrected'), so their evening scans never became their clock-outs. Now:
--
--   attendance_settings.missed_scan_days_back   how far back a request may go: today and up to this many days before
--                                               (default 7; 0 = today only; at most 31).
--   attendance_settings.missed_scan_approver    'manager' (the default: the person's manager, else HR) or 'hr' (HR only).
--   attendance_missed_scan_requests             one request: the day, when the person came in and/or left, the reason
--                                               (required), who it went to (approver 'manager' with manager_number, or
--                                               'hr'), its status (pending, approved, declined, cancelled) and the
--                                               decision (who, when, the comment; required to decline). One pending
--                                               request per person per day. Read by the person, their managers and the
--                                               people who see attendance; written only through the functions below.
--   attendance_missed_scan_request(...)         the signed-in employee asks. Rules: a day from today back to the setting,
--                                               a time that has happened, on that day, the time they left after the time
--                                               they came in (or after the day's clock-in when only leaving is given),
--                                               a reason. The approver is told: their manager in the staff portal bell
--                                               (and by email, as the employee notifications are: 'missed_scan_request'),
--                                               or HR as an HR alert ('missed_scan_requested': the HR bell and the HR
--                                               alert emails to the people with Employees / HR Lifecycle, and admins).
--   attendance_missed_scan_cancel(id)           the person cancels their own pending request.
--   attendance_missed_scan_decide(id, ...)      'approve' or 'decline' (with a comment). The manager it went to, or HR
--                                               (manages_attendance) for any request; nobody decides their own. Approving
--                                               applies it as HR would: source 'hr', note "Missed scan: <reason>
--                                               (approved by <name>)". The person is told ('missed_scan_approved' /
--                                               'missed_scan_declined').
--   attendance_missed_scans(...)                the requests the signed-in person may see, with can_decide.
--   attendance_missed_scan_rules()              the portal form: days back, and who the request goes to.
--
-- The freeze fix: attendance_logs.hr_fixed_in / hr_fixed_out say which of a corrected day's times HR (or an approved
-- request) set. A scanner punch on an 'hr' day still moves what wasn't fixed: an earlier punch the clock-in, a later
-- punch the clock-out. HR's attendance_set_day sets hr_fixed_in, and hr_fixed_out only when it gives a clock-out: left
-- empty, the clock-out is the latest scanner punch after the clock-in (now and as more arrive), not "still at work".
-- The days HR corrected before this migration keep both times fixed (as before). An app Clock out after the scanner's
-- latest scan moves an hr day's clock-out too, unless HR fixed it. attendance_days_for says a clock-out came from the
-- scanner on such a day, so the portal shows a scan before the end of the day as "Last scan".
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the settings
-- ---------------------------------------------------------------------------------------------
alter table public.attendance_settings add column if not exists missed_scan_days_back integer not null default 7;
alter table public.attendance_settings add column if not exists missed_scan_approver text not null default 'manager';
alter table public.attendance_settings drop constraint if exists attendance_settings_missed_scan_days_check;
alter table public.attendance_settings add constraint attendance_settings_missed_scan_days_check
  check (missed_scan_days_back between 0 and 31);
alter table public.attendance_settings drop constraint if exists attendance_settings_missed_scan_approver_check;
alter table public.attendance_settings add constraint attendance_settings_missed_scan_approver_check
  check (missed_scan_approver in ('manager', 'hr'));

-- ---------------------------------------------------------------------------------------------
-- 2. which times of a corrected day are fixed
-- ---------------------------------------------------------------------------------------------
-- the first time only: the days HR corrected so far keep both times fixed, as they were
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'attendance_logs' and column_name = 'hr_fixed_out') then
    alter table public.attendance_logs add column hr_fixed_in boolean not null default false;
    alter table public.attendance_logs add column hr_fixed_out boolean not null default false;
    update public.attendance_logs set hr_fixed_in = true, hr_fixed_out = true where source = 'hr';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. a scanner punch on a corrected day moves what HR didn't fix
-- ---------------------------------------------------------------------------------------------
-- (20261023600000's, plus: on an 'hr' day an earlier punch moves the clock-in unless it is fixed, a later one the
-- clock-out unless it is fixed; otherwise skipped as 'hr_corrected' as before)
create or replace function public.attendance_scanner_apply(p_punch uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  p public.attendance_scanner_punches;
  r public.attendance_logs;
  v_day date;
  v_start timestamptz;
  v_in timestamptz;
  v_last timestamptz;
  v_out timestamptz;
begin
  select * into p from public.attendance_scanner_punches x where x.id = p_punch for update;
  if p.id is null or p.employee_number is null or p.applied_at is not null then
    return false;
  end if;
  v_day := (p.punched_at at time zone 'Africa/Nairobi')::date;
  v_start := v_day::timestamp at time zone 'Africa/Nairobi';

  -- the first punch of the day: the clock-in
  insert into public.attendance_logs (tenant_id, employee_number, work_date, login_time, status, source)
  values (p.tenant_id, p.employee_number, v_day, p.punched_at, 'clocked_in', 'scanner')
  on conflict (tenant_id, employee_number, work_date) where source <> 'legacy' do nothing
  returning * into r;
  if r.id is not null then
    update public.attendance_scanner_punches set applied_at = now(), skipped_reason = null where id = p.id;
    return true;
  end if;

  select * into r from public.attendance_logs a
  where a.tenant_id = p.tenant_id and a.employee_number = p.employee_number and a.work_date = v_day and a.source <> 'legacy'
  for update;
  if r.source = 'hr' then
    if r.login_time is null
       or (r.hr_fixed_in and r.hr_fixed_out)
       or (p.punched_at < r.login_time and r.hr_fixed_in)
       or (p.punched_at > r.login_time and r.hr_fixed_out) then
      update public.attendance_scanner_punches set skipped_reason = 'hr_corrected' where id = p.id;
      return false;
    end if;
    -- what HR left open: an earlier clock-in, or a later clock-out
    v_in := least(r.login_time, p.punched_at);
    v_out := case
               when r.hr_fixed_out then r.logout_time
               when p.punched_at > r.login_time then greatest(coalesce(r.logout_time, p.punched_at), p.punched_at)
               else r.logout_time
             end;
    update public.attendance_logs
    set login_time = v_in, logout_time = v_out,
        status = case when v_out is null then 'clocked_in' else 'clocked_out' end
    where id = r.id;
    update public.attendance_scanner_punches set applied_at = now(), skipped_reason = null where id = p.id;
    return true;
  end if;

  v_in := least(coalesce(r.login_time, p.punched_at), p.punched_at);
  -- the clock-out: the latest of this employee's scanner punches that day after the clock-in
  select max(x.punched_at) into v_last
  from public.attendance_scanner_punches x
  where x.tenant_id = p.tenant_id and x.employee_number = p.employee_number
    and x.punched_at >= v_start and x.punched_at < v_start + interval '1 day'
    and (x.applied_at is not null or x.id = p.id)
    and x.punched_at > v_in;
  v_out := case when v_last is null then r.logout_time else greatest(coalesce(r.logout_time, v_last), v_last) end;
  update public.attendance_logs
  set login_time = v_in, logout_time = v_out, work_date = v_day,
      status = case when v_out is null then 'clocked_in' else 'clocked_out' end
  where id = r.id;
  update public.attendance_scanner_punches set applied_at = now(), skipped_reason = null where id = p.id;
  return true;
end $$;
revoke all on function public.attendance_scanner_apply(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. writing a corrected day (HR's correction and an approved request)
-- ---------------------------------------------------------------------------------------------
-- The record becomes 'hr' with this clock-in (fixed). p_out_fixed: p_out is the clock-out, fixed. Otherwise the
-- clock-out stays open: the latest of p_out (when after the clock-in) and the day's scanner punches after the
-- clock-in (or none yet), and later punches keep moving it. No access check: the callers check.
create or replace function public.attendance_write_day(
  p_tenant uuid, p_employee text, p_date date, p_in timestamptz, p_out timestamptz, p_out_fixed boolean, p_note text, p_by uuid
) returns public.attendance_logs
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := p_date::timestamp at time zone 'Africa/Nairobi';
  v_out timestamptz := p_out;
  v_scan timestamptz;
  r public.attendance_logs;
begin
  if not p_out_fixed then
    -- punches held back only because HR had corrected the day count again
    update public.attendance_scanner_punches x
    set applied_at = coalesce(x.applied_at, now()), skipped_reason = null
    where x.tenant_id = p_tenant and x.employee_number = p_employee and x.skipped_reason = 'hr_corrected'
      and x.punched_at > p_in and x.punched_at >= v_start and x.punched_at < v_start + interval '1 day';
    select max(x.punched_at) into v_scan
    from public.attendance_scanner_punches x
    where x.tenant_id = p_tenant and x.employee_number = p_employee
      and x.applied_at is not null and x.skipped_reason is null
      and x.punched_at > p_in and x.punched_at >= v_start and x.punched_at < v_start + interval '1 day';
    v_out := greatest(case when p_out > p_in then p_out end, v_scan);
  end if;

  select * into r from public.attendance_logs a
  where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = p_date and a.source <> 'legacy'
  for update;
  if r.id is null then
    insert into public.attendance_logs (tenant_id, employee_number, work_date, login_time, logout_time, status, source, note,
                                        edited_by, edited_at, hr_fixed_in, hr_fixed_out)
    values (p_tenant, p_employee, p_date, p_in, v_out, case when v_out is null then 'clocked_in' else 'clocked_out' end,
            'hr', p_note, p_by, now(), true, p_out_fixed)
    returning * into r;
  else
    update public.attendance_logs
    set login_time = p_in, logout_time = v_out, work_date = p_date,
        status = case when v_out is null then 'clocked_in' else 'clocked_out' end,
        source = 'hr', note = p_note, edited_by = p_by, edited_at = now(),
        hr_fixed_in = true, hr_fixed_out = p_out_fixed
    where id = r.id
    returning * into r;
  end if;
  return r;
end $$;
revoke all on function public.attendance_write_day(uuid, text, date, timestamptz, timestamptz, boolean, text, uuid) from public, anon, authenticated;

-- (20261023300000's checks; the clock-out left empty now means "take it from the scanner")
create or replace function public.attendance_set_day(
  p_employee text, p_date date, p_in timestamptz, p_out timestamptz, p_note text
) returns public.attendance_logs
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.manages_attendance() then
    raise exception 'Only HR can correct attendance' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.tenant_id = v_tenant and e."Employee Number" = p_employee) then
    raise exception 'Unknown employee' using errcode = '23503';
  end if;
  if p_date is null or p_in is null then
    raise exception 'Enter the clock-in time (to clear the day, remove it instead)' using errcode = '22023';
  end if;
  if v_note is null then
    raise exception 'Add a note saying why the day is being corrected' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the note to 500 characters' using errcode = '22023';
  end if;
  if (p_in at time zone 'Africa/Nairobi')::date <> p_date then
    raise exception 'The clock-in time must be on %', to_char(p_date, 'DD Mon YYYY') using errcode = '22023';
  end if;
  if p_out is not null and p_out <= p_in then
    raise exception 'The clock-out time must be after the clock-in time' using errcode = '22023';
  end if;
  if p_in > now() or p_out > now() then
    raise exception 'A time that hasn''t happened yet can''t be recorded' using errcode = '22023';
  end if;
  return public.attendance_write_day(v_tenant, p_employee, p_date, p_in, p_out, p_out is not null, v_note, auth.uid());
end $$;
revoke all on function public.attendance_set_day(text, date, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.attendance_set_day(text, date, timestamptz, timestamptz, text) to authenticated;

-- (20261025000000's, plus: the scanner-later Clock out also moves an hr day's clock-out that HR didn't fix)
create or replace function public.attendance_app_punch(
  p_tenant uuid, p_employee text, p_kind text, p_location jsonb, p_ip text, p_at timestamptz,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := public.attendance_clock_check(p_tenant, p_employee, p_kind, p_location, p_ip, p_at);
  v_day date := (p_at at time zone 'Africa/Nairobi')::date;
  v_loc jsonb := public.attendance_location(p_location);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  r public.attendance_logs;
begin
  if not coalesce((v ->> 'ok')::boolean, false) then
    raise exception '%', v ->> 'message' using errcode = 'P0001', hint = 'clock_policy';
  end if;

  if p_kind = 'out' then
    -- the person presses Clock out after the scanner's latest scan: their clock-out, at the later time
    select * into r from public.attendance_logs a
    where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source <> 'legacy'
    for update;
    if r.id is not null and (r.source <> 'hr' or not r.hr_fixed_out) and r.logout_time is not null and p_at > r.logout_time
       and exists (select 1 from public.attendance_scanner_punches x
                   where x.tenant_id = p_tenant and x.employee_number = p_employee and x.punched_at = r.logout_time
                     and x.applied_at is not null and x.skipped_reason is null) then
      update public.attendance_logs
      set logout_time = p_at, status = 'clocked_out',
          geolocation = case when v_loc is not null then coalesce(geolocation, '{}'::jsonb) || jsonb_build_object('out', v_loc) else geolocation end,
          web_reason = coalesce(web_reason, v_reason)
      where id = r.id;
      return public.attendance_today_for(p_tenant, p_employee, p_at);
    end if;
  end if;

  perform public.attendance_punch(p_tenant, p_employee, p_kind, p_location, p_at);
  if p_kind = 'in' then
    -- only when this punch made the clock-in (not a clock-in again after clocking out, or a scanner's day)
    update public.attendance_logs a
    set place = v ->> 'place', place_detail = v ->> 'detail', web_reason = v_reason
    where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source = 'app'
      and a.login_time = p_at;
  elsif p_kind = 'out' and v_reason is not null then
    -- clock-out via web when clock-in was via scanner: store the reason on the day's record
    update public.attendance_logs a
    set web_reason = coalesce(a.web_reason, v_reason)
    where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source <> 'legacy';
  end if;
  return public.attendance_today_for(p_tenant, p_employee, p_at);
end $$;
revoke all on function public.attendance_app_punch(uuid, text, text, jsonb, text, timestamptz, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. the days: an hr day's clock-out from the scanner says so
-- ---------------------------------------------------------------------------------------------
-- (20261024100000's; out_via is 'hr' only when HR fixed the clock-out. Same columns, so replaced in place.)
create or replace function public.attendance_days_for(
  p_tenant uuid, p_from date, p_to date, p_employee text default null, p_today date default null
) returns table (
  employee_number text, day date, status text, clock_in timestamptz, clock_out timestamptz, hours numeric,
  late_minutes integer, source text, note text, flag text, counted boolean,
  end_time time, clock_out_via text, place text, place_detail text, place_location jsonb
)
language sql stable security definer set search_path = public as $$
  with people as (
    select e."Employee Number" as emp,
           public.employee_start_date(e."Start Date") as hired,
           public.employee_start_date(e."Termination Date") as left_on,
           public.employee_country(p_tenant, e."Employee Number") as country,
           s.work_days, s.start_time, s.end_time, s.grace_minutes
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
           a.place as a_place, a.place_detail as a_place_detail, a.geolocation -> 'in' as a_location,
           case
             when a.logout_time is null then null
             when a.source = 'hr' and a.hr_fixed_out then 'hr'
             when exists (
               select 1 from public.attendance_scanner_punches x
               where x.tenant_id = p_tenant and x.employee_number = p.emp and x.punched_at = a.logout_time
                 and x.applied_at is not null and x.skipped_reason is null) then 'scanner'
             when a.source = 'hr' then 'hr'
             else 'app'
           end as out_via,
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
             -- minutes after the late mark (start + grace): 8:39 with an 8:00 start and 30 minutes' grace is 9
             then (extract(epoch from (g.in_local - (g.day + g.start_time + make_interval(mins => g.grace_minutes)))) / 60)::integer
           else 0
         end,
         g.source,
         g.note,
         case when g.counted then g.flag end,
         g.counted,
         g.end_time,
         g.out_via,
         case when g.source = 'app' then g.a_place end,
         case when g.source = 'app' then g.a_place_detail end,
         case when g.source = 'app' then g.a_location end
  from (select x.*, (c.from_day is null or x.day >= c.from_day) as counted from grid x cross join counting c) g
  order by g.emp, g.day
$$;
revoke all on function public.attendance_days_for(uuid, date, date, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. the requests
-- ---------------------------------------------------------------------------------------------
create table if not exists public.attendance_missed_scan_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_number text not null,
  work_date date not null,
  came_in_at timestamptz,
  left_at timestamptz,
  reason text not null,
  status text not null default 'pending',
  approver text not null default 'hr',
  manager_number text,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_comment text
);
alter table public.attendance_missed_scan_requests drop constraint if exists attendance_missed_scan_requests_status_check;
alter table public.attendance_missed_scan_requests add constraint attendance_missed_scan_requests_status_check
  check (status in ('pending', 'approved', 'declined', 'cancelled'));
alter table public.attendance_missed_scan_requests drop constraint if exists attendance_missed_scan_requests_approver_check;
alter table public.attendance_missed_scan_requests add constraint attendance_missed_scan_requests_approver_check
  check (approver in ('manager', 'hr') and (approver = 'hr' or manager_number is not null));
alter table public.attendance_missed_scan_requests drop constraint if exists attendance_missed_scan_requests_times_check;
alter table public.attendance_missed_scan_requests add constraint attendance_missed_scan_requests_times_check
  check ((came_in_at is not null or left_at is not null) and (came_in_at is null or left_at is null or left_at > came_in_at));
alter table public.attendance_missed_scan_requests drop constraint if exists attendance_missed_scan_requests_reason_check;
alter table public.attendance_missed_scan_requests add constraint attendance_missed_scan_requests_reason_check
  check (length(btrim(reason)) between 1 and 300);
alter table public.attendance_missed_scan_requests drop constraint if exists attendance_missed_scan_requests_comment_check;
alter table public.attendance_missed_scan_requests add constraint attendance_missed_scan_requests_comment_check
  check (decision_comment is null or length(decision_comment) <= 300);
-- one open request per person per day
create unique index if not exists attendance_missed_scan_requests_one_open
  on public.attendance_missed_scan_requests (tenant_id, employee_number, work_date) where status = 'pending';
create index if not exists attendance_missed_scan_requests_day_idx
  on public.attendance_missed_scan_requests (tenant_id, work_date);

alter table public.attendance_missed_scan_requests enable row level security;
drop policy if exists tenant_isolation on public.attendance_missed_scan_requests;
create policy tenant_isolation on public.attendance_missed_scan_requests as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists own_read on public.attendance_missed_scan_requests;
create policy own_read on public.attendance_missed_scan_requests for select to authenticated
  using (employee_number = (select public.current_employee_number()));
drop policy if exists team_read on public.attendance_missed_scan_requests;
create policy team_read on public.attendance_missed_scan_requests for select to authenticated
  using (employee_number in (select public.supervised_employee_numbers()));
drop policy if exists hr_read on public.attendance_missed_scan_requests;
create policy hr_read on public.attendance_missed_scan_requests for select to authenticated
  using ((select public.sees_attendance()));
revoke all on public.attendance_missed_scan_requests from anon;
revoke insert, update, delete, truncate on public.attendance_missed_scan_requests from authenticated;
grant select on public.attendance_missed_scan_requests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. small helpers
-- ---------------------------------------------------------------------------------------------
-- "Amina Otieno", or the employee number when there is no name
create or replace function public.attendance_person_name(p_tenant uuid, p_employee text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), '') from public.employees e
     where e.tenant_id = p_tenant and e."Employee Number" = p_employee limit 1),
    p_employee)
$$;
revoke all on function public.attendance_person_name(uuid, text) from public, anon, authenticated;

-- the signed-in person's name: their employee record's, else their profile's, else their email
create or replace function public.attendance_actor_name(p_tenant uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), '') from public.employees e
     where e.tenant_id = p_tenant and e."Employee Number" = public.current_employee_number() limit 1),
    (select nullif(btrim(p.full_name), '') from public.user_profiles p where p.user_id = auth.uid() limit 1),
    (select u.email from auth.users u where u.id = auth.uid()),
    'HR')
$$;
revoke all on function public.attendance_actor_name(uuid) from public, anon, authenticated;

-- the employee number of a person's manager (Reports to, else the manager email), still working here; null if none
create or replace function public.attendance_manager_of(p_tenant uuid, p_employee text) returns text
language sql stable security definer set search_path = public as $$
  select m."Employee Number"
  from public.employees r
  join public.employees m on m.tenant_id = r.tenant_id
   and (m.id = r.reports_to_id
        or (coalesce(btrim(r.manager_email), '') <> '' and lower(btrim(m."Work Email")) = lower(btrim(r.manager_email))))
  where r.tenant_id = p_tenant and r."Employee Number" = p_employee
    and m."Employee Number" is distinct from p_employee
    and coalesce(btrim(m."Employee Number"), '') <> ''
    and lower(coalesce(m."Status", 'active')) not in ('terminated', 'inactive')
  order by (m.id = r.reports_to_id) desc, m."Employee Number"
  limit 1
$$;
revoke all on function public.attendance_manager_of(uuid, text) from public, anon, authenticated;

-- "came in 7:59 am, left 5:10 pm"
create or replace function public.attendance_missed_scan_times(p_in timestamptz, p_out timestamptz) returns text
language sql stable as $$
  select concat_ws(', ',
    case when p_in is not null
         then 'came in ' || public.attendance_clock_label(date_trunc('minute', p_in at time zone 'Africa/Nairobi')::time) end,
    case when p_out is not null
         then 'left ' || public.attendance_clock_label(date_trunc('minute', p_out at time zone 'Africa/Nairobi')::time) end)
$$;

-- the company's rules: how many days back, and who approves
create or replace function public.attendance_missed_scan_settings(p_tenant uuid)
returns table (days_back integer, approver text)
language sql stable security definer set search_path = public as $$
  select coalesce((select s.missed_scan_days_back from public.attendance_settings s where s.tenant_id = p_tenant), 7),
         coalesce((select s.missed_scan_approver from public.attendance_settings s where s.tenant_id = p_tenant), 'manager')
$$;
revoke all on function public.attendance_missed_scan_settings(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. notifications
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
  'missed_scan_requested', 'missed_scan_request', 'missed_scan_approved', 'missed_scan_declined'
));

-- (20261023800000's list, plus missed_scan_requested: a request for HR, never shown to the employee who asked;
-- hr_alert_modules sends it to the employees and hr-lifecycle modules, the people who manage attendance, and admins)
create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested', 'contract_signed', 'leave_exhausted', 'casual_limit', 'leave_document_overdue',
                    'contribution_requested', 'onboarding_followups_overdue', 'attendance_odd_hours', 'missed_scan_requested')
$$;

-- (20261023000000's list, plus the missed-scan request waiting for a decision and its decision)
create or replace function public.important_notification(p_type text) returns boolean language sql immutable as $$
  select public.always_emailed(p_type) or p_type in (
    -- the employee's own
    'leave_approved', 'leave_rejected', 'leave_reopened', 'document_rejected', 'document_requested', 'onboarding_changes_requested',
    'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
    'loan_disbursed', 'salary_paid', 'expense_approved', 'expense_rejected', 'reactivated', 'employment_update',
    'policy_to_accept', 'task_assigned', 'approval_needed', 'exit_approved', 'exit_declined', 'contract_sent',
    'contract_sent_back', 'missed_scan_request', 'missed_scan_approved', 'missed_scan_declined',
    -- for HR: a decision is waiting
    'leave_recommended', 'exit_requested', 'loan_requested', 'contract_signed', 'contract_expiring', 'probation_expiring',
    'missed_scan_requested')
$$;

-- ---------------------------------------------------------------------------------------------
-- 9. asking
-- ---------------------------------------------------------------------------------------------
-- p_now: when the request is made (now(); tests give another moment)
create or replace function public.attendance_missed_scan_request_for(
  p_tenant uuid, p_employee text, p_date date, p_in timestamptz, p_out timestamptz, p_reason text, p_now timestamptz
) returns public.attendance_missed_scan_requests
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_today date := (p_now at time zone 'Africa/Nairobi')::date;
  s record;
  d public.attendance_logs;
  v_mgr text;
  v_who text;
  v_msg text;
  q public.attendance_missed_scan_requests;
begin
  select * into s from public.attendance_missed_scan_settings(p_tenant);
  if p_date is null then
    raise exception 'Choose the day' using errcode = '22023';
  end if;
  if p_date > v_today then
    raise exception 'Choose today or a day before' using errcode = '22023';
  end if;
  if p_date < v_today - s.days_back then
    raise exception '%', case when s.days_back = 0 then 'A missed scan can be asked for today only'
                              else format('A missed scan can be asked for up to %s %s back', s.days_back,
                                          case when s.days_back = 1 then 'day' else 'days' end) end
      using errcode = '22023';
  end if;
  if p_in is null and p_out is null then
    raise exception 'Enter the time you came in or the time you left' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Say why the scan was missed' using errcode = '22023';
  end if;
  if length(v_reason) > 300 then
    raise exception 'Keep the reason to 300 characters' using errcode = '22023';
  end if;
  if (p_in is not null and (p_in at time zone 'Africa/Nairobi')::date <> p_date)
     or (p_out is not null and (p_out at time zone 'Africa/Nairobi')::date <> p_date) then
    raise exception 'The times must be on %', to_char(p_date, 'DD Mon YYYY') using errcode = '22023';
  end if;
  if p_in > p_now or p_out > p_now then
    raise exception 'A time that hasn''t happened yet can''t be asked for' using errcode = '22023';
  end if;
  if p_in is not null and p_out is not null and p_out <= p_in then
    raise exception 'The time you left must be after the time you came in' using errcode = '22023';
  end if;
  if p_in is null then
    -- leaving only: the day needs a clock-in before it
    select * into d from public.attendance_logs a
    where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = p_date and a.source <> 'legacy';
    if d.login_time is null then
      raise exception 'There''s no clock-in that day: enter the time you came in too' using errcode = '22023';
    end if;
    if p_out <= d.login_time then
      raise exception 'The time you left must be after your clock-in at %',
        public.attendance_clock_label(date_trunc('minute', d.login_time at time zone 'Africa/Nairobi')::time) using errcode = '22023';
    end if;
  end if;
  if exists (select 1 from public.attendance_missed_scan_requests x
             where x.tenant_id = p_tenant and x.employee_number = p_employee and x.work_date = p_date and x.status = 'pending') then
    raise exception 'You already have a request waiting for that day: cancel it to send a new one' using errcode = '23505';
  end if;

  if s.approver = 'manager' then
    v_mgr := public.attendance_manager_of(p_tenant, p_employee);
  end if;
  insert into public.attendance_missed_scan_requests
    (tenant_id, employee_number, work_date, came_in_at, left_at, reason, status, approver, manager_number, requested_by)
  values (p_tenant, p_employee, p_date, p_in, p_out, v_reason, 'pending',
          case when v_mgr is not null then 'manager' else 'hr' end, v_mgr, auth.uid())
  returning * into q;

  v_who := public.attendance_person_name(p_tenant, p_employee);
  v_msg := format('%s (%s) missed a scan on %s: %s. Reason: %s', v_who, p_employee, to_char(p_date, 'Dy FMDD Mon'),
                  public.attendance_missed_scan_times(p_in, p_out), v_reason);
  if v_mgr is not null then
    perform public.notify_employee_number(p_tenant, v_mgr, 'missed_scan_request', 'Missed scan to approve', v_msg);
  else
    insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date)
    select p_tenant, p_employee, v_who, e."Work Email", 'missed_scan_requested', 'Missed scan to approve', v_msg, p_date
    from (select 1) one
    left join public.employees e on e.tenant_id = p_tenant and e."Employee Number" = p_employee;
  end if;
  return q;
end $$;
revoke all on function public.attendance_missed_scan_request_for(uuid, text, date, timestamptz, timestamptz, text, timestamptz)
  from public, anon, authenticated;

-- the signed-in employee asks
create or replace function public.attendance_missed_scan_request(
  p_date date, p_in timestamptz, p_out timestamptz, p_reason text
) returns public.attendance_missed_scan_requests
language plpgsql security definer set search_path = public as $$
declare
  me record;
begin
  select * into me from public.attendance_me();
  return public.attendance_missed_scan_request_for(me.tenant_id, me.employee_number, p_date, p_in, p_out, p_reason, now());
end $$;
revoke all on function public.attendance_missed_scan_request(date, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.attendance_missed_scan_request(date, timestamptz, timestamptz, text) to authenticated;

-- the person cancels their own request while it waits
create or replace function public.attendance_missed_scan_cancel(p_id uuid) returns public.attendance_missed_scan_requests
language plpgsql security definer set search_path = public as $$
declare
  me record;
  q public.attendance_missed_scan_requests;
begin
  select * into me from public.attendance_me();
  select * into q from public.attendance_missed_scan_requests x
  where x.id = p_id and x.tenant_id = me.tenant_id and x.employee_number = me.employee_number
  for update;
  if q.id is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if q.status <> 'pending' then
    raise exception 'This request was already %', q.status using errcode = '22023';
  end if;
  update public.attendance_missed_scan_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
  where id = q.id
  returning * into q;
  return q;
end $$;
revoke all on function public.attendance_missed_scan_cancel(uuid) from public, anon;
grant execute on function public.attendance_missed_scan_cancel(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10. deciding
-- ---------------------------------------------------------------------------------------------
-- may the signed-in person decide this request? HR any; the manager it went to; never the person who asked
create or replace function public.attendance_missed_scan_can_decide(q public.attendance_missed_scan_requests) returns boolean
language sql stable security definer set search_path = public as $$
  select q.status = 'pending'
     and auth.uid() is not null
     and q.tenant_id = public.current_tenant_id()
     and q.employee_number is distinct from public.current_employee_number()
     and (public.manages_attendance()
          or (q.approver = 'manager' and q.employee_number in (select public.supervised_employee_numbers())))
$$;
revoke all on function public.attendance_missed_scan_can_decide(public.attendance_missed_scan_requests) from public, anon, authenticated;

create or replace function public.attendance_missed_scan_decide(p_id uuid, p_decision text, p_comment text default null)
returns public.attendance_missed_scan_requests
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_name text;
  v_in timestamptz;
  v_out timestamptz;
  v_fixed boolean;
  q public.attendance_missed_scan_requests;
  r public.attendance_logs;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'decline') then
    raise exception 'Approve or decline' using errcode = '22023';
  end if;
  select * into q from public.attendance_missed_scan_requests x where x.id = p_id and x.tenant_id = v_tenant for update;
  if q.id is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if q.status <> 'pending' then
    raise exception 'This request was already %', q.status using errcode = '22023';
  end if;
  if q.employee_number = public.current_employee_number() then
    raise exception 'You can''t decide your own request' using errcode = '42501';
  end if;
  if not public.attendance_missed_scan_can_decide(q) then
    raise exception 'Only their manager or HR can decide this request' using errcode = '42501';
  end if;
  if p_decision = 'decline' and v_comment is null then
    raise exception 'Add a comment saying why it is declined' using errcode = '22023';
  end if;
  if length(v_comment) > 300 then
    raise exception 'Keep the comment to 300 characters' using errcode = '22023';
  end if;
  v_name := public.attendance_actor_name(v_tenant);

  if p_decision = 'approve' then
    select * into r from public.attendance_logs a
    where a.tenant_id = v_tenant and a.employee_number = q.employee_number and a.work_date = q.work_date and a.source <> 'legacy'
    for update;
    v_in := coalesce(q.came_in_at, r.login_time);
    -- the time they left when given (fixed); else a clock-out HR fixed stays fixed; else the day's clock-out so far
    -- stays open: later scans still move it
    v_out := coalesce(q.left_at, r.logout_time);
    v_fixed := q.left_at is not null or coalesce(r.source = 'hr' and r.hr_fixed_out, false);
    if v_in is null then
      raise exception 'There''s no clock-in that day any more: ask them for the time they came in' using errcode = '22023';
    end if;
    if v_fixed and v_out is not null and v_out <= v_in then
      raise exception 'The time they left (%) isn''t after the clock-in (%)',
        public.attendance_clock_label(date_trunc('minute', v_out at time zone 'Africa/Nairobi')::time),
        public.attendance_clock_label(date_trunc('minute', v_in at time zone 'Africa/Nairobi')::time) using errcode = '22023';
    end if;
    perform public.attendance_write_day(v_tenant, q.employee_number, q.work_date, v_in, v_out, v_fixed,
      left(format('Missed scan: %s (approved by %s)', q.reason, v_name), 500), auth.uid());
    -- the clock-in the request didn't change stays open to the scanner, as it was
    if q.came_in_at is null and r.id is not null and not (r.source = 'hr' and r.hr_fixed_in) then
      update public.attendance_logs a set hr_fixed_in = false
      where a.tenant_id = v_tenant and a.employee_number = q.employee_number and a.work_date = q.work_date and a.source = 'hr';
    end if;
  end if;

  update public.attendance_missed_scan_requests
  set status = case when p_decision = 'approve' then 'approved' else 'declined' end,
      decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(), decision_comment = v_comment
  where id = q.id
  returning * into q;

  if p_decision = 'approve' then
    perform public.notify_employee_number(v_tenant, q.employee_number, 'missed_scan_approved', 'Missed scan approved',
      format('Your missed scan on %s was approved by %s: %s.', to_char(q.work_date, 'Dy FMDD Mon'), v_name,
             public.attendance_missed_scan_times(q.came_in_at, q.left_at)) || public.with_note('Comment', v_comment));
  else
    perform public.notify_employee_number(v_tenant, q.employee_number, 'missed_scan_declined', 'Missed scan declined',
      format('Your missed scan on %s (%s) was declined by %s.', to_char(q.work_date, 'Dy FMDD Mon'),
             public.attendance_missed_scan_times(q.came_in_at, q.left_at), v_name) || public.with_note('Comment', v_comment));
  end if;
  return q;
end $$;
revoke all on function public.attendance_missed_scan_decide(uuid, text, text) from public, anon;
grant execute on function public.attendance_missed_scan_decide(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 11. reading
-- ---------------------------------------------------------------------------------------------
-- The requests the signed-in person may see (HR and Reports everyone's, a manager their reports', everyone their own),
-- newest first; filtered by status, person and day range when given. can_decide: they may approve or decline it now.
create or replace function public.attendance_missed_scans(
  p_status text default null, p_employee text default null, p_from date default null, p_to date default null
) returns table (
  id uuid, employee_number text, employee_name text, work_date date, came_in_at timestamptz, left_at timestamptz,
  reason text, status text, approver text, manager_number text, manager_name text, created_at timestamptz,
  decided_at timestamptz, decided_by_name text, decision_comment text, can_decide boolean, mine boolean
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
  v_all boolean;
  v_me text;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  v_all := public.sees_attendance();
  v_me := public.current_employee_number();
  return query
    select q.id, q.employee_number, public.attendance_person_name(v_tenant, q.employee_number), q.work_date, q.came_in_at,
           q.left_at, q.reason, q.status, q.approver, q.manager_number,
           case when q.manager_number is not null then public.attendance_person_name(v_tenant, q.manager_number) end,
           q.created_at, q.decided_at, q.decided_by_name, q.decision_comment,
           public.attendance_missed_scan_can_decide(q), q.employee_number is not distinct from v_me
    from public.attendance_missed_scan_requests q
    where q.tenant_id = v_tenant
      and (v_all or q.employee_number is not distinct from v_me or q.employee_number in (select public.supervised_employee_numbers()))
      and (p_status is null or q.status = p_status)
      and (p_employee is null or q.employee_number = p_employee)
      and (p_from is null or q.work_date >= p_from)
      and (p_to is null or q.work_date <= p_to)
    order by q.created_at desc
    limit 500;
end $$;
revoke all on function public.attendance_missed_scans(text, text, date, date) from public, anon;
grant execute on function public.attendance_missed_scans(text, text, date, date) to authenticated;

-- For the portal's form: how far back, and who the request goes to ({days_back, approver: 'manager'|'hr', approver_name}).
create or replace function public.attendance_missed_scan_rules() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me record;
  s record;
  v_mgr text;
begin
  select * into me from public.attendance_me();
  select * into s from public.attendance_missed_scan_settings(me.tenant_id);
  if s.approver = 'manager' then
    v_mgr := public.attendance_manager_of(me.tenant_id, me.employee_number);
  end if;
  return jsonb_build_object(
    'days_back', s.days_back,
    'approver', case when v_mgr is not null then 'manager' else 'hr' end,
    'approver_name', case when v_mgr is not null then public.attendance_person_name(me.tenant_id, v_mgr) else 'HR' end);
end $$;
revoke all on function public.attendance_missed_scan_rules() from public, anon;
grant execute on function public.attendance_missed_scan_rules() to authenticated;

notify pgrst, 'reload schema';
