-- KPIs calculated from attendance (FIG-986, second half).
--
-- 20261023200000 let a KPI be calculated from tasks; clock in / clock out (20261023300000, 20261023400000) now says
-- which days each employee was present, late or absent. Four more measures read it, through attendance_days_for over
-- the review period up to today:
--
--   attendance_rate   % of counted working days the employee clocked in (present or late) out of the days they were
--                     expected (present, late or absent: days off, holidays, leave and days before attendance counted
--                     are left out). Percent, higher is better.
--   punctuality       % of the days they clocked in that were on time (present, not late). Percent, higher is better.
--   absent_days       working days with no clock-in, no leave and no holiday. Number, lower is better.
--   avg_hours         average hours between clock in and clock out, over the days with both. Number (hours), higher
--                     is better.
--
-- kpi_measure_value(...) picks tasks or attendance for a measure; kpi_refresh_measures is 20261023200000's, calling it.
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the measures
-- ---------------------------------------------------------------------------------------------
alter table public.kpis drop constraint if exists kpis_measure_check;
alter table public.kpis add constraint kpis_measure_check
  check (measure in ('manual', 'tasks_on_time', 'tasks_completed', 'tasks_late', 'task_days',
                     'attendance_rate', 'punctuality', 'absent_days', 'avg_hours'));

-- (20261023200000's, plus the attendance measures)
create or replace function public.kpis_measure_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  case new.measure
    when 'tasks_on_time' then new.unit := 'percent'; new.direction := 'higher_is_better';
    when 'tasks_completed' then new.unit := 'number'; new.direction := 'higher_is_better';
    when 'tasks_late' then new.unit := 'number'; new.direction := 'lower_is_better';
    when 'task_days' then new.unit := 'number'; new.direction := 'lower_is_better';
    when 'attendance_rate' then new.unit := 'percent'; new.direction := 'higher_is_better';
    when 'punctuality' then new.unit := 'percent'; new.direction := 'higher_is_better';
    when 'absent_days' then new.unit := 'number'; new.direction := 'lower_is_better';
    when 'avg_hours' then new.unit := 'number'; new.direction := 'higher_is_better';
    else null;
  end case;
  return new;
end $$;
revoke all on function public.kpis_measure_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. working out an attendance measure
-- ---------------------------------------------------------------------------------------------
-- One employee's value for an attendance measure over a period, as of p_today: the value (null when there is nothing to
-- measure yet) and what it came from.
create or replace function public.kpi_attendance_measure(
  p_tenant uuid, p_employee text, p_measure text, p_from date, p_to date, p_today date
) returns table (value numeric, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_expected integer;
  v_present integer;
  v_on_time integer;
  v_absent integer;
  v_days integer;
  v_hours numeric;
begin
  if p_from > least(p_to, p_today) then
    return query select null::numeric, jsonb_build_object('expected', 0);
    return;
  end if;
  select count(*) filter (where d.status in ('present', 'late', 'absent'))::integer,
         count(*) filter (where d.status in ('present', 'late'))::integer,
         count(*) filter (where d.status = 'present')::integer,
         count(*) filter (where d.status = 'absent')::integer,
         count(*) filter (where d.hours is not null)::integer,
         avg(d.hours) filter (where d.hours is not null)
    into v_expected, v_present, v_on_time, v_absent, v_days, v_hours
  from public.attendance_days_for(p_tenant, p_from, least(p_to, p_today), p_employee, p_today) d;

  if p_measure = 'attendance_rate' then
    return query select case when v_expected > 0 then round(100.0 * v_present / v_expected, 1) end,
                        jsonb_build_object('present', v_present, 'expected', v_expected);
  elsif p_measure = 'punctuality' then
    return query select case when v_present > 0 then round(100.0 * v_on_time / v_present, 1) end,
                        jsonb_build_object('on_time', v_on_time, 'present', v_present);
  elsif p_measure = 'absent_days' then
    return query select case when v_expected > 0 then v_absent::numeric end,
                        jsonb_build_object('absent', v_absent, 'expected', v_expected);
  elsif p_measure = 'avg_hours' then
    return query select round(v_hours, 1), jsonb_build_object('days', v_days);
  else
    return query select null::numeric, null::jsonb;
  end if;
end $$;
revoke all on function public.kpi_attendance_measure(uuid, text, text, date, date, date) from public, anon, authenticated;

-- a measure's value, from tasks or from attendance
create or replace function public.kpi_measure_value(
  p_tenant uuid, p_employee text, p_measure text, p_from date, p_to date, p_today date
) returns table (value numeric, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_measure in ('attendance_rate', 'punctuality', 'absent_days', 'avg_hours') then
    return query select * from public.kpi_attendance_measure(p_tenant, p_employee, p_measure, p_from, p_to, p_today);
  else
    return query select * from public.kpi_task_measure(p_tenant, p_employee, p_measure, p_from, p_to, p_today);
  end if;
end $$;
revoke all on function public.kpi_measure_value(uuid, text, text, date, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. recalculating (20261023200000's, through kpi_measure_value)
-- ---------------------------------------------------------------------------------------------
create or replace function public.kpi_refresh_measures(p_period uuid default null, p_today date default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_today date := coalesce(p_today, (now() at time zone 'Africa/Nairobi')::date);
  v_n integer := 0;
  r record;
  m record;
begin
  if auth.uid() is not null then
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
      raise exception 'Sign in first' using errcode = '42501';
    end if;
    if not public.manages_kpis() and not exists (select 1 from public.supervised_employee_numbers()) then
      raise exception 'Only HR or a manager can recalculate KPIs' using errcode = '42501';
    end if;
    if p_period is not null and not exists (select 1 from public.kpi_periods where id = p_period and tenant_id = v_tenant) then
      raise exception 'Unknown review period' using errcode = '23503';
    end if;
    -- (another "today" is for the system and tests only)
    v_today := (now() at time zone 'Africa/Nairobi')::date;
  end if;

  perform set_config('app.kpi_measure', 'on', true);
  for r in
    select a.id, a.tenant_id, a.employee_number, a.auto_value, a.auto_detail, k.measure, p.starts_on, p.ends_on
    from public.kpi_assignments a
    join public.kpis k on k.id = a.kpi_id
    join public.kpi_periods p on p.id = a.period_id
    where p.status = 'open'
      and (p_period is null or p.id = p_period)
      and (v_tenant is null or a.tenant_id = v_tenant)
      and (k.measure <> 'manual' or a.auto_value is not null or a.auto_detail is not null)
  loop
    select * into m from public.kpi_measure_value(r.tenant_id, r.employee_number, r.measure, r.starts_on, r.ends_on, v_today);
    if m.value is distinct from r.auto_value or m.detail is distinct from r.auto_detail then
      update public.kpi_assignments
      set auto_value = m.value, auto_detail = m.detail, auto_at = case when m.detail is null then null else now() end
      where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  perform set_config('app.kpi_measure', 'off', true);
  return v_n;
end $$;
revoke all on function public.kpi_refresh_measures(uuid, date) from public, anon;
grant execute on function public.kpi_refresh_measures(uuid, date) to authenticated, service_role;

notify pgrst, 'reload schema';
