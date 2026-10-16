-- Leave counted from when someone joined, a service rule before leave can be taken, and Kenyan defaults for new
-- companies (FIG-878).
--
-- Before this the leave engine ignored start dates: someone joining in October was credited from January (10/12 of a
-- monthly-earned allowance at once), and on a whole-allowance-at-once type got the full year.
--
--   1. employee_joined(): the joining date - "Start Date", else "Contract Start Date", else "Probation Start Date"
--      (the order the HR status sync uses). "Start Date" first: a contract renewed mid-year must not restart anyone's
--      leave. Only dates written as YYYY-MM-DD count; an employee without one is treated as here all year, as before.
--   2. leave_year_allowance(): the part of a yearly allowance someone has for a year - from the month they joined
--      (that month counts in full), up to the month asked for (12 = the whole year). Everything that sets or checks a
--      balance uses it: the monthly accrual, the yearly grant, the balance check, the balance taken on approval and a
--      per-employee allowance.
--   3. service_months_before_use on the leave type's policy: leave can be taken only this many months after joining
--      (the days still build up meanwhile). Applies to an employee applying for themselves, like the other FIG-875
--      rules; HR entering leave for someone may go ahead.
--   4. New companies get the Kenyan defaults: Annual Leave 21 days earned monthly, usable after 2 months; Maternity 90
--      and Paternity 14 calendar days (maternity with 7 days' notice); Adoption Leave 30 calendar days; compassionate
--      leave per bereavement - immediate family up to 10 days, extended family up to 3. Existing companies keep theirs.

-- ---------------------------------------------------------------------------------------------
-- 1 + 2. when someone joined, and their part of a year
-- ---------------------------------------------------------------------------------------------
create or replace function public.employee_joined(p_tenant uuid, p_employee text) returns date
language sql stable security definer set search_path = public as $$
  select coalesce(public.employee_start_date(e."Start Date"),
                  public.employee_start_date(e."Contract Start Date"),
                  public.employee_start_date(e."Probation Start Date"))
  from public.employees e
  where e.tenant_id = p_tenant and e."Employee Number" = p_employee
  limit 1
$$;
revoke all on function public.employee_joined(uuid, text) from public, anon;
grant execute on function public.employee_joined(uuid, text) to authenticated;

-- months of p_year, up to month p_upto, someone was employed: all of them if they joined before the year (or we don't
-- know when), none if they join after it, else from the month they joined
create or replace function public.leave_service_months(p_joined date, p_year integer, p_upto integer) returns integer
language sql immutable as $$
  select case
    when p_joined is null or p_joined < make_date(p_year, 1, 1) then least(greatest(p_upto, 0), 12)
    when extract(year from p_joined) > p_year then 0
    else greatest(least(p_upto, 12) - extract(month from p_joined)::int + 1, 0)
  end
$$;

create or replace function public.leave_year_allowance(p_tenant uuid, p_employee text, p_yearly numeric, p_year integer, p_upto integer)
returns numeric
language sql stable security definer set search_path = public as $$
  select round(coalesce(p_yearly, 0)
               * public.leave_service_months(public.employee_joined(p_tenant, p_employee), p_year, p_upto) / 12.0, 2)
$$;
revoke all on function public.leave_year_allowance(uuid, text, numeric, integer, integer) from public, anon;
grant execute on function public.leave_year_allowance(uuid, text, numeric, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. the service rule
-- ---------------------------------------------------------------------------------------------
alter table public.leave_policies add column if not exists service_months_before_use integer not null default 0;
alter table public.leave_policies drop constraint if exists leave_policies_service_check;
alter table public.leave_policies add constraint leave_policies_service_check check (service_months_before_use between 0 and 60);

drop view if exists public.current_leave_policies;
create view public.current_leave_policies as
select distinct on (leave_type_id) *
from public.leave_policies
where effective_from <= current_date
order by leave_type_id, effective_from desc;
alter view public.current_leave_policies set (security_invoker = true);

-- ---------------------------------------------------------------------------------------------
-- the engine, counting from when people joined
-- ---------------------------------------------------------------------------------------------
create or replace function public.run_annual_leave_reset(p_year integer)
returns setof public.leave_balances
language plpgsql
as $$
declare
  r record;
  v_carry numeric;
  v_days numeric;
  v_new_row public.leave_balances;
begin
  for r in
    select
      e.tenant_id as tenant_id,
      e."Employee Number" as employee_number,
      lt.id as leave_type_id,
      cp.days_allotted,
      cp.carry_forward_max_days,
      prev.remaining_days as prev_remaining
    from public.employees e
    join public.leave_types lt on lt.tenant_id = e.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = e.tenant_id
    left join public.leave_balances prev
      on prev.employee_number = e."Employee Number"
     and prev.tenant_id = e.tenant_id
     and prev.leave_type_id = lt.id
     and prev.year = p_year - 1
     and prev.month = 0
    where lt.is_deductible = true
      and cp.accrual_method = 'annual'
  loop
    v_carry := greatest(least(coalesce(r.prev_remaining, 0), r.carry_forward_max_days), 0);
    -- the whole year, or from the month they join
    v_days := public.leave_year_allowance(r.tenant_id, r.employee_number,
      public.leave_entitlement(r.tenant_id, r.employee_number, r.leave_type_id, r.days_allotted), p_year, 12);

    insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days)
    values (r.tenant_id, r.employee_number, r.leave_type_id, p_year, 0, v_days, 0, v_carry)
    on conflict (employee_number, leave_type_id, year, month) do nothing
    returning * into v_new_row;

    if found then
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_new_row.id, 'annual_reset', v_days + v_carry, 0, 0, 0, v_days,
         format('Annual reset for %s: %s days allotted + %s carried forward from %s', p_year, v_days, v_carry, p_year - 1));
      return next v_new_row;
    end if;
  end loop;
end;
$$;

create or replace function public.run_leave_accrual(p_year integer, p_month integer)
returns setof public.leave_balances
language plpgsql
as $$
declare
  r record;
  v_carry numeric;
  v_due numeric;
  v_row public.leave_balances;
  v_old numeric;
begin
  for r in
    select
      e.tenant_id as tenant_id,
      e."Employee Number" as employee_number,
      lt.id as leave_type_id,
      cp.days_allotted,
      cp.carry_forward_max_days,
      prev.remaining_days as prev_remaining
    from public.employees e
    join public.leave_types lt on lt.tenant_id = e.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = e.tenant_id
    left join public.leave_balances prev
      on prev.employee_number = e."Employee Number"
     and prev.tenant_id = e.tenant_id
     and prev.leave_type_id = lt.id
     and prev.year = p_year - 1
     and prev.month = 0
    where lt.is_deductible = true
      and cp.accrual_method = 'monthly_cumulative'
  loop
    -- earned from the month they joined (or January) to p_month
    v_due := public.leave_year_allowance(r.tenant_id, r.employee_number,
      public.leave_entitlement(r.tenant_id, r.employee_number, r.leave_type_id, r.days_allotted), p_year, p_month);

    select * into v_row from public.leave_balances b
    where b.employee_number = r.employee_number and b.leave_type_id = r.leave_type_id and b.year = p_year and b.month = 0;

    if not found then
      v_carry := greatest(least(coalesce(r.prev_remaining, 0), r.carry_forward_max_days), 0);
      insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days, last_accrual_date)
      values (r.tenant_id, r.employee_number, r.leave_type_id, p_year, 0, v_due, 0, v_carry, current_date)
      returning * into v_row;
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_row.id, 'monthly_accrual', v_due + v_carry, 0, 0, 0, v_due,
         format('Year %s started: %s days earned so far + %s carried forward from %s', p_year, v_due, v_carry, p_year - 1));
      return next v_row;
    elsif v_row.accrued_days < v_due then
      v_old := v_row.accrued_days;
      update public.leave_balances set accrued_days = v_due, last_accrual_date = current_date, updated_at = now()
      where id = v_row.id returning * into v_row;
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_row.id, 'monthly_accrual', v_due - v_old, v_row.used_days, v_row.used_days, v_old, v_due,
         format('Earned %s days by month %s of %s', v_due, p_month, p_year));
      return next v_row;
    end if;
  end loop;
end;
$$;

-- a balance row's starting days when one is first made: earned so far, the (part-)year, or the monthly allowance
create or replace function public.leave_seed_days(p_tenant uuid, p_employee text, p_method text, p_yearly numeric, p_year integer)
returns numeric
language sql stable security definer set search_path = public as $$
  select case p_method
    when 'monthly_cumulative' then public.leave_year_allowance(p_tenant, p_employee, p_yearly, p_year, public.leave_months_earned(p_year))
    when 'annual' then public.leave_year_allowance(p_tenant, p_employee, p_yearly, p_year, 12)
    else coalesce(p_yearly, 0)
  end
$$;
revoke all on function public.leave_seed_days(uuid, text, text, numeric, integer) from public, anon;
grant execute on function public.leave_seed_days(uuid, text, text, numeric, integer) to authenticated;

create or replace function public.leave_available(p_tenant uuid, p_employee text, p_type uuid, p_year integer, p_month integer)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  t public.leave_types;
  pol record;
  b public.leave_balances;
  v_yearly numeric;
  v_allowance numeric;
begin
  select * into t from public.leave_types where id = p_type and tenant_id = p_tenant;
  select * into pol from public.current_leave_policies where leave_type_id = p_type;
  if t.id is null or not coalesce(t.is_deductible, true) or pol.leave_type_id is null
     or pol.accrual_method = 'none' or pol.days_allotted is null or pol.balance_rule = 'none' then
    return null;
  end if;
  v_yearly := public.leave_entitlement(p_tenant, p_employee, p_type, pol.days_allotted);
  select * into b from public.leave_balances
  where employee_number = p_employee and leave_type_id = p_type and year = p_year and month = p_month;

  if pol.accrual_method = 'monthly_cumulative' and pol.balance_rule = 'full_year' then
    -- the rest of the year can be booked ahead: their whole (part-)year
    v_allowance := greatest(public.leave_year_allowance(p_tenant, p_employee, v_yearly, p_year, 12), coalesce(b.accrued_days, 0));
  else
    v_allowance := coalesce(b.accrued_days, public.leave_seed_days(p_tenant, p_employee, pol.accrual_method, v_yearly, p_year));
  end if;
  return v_allowance + coalesce(b.carried_over_days, 0) - coalesce(b.used_days, 0);
end $$;
revoke all on function public.leave_available(uuid, text, uuid, integer, integer) from public, anon, authenticated;

create or replace function public.leave_take(p_app public.leave_application, p_sign integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.leave_types;
  pol record;
  v_start date := public.leave_parse_date(p_app."Start Date");
  v_year integer;
  v_month integer;
  v_days numeric := coalesce(p_app.days, 0);
  v_free numeric;
  v_seed numeric;
  v_before public.leave_balances;
  v_after public.leave_balances;
begin
  select * into t from public.leave_types where tenant_id = p_app.tenant_id and name = btrim(coalesce(p_app."Leave Type", ''));
  if t.id is null or not coalesce(t.is_deductible, true) or v_start is null or v_days <= 0 then
    return;
  end if;
  select * into pol from public.current_leave_policies where leave_type_id = t.id;
  if pol.leave_type_id is null or pol.accrual_method = 'none' then
    return;
  end if;
  v_year := extract(year from v_start)::int;
  v_month := public.leave_bucket_month(pol.accrual_method, v_start);

  if p_sign > 0 then
    v_free := public.leave_available(p_app.tenant_id, p_app."Employee Number", t.id, v_year, v_month);
    if v_free is not null and v_days > v_free then
      raise exception 'Not enough % left for %: % day% free, and this leave needs %. Change the allowance in Balances, or the leave type''s balance rule',
        t.name, coalesce(nullif(btrim(p_app.name), ''), p_app."Employee Number"), trim_scale(greatest(v_free, 0)),
        case when greatest(v_free, 0) = 1 then '' else 's' end, trim_scale(v_days)
        using errcode = 'P0001';
    end if;
  end if;

  select * into v_before from public.leave_balances
  where employee_number = p_app."Employee Number" and leave_type_id = t.id and year = v_year and month = v_month;

  v_seed := public.leave_seed_days(p_app.tenant_id, p_app."Employee Number", pol.accrual_method,
    public.leave_entitlement(p_app.tenant_id, p_app."Employee Number", t.id, pol.days_allotted), v_year);

  insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days)
  values (p_app.tenant_id, p_app."Employee Number", t.id, v_year, v_month, v_seed, greatest(p_sign * v_days, 0))
  on conflict (employee_number, leave_type_id, year, month)
  do update set used_days = greatest(public.leave_balances.used_days + p_sign * v_days, 0), updated_at = now()
  returning * into v_after;

  insert into public.leave_balance_adjustments
    (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
  values
    (p_app.tenant_id, v_after.id, case when p_sign > 0 then 'approval_deduction' else 'approval_reversal' end,
     v_after.used_days - coalesce(v_before.used_days, 0),
     coalesce(v_before.used_days, 0), v_after.used_days,
     coalesce(v_before.accrued_days, v_after.accrued_days), v_after.accrued_days,
     case when p_sign > 0 then 'Leave application approved' else 'Approved leave application no longer approved' end);
end $$;
revoke all on function public.leave_take(public.leave_application, integer) from public, anon, authenticated;

create or replace function public.set_leave_entitlement(p_employee_number text, p_leave_type_id uuid, p_days numeric, p_year integer default null)
returns public.leave_balances
language plpgsql
as $$
declare
  v_year integer := coalesce(p_year, extract(year from current_date)::int);
  v_tenant uuid := public.current_tenant_id();
  v_method text;
  v_new numeric;
  v_row public.leave_balances;
  v_old numeric;
begin
  if p_days is null or p_days < 0 then
    raise exception 'The allowance must be zero or more days' using errcode = '22023';
  end if;

  insert into public.leave_entitlements (tenant_id, employee_number, leave_type_id, days_allotted)
  values (v_tenant, p_employee_number, p_leave_type_id, p_days)
  on conflict (tenant_id, employee_number, leave_type_id)
  do update set days_allotted = excluded.days_allotted, updated_at = now();

  select accrual_method into v_method from public.current_leave_policies where leave_type_id = p_leave_type_id;
  v_new := public.leave_seed_days(v_tenant, p_employee_number, v_method, p_days, v_year);

  select * into v_row from public.leave_balances
  where employee_number = p_employee_number and leave_type_id = p_leave_type_id and year = v_year and month = 0;
  if found and v_method in ('annual', 'monthly_cumulative') then
    v_old := v_row.accrued_days;
    update public.leave_balances set accrued_days = v_new, updated_at = now() where id = v_row.id returning * into v_row;
    insert into public.leave_balance_adjustments
      (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
    values
      (v_row.tenant_id, v_row.id, 'allowance_change', v_new - v_old, v_row.used_days, v_row.used_days, v_old, v_new,
       format('Yearly allowance set to %s days for this employee', p_days));
  end if;
  return v_row;
end;
$$;
grant execute on function public.set_leave_entitlement(text, uuid, numeric, integer) to authenticated;

-- the FIG-875 checks, plus the service rule
create or replace function public.leave_request_problems(
  p_tenant uuid, p_employee text, p_type text, p_start date, p_end date, p_self boolean, p_exclude uuid default null
) returns table (days integer, available numeric, problems text[])
language plpgsql stable security definer set search_path = public as $$
declare
  t public.leave_types;
  pol record;
  v_days integer := 0;
  v_free numeric;
  v_pending numeric;
  v_month integer;
  v_joined date;
  v_from date;
  v_problems text[] := '{}';
begin
  select * into t from public.leave_types lt where lt.tenant_id = p_tenant and lt.name = btrim(coalesce(p_type, ''));
  if t.id is null then
    return query select 0, null::numeric, array['Choose a leave type'];
    return;
  end if;
  select * into pol from public.current_leave_policies where leave_type_id = t.id;

  if p_start is null or p_end is null or p_end < p_start then
    return query select 0, null::numeric, array['Choose a start date, and an end date that is the same day or later'];
    return;
  end if;

  v_days := public.leave_days_between(p_tenant, p_start, p_end, coalesce(pol.count_days, 'working') = 'calendar');
  if v_days = 0 then
    return query select 0, null::numeric, array['Those dates are all weekends or public holidays, so no leave is needed'];
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
        t.name, trim_scale(pol.max_days_per_request), v_days);
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
        v_days);
    end if;
  end if;

  return query select v_days, v_free, v_problems;
end $$;
revoke all on function public.leave_request_problems(uuid, text, text, date, date, boolean, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Kenyan defaults for new companies
-- ---------------------------------------------------------------------------------------------
create or replace function public.seed_default_leave_types(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.leave_types (tenant_id, name, description, is_deductible, is_continuous, icon)
  values
    (p_tenant, 'Annual Leave', 'Yearly leave, earned month by month (Employment Act: 21 working days)', true, true, 'Sun'),
    (p_tenant, 'Sick Leave', 'Time off when unwell, with a report from a registered medical practitioner', true, true, 'Heart'),
    (p_tenant, 'Compassionate Leave (immediate family)', 'Bereavement in the immediate family, per bereavement', true, true, 'HeartHandshake'),
    (p_tenant, 'Compassionate Leave (extended family)', 'Bereavement in the extended family, per bereavement', true, true, 'HeartHandshake'),
    (p_tenant, 'Maternity Leave', 'Three months for new mothers', false, true, 'Baby'),
    (p_tenant, 'Paternity Leave', 'Two weeks for new fathers', false, true, 'Baby'),
    (p_tenant, 'Adoption Leave', 'One month when adopting a child', false, true, 'Baby'),
    (p_tenant, 'Study/Exam Leave', 'Time off for study or examinations (optional: remove it if you don''t offer it)', true, true, 'book'),
    (p_tenant, 'Unpaid Leave', 'Leave without pay', true, true, 'calendar')
  on conflict (tenant_id, name) where tenant_id is not null do nothing;

  insert into public.leave_policies (tenant_id, leave_type_id, days_allotted, accrual_method, carry_forward_max_days,
                                     reminder_days_before_year_end, reminder_min_remaining, max_days_per_request,
                                     min_notice_days, count_days, service_months_before_use)
  select p_tenant, lt.id, v.days, v.method, 0, v.remind_days, v.remind_min, v.per_request, v.notice, v.count_days, v.service
  from public.leave_types lt
  join (values
    -- (name, days, method, remind days before year end, ...if this many left, most per application, notice, count, service months)
    ('Annual Leave', 21::numeric, 'monthly_cumulative', 60, 14::numeric, null::numeric, 0, 'working', 2),
    ('Sick Leave', 14::numeric, 'annual', 0, 0::numeric, null::numeric, 0, 'working', 0),
    ('Compassionate Leave (immediate family)', null::numeric, 'none', 0, 0::numeric, 10::numeric, 0, 'working', 0),
    ('Compassionate Leave (extended family)', null::numeric, 'none', 0, 0::numeric, 3::numeric, 0, 'working', 0),
    ('Maternity Leave', 90::numeric, 'annual', 0, 0::numeric, null::numeric, 7, 'calendar', 0),
    ('Paternity Leave', 14::numeric, 'annual', 0, 0::numeric, null::numeric, 0, 'calendar', 0),
    ('Adoption Leave', 30::numeric, 'annual', 0, 0::numeric, null::numeric, 0, 'calendar', 0),
    ('Study/Exam Leave', 10::numeric, 'annual', 0, 0::numeric, null::numeric, 0, 'working', 0)
  ) as v(name, days, method, remind_days, remind_min, per_request, notice, count_days, service) on v.name = lt.name
  where lt.tenant_id = p_tenant
    and not exists (select 1 from public.leave_policies p where p.leave_type_id = lt.id);
end;
$$;
revoke all on function public.seed_default_leave_types(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
