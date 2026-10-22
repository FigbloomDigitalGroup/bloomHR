-- Minutes late count from the late mark (FIG-986 follow-up).
--
-- Someone is late when they clock in after their schedule's start plus its grace minutes (the late mark: 8:30 for an
-- 8:00 start with 30 minutes' grace). Until now their minutes late were counted from the start time, so 8:39 showed
-- as 39 minutes late. Figbloom's decision (Oct 22): count from the late mark, so 8:39 is 9 minutes late and 8:30 is
-- on time. A schedule without grace is unchanged (the late mark is the start time).
--
-- attendance_days_for is 20261023800000's with only that changed (same columns, so create or replace). Everything
-- that shows minutes late reads them from here: the Attendance page, the staff portal's clock card
-- (attendance_today_for), the CSV export. Written to run again safely.

create or replace function public.attendance_days_for(
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
             -- minutes after the late mark (start + grace): 8:39 with an 8:00 start and 30 minutes' grace is 9
             then (extract(epoch from (g.in_local - (g.day + g.start_time + make_interval(mins => g.grace_minutes)))) / 60)::integer
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

notify pgrst, 'reload schema';
