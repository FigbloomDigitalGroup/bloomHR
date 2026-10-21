-- KPIs calculated from tasks (FIG-985).
--
-- Until now every KPI's actual was typed in: the employee's self-assessment and their manager's (or HR's) final score
-- (20261016900000). The Task Manager (20261019200000) already knows who was given what, when it was due and when it
-- was done, so a KPI can now be measured from it:
--
--   kpis.measure                 how the KPI is measured:
--                                  manual            entered by hand, as before (the default)
--                                  tasks_on_time     % of the employee's tasks due in the period that were done by their
--                                                    due date (percent, higher is better)
--                                  tasks_completed   tasks the employee finished in the period (number, higher is better)
--                                  tasks_late        tasks due in the period not done by their due date: done late or
--                                                    still open (number, lower is better)
--                                  task_days         median days from a task being created to it being done, for the
--                                                    tasks finished in the period (number, lower is better)
--                                a calculated measure fixes the KPI's unit and direction (kpis_measure_rules).
--   kpi_assignments.auto_value   the value worked out for this employee and period, auto_detail what it was worked out
--                  auto_detail   from (e.g. {"on_time": 8, "due": 10}) and auto_at when it last changed. Only
--                  auto_at       kpi_refresh_measures() writes them.
--
-- Which tasks count: those assigned to the employee (sub-tasks of a task given to a group count for the person they
-- are for; the group task itself does not), not cancelled. "Due in the period": a due date from the period's start to
-- its end, and either already done or due before today (a task due today isn't late until tomorrow). Days are
-- Africa/Nairobi days, like the rest of the app.
--
-- Scoring: the manager's (or HR's) final score, when there is one, is the actual; otherwise the calculated value is
-- (src/lib/kpis.ts). So a manager can still correct a calculated number by entering a final score.
--
-- kpi_refresh_measures(period): recalculates the KPIs of open periods (one period, or all of the signed-in person's
-- company's; all companies' when run by the system). Runs every hour, and from the Scorecards screen's "Recalculate".
-- Closed periods keep the values they had when they closed; a KPI switched back to manual loses its calculated value.
--
-- Written to run again safely (if not exists / or replace / drop ... if exists).

-- ---------------------------------------------------------------------------------------------
-- 1. columns
-- ---------------------------------------------------------------------------------------------
alter table public.kpis add column if not exists measure text not null default 'manual';
alter table public.kpis drop constraint if exists kpis_measure_check;
alter table public.kpis add constraint kpis_measure_check
  check (measure in ('manual', 'tasks_on_time', 'tasks_completed', 'tasks_late', 'task_days'));

alter table public.kpi_assignments add column if not exists auto_value numeric(16, 2);
alter table public.kpi_assignments add column if not exists auto_detail jsonb;
alter table public.kpi_assignments add column if not exists auto_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- 2. a calculated measure decides the KPI's unit and direction
-- ---------------------------------------------------------------------------------------------
create or replace function public.kpis_measure_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  case new.measure
    when 'tasks_on_time' then new.unit := 'percent'; new.direction := 'higher_is_better';
    when 'tasks_completed' then new.unit := 'number'; new.direction := 'higher_is_better';
    when 'tasks_late' then new.unit := 'number'; new.direction := 'lower_is_better';
    when 'task_days' then new.unit := 'number'; new.direction := 'lower_is_better';
    else null;
  end case;
  return new;
end $$;
revoke all on function public.kpis_measure_rules() from public, anon, authenticated;
drop trigger if exists kpis_measure_rules on public.kpis;
create trigger kpis_measure_rules before insert or update on public.kpis
  for each row execute function public.kpis_measure_rules();

-- ---------------------------------------------------------------------------------------------
-- 3. calculated values are the system's
-- ---------------------------------------------------------------------------------------------
-- (20261019300000's rules, plus: auto_value, auto_detail and auto_at change only through kpi_refresh_measures)
create or replace function public.kpi_assignments_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_default numeric;
begin
  -- a check-in copying its value here (kpi_checkins_apply), or a calculated value (kpi_refresh_measures)
  if current_setting('app.kpi_checkin', true) = 'on' or current_setting('app.kpi_measure', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    select p.status into v_status from public.kpi_periods p where p.id = old.period_id;
    if auth.uid() is not null and v_status = 'closed' and pg_trigger_depth() <= 1 then
      raise exception 'This review period is closed; reopen it to change its KPIs' using errcode = '42501';
    end if;
    return old;
  end if;

  -- an employee renumbered: the foreign key moves their KPIs along and nothing else changes
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'employee_number') = (to_jsonb(old) - 'employee_number') then
    return new;
  end if;
  -- a template removed: the foreign key clears template_id (also in a closed period) and nothing else changes
  if tg_op = 'UPDATE' and new.template_id is null and old.template_id is not null
     and (to_jsonb(new) - 'template_id') = (to_jsonb(old) - 'template_id') then
    return new;
  end if;

  select p.status into v_status from public.kpi_periods p where p.id = new.period_id;
  if auth.uid() is not null and v_status = 'closed' then
    raise exception 'This review period is closed; reopen it to change its KPIs' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.assigned_by := coalesce(auth.uid(), new.assigned_by);
    new.self_value := null; new.self_comment := null; new.self_by := null; new.self_at := null;
    new.actual_value := null; new.manager_comment := null; new.scored_by := null; new.scored_at := null;
    new.auto_value := null; new.auto_detail := null; new.auto_at := null;
    new.created_at := now();
    if new.target is null then
      select k.default_target into v_default from public.kpis k where k.id = new.kpi_id;
      new.target := v_default;
    end if;
  else
    -- only the target, the weight (and how it was assigned) change here; the scores come from check-ins
    new.tenant_id := old.tenant_id;
    new.period_id := old.period_id;
    new.kpi_id := old.kpi_id;
    new.employee_number := old.employee_number;
    new.created_at := old.created_at;
    new.self_value := old.self_value; new.self_comment := old.self_comment; new.self_by := old.self_by; new.self_at := old.self_at;
    new.actual_value := old.actual_value; new.manager_comment := old.manager_comment;
    new.scored_by := old.scored_by; new.scored_at := old.scored_at;
    new.auto_value := old.auto_value; new.auto_detail := old.auto_detail; new.auto_at := old.auto_at;
    if auth.uid() is not null then
      new.assigned_by := auth.uid();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.kpi_assignments_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. working out a measure
-- ---------------------------------------------------------------------------------------------
-- One employee's value for a task measure over a period, as of p_today: the value (null when there is nothing to
-- measure yet) and what it came from.
create or replace function public.kpi_task_measure(
  p_tenant uuid, p_employee text, p_measure text, p_from date, p_to date, p_today date
) returns table (value numeric, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_due integer;
  v_on_time integer;
  v_done integer;
  v_days numeric;
begin
  if p_measure in ('tasks_on_time', 'tasks_late') then
    select count(*)::integer,
           count(*) filter (where t.status = 'done' and (t.completed_at at time zone 'Africa/Nairobi')::date <= t.due_date)::integer
      into v_due, v_on_time
    from public.tasks t
    where t.tenant_id = p_tenant and t.assignee_number = p_employee and not t.is_group and t.status <> 'cancelled'
      and t.due_date between p_from and p_to
      and (t.status = 'done' or t.due_date < p_today);
    if v_due = 0 then
      return query select null::numeric, jsonb_build_object('due', 0);
    elsif p_measure = 'tasks_on_time' then
      return query select round(100.0 * v_on_time / v_due, 1), jsonb_build_object('on_time', v_on_time, 'due', v_due);
    else
      return query select (v_due - v_on_time)::numeric, jsonb_build_object('late', v_due - v_on_time, 'due', v_due);
    end if;
    return;
  end if;

  if p_measure in ('tasks_completed', 'task_days') then
    select count(*)::integer,
           round((percentile_cont(0.5) within group (order by extract(epoch from t.completed_at - t.created_at) / 86400.0))::numeric, 1)
      into v_done, v_days
    from public.tasks t
    where t.tenant_id = p_tenant and t.assignee_number = p_employee and not t.is_group and t.status = 'done'
      and (t.completed_at at time zone 'Africa/Nairobi')::date between p_from and least(p_to, p_today);
    if p_measure = 'tasks_completed' then
      return query select v_done::numeric, jsonb_build_object('done', v_done);
    else
      return query select greatest(v_days, 0), jsonb_build_object('done', v_done);
    end if;
    return;
  end if;
  -- manual (or unknown): nothing to work out
  return query select null::numeric, null::jsonb;
end $$;
revoke all on function public.kpi_task_measure(uuid, text, text, date, date, date) from public, anon, authenticated;

-- Recalculates the calculated KPIs of open periods: p_period alone, or every open period (of the signed-in person's
-- company, or of every company when the system runs it). Returns how many values changed. p_today (the day to count
-- up to) is honoured only when the system runs it.
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
    select * into m from public.kpi_task_measure(r.tenant_id, r.employee_number, r.measure, r.starts_on, r.ends_on, v_today);
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

-- ---------------------------------------------------------------------------------------------
-- 5. scheduling (best effort, like the other jobs): every hour
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'kpi-measures-hourly') then
      perform cron.unschedule('kpi-measures-hourly');
    end if;
    perform cron.schedule('kpi-measures-hourly', '17 * * * *', $c$select public.kpi_refresh_measures();$c$);
  else
    raise notice 'pg_cron is not available: calculated KPIs update when someone presses Recalculate on Scorecards.';
  end if;
end $$;

notify pgrst, 'reload schema';
