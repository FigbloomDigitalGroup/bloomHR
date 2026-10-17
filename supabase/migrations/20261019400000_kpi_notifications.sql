-- Telling employees about new and changed KPIs (FIG-885, after 20261019300000_kpi_templates).
--
-- Employees get a notification (their bell, and emailed by the existing pipeline like every employee notification)
-- of type employment_update when, in a review period they can see (open):
--   * new KPIs reach them: assigned by hand (one person or a group), from templates when they join or move, or by
--     "Apply to open periods"  -> "New KPIs: You have 4 new KPIs for the Q4 2026 review."
--   * the review period opens -> one notification with how many KPIs they have in it (those set up while it was a
--     draft and those its templates just gave them), instead of one for each
--   * a manager or HR changes the target or weight of one of their KPIs -> "KPI targets changed", naming the KPIs
--   * template KPIs are taken off them because the template no longer fits -> "KPIs removed", naming the KPIs
-- One notification per employee, per period, per change (an SQL statement: one assign, one apply, one save), never one
-- per KPI. Nobody is told about their own change (notify_employee_number skips the signed-in person), and nothing is
-- sent for draft periods (staff can't see them), for check-ins, renumbering, or rows removed with their employee or
-- period.
--
-- How: statement-level triggers on kpi_assignments with transition tables (the rows one statement added, changed or
-- removed), grouped by employee and period. This covers every way an assignment is written (assign_kpi, the screens,
-- the template functions) without changing those functions. Opening a period is marked for the rest of the
-- transaction by a BEFORE trigger on kpi_periods so the KPIs its templates add are not announced twice; an AFTER
-- trigger then sends the one "period is open" notification per employee.
--
-- hr_notifications has no link column; the message says where to look (My KPIs). Written to run again safely.

create or replace function public.kpi_count_text(n integer, p_word text default 'KPI') returns text
language sql immutable as $$
  select n || ' ' || p_word || case when n = 1 then '' else 's' end
$$;

-- a period about to open: KPIs added to it in this transaction are announced by kpi_periods_notify_open
create or replace function public.kpi_periods_mark_opening() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    perform set_config('app.kpi_opening', new.id::text, true);
  end if;
  return new;
end $$;
revoke all on function public.kpi_periods_mark_opening() from public, anon, authenticated;
drop trigger if exists kpi_periods_mark_opening on public.kpi_periods;
create trigger kpi_periods_mark_opening before insert or update on public.kpi_periods
  for each row execute function public.kpi_periods_mark_opening();

-- after the templates are applied (kpi_periods_apply_templates_* run first: triggers fire in name order)
create or replace function public.kpi_periods_notify_open() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform set_config('app.kpi_opening', '', true);
  for r in
    select a.employee_number, count(*)::integer as n
    from public.kpi_assignments a where a.period_id = new.id group by a.employee_number
  loop
    perform public.notify_employee_number(new.tenant_id, r.employee_number, 'employment_update', 'Your KPIs for ' || new.name,
      'The ' || new.name || ' review is open. You have ' || public.kpi_count_text(r.n)
      || ' to work towards. See them, and add your self-assessments, under My KPIs.');
  end loop;
  return new;
end $$;
revoke all on function public.kpi_periods_notify_open() from public, anon, authenticated;
drop trigger if exists kpi_periods_notify_open_insert on public.kpi_periods;
create trigger kpi_periods_notify_open_insert after insert on public.kpi_periods
  for each row when (new.status = 'open') execute function public.kpi_periods_notify_open();
drop trigger if exists kpi_periods_notify_open on public.kpi_periods;
create trigger kpi_periods_notify_open after update on public.kpi_periods
  for each row when (new.status = 'open' and old.status is distinct from 'open') execute function public.kpi_periods_notify_open();

-- new KPIs: one notification per employee and period
create or replace function public.kpi_assignments_notify_added() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_opening text := coalesce(current_setting('app.kpi_opening', true), '');
begin
  for r in
    select n.tenant_id, n.employee_number, p.name as period, count(*)::integer as cnt
    from added n join public.kpi_periods p on p.id = n.period_id
    where p.status = 'open' and n.period_id::text <> v_opening
    group by n.tenant_id, n.employee_number, p.name
  loop
    perform public.notify_employee_number(r.tenant_id, r.employee_number, 'employment_update', 'New KPIs',
      'You have ' || public.kpi_count_text(r.cnt, 'new KPI') || ' for the ' || r.period || ' review. See them under My KPIs.');
  end loop;
  return null;
end $$;
revoke all on function public.kpi_assignments_notify_added() from public, anon, authenticated;
drop trigger if exists kpi_assignments_notify_added on public.kpi_assignments;
create trigger kpi_assignments_notify_added after insert on public.kpi_assignments
  referencing new table as added for each statement execute function public.kpi_assignments_notify_added();

-- a target or weight changed by a person (not a template being applied, a check-in or a renumbering)
create or replace function public.kpi_assignments_notify_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null or current_setting('app.kpi_template_apply', true) = 'on' or current_setting('app.kpi_checkin', true) = 'on' then
    return null;
  end if;
  for r in
    select n.tenant_id, n.employee_number, p.name as period, string_agg(k.name, ', ' order by k.name) as kpis, count(*)::integer as cnt
    from changed n
    join before_change o on o.id = n.id
    join public.kpi_periods p on p.id = n.period_id
    join public.kpis k on k.id = n.kpi_id
    where p.status = 'open' and o.employee_number = n.employee_number
      and (n.target is distinct from o.target or n.weight is distinct from o.weight)
    group by n.tenant_id, n.employee_number, p.name
  loop
    perform public.notify_employee_number(r.tenant_id, r.employee_number, 'employment_update', 'KPI targets changed',
      'The target or weight of ' || case when r.cnt = 1 then 'your KPI ' else 'your KPIs ' end || r.kpis || ' for the ' || r.period
      || ' review changed. See them under My KPIs.');
  end loop;
  return null;
end $$;
revoke all on function public.kpi_assignments_notify_changed() from public, anon, authenticated;
drop trigger if exists kpi_assignments_notify_changed on public.kpi_assignments;
create trigger kpi_assignments_notify_changed after update on public.kpi_assignments
  referencing old table as before_change new table as changed for each statement execute function public.kpi_assignments_notify_changed();

-- template KPIs taken off because the template no longer fits (removed by a template run, not by hand or with the
-- employee or period)
create or replace function public.kpi_assignments_notify_removed() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if current_setting('app.kpi_template_apply', true) is distinct from 'on' then
    return null;
  end if;
  for r in
    select o.tenant_id, o.employee_number, p.name as period, string_agg(k.name, ', ' order by k.name) as kpis, count(*)::integer as cnt
    from removed o
    join public.kpi_periods p on p.id = o.period_id
    join public.kpis k on k.id = o.kpi_id
    where p.status = 'open' and o.assigned_via = 'template'
    group by o.tenant_id, o.employee_number, p.name
  loop
    perform public.notify_employee_number(r.tenant_id, r.employee_number, 'employment_update', 'KPIs removed',
      case when r.cnt = 1 then 'The KPI ' else 'The KPIs ' end || r.kpis || case when r.cnt = 1 then ' was' else ' were' end
      || ' taken off your ' || r.period || ' review because ' || case when r.cnt = 1 then 'it no longer applies' else 'they no longer apply' end
      || ' to your role. See your KPIs under My KPIs.');
  end loop;
  return null;
end $$;
revoke all on function public.kpi_assignments_notify_removed() from public, anon, authenticated;
drop trigger if exists kpi_assignments_notify_removed on public.kpi_assignments;
create trigger kpi_assignments_notify_removed after delete on public.kpi_assignments
  referencing old table as removed for each statement execute function public.kpi_assignments_notify_removed();
