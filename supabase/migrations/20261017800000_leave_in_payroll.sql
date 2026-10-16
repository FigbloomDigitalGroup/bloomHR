-- Half-pay and unpaid leave days come off the payslip automatically (FIG-880).
--
--   leave_types.paid                       false for leave without pay (e.g. "Unpaid Leave"). It is on the leave type,
--                                          not its policy: Unpaid Leave usually has no policy row, and whether a kind
--                                          of leave is paid doesn't change from one policy version to the next.
--                                          Types named "Unpaid..." start unpaid (existing ones now, new ones as added).
--   company_payroll_settings.leave_daily_rate_basis
--                                          a day's pay for leave deductions: 'basic_30' (basic / 30, the default)
--                                          or 'working_days' (basic / the employee's working days that month)
--   leave_pay_deductions('YYYY-MM')        per employee, the month's unpaid days and half-pay days from approved leave,
--                                          the employee's working days that month, and the applications behind them
--   salary_history.leave_deduction         what the payslip took off gross pay for them
--   salary_history.leave_items             the lines: [{"name", "kind", "leave_type", "days", "daily_rate", "amount",
--                                          "applications": [{"id", "start_date", "end_date", "days"}]}]
--
-- Payroll works the payslip out in the browser (src/lib/leavePay.ts): unpaid days x a day's pay, plus half-pay days x
-- half a day's pay, come off gross pay, so PAYE, NSSF, SHIF and the housing levy are worked out on what is left.
-- Leave approved or cancelled after the month's payroll is approved leaves those payslips alone (they are locked); it
-- shows if the month is reopened and recalculated.

-- ---------------------------------------------------------------------------------------------
-- 1. paid / unpaid leave types
-- ---------------------------------------------------------------------------------------------
alter table public.leave_types add column if not exists paid boolean not null default true;

-- once: existing "Unpaid ..." types are unpaid (re-running doesn't undo a type someone has since marked paid)
do $$
begin
  if not exists (select 1 from public.leave_types where not paid) then
    update public.leave_types set paid = false where name ~* '^\s*unpaid';
  end if;
end $$;

-- a new type named "Unpaid ..." (such as the one every new company starts with) starts unpaid
create or replace function public.leave_type_unpaid_by_name() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.name ~* '^\s*unpaid' then
    new.paid := false;
  end if;
  return new;
end $$;

drop trigger if exists leave_type_unpaid_by_name on public.leave_types;
create trigger leave_type_unpaid_by_name before insert on public.leave_types
  for each row execute function public.leave_type_unpaid_by_name();

-- ---------------------------------------------------------------------------------------------
-- 2. a day's pay
-- ---------------------------------------------------------------------------------------------
alter table public.company_payroll_settings
  add column if not exists leave_daily_rate_basis text not null default 'basic_30';
alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_leave_rate_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_leave_rate_check
  check (leave_daily_rate_basis in ('basic_30', 'working_days'));

-- ---------------------------------------------------------------------------------------------
-- 3. on the payslip
-- ---------------------------------------------------------------------------------------------
alter table public.salary_history add column if not exists leave_deduction numeric not null default 0;
alter table public.salary_history add column if not exists leave_items jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------------------------
-- 4. the month's unpaid and half-pay days
-- ---------------------------------------------------------------------------------------------
-- An application's days in the month are counted like the application (the employee's work week less holidays, or
-- every day for leave counted in calendar days). Its half-pay days are its last days (full pay is used first), so of
-- H half-pay days, the month has H less the days after the month, but no fewer than 0 and no more than its days in it.
create or replace function public.leave_pay_deductions(p_period text)
returns table (
  employee_number text,
  unpaid_days numeric,
  half_pay_days numeric,
  month_working_days numeric,
  applications jsonb
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_first date;
  v_last date;
begin
  if v_tenant is null or not public.has_module('payroll') then
    raise exception 'Only payroll can see leave deductions' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Pay period "%" should look like 2026-09 (year-month)', coalesce(p_period, '') using errcode = '22023';
  end if;
  v_first := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_last := (v_first + interval '1 month' - interval '1 day')::date;

  return query
  with apps as (
    select a.id, a."Employee Number" as emp, btrim(coalesce(a."Leave Type", '')) as leave_type, d.s, d.e,
           coalesce(a.days, 0) as days, coalesce(a.half_pay_days, 0) as h, coalesce(t.paid, true) as paid,
           coalesce(p.count_days, 'working') = 'calendar' as cal,
           lower(btrim(coalesce(a.type, ''))) = 'half day' and d.s = d.e as half
    from public.leave_application a
    cross join lateral (select public.leave_parse_date(a."Start Date") as s, public.leave_parse_date(a."End Date") as e) d
    left join public.leave_types t on t.tenant_id = a.tenant_id and t.name = btrim(coalesce(a."Leave Type", ''))
    left join public.current_leave_policies p on p.leave_type_id = t.id
    where a.tenant_id = v_tenant
      and lower(btrim(coalesce(a.status, ''))) = 'approved'
      and nullif(btrim(a."Employee Number"), '') is not null
      and d.s is not null and d.e is not null and d.e >= d.s
      and d.s <= v_last and d.e >= v_first
  ), counted as (
    select apps.*,
           -- wholly in the month: its own day count, which its half-pay days were worked out from
           case when apps.s >= v_first and apps.e <= v_last then apps.days
                else public.leave_days_for(v_tenant, apps.emp, greatest(apps.s, v_first), least(apps.e, v_last), apps.cal, apps.half)
           end as in_month,
           case when apps.e > v_last then public.leave_days_for(v_tenant, apps.emp, v_last + 1, apps.e, apps.cal, false)
                else 0 end as after_month
    from apps
  ), split as (
    select counted.*,
           case when not counted.paid then counted.in_month else 0 end as u,
           case when counted.paid then least(greatest(counted.h - counted.after_month, 0), counted.in_month) else 0 end as hp
    from counted
  )
  select split.emp,
         trim_scale(sum(split.u)),
         trim_scale(sum(split.hp)),
         public.leave_days_for(v_tenant, split.emp, v_first, v_last, false),
         jsonb_agg(jsonb_build_object(
           'id', split.id, 'leave_type', split.leave_type,
           'start_date', to_char(split.s, 'YYYY-MM-DD'), 'end_date', to_char(split.e, 'YYYY-MM-DD'),
           'days_in_month', trim_scale(split.in_month),
           'unpaid_days', trim_scale(split.u), 'half_pay_days', trim_scale(split.hp)) order by split.s, split.id)
  from split
  where split.u > 0 or split.hp > 0
  group by split.emp
  order by split.emp;
end $$;

revoke all on function public.leave_pay_deductions(text) from public, anon;
grant execute on function public.leave_pay_deductions(text) to authenticated;

notify pgrst, 'reload schema';
