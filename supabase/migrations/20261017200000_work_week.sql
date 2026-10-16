-- Each company's work week, and a department's own (FIG-888).
--
-- Leave in working days counted Monday to Friday for every company. Now each company sets, for each day of the week,
-- whether it is worked in full (1), half (0.5) or not at all (0): a four-day week skips the days off, a six-day week
-- counts Saturday, a half-day Saturday counts half. A department may have its own (the farm works Saturdays, the
-- office doesn't); a sub-department without one follows the department above it, then the company.
--
--   company_work_week(tenant_id, days)   days: 7 numbers, Monday first. No row = Monday to Friday.
--   departments.work_week                the same, or null to follow the department above / the company
--   work_week_for(tenant, employee)      the week that applies to one employee
--   leave_days_for(...)                  the days a leave covers for that employee: their working days less the
--                                        company's holidays, or every day for leave counted in calendar days.
--                                        A half-day application (one day) counts half of that day.
--   leave_application.days               now a decimal, so half days can be kept
-- leave_days_between (company-wide, whole days) is replaced by leave_days_for.

-- ---------------------------------------------------------------------------------------------
-- 1. the weeks
-- ---------------------------------------------------------------------------------------------
create or replace function public.valid_work_week(p numeric[]) returns boolean
language sql immutable as $$
  select p is not null and cardinality(p) = 7 and array_ndims(p) = 1
     and p <@ array[0, 0.5, 1]::numeric[] and exists (select 1 from unnest(p) d where d > 0)
$$;

create table if not exists public.company_work_week (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  days numeric[] not null default array[1, 1, 1, 1, 1, 0, 0]::numeric[] check (public.valid_work_week(days)),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.company_work_week enable row level security;
drop policy if exists tenant_isolation on public.company_work_week;
create policy tenant_isolation on public.company_work_week as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists members_read on public.company_work_week;
create policy members_read on public.company_work_week for select to authenticated using (true);
-- set where the company's settings and its leave are run
drop policy if exists settings_write on public.company_work_week;
create policy settings_write on public.company_work_week for all to authenticated
  using ((select public.has_any_module('settings', 'leaves')))
  with check ((select public.has_any_module('settings', 'leaves')));
revoke all on public.company_work_week from anon;

alter table public.departments add column if not exists work_week numeric[];
alter table public.departments drop constraint if exists departments_work_week_check;
alter table public.departments add constraint departments_work_week_check
  check (work_week is null or public.valid_work_week(work_week));

create or replace function public.work_week_for(p_tenant uuid, p_employee text) returns numeric[]
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select d.id, d.parent_id, d.work_week, 0 as depth
    from public.employees e join public.departments d on d.id = e.department_id
    where e.tenant_id = p_tenant and e."Employee Number" = p_employee
    union all
    select d.id, d.parent_id, d.work_week, up.depth + 1
    from up join public.departments d on d.id = up.parent_id
    where up.work_week is null and up.depth < 20
  )
  select coalesce(
    (select work_week from up where work_week is not null order by depth limit 1),
    (select days from public.company_work_week where tenant_id = p_tenant),
    array[1, 1, 1, 1, 1, 0, 0]::numeric[])
$$;
revoke all on function public.work_week_for(uuid, text) from public, anon;
grant execute on function public.work_week_for(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. counting a leave's days
-- ---------------------------------------------------------------------------------------------
create or replace function public.leave_days_for(
  p_tenant uuid, p_employee text, p_start date, p_end date, p_calendar boolean, p_half boolean default false
) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_week numeric[];
  v_days numeric;
begin
  if p_start is null or p_end is null or p_end < p_start then
    return 0;
  end if;
  if p_calendar then
    v_days := (p_end - p_start) + 1;
  else
    v_week := public.work_week_for(p_tenant, p_employee);
    select coalesce(sum(v_week[extract(isodow from g.d)::int]), 0) into v_days
    from generate_series(p_start, p_end, interval '1 day') g(d)
    where not exists (
      select 1 from public.holidays h
      where h.tenant_id = p_tenant and h.date is not null
        and (h.date = g.d::date
             or (coalesce(h.recurring, false) and to_char(h.date, 'MM-DD') = to_char(g.d, 'MM-DD'))));
  end if;
  if p_half and p_start = p_end then
    v_days := v_days / 2;
  end if;
  return trim_scale(v_days);
end $$;
revoke all on function public.leave_days_for(uuid, text, date, date, boolean, boolean) from public, anon;
grant execute on function public.leave_days_for(uuid, text, date, date, boolean, boolean) to authenticated;

drop function if exists public.leave_days_between(uuid, date, date, boolean);

-- half days can be kept
alter table public.leave_application alter column days type numeric using days::numeric;

-- ---------------------------------------------------------------------------------------------
-- 3. the checks, counting with the employee's week (and half days)
-- ---------------------------------------------------------------------------------------------
drop function if exists public.leave_request_problems(uuid, text, text, date, date, boolean, uuid);
create or replace function public.leave_request_problems(
  p_tenant uuid, p_employee text, p_type text, p_start date, p_end date, p_self boolean, p_exclude uuid default null,
  p_half boolean default false
) returns table (days numeric, available numeric, problems text[])
language plpgsql stable security definer set search_path = public as $$
declare
  t public.leave_types;
  pol record;
  v_days numeric := 0;
  v_free numeric;
  v_pending numeric;
  v_month integer;
  v_joined date;
  v_from date;
  v_problems text[] := '{}';
begin
  select * into t from public.leave_types lt where lt.tenant_id = p_tenant and lt.name = btrim(coalesce(p_type, ''));
  if t.id is null then
    return query select 0::numeric, null::numeric, array['Choose a leave type'];
    return;
  end if;
  select * into pol from public.current_leave_policies where leave_type_id = t.id;

  if p_start is null or p_end is null or p_end < p_start then
    return query select 0::numeric, null::numeric, array['Choose a start date, and an end date that is the same day or later'];
    return;
  end if;
  if p_half and p_end <> p_start then
    return query select 0::numeric, null::numeric, array['A half day is one day: choose the same start and end date'];
    return;
  end if;

  v_days := public.leave_days_for(p_tenant, p_employee, p_start, p_end, coalesce(pol.count_days, 'working') = 'calendar', p_half);
  if v_days = 0 then
    return query select 0::numeric, null::numeric, array['Those dates are all days off or public holidays, so no leave is needed'];
    return;
  end if;

  if p_self and pol.leave_type_id is not null then
    if pol.service_months_before_use > 0 then
      v_joined := public.employee_joined(p_tenant, p_employee);
      v_from := (v_joined + make_interval(months => pol.service_months_before_use))::date;
      if v_joined is not null and p_start < v_from then
        v_problems := v_problems || format('%s can be taken from %s, %s month%s after joining (%s)',
          t.name, to_char(v_from, 'DD Mon YYYY'), pol.service_months_before_use,
          case when pol.service_months_before_use = 1 then '' else 's' end, to_char(v_joined, 'DD Mon YYYY'));
      end if;
    end if;
    if pol.max_days_per_request is not null and v_days > pol.max_days_per_request then
      v_problems := v_problems || format('%s allows at most %s days in one application (this is %s)',
        t.name, trim_scale(pol.max_days_per_request), trim_scale(v_days));
    end if;
    if pol.min_notice_days > 0 and p_start < current_date + pol.min_notice_days then
      v_problems := v_problems || format('%s needs %s days'' notice: the earliest start date is %s',
        t.name, pol.min_notice_days, to_char(current_date + pol.min_notice_days, 'DD Mon YYYY'));
    end if;
    if pol.one_per_month and exists (
      select 1 from public.leave_application a
      where a.tenant_id = p_tenant and a."Employee Number" = p_employee and a."Leave Type" = t.name
        and a.id is distinct from p_exclude
        and lower(coalesce(a.status, 'pending')) not in ('rejected', 'cancelled')
        and date_trunc('month', a.time_added) = date_trunc('month', now())) then
      v_problems := v_problems || format('You have already applied for %s this month', t.name);
    end if;
  end if;

  v_month := public.leave_bucket_month(pol.accrual_method, p_start);
  v_free := public.leave_available(p_tenant, p_employee, t.id, extract(year from p_start)::int, v_month);
  if v_free is not null then
    select coalesce(sum(a.days), 0) into v_pending
    from public.leave_application a
    where a.tenant_id = p_tenant and a."Employee Number" = p_employee and a."Leave Type" = t.name
      and a.id is distinct from p_exclude
      and lower(coalesce(a.status, 'pending')) = 'pending'
      and extract(year from public.leave_parse_date(a."Start Date")) = extract(year from p_start)
      and (v_month = 0 or extract(month from public.leave_parse_date(a."Start Date")) = v_month);
    v_free := v_free - v_pending;
    if v_days > v_free then
      v_problems := v_problems || format('Not enough %s left: %s day%s free to book%s, and this needs %s',
        t.name, trim_scale(greatest(v_free, 0)), case when greatest(v_free, 0) = 1 then '' else 's' end,
        case when v_pending > 0 then format(' (%s more waiting for approval)', trim_scale(v_pending)) else '' end,
        trim_scale(v_days));
    end if;
  end if;

  return query select trim_scale(v_days), v_free, v_problems;
end $$;
revoke all on function public.leave_request_problems(uuid, text, text, date, date, boolean, uuid, boolean) from public, anon, authenticated;

drop function if exists public.leave_request_check(text, text, text, text);
create or replace function public.leave_request_check(
  p_employee_number text, p_leave_type text, p_start text, p_end text, p_half boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_self boolean := public.current_employee_number() is not distinct from p_employee_number;
  r record;
begin
  if not v_self and not public.has_module('leaves') then
    raise exception 'You can only check your own leave' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.tenant_id = v_tenant and e."Employee Number" = p_employee_number) then
    raise exception 'No such employee' using errcode = '22023';
  end if;
  select * into r from public.leave_request_problems(v_tenant, p_employee_number, p_leave_type,
    public.leave_parse_date(p_start), public.leave_parse_date(p_end), v_self, null, coalesce(p_half, false));
  return jsonb_build_object('days', r.days, 'available', r.available, 'problems', to_jsonb(r.problems));
end $$;
revoke all on function public.leave_request_check(text, text, text, text, boolean) from public, anon;
grant execute on function public.leave_request_check(text, text, text, text, boolean) to authenticated;

-- "Half Day" on the form is a half-day application
create or replace function public.leave_application_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_self boolean;
  v_half boolean := lower(btrim(coalesce(new.type, ''))) = 'half day';
begin
  if auth.uid() is null then
    select * into r from public.leave_request_problems(new.tenant_id, new."Employee Number", new."Leave Type",
      public.leave_parse_date(new."Start Date"), public.leave_parse_date(new."End Date"), false, new.id, v_half);
    if r.days > 0 then
      new.days := r.days;
    end if;
    return new;
  end if;

  v_self := public.current_employee_number() is not distinct from new."Employee Number" or not public.has_module('leaves');
  select * into r from public.leave_request_problems(new.tenant_id, new."Employee Number", new."Leave Type",
    public.leave_parse_date(new."Start Date"), public.leave_parse_date(new."End Date"), v_self, new.id, v_half);
  if lower(coalesce(new.status, 'pending')) = 'approved' then
    r.problems := array(select p from unnest(r.problems) p where p not like 'Not enough %');
  end if;
  if cardinality(r.problems) > 0 then
    raise exception '%', array_to_string(r.problems, '. ') using errcode = 'P0001';
  end if;
  new.days := r.days;
  return new;
end $$;

-- "3 days", "2.5 days", "1 day" in approval messages
create or replace function public.approval_leave_text(l public.leave_application) returns text language sql stable as $$
  select coalesce(nullif(btrim(l."Leave Type"), ''), 'leave') || ' application (' || coalesce(trim_scale(l.days), 0) || ' day'
    || case when l.days = 1 then '' else 's' end
    || coalesce(', ' || nullif(btrim(l."Start Date"), '') || ' to ' || nullif(btrim(l."End Date"), ''), '') || ')'
$$;

notify pgrst, 'reload schema';
