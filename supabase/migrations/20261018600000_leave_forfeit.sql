-- Leave forfeit (FIG-877): the company's leave year, a deadline for carried-over days, losing or paying out the days
-- over the carry-forward cap, and a report of both.
--
-- From an HR meeting: "We allow up to 6 days to carry forward to the next year and they must be taken in the first 6
-- months of the next year; other companies are different. If more than 6 are left at the end, the extra are scrapped."
--
--   1. The leave year. company_leave_settings.leave_year_start_month (1 = January, the default) or "the same as the
--      fiscal year" (company_profile.fiscal_year_start_month). A balance's `year` is the leave year that starts in that
--      year's start month: with a July start, year 2026 runs from 1 Jul 2026 to 30 Jun 2027. leave_year_of(),
--      leave_year_start(), leave_year_end() and leave_month_of() (month 1..12 of the leave year) are used by everything
--      that maps a date to a balance: what has been earned, a joiner's part of the year, which year an application
--      counts in, the yearly reset (now on the 1st of the start month, per company), year-end reminders and the
--      "all leave used" alert. Leave that resets every month (monthly_non_cumulative) stays on calendar months.
--      With the default (January) everything works exactly as before.
--   2. carry_forward_expiry_months on the leave type's policy (0 = carried days never expire). Carried days are used
--      first. At the deadline (the leave year's start + N months) the carried days still unused are lost:
--      carried_over_days goes down by that much and a 'forfeit' adjustment records it. Leave dated on or after the
--      deadline is never taken from carried days (booking it can't count on them either).
--   3. over_cap on the policy: what happens to the days over the carry-forward cap at the yearly reset. 'forfeit' (the
--      default, as before; now recorded as a 'forfeit' adjustment) or 'pay_out': a leave_payouts row, which payroll pays
--      in the first payroll month of the new leave year (or the next one after it) as a taxable earning
--      "Leave paid out: N days" at the leave daily rate. Approving that payroll month marks it paid.
--   4. leave_forfeit_report(year): days lost (when and why) and days paid out, per employee and leave type.
--   5. carry_expiry_reminder_days on the policy (default 30): from that many days before the deadline, employees with
--      unused carried days are reminded (notification type leave_year_end_reminder, sent with the year-end reminders).
--
-- Jobs: a daily pg_cron job (run_leave_daily) runs each company's yearly reset on the 1st of its leave year and the
-- carried-days deadline; it replaces the 1 January reset. Both can be run from Leave > Settings > reset controls.

-- ---------------------------------------------------------------------------------------------
-- 1. settings
-- ---------------------------------------------------------------------------------------------
create table if not exists public.company_leave_settings (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  leave_year_start_month smallint not null default 1 check (leave_year_start_month between 1 and 12),
  same_as_fiscal_year boolean not null default false,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.company_leave_settings enable row level security;
drop policy if exists tenant_isolation on public.company_leave_settings;
create policy tenant_isolation on public.company_leave_settings as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists members_read on public.company_leave_settings;
create policy members_read on public.company_leave_settings for select to authenticated using (true);
drop policy if exists leave_write on public.company_leave_settings;
create policy leave_write on public.company_leave_settings for all to authenticated
  using ((select public.has_any_module('leaves', 'settings'))) with check ((select public.has_any_module('leaves', 'settings')));
revoke all on public.company_leave_settings from anon;
grant select, insert, update on public.company_leave_settings to authenticated;

alter table public.leave_policies add column if not exists carry_forward_expiry_months integer not null default 0;
alter table public.leave_policies add column if not exists over_cap text not null default 'forfeit';
alter table public.leave_policies add column if not exists carry_expiry_reminder_days integer not null default 30;
alter table public.leave_policies drop constraint if exists leave_policies_carry_expiry_check;
alter table public.leave_policies add constraint leave_policies_carry_expiry_check
  check (carry_forward_expiry_months between 0 and 12 and carry_expiry_reminder_days between 0 and 365);
alter table public.leave_policies drop constraint if exists leave_policies_over_cap_check;
alter table public.leave_policies add constraint leave_policies_over_cap_check check (over_cap in ('forfeit', 'pay_out'));

drop view if exists public.current_leave_policies;
create view public.current_leave_policies as
select distinct on (leave_type_id) *
from public.leave_policies
where effective_from <= current_date
order by leave_type_id, effective_from desc;
alter view public.current_leave_policies set (security_invoker = true);

-- the day the carried days' deadline was dealt with (null = not yet)
alter table public.leave_balances add column if not exists carry_expired_on date;

alter table public.leave_balance_adjustments drop constraint if exists leave_balance_adjustments_change_type_check;
alter table public.leave_balance_adjustments
  add constraint leave_balance_adjustments_change_type_check
  check (change_type in ('approval_deduction', 'approval_reversal', 'annual_reset', 'monthly_reset', 'monthly_accrual',
                         'allowance_change', 'forfeit'));
-- for 'forfeit': why ('over_cap' at the yearly reset, 'carry_expired' at the carried days' deadline) and the day
alter table public.leave_balance_adjustments add column if not exists forfeit_reason text;
alter table public.leave_balance_adjustments add column if not exists effective_on date;
alter table public.leave_balance_adjustments drop constraint if exists leave_balance_adjustments_forfeit_reason_check;
alter table public.leave_balance_adjustments add constraint leave_balance_adjustments_forfeit_reason_check
  check (forfeit_reason is null or forfeit_reason in ('over_cap', 'carry_expired'));

-- ---------------------------------------------------------------------------------------------
-- 2. the leave year
-- ---------------------------------------------------------------------------------------------
create or replace function public.leave_year_start_month(p_tenant uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when s.same_as_fiscal_year then coalesce(cp.fiscal_year_start_month, 1) else s.leave_year_start_month end
    from public.company_leave_settings s
    left join public.company_profile cp on cp.tenant_id = s.tenant_id
    where s.tenant_id = p_tenant), 1)::int
$$;
revoke all on function public.leave_year_start_month(uuid) from public, anon;
grant execute on function public.leave_year_start_month(uuid) to authenticated;

-- the leave year a date falls in: the year its leave year started
create or replace function public.leave_year_of(p_tenant uuid, p_date date) returns integer
language sql stable as $$
  select extract(year from p_date)::int
         - case when extract(month from p_date)::int < public.leave_year_start_month(p_tenant) then 1 else 0 end
$$;

-- month 1..12 of the leave year a date falls in
create or replace function public.leave_month_of(p_tenant uuid, p_date date) returns integer
language sql stable as $$
  select (extract(month from p_date)::int - public.leave_year_start_month(p_tenant) + 12) % 12 + 1
$$;

create or replace function public.leave_year_start(p_tenant uuid, p_year integer) returns date
language sql stable as $$ select make_date(p_year, public.leave_year_start_month(p_tenant), 1) $$;

create or replace function public.leave_year_end(p_tenant uuid, p_year integer) returns date
language sql stable as $$ select (public.leave_year_start(p_tenant, p_year) + interval '1 year' - interval '1 day')::date $$;

-- the balance year an application starting on p_date counts in: the leave year, or the calendar year for leave that
-- resets every month (its balance is per calendar month)
create or replace function public.leave_bucket_year(p_tenant uuid, p_method text, p_date date) returns integer
language sql stable as $$
  select case when p_method = 'monthly_non_cumulative' then extract(year from p_date)::int
              else public.leave_year_of(p_tenant, p_date) end
$$;

grant execute on function public.leave_year_of(uuid, date) to authenticated;
grant execute on function public.leave_month_of(uuid, date) to authenticated;
grant execute on function public.leave_year_start(uuid, integer) to authenticated;
grant execute on function public.leave_year_end(uuid, integer) to authenticated;
grant execute on function public.leave_bucket_year(uuid, text, date) to authenticated;

-- months of leave year p_year (starting in month p_start_month), up to month p_upto of it, someone was employed
create or replace function public.leave_service_months(p_joined date, p_year integer, p_upto integer, p_start_month integer)
returns integer
language sql immutable as $$
  select case
    when p_joined is null or p_joined < make_date(p_year, p_start_month, 1) then least(greatest(p_upto, 0), 12)
    when p_joined >= (make_date(p_year, p_start_month, 1) + interval '1 year')::date then 0
    else greatest(least(p_upto, 12) - ((extract(month from p_joined)::int - p_start_month + 12) % 12 + 1) + 1, 0)
  end
$$;

create or replace function public.leave_year_allowance(p_tenant uuid, p_employee text, p_yearly numeric, p_year integer, p_upto integer)
returns numeric
language sql stable security definer set search_path = public as $$
  select round(coalesce(p_yearly, 0)
               * public.leave_service_months(public.employee_joined(p_tenant, p_employee), p_year, p_upto,
                                             public.leave_year_start_month(p_tenant)) / 12.0, 2)
$$;

-- months of a leave year counted as earned today: this leave year -> its months so far, a past one -> 12, a future one -> 1
create or replace function public.leave_months_earned(p_tenant uuid, p_year integer) returns integer
language sql stable as $$
  select case when p_year = public.leave_year_of(p_tenant, current_date) then public.leave_month_of(p_tenant, current_date)
              when p_year < public.leave_year_of(p_tenant, current_date) then 12 else 1 end
$$;
grant execute on function public.leave_months_earned(uuid, integer) to authenticated;

create or replace function public.leave_seed_days(p_tenant uuid, p_employee text, p_method text, p_yearly numeric, p_year integer)
returns numeric
language sql stable security definer set search_path = public as $$
  select case p_method
    when 'monthly_cumulative' then public.leave_year_allowance(p_tenant, p_employee, p_yearly, p_year, public.leave_months_earned(p_tenant, p_year))
    when 'annual' then public.leave_year_allowance(p_tenant, p_employee, p_yearly, p_year, 12)
    else coalesce(p_yearly, 0)
  end
$$;

-- the current company's leave year, for the Leave page
create or replace function public.leave_year_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'start_month', public.leave_year_start_month(public.current_tenant_id()),
    'leave_year_start_month', coalesce(s.leave_year_start_month, 1),
    'same_as_fiscal_year', coalesce(s.same_as_fiscal_year, false),
    'fiscal_year_start_month', coalesce(cp.fiscal_year_start_month, 1),
    'current_year', public.leave_year_of(public.current_tenant_id(), current_date))
  from (select 1) one
  left join public.company_leave_settings s on s.tenant_id = public.current_tenant_id()
  left join public.company_profile cp on cp.tenant_id = public.current_tenant_id()
$$;
revoke all on function public.leave_year_settings() from public, anon;
grant execute on function public.leave_year_settings() to authenticated;

create or replace function public.set_leave_year_start(p_month integer, p_same_as_fiscal boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not public.has_any_module('leaves', 'settings') then
    raise exception 'Only people who run leave can change the leave year' using errcode = '42501';
  end if;
  if not coalesce(p_same_as_fiscal, false) and (p_month is null or p_month not between 1 and 12) then
    raise exception 'The leave year starts in a month from 1 (January) to 12 (December)' using errcode = '22023';
  end if;
  insert into public.company_leave_settings (tenant_id, leave_year_start_month, same_as_fiscal_year, updated_by, updated_at)
  values (v_tenant, coalesce(case when p_month between 1 and 12 then p_month end, 1), coalesce(p_same_as_fiscal, false), auth.uid(), now())
  on conflict (tenant_id) do update
    set leave_year_start_month = coalesce(case when p_month between 1 and 12 then p_month end, public.company_leave_settings.leave_year_start_month),
        same_as_fiscal_year = excluded.same_as_fiscal_year, updated_by = excluded.updated_by, updated_at = now();
  return public.leave_year_settings();
end $$;
revoke all on function public.set_leave_year_start(integer, boolean) from public, anon;
grant execute on function public.set_leave_year_start(integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. paying out days over the cap
-- ---------------------------------------------------------------------------------------------
create table if not exists public.leave_payouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  -- the leave year at whose start the days were over the cap (they were left over from the year before)
  year integer not null,
  days numeric not null check (days > 0),
  -- the first payroll month it can be paid in
  pay_period text not null check (pay_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  -- worked out by payroll: days x the leave daily rate, written when the payroll month is approved
  amount numeric,
  paid_period text,
  run_id uuid references public.payroll_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, employee_number, leave_type_id, year)
);
create index if not exists leave_payouts_run_idx on public.leave_payouts (run_id);

alter table public.leave_payouts enable row level security;
drop policy if exists tenant_isolation on public.leave_payouts;
create policy tenant_isolation on public.leave_payouts as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists module_read on public.leave_payouts;
create policy module_read on public.leave_payouts for select to authenticated
  using ((select public.has_any_module('leaves', 'payroll')));
drop policy if exists module_write on public.leave_payouts;
create policy module_write on public.leave_payouts for all to authenticated
  using ((select public.has_any_module('leaves'))) with check ((select public.has_any_module('leaves')));
revoke all on public.leave_payouts from anon;
grant select, insert, update, delete on public.leave_payouts to authenticated;

-- At the yearly reset, the days over the carry-forward cap: recorded as lost, or to be paid out. Runs as the caller
-- (RLS keeps HR inside their company); from pg_cron, for every company.
create or replace function public.leave_settle_over_cap(
  p_tenant uuid, p_employee text, p_type uuid, p_new_row uuid, p_year integer,
  p_prev_remaining numeric, p_cap numeric, p_over_cap text
) returns numeric
language plpgsql as $$
declare
  v_over numeric := greatest(coalesce(p_prev_remaining, 0) - greatest(coalesce(p_cap, 0), 0), 0);
  v_on date := public.leave_year_start(p_tenant, p_year);
  b public.leave_balances;
begin
  if v_over <= 0 then
    return 0;
  end if;
  if p_over_cap = 'pay_out' then
    insert into public.leave_payouts (tenant_id, employee_number, leave_type_id, year, days, pay_period)
    values (p_tenant, p_employee, p_type, p_year, v_over, to_char(v_on, 'YYYY-MM'))
    on conflict (tenant_id, employee_number, leave_type_id, year) do nothing;
  else
    select * into b from public.leave_balances where id = p_new_row;
    insert into public.leave_balance_adjustments
      (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before,
       accrued_days_after, reason, forfeit_reason, effective_on)
    values
      (p_tenant, p_new_row, 'forfeit', -v_over, b.used_days, b.used_days, b.accrued_days, b.accrued_days,
       format('%s unused day(s) from %s were over the carry-forward cap of %s and were lost', trim_scale(v_over),
              p_year - 1, trim_scale(greatest(coalesce(p_cap, 0), 0))),
       'over_cap', v_on);
  end if;
  return v_over;
end $$;
grant execute on function public.leave_settle_over_cap(uuid, text, uuid, uuid, integer, numeric, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. the engine, by leave year
-- ---------------------------------------------------------------------------------------------
-- p_year is a leave year (each company's own); p_tenant limits it to one company (the daily job, on its start day)
drop function if exists public.run_annual_leave_reset(integer);
create or replace function public.run_annual_leave_reset(p_year integer, p_tenant uuid default null)
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
      cp.over_cap,
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
      and coalesce(e.worker_kind, 'employee') <> 'casual'
      and (p_tenant is null or e.tenant_id = p_tenant)
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
      perform public.leave_settle_over_cap(r.tenant_id, r.employee_number, r.leave_type_id, v_new_row.id, p_year,
        r.prev_remaining, r.carry_forward_max_days, r.over_cap);
      return next v_new_row;
    end if;
  end loop;
end;
$$;
grant execute on function public.run_annual_leave_reset(integer, uuid) to authenticated;

-- p_year / p_month is a calendar month: each company earns up to the month of its leave year that it falls in
create or replace function public.run_leave_accrual(p_year integer, p_month integer)
returns setof public.leave_balances
language plpgsql
as $$
declare
  r record;
  v_date date := make_date(p_year, least(greatest(coalesce(p_month, 1), 1), 12), 1);
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
      cp.over_cap,
      y.ly,
      y.lm,
      prev.remaining_days as prev_remaining
    from public.employees e
    cross join lateral (select public.leave_year_of(e.tenant_id, v_date) as ly, public.leave_month_of(e.tenant_id, v_date) as lm) y
    join public.leave_types lt on lt.tenant_id = e.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = e.tenant_id
    left join public.leave_balances prev
      on prev.employee_number = e."Employee Number"
     and prev.tenant_id = e.tenant_id
     and prev.leave_type_id = lt.id
     and prev.year = y.ly - 1
     and prev.month = 0
    where lt.is_deductible = true
      and cp.accrual_method = 'monthly_cumulative'
      and coalesce(e.worker_kind, 'employee') <> 'casual'
  loop
    -- earned from the month they joined (or the leave year's start) to this month of the leave year
    v_due := public.leave_year_allowance(r.tenant_id, r.employee_number,
      public.leave_entitlement(r.tenant_id, r.employee_number, r.leave_type_id, r.days_allotted), r.ly, r.lm);

    select * into v_row from public.leave_balances b
    where b.employee_number = r.employee_number and b.leave_type_id = r.leave_type_id and b.year = r.ly and b.month = 0;

    if not found then
      v_carry := greatest(least(coalesce(r.prev_remaining, 0), r.carry_forward_max_days), 0);
      insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days, last_accrual_date)
      values (r.tenant_id, r.employee_number, r.leave_type_id, r.ly, 0, v_due, 0, v_carry, current_date)
      returning * into v_row;
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_row.id, 'monthly_accrual', v_due + v_carry, 0, 0, 0, v_due,
         format('Year %s started: %s days earned so far + %s carried forward from %s', r.ly, v_due, v_carry, r.ly - 1));
      perform public.leave_settle_over_cap(r.tenant_id, r.employee_number, r.leave_type_id, v_row.id, r.ly,
        r.prev_remaining, r.carry_forward_max_days, r.over_cap);
      return next v_row;
    elsif v_row.accrued_days < v_due then
      v_old := v_row.accrued_days;
      update public.leave_balances set accrued_days = v_due, last_accrual_date = current_date, updated_at = now()
      where id = v_row.id returning * into v_row;
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_row.id, 'monthly_accrual', v_due - v_old, v_row.used_days, v_row.used_days, v_old, v_due,
         format('Earned %s days by month %s of %s', v_due, r.lm, r.ly));
      return next v_row;
    end if;
  end loop;
end;
$$;
grant execute on function public.run_leave_accrual(integer, integer) to authenticated;

create or replace function public.set_leave_entitlement(p_employee_number text, p_leave_type_id uuid, p_days numeric, p_year integer default null)
returns public.leave_balances
language plpgsql
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_year integer := coalesce(p_year, public.leave_year_of(public.current_tenant_id(), current_date));
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

-- ---------------------------------------------------------------------------------------------
-- 5. carried days: used first, lost at the deadline
-- ---------------------------------------------------------------------------------------------
-- For one balance with carried days and a deadline not yet dealt with: the deadline, and how many carried days would
-- be lost at it. Carried days are used first, but only by leave before the deadline: approved leave starting on or
-- after it (p_exclude: an application being checked) doesn't use them. Runs as the caller.
create or replace function public.leave_carry_expiring(p_tenant uuid, p_employee text, p_type uuid, p_year integer, p_exclude uuid default null)
returns table (expires_on date, lost numeric)
language plpgsql stable as $$
declare
  pol record;
  t public.leave_types;
  b public.leave_balances;
  v_exp date;
  v_later numeric;
begin
  select * into pol from public.current_leave_policies p where p.leave_type_id = p_type;
  if pol.leave_type_id is null or coalesce(pol.carry_forward_expiry_months, 0) <= 0
     or pol.accrual_method not in ('annual', 'monthly_cumulative') then
    return;
  end if;
  select * into b from public.leave_balances x
  where x.tenant_id = p_tenant and x.employee_number = p_employee and x.leave_type_id = p_type and x.year = p_year and x.month = 0;
  if b.id is null or coalesce(b.carried_over_days, 0) <= 0 or b.carry_expired_on is not null then
    return;
  end if;
  select * into t from public.leave_types where id = p_type;
  v_exp := (public.leave_year_start(p_tenant, p_year) + make_interval(months => pol.carry_forward_expiry_months))::date;
  select coalesce(sum(a.days), 0) into v_later
  from public.leave_application a
  where a.tenant_id = p_tenant and a."Employee Number" = p_employee and btrim(coalesce(a."Leave Type", '')) = t.name
    and lower(btrim(coalesce(a.status, ''))) = 'approved'
    and a.id is distinct from p_exclude
    and public.leave_parse_date(a."Start Date") >= v_exp
    and public.leave_parse_date(a."Start Date") < public.leave_year_start(p_tenant, p_year + 1);
  return query select v_exp, greatest(b.carried_over_days - greatest(b.used_days - v_later, 0), 0);
end $$;
grant execute on function public.leave_carry_expiring(uuid, text, uuid, integer, uuid) to authenticated;

-- The deadline, for every balance that has reached it: the unused carried days are lost and recorded. Safe to run any
-- number of times. HR runs it for their company; pg_cron for every company.
create or replace function public.run_leave_carry_expiry(p_today date default current_date)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  r record;
  x record;
  v_n integer := 0;
begin
  if auth.uid() is not null then
    if not public.has_module('leaves') then
      raise exception 'Only people who run leave can do this' using errcode = '42501';
    end if;
    v_tenant := public.current_tenant_id();
  end if;

  for r in
    select b.id, b.tenant_id, b.employee_number, b.leave_type_id, b.year, b.used_days, b.accrued_days, b.carried_over_days,
           lt.name as type_name, cp.carry_forward_expiry_months as months
    from public.leave_balances b
    join public.leave_types lt on lt.id = b.leave_type_id and lt.tenant_id = b.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = b.tenant_id
    where b.month = 0 and b.carried_over_days > 0 and b.carry_expired_on is null
      and cp.carry_forward_expiry_months > 0 and cp.accrual_method in ('annual', 'monthly_cumulative')
      and (v_tenant is null or b.tenant_id = v_tenant)
  loop
    select * into x from public.leave_carry_expiring(r.tenant_id, r.employee_number, r.leave_type_id, r.year);
    continue when x.expires_on is null or p_today < x.expires_on;

    update public.leave_balances
    set carried_over_days = carried_over_days - x.lost, carry_expired_on = x.expires_on, updated_at = now()
    where id = r.id;

    if x.lost > 0 then
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before,
         accrued_days_after, reason, forfeit_reason, effective_on)
      values
        (r.tenant_id, r.id, 'forfeit', -x.lost, r.used_days, r.used_days, r.accrued_days, r.accrued_days,
         format('%s of %s day(s) carried over from %s were not taken by %s and were lost (carried days must be used within %s month%s)',
                trim_scale(x.lost), trim_scale(r.carried_over_days), r.year - 1, to_char(x.expires_on - 1, 'DD Mon YYYY'),
                r.months, case when r.months = 1 then '' else 's' end),
         'carry_expired', x.expires_on);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.run_leave_carry_expiry(date) from public, anon;
grant execute on function public.run_leave_carry_expiry(date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. applications count in their leave year, and can't count on carried days past the deadline
-- ---------------------------------------------------------------------------------------------
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
  v_half numeric := 0;
  v_seed numeric;
  v_before public.leave_balances;
  v_after public.leave_balances;
  x record;
begin
  select * into t from public.leave_types where tenant_id = p_app.tenant_id and name = btrim(coalesce(p_app."Leave Type", ''));
  if t.id is null or not coalesce(t.is_deductible, true) or v_start is null or v_days <= 0 then
    return;
  end if;
  select * into pol from public.current_leave_policies where leave_type_id = t.id;
  if pol.leave_type_id is null or pol.accrual_method = 'none' then
    return;
  end if;
  v_year := public.leave_bucket_year(p_app.tenant_id, pol.accrual_method, v_start);
  v_month := public.leave_bucket_month(pol.accrual_method, v_start);

  if p_sign > 0 then
    v_free := public.leave_available(p_app.tenant_id, p_app."Employee Number", t.id, v_year, v_month);
    if v_free is not null then
      -- carried days still unused at the deadline are lost then: leave on or after it can't use them
      select * into x from public.leave_carry_expiring(p_app.tenant_id, p_app."Employee Number", t.id, v_year, p_app.id);
      if x.expires_on is not null and v_start >= x.expires_on then
        v_free := v_free - x.lost;
      end if;
    end if;
    if v_free is not null and v_days > v_free then
      raise exception 'Not enough % left for %: % day% free, and this leave needs %.%',
        t.name, coalesce(nullif(btrim(p_app.name), ''), p_app."Employee Number"), trim_scale(greatest(v_free, 0)),
        case when greatest(v_free, 0) = 1 then '' else 's' end, trim_scale(v_days),
        case when public.leave_half_pay_allowance(t.id) > 0
             then ' Its full-pay and half-pay days are used: they can apply for annual leave instead'
             else ' Change the allowance in Balances, or the leave type''s balance rule' end
        using errcode = 'P0001';
    end if;
    -- full-pay days first; what goes past them is at half pay
    if v_free is not null then
      v_half := least(v_days, greatest(v_days - greatest(v_free - public.leave_half_pay_allowance(t.id), 0), 0));
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
     case when p_sign > 0 then 'Leave application approved' else 'Approved leave application no longer approved' end
       || case when v_half > 0 then format(' (%s at half pay)', trim_scale(v_half)) else '' end);

  update public.leave_application set half_pay_days = case when p_sign > 0 then v_half else 0 end where id = p_app.id;
end $$;
revoke all on function public.leave_take(public.leave_application, integer) from public, anon, authenticated;

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
  v_year integer;
  v_month integer;
  v_joined date;
  v_from date;
  v_expiring numeric := 0;
  v_expires date;
  x record;
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

  v_year := public.leave_bucket_year(p_tenant, pol.accrual_method, p_start);
  v_month := public.leave_bucket_month(pol.accrual_method, p_start);
  v_free := public.leave_available(p_tenant, p_employee, t.id, v_year, v_month);
  if v_free is not null then
    select * into x from public.leave_carry_expiring(p_tenant, p_employee, t.id, v_year, p_exclude);
    if x.expires_on is not null and p_start >= x.expires_on and x.lost > 0 then
      v_expiring := x.lost;
      v_expires := x.expires_on;
      v_free := v_free - v_expiring;
    end if;
    select coalesce(sum(a.days), 0) into v_pending
    from public.leave_application a
    where a.tenant_id = p_tenant and a."Employee Number" = p_employee and a."Leave Type" = t.name
      and a.id is distinct from p_exclude
      and lower(coalesce(a.status, 'pending')) = 'pending'
      and public.leave_bucket_year(p_tenant, pol.accrual_method, public.leave_parse_date(a."Start Date")) = v_year
      and (v_month = 0 or extract(month from public.leave_parse_date(a."Start Date")) = v_month);
    v_free := v_free - v_pending;
    if v_days > v_free then
      v_problems := v_problems || (format('Not enough %s left: %s day%s free to book%s, and this needs %s',
        t.name, trim_scale(greatest(v_free, 0)), case when greatest(v_free, 0) = 1 then '' else 's' end,
        case when v_pending > 0 then format(' (%s more waiting for approval)', trim_scale(v_pending)) else '' end,
        trim_scale(v_days))
        || case when v_expiring > 0
                then format('. %s carried-over day%s must be taken by %s, so can''t be used for this leave',
                            trim_scale(v_expiring), case when v_expiring = 1 then '' else 's' end, to_char(v_expires - 1, 'DD Mon YYYY'))
                else '' end);
    end if;
  end if;

  return query select trim_scale(v_days), v_free, v_problems;
end $$;
revoke all on function public.leave_request_problems(uuid, text, text, date, date, boolean, uuid, boolean) from public, anon, authenticated;

-- "all sick and annual leave used" (20261018000000), for the leave year
create or replace function public.leave_application_exhausted_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_start date := public.leave_parse_date(new."Start Date");
  v_year integer;
  v_end date;
  v_sick numeric;
  v_annual numeric;
  e public.employees;
  who text;
begin
  if lower(coalesce(new.status, '')) <> 'approved' or (tg_op = 'UPDATE' and lower(coalesce(old.status, '')) = 'approved')
     or v_start is null or new."Leave Type" !~* '^(sick|annual)' then
    return null;
  end if;
  v_year := public.leave_year_of(new.tenant_id, v_start);
  v_end := public.leave_year_end(new.tenant_id, v_year);
  v_sick := public.leave_left_of_kind(new.tenant_id, new."Employee Number", 'sick', v_year);
  v_annual := public.leave_left_of_kind(new.tenant_id, new."Employee Number", 'annual', v_year);
  if v_sick is null or v_annual is null or v_sick > 0 or v_annual > 0 then
    return null;
  end if;
  if exists (select 1 from public.hr_notifications n
             where n.tenant_id = new.tenant_id and n.employee_number = new."Employee Number"
               and n.notification_type = 'leave_exhausted' and n.end_date = v_end) then
    return null;
  end if;
  select * into e from public.employees where tenant_id = new.tenant_id and "Employee Number" = new."Employee Number";
  who := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), new."Employee Number");
  insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date)
  values (new.tenant_id, new."Employee Number", who, e."Work Email", 'leave_exhausted', 'All sick and annual leave used',
    who || ' has used all their sick leave (half-pay days included) and all their annual leave for '
    || case when public.leave_year_start_month(new.tenant_id) = 1 then v_year::text
            else 'the leave year from ' || to_char(public.leave_year_start(new.tenant_id, v_year), 'DD Mon YYYY') end
    || '. Any more time off would be unpaid or outside policy: talk to them about next steps.',
    v_end);
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. reminders: before the leave year ends, and before carried days expire
-- ---------------------------------------------------------------------------------------------
create or replace function public.run_leave_year_end_reminders(p_today date default current_date)
returns integer
language plpgsql
as $$
declare
  r record;
  x record;
  v_lost numeric;
  v_title text;
  v_sent integer := 0;
  v_take_by date;
begin
  for r in
    select
      b.tenant_id, b.employee_number, b.remaining_days, lt.name as type_name,
      cp.carry_forward_max_days, cp.reminder_days_before_year_end, cp.reminder_min_remaining, cp.over_cap,
      e."First Name" as first_name, e."Last Name" as last_name, e."Work Email" as work_email,
      public.leave_year_end(b.tenant_id, b.year) as year_end
    from public.leave_balances b
    join public.leave_types lt on lt.id = b.leave_type_id and lt.tenant_id = b.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = b.tenant_id
    join public.employees e on e."Employee Number" = b.employee_number and e.tenant_id = b.tenant_id
    where b.year = public.leave_year_of(b.tenant_id, p_today)
      and b.month = 0
      and cp.accrual_method in ('annual', 'monthly_cumulative')
      and cp.reminder_days_before_year_end > 0
      and p_today >= public.leave_year_end(b.tenant_id, b.year) - cp.reminder_days_before_year_end
      and b.remaining_days >= cp.reminder_min_remaining
  loop
    -- only what would actually be lost (or paid out) matters: days above the carry-forward cap
    v_lost := greatest(r.remaining_days - coalesce(r.carry_forward_max_days, 0), 0);
    continue when v_lost <= 0;

    v_title := format('Take your %s before the year ends', r.type_name);
    continue when exists (
      select 1 from public.hr_notifications n
      where n.tenant_id = r.tenant_id and n.employee_number = r.employee_number
        and n.notification_type = 'leave_year_end_reminder' and n.title = v_title
        and n.created_at >= date_trunc('month', p_today)
    );

    insert into public.hr_notifications
      (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date, days_remaining, is_read_admin, created_at)
    values
      (r.tenant_id, r.employee_number, btrim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), r.work_email,
       'leave_year_end_reminder', v_title,
       case when r.over_cap = 'pay_out'
            then format('You have %s unused %s day(s). %s will not carry forward past %s and will be paid out instead%s. You can still take some leave before then.',
                        r.remaining_days, r.type_name, v_lost, to_char(r.year_end, 'DD Mon YYYY'),
                        case when coalesce(r.carry_forward_max_days, 0) > 0 then format(' (only %s can be carried forward)', r.carry_forward_max_days) else '' end)
            else format('You have %s unused %s day(s). %s will be lost on %s%s. Please plan to take some leave before then.',
                        r.remaining_days, r.type_name, v_lost, to_char(r.year_end, 'DD Mon YYYY'),
                        case when coalesce(r.carry_forward_max_days, 0) > 0 then format(' (only %s can be carried forward)', r.carry_forward_max_days) else '' end)
       end,
       r.year_end, r.year_end - p_today, true,
       case when p_today = current_date then now() else p_today::timestamptz end);
    v_sent := v_sent + 1;
  end loop;

  -- carried days about to expire
  for r in
    select
      b.tenant_id, b.employee_number, b.leave_type_id, b.year, b.carried_over_days, lt.name as type_name,
      cp.carry_expiry_reminder_days,
      e."First Name" as first_name, e."Last Name" as last_name, e."Work Email" as work_email
    from public.leave_balances b
    join public.leave_types lt on lt.id = b.leave_type_id and lt.tenant_id = b.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = b.tenant_id
    join public.employees e on e."Employee Number" = b.employee_number and e.tenant_id = b.tenant_id
    where b.year = public.leave_year_of(b.tenant_id, p_today)
      and b.month = 0
      and b.carried_over_days > 0
      and b.carry_expired_on is null
      and cp.accrual_method in ('annual', 'monthly_cumulative')
      and cp.carry_forward_expiry_months > 0
      and cp.carry_expiry_reminder_days > 0
  loop
    select * into x from public.leave_carry_expiring(r.tenant_id, r.employee_number, r.leave_type_id, r.year);
    continue when x.expires_on is null or x.lost <= 0 or p_today >= x.expires_on
      or p_today < x.expires_on - r.carry_expiry_reminder_days;
    v_take_by := x.expires_on - 1;

    v_title := format('Use your carried-over %s by %s', r.type_name, to_char(v_take_by, 'DD Mon YYYY'));
    continue when exists (
      select 1 from public.hr_notifications n
      where n.tenant_id = r.tenant_id and n.employee_number = r.employee_number
        and n.notification_type = 'leave_year_end_reminder' and n.title = v_title
        and n.created_at >= date_trunc('month', p_today)
    );

    insert into public.hr_notifications
      (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date, days_remaining, is_read_admin, created_at)
    values
      (r.tenant_id, r.employee_number, btrim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), r.work_email,
       'leave_year_end_reminder', v_title,
       format('You carried %s %s day(s) over from %s and %s of them are still unused. Carried-over days must be taken by %s: any not taken by then will be lost. Please plan to take them before then.',
              trim_scale(r.carried_over_days), r.type_name, r.year - 1, trim_scale(x.lost), to_char(v_take_by, 'DD Mon YYYY')),
       v_take_by, v_take_by - p_today, true,
       case when p_today = current_date then now() else p_today::timestamptz end);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
grant execute on function public.run_leave_year_end_reminders(date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. payroll: leave paid out
-- ---------------------------------------------------------------------------------------------
-- Payouts not yet paid that payroll for p_period can pay, with the employee's working days that month (for the
-- 'working_days' leave daily rate). The payslip adds a taxable "Leave paid out: N days" earning (src/lib/leavePay.ts).
create or replace function public.leave_payouts_due(p_period text)
returns table (id uuid, employee_number text, leave_type text, days numeric, year integer, pay_period text, month_working_days numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_first date;
  v_last date;
begin
  if v_tenant is null or not public.has_module('payroll') then
    raise exception 'Only payroll can see leave payouts' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Pay period "%" should look like 2026-09 (year-month)', coalesce(p_period, '') using errcode = '22023';
  end if;
  v_first := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_last := (v_first + interval '1 month' - interval '1 day')::date;
  return query
  select p.id, p.employee_number, t.name, trim_scale(p.days), p.year, p.pay_period,
         public.leave_days_for(v_tenant, p.employee_number, v_first, v_last, false)
  from public.leave_payouts p
  join public.leave_types t on t.id = p.leave_type_id
  where p.tenant_id = v_tenant and p.status = 'pending' and p.pay_period <= p_period
  order by p.employee_number, t.name;
end $$;
revoke all on function public.leave_payouts_due(text) from public, anon;
grant execute on function public.leave_payouts_due(text) to authenticated;

-- approving a payroll month marks the payouts on its payslips paid (with what they paid); reopening it undoes that
create or replace function public.payroll_run_leave_payouts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  if old.status = 'draft' and new.status = 'approved' then
    update public.leave_payouts p
    set status = 'paid', paid_period = new.pay_period, run_id = new.id, amount = x.amount
    from (
      select (i.item->>'leave_payout_id')::uuid as payout_id, h.employee_id, sum((i.item->>'amount')::numeric) as amount
      from public.salary_history h
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(h.earning_items) = 'array' then h.earning_items else '[]'::jsonb end) as i(item)
      where h.run_id = new.id
        and (i.item->>'leave_payout_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and (i.item->>'amount') ~ '^\d+(\.\d+)?$'
      group by 1, 2
    ) x
    where p.id = x.payout_id and p.tenant_id = new.tenant_id and p.employee_number = x.employee_id and p.status = 'pending';
  elsif old.status = 'approved' and new.status = 'draft' then
    update public.leave_payouts set status = 'pending', paid_period = null, run_id = null, amount = null
    where run_id = new.id;
  end if;
  return null;
end $$;
revoke all on function public.payroll_run_leave_payouts() from public, anon, authenticated;

drop trigger if exists payroll_run_leave_payouts on public.payroll_runs;
create trigger payroll_run_leave_payouts after update of status on public.payroll_runs
  for each row execute function public.payroll_run_leave_payouts();

-- ---------------------------------------------------------------------------------------------
-- 9. the report: days lost and days paid out
-- ---------------------------------------------------------------------------------------------
create or replace function public.leave_forfeit_report(p_year integer default null)
returns table (
  kind text,            -- 'forfeit' | 'pay_out'
  reason text,          -- 'over_cap' | 'carry_expired' (forfeits)
  employee_number text,
  employee_name text,
  leave_type text,
  year integer,         -- the leave year it happened in
  days numeric,
  on_date date,
  status text,          -- payouts: 'pending' | 'paid'
  amount numeric,
  pay_period text,
  note text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not public.has_any_module('leaves', 'payroll') then
    raise exception 'Only people who run leave can see this report' using errcode = '42501';
  end if;
  return query
  select * from (
    select 'forfeit'::text, a.forfeit_reason, b.employee_number,
           coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), b.employee_number),
           t.name, b.year, trim_scale(-a.delta_days), coalesce(a.effective_on, a.created_at::date),
           null::text, null::numeric, null::text, a.reason
    from public.leave_balance_adjustments a
    join public.leave_balances b on b.id = a.leave_balance_id
    join public.leave_types t on t.id = b.leave_type_id
    left join public.employees e on e.tenant_id = b.tenant_id and e."Employee Number" = b.employee_number
    where a.tenant_id = v_tenant and a.change_type = 'forfeit' and (p_year is null or b.year = p_year)
    union all
    select 'pay_out'::text, 'over_cap'::text, p.employee_number,
           coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), p.employee_number),
           t.name, p.year, trim_scale(p.days), public.leave_year_start(v_tenant, p.year),
           p.status, p.amount, coalesce(p.paid_period, p.pay_period),
           format('%s day(s) left over from %s over the carry-forward cap, paid out', trim_scale(p.days), p.year - 1)
    from public.leave_payouts p
    join public.leave_types t on t.id = p.leave_type_id
    left join public.employees e on e.tenant_id = p.tenant_id and e."Employee Number" = p.employee_number
    where p.tenant_id = v_tenant and (p_year is null or p.year = p_year)
  ) r
  order by 8 desc, 4, 5;
end $$;
revoke all on function public.leave_forfeit_report(integer) from public, anon;
grant execute on function public.leave_forfeit_report(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10. the daily job: each company's yearly reset on the 1st of its leave year, and the carried days' deadline
-- ---------------------------------------------------------------------------------------------
create or replace function public.run_leave_daily(p_today date default current_date) returns integer
language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_year integer;
  v_n integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'This runs on a schedule; use the reset controls on the Leave page instead' using errcode = '42501';
  end if;
  for t in select id from public.tenants loop
    v_year := public.leave_year_of(t.id, p_today);
    if public.leave_year_start(t.id, v_year) = p_today then
      perform public.run_annual_leave_reset(v_year, t.id);
      v_n := v_n + 1;
    end if;
  end loop;
  perform public.run_leave_carry_expiry(p_today);
  return v_n;
end $$;
revoke all on function public.run_leave_daily(date) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- the 1 January reset is now each company's own (in leave-daily)
    if exists (select 1 from cron.job where jobname = 'annual-leave-reset') then
      perform cron.unschedule('annual-leave-reset');
    end if;
    if exists (select 1 from cron.job where jobname = 'leave-daily') then
      perform cron.unschedule('leave-daily');
    end if;
    perform cron.schedule('leave-daily', '20 0 * * *', $c$select public.run_leave_daily();$c$);
  else
    raise notice 'pg_cron is not available: run the yearly reset and the carried-days deadline from the Leave page instead.';
  end if;
end $$;

notify pgrst, 'reload schema';
