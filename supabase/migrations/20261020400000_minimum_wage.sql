-- Piece rate and contract jobs, stage 6: a minimum wage check (FIG-812). A warning only: nothing is ever blocked.
--
-- The decision: one set monthly minimum wage per country, which each company enters itself (no regions, no
-- occupations, no amounts seeded by Figbloom). Payroll warns before approving a month when someone is paid below it.
--
--   minimum_wages                    per company: country, monthly amount, currency (KES / TZS / UGX by country when
--                                    left out), the date it takes effect, notes. A new amount is a new row with a later
--                                    date, so the history stays. Payroll and HR write it; payroll, HR and the people who
--                                    run work and casuals read it.
--   company_payroll_settings
--     .minimum_wage_check            (default on) warn when pay is below the minimum; it only warns once an amount is set
--     .minimum_wage_days             (default 26) working days in a month: the per-day minimum for people paid by the day
--                                    or by work is the monthly amount / this
--   employee_country(tenant, emp)    the country whose minimum applies to an employee. For now the company's country
--                                    (company_profile.country, Kenya when not set), as public holidays read it. Staff in
--                                    several countries ("country as branches") will change only this helper.
--   minimum_wage_for(tenant, country, day)   the amount in force in a country on a day (the latest effective_from on or
--                                    before it), or nothing
--   minimum_wage_settings(day)       the signed-in company's check, days, country and the company-country amount in force
--   employee_minimum_wages(day)      per employee: country, monthly minimum and per-day minimum in force on that day
--   minimum_wage_work_month(month)   per worker: distinct days with approved work entries in the month, the month's
--                                    approved work and contract jobs (for the per-day comparison)
--
-- The comparison itself is worked out in the browser (lib/minimumWage), like the rest of the payroll:
--   * salaried employees: basic salary (plus any work or jobs that month) against the monthly amount
--   * paid by work: work + jobs gross against the per-day minimum x days they recorded approved work that month
--   * casual workers: their daily rate against the per-day minimum (Casual workers page and casual pay runs)
--   * contractors are not checked (a contract for service)
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the settings
-- ---------------------------------------------------------------------------------------------
alter table public.company_payroll_settings
  add column if not exists minimum_wage_check boolean not null default true,
  add column if not exists minimum_wage_days integer not null default 26;

alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_minimum_wage_days_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_minimum_wage_days_check
  check (minimum_wage_days between 1 and 31);

-- ---------------------------------------------------------------------------------------------
-- 2. the amounts
-- ---------------------------------------------------------------------------------------------
create or replace function public.minimum_wage_currency(p_country text) returns text
language sql immutable as $$
  select case lower(btrim(coalesce(p_country, '')))
    when 'tanzania' then 'TZS'
    when 'uganda' then 'UGX'
    when 'rwanda' then 'RWF'
    else 'KES' end
$$;

create table if not exists public.minimum_wages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  country text not null check (btrim(country) <> ''),
  monthly_amount numeric(14, 2) not null check (monthly_amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  effective_from date not null,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists minimum_wages_one_per_day
  on public.minimum_wages (tenant_id, lower(btrim(country)), effective_from);

-- the country is kept tidy and the currency follows it when left out
create or replace function public.minimum_wages_fill() returns trigger
language plpgsql set search_path = public as $$
begin
  new.country := btrim(new.country);
  if new.currency is null or btrim(new.currency) = '' then
    new.currency := public.minimum_wage_currency(new.country);
  end if;
  new.currency := upper(btrim(new.currency));
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists minimum_wages_fill on public.minimum_wages;
create trigger minimum_wages_fill before insert or update on public.minimum_wages
  for each row execute function public.minimum_wages_fill();

alter table public.minimum_wages enable row level security;
drop policy if exists tenant_isolation on public.minimum_wages;
create policy tenant_isolation on public.minimum_wages as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
-- payroll and HR keep them; the people who run work and casuals read them too (for the warnings)
drop policy if exists payroll_read on public.minimum_wages;
create policy payroll_read on public.minimum_wages for select to authenticated
  using ((select public.has_any_module('payroll', 'employees', 'work-records')));
drop policy if exists payroll_insert on public.minimum_wages;
create policy payroll_insert on public.minimum_wages for insert to authenticated
  with check ((select public.has_any_module('payroll', 'employees')));
drop policy if exists payroll_update on public.minimum_wages;
create policy payroll_update on public.minimum_wages for update to authenticated
  using ((select public.has_any_module('payroll', 'employees')))
  with check ((select public.has_any_module('payroll', 'employees')));
drop policy if exists payroll_delete on public.minimum_wages;
create policy payroll_delete on public.minimum_wages for delete to authenticated
  using ((select public.has_any_module('payroll', 'employees')));
revoke all on public.minimum_wages from anon;
revoke truncate on public.minimum_wages from authenticated;
grant select, insert, update, delete on public.minimum_wages to authenticated;

drop trigger if exists audit_minimum_wages on public.minimum_wages;
create trigger audit_minimum_wages after insert or update or delete on public.minimum_wages
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- 3. helpers
-- ---------------------------------------------------------------------------------------------
-- the country whose minimum wage applies to an employee: the company's for now (Kenya when not set)
create or replace function public.employee_country(p_tenant uuid, p_employee_number text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(p.country), '') from public.company_profile p where p.tenant_id = p_tenant), 'Kenya')
$$;
revoke all on function public.employee_country(uuid, text) from public, anon, authenticated;

create or replace function public.minimum_wage_for(p_tenant uuid, p_country text, p_day date) returns public.minimum_wages
language sql stable security definer set search_path = public as $$
  select w.* from public.minimum_wages w
  where w.tenant_id = p_tenant and lower(btrim(w.country)) = lower(btrim(coalesce(p_country, '')))
    and w.effective_from <= coalesce(p_day, current_date)
  order by w.effective_from desc
  limit 1
$$;
revoke all on function public.minimum_wage_for(uuid, text, date) from public, anon, authenticated;

create or replace function public.minimum_wage_days(p_tenant uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select s.minimum_wage_days from public.company_payroll_settings s where s.tenant_id = p_tenant), 26)
$$;
revoke all on function public.minimum_wage_days(uuid) from public, anon, authenticated;

create or replace function public.can_see_minimum_wage() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_module('payroll', 'employees', 'work-records')
$$;
revoke all on function public.can_see_minimum_wage() from public, anon, authenticated;

-- the signed-in company's settings and the amount in force in its country (for a casual being registered, the
-- settings card)
create or replace function public.minimum_wage_settings(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_country text;
  v_days integer;
  w public.minimum_wages;
begin
  if not public.can_see_minimum_wage() then raise exception 'Only payroll and HR can see this' using errcode = '42501'; end if;
  v_country := public.employee_country(v_tenant, null);
  v_days := public.minimum_wage_days(v_tenant);
  w := public.minimum_wage_for(v_tenant, v_country, coalesce(p_day, current_date));
  return jsonb_build_object(
    'enabled', coalesce((select s.minimum_wage_check from public.company_payroll_settings s where s.tenant_id = v_tenant), true),
    'days_per_month', v_days,
    'country', v_country,
    'monthly_amount', w.monthly_amount,
    'per_day', case when w.id is null then null else round(w.monthly_amount / v_days, 2) end,
    'currency', coalesce(w.currency, public.minimum_wage_currency(v_country)),
    'effective_from', w.effective_from);
end $$;
revoke all on function public.minimum_wage_settings(date) from public, anon;
grant execute on function public.minimum_wage_settings(date) to authenticated;

-- per employee of the signed-in company: their country and the minimum in force on p_day (nulls when none is set)
create or replace function public.employee_minimum_wages(p_day date default null)
returns table (employee_number text, country text, monthly_amount numeric, per_day numeric, currency text, effective_from date)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_days integer := public.minimum_wage_days(public.current_tenant_id());
begin
  if not public.can_see_minimum_wage() then raise exception 'Only payroll and HR can see this' using errcode = '42501'; end if;
  return query
    select e."Employee Number"::text, c.country, w.monthly_amount, round(w.monthly_amount / v_days, 2),
           coalesce(w.currency, public.minimum_wage_currency(c.country)), w.effective_from
    from public.employees e
    cross join lateral (select public.employee_country(v_tenant, e."Employee Number") as country) c
    left join lateral public.minimum_wage_for(v_tenant, c.country, coalesce(p_day, current_date)) w on w.id is not null
    where e.tenant_id = v_tenant and e."Employee Number" is not null
    order by 1;
end $$;
revoke all on function public.employee_minimum_wages(date) from public, anon;
grant execute on function public.employee_minimum_wages(date) to authenticated;

-- per worker, the month p_month is in: distinct days with approved work, and the month's approved work and jobs
-- (work by its day; a job by the day it was approved, Nairobi time)
create or replace function public.minimum_wage_work_month(p_month date default null)
returns table (employee_number text, days integer, work_gross numeric, jobs_gross numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_end date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month')::date;
begin
  if not public.can_see_minimum_wage() then raise exception 'Only payroll and HR can see this' using errcode = '42501'; end if;
  return query
    with work as (
      select w.employee_number, count(distinct w.work_date)::int as days, sum(w.amount) as gross
      from public.work_entries w
      where w.tenant_id = v_tenant and w.status = 'approved' and w.work_date >= v_start and w.work_date < v_end
      group by w.employee_number
    ), jobs as (
      select j.employee_number, sum(j.amount) as gross
      from public.contract_jobs j
      where j.tenant_id = v_tenant and j.status = 'approved' and j.approved_at is not null
        and (j.approved_at at time zone 'Africa/Nairobi')::date >= v_start
        and (j.approved_at at time zone 'Africa/Nairobi')::date < v_end
      group by j.employee_number
    )
    select coalesce(w.employee_number, j.employee_number), coalesce(w.days, 0), coalesce(w.gross, 0), coalesce(j.gross, 0)
    from work w full join jobs j on j.employee_number = w.employee_number
    order by 1;
end $$;
revoke all on function public.minimum_wage_work_month(date) from public, anon;
grant execute on function public.minimum_wage_work_month(date) to authenticated;

notify pgrst, 'reload schema';
