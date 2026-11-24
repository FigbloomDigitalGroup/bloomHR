-- Attendance says "Half day", not "On leave", on a day of approved half-day leave.
--
-- On 24 Nov Hassan was on an approved half day, came in at 11:13 and scanned until 1:54 pm, but the Today view called
-- him "On leave" as if he was not there. A half day is still leave (the status stays 'leave', so the counts here, the
-- KPI measures, possible absences and My HR in Fleet, Property and Schools are unchanged); the days now also say
-- whether that leave is a half day, and HR's Attendance shows it as "Half day".
--
--   attendance_days_for / attendance_days   gain half_day: true when the day's approved leave is half-day leave only
--                                           (leave_application.type 'Half Day'); a full day of leave the same day wins.
--   attendance_today_for                    adds half_day for the portal card.
--
-- 20261025100000's attendance_days_for and 20261024100000's attendance_days and attendance_today_for, otherwise
-- unchanged. A new column, so the two table functions are dropped and created again.

drop function if exists public.attendance_days(date, date, text);
drop function if exists public.attendance_days_for(uuid, date, date, text, date);

create function public.attendance_days_for(
  p_tenant uuid, p_from date, p_to date, p_employee text default null, p_today date default null
) returns table (
  employee_number text, day date, status text, clock_in timestamptz, clock_out timestamptz, hours numeric,
  late_minutes integer, source text, note text, flag text, counted boolean,
  end_time time, clock_out_via text, place text, place_detail text, place_location jsonb, half_day boolean
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
           lv.on_leave,
           lv.on_leave and not lv.full_day as half_day,
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
    cross join lateral (
      select count(*) > 0 as on_leave,
             coalesce(bool_or(lower(btrim(coalesce(l.type, ''))) <> 'half day'), false) as full_day
      from public.leave_application l
      where l.tenant_id = p_tenant and l."Employee Number" = p.emp
        and lower(coalesce(l.status, '')) = 'approved'
        and public.leave_parse_date(l."Start Date") <= d.day
        and public.leave_parse_date(l."End Date") >= d.day
    ) lv
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
         case when g.source = 'app' then g.a_location end,
         g.counted and g.working and not g.holiday and g.half_day
  from (select x.*, (c.from_day is null or x.day >= c.from_day) as counted from grid x cross join counting c) g
  order by g.emp, g.day
$$;
revoke all on function public.attendance_days_for(uuid, date, date, text, date) from public, anon, authenticated;

create function public.attendance_days(p_from date, p_to date, p_employee text default null)
returns table (
  employee_number text, day date, status text, clock_in timestamptz, clock_out timestamptz, hours numeric,
  late_minutes integer, source text, note text, flag text, counted boolean,
  end_time time, clock_out_via text, place text, place_detail text, place_location jsonb, half_day boolean
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
    select d.employee_number, d.day, d.status, d.clock_in, d.clock_out, d.hours, d.late_minutes, d.source, d.note, d.flag, d.counted,
           d.end_time, d.clock_out_via, d.place, d.place_detail, d.place_location, d.half_day
    from public.attendance_days_for(v_tenant, p_from, p_to, p_employee, null) d
    where v_all
       or d.employee_number = v_me
       or d.employee_number in (select public.supervised_employee_numbers());
end $$;
revoke all on function public.attendance_days(date, date, text) from public, anon;
grant execute on function public.attendance_days(date, date, text) to authenticated, service_role;

create or replace function public.attendance_today_for(p_tenant uuid, p_employee text, p_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := (p_at at time zone 'Africa/Nairobi')::date;
  s record;
  d record;
  r public.attendance_logs;
begin
  select * into s from public.work_schedule_for(p_tenant, p_employee);
  select * into d from public.attendance_days_for(p_tenant, v_day, v_day, p_employee, v_day);
  select * into r from public.attendance_logs a
  where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source <> 'legacy';
  return jsonb_build_object(
    'date', v_day,
    'employee_number', p_employee,
    'status', d.status,
    'half_day', coalesce(d.half_day, false),
    'clock_in', r.login_time,
    'clock_out', r.logout_time,
    'clock_out_via', d.clock_out_via,
    'late_minutes', d.late_minutes,
    'source', r.source,
    'place', d.place,
    'place_detail', d.place_detail,
    'note', r.note,
    'working_day', extract(isodow from v_day)::smallint = any (s.work_days),
    'work_days', to_jsonb(s.work_days),
    'start_time', to_char(s.start_time, 'HH24:MI'),
    'end_time', to_char(s.end_time, 'HH24:MI'),
    'grace_minutes', s.grace_minutes,
    'late_after', to_char(s.start_time + make_interval(mins => s.grace_minutes), 'HH24:MI'));
end $$;
revoke all on function public.attendance_today_for(uuid, text, timestamptz) from public, anon, authenticated;

notify pgrst, 'reload schema';
