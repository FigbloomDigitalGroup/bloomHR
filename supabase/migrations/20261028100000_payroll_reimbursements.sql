-- Reimbursements on the payroll page: per diem, mileage and the company's own columns, typed in for each employee
-- each month and added to net pay after deductions. Not pay: no PAYE, NSSF, SHIF or housing levy, and not on the P10.
--
-- Finance's feedback (Oct 28): the Run tab shows each deduction in its own column, and the per diem and mileage they
-- pay back are typed in on the payroll page rather than worked out:
--
--   reimbursement_types(tenant_id, name, position, active, from_job_group)
--       the company's columns. Each company starts with Per diem and Mileage, and adds its own (Fuel, Airtime...).
--       A removed column is paused (active = false), so payslips and amounts already entered keep their name.
--       from_job_group: the column is filled every month with the employee's job group's per diem (Per diem's is).
--   job_group_rates.per_diem
--       the monthly per diem the company gives a job group, dated like the group's other pay (0 = none)
--   employee_reimbursements(tenant_id, employee_number, reimbursement_type_id, pay_period, amount)
--       what one employee is paid back for one month ('YYYY-MM'), one amount per column, typed in on the payroll
--       page. In the job group column it replaces the group's amount for that month (0 = none that month).
--   salary_history.reimbursement_items   the reimbursements on that payslip: [{"name", "amount"}]
--   salary_history.reimbursements        their total, part of net_pay (net pay = gross pay - deductions + this)
--
-- Payroll users (the 'payroll' module) manage them, like earnings and deductions.
--
-- The per diem that was part of basic salary (per_diem_rate, a non-taxed 33% share of basic) is replaced by the job
-- group's per diem from October 2026: the platform's Kenya default is 0 from 2026-10-01. Approved months keep their payslips;
-- a draft October is flagged for recalculation. A company that still wants a share of basic untaxed sets its own rate
-- on the Rates tab.

-- ---------------------------------------------------------------------------------------------
-- the columns and the amounts
-- ---------------------------------------------------------------------------------------------
create table if not exists public.reimbursement_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(name) <= 40),
  position integer not null default 0,
  active boolean not null default true,
  from_job_group boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists reimbursement_types_tenant_name on public.reimbursement_types (tenant_id, lower(btrim(name)));
-- one column per company is filled from the job groups
create unique index if not exists reimbursement_types_job_group on public.reimbursement_types (tenant_id) where from_job_group;

create table if not exists public.employee_reimbursements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null check (btrim(employee_number) <> ''),
  reimbursement_type_id uuid not null references public.reimbursement_types(id) on delete restrict,
  pay_period text not null check (pay_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount numeric(14, 2) not null check (amount >= 0),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, employee_number, reimbursement_type_id, pay_period)
);

create index if not exists employee_reimbursements_tenant_period on public.employee_reimbursements (tenant_id, pay_period);

-- a reimbursement's column must belong to the same company
create or replace function public.employee_reimbursement_same_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.reimbursement_types where id = new.reimbursement_type_id and tenant_id = new.tenant_id) then
    raise exception 'Unknown reimbursement';
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists employee_reimbursement_same_tenant on public.employee_reimbursements;
create trigger employee_reimbursement_same_tenant before insert or update on public.employee_reimbursements
  for each row execute function public.employee_reimbursement_same_tenant();

do $$
declare t text;
begin
  foreach t in array array['reimbursement_types', 'employee_reimbursements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    -- managed from the payroll page
    execute format('drop policy if exists module_access on public.%I', t);
    execute format($p$create policy module_access on public.%I for all to authenticated
      using ((select public.has_module('payroll'))) with check ((select public.has_module('payroll')))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- renumbering an employee follows through to their reimbursements
create or replace function public.employee_reimbursements_follow_renumber() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.employee_reimbursements set employee_number = new."Employee Number"
  where tenant_id = new.tenant_id and employee_number = old."Employee Number";
  return new;
end $$;

drop trigger if exists employee_reimbursements_follow_renumber on public.employees;
create trigger employee_reimbursements_follow_renumber
  after update of "Employee Number" on public.employees
  for each row when (old."Employee Number" is distinct from new."Employee Number")
  execute function public.employee_reimbursements_follow_renumber();

alter table public.salary_history add column if not exists reimbursement_items jsonb not null default '[]'::jsonb;
alter table public.salary_history add column if not exists reimbursements numeric(14, 2) not null default 0;

-- ---------------------------------------------------------------------------------------------
-- every company starts with Per diem and Mileage
-- ---------------------------------------------------------------------------------------------
create or replace function public.ensure_reimbursement_types(p_tenant uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.reimbursement_types (tenant_id, name, position, from_job_group)
  select p_tenant, v.name, v.position, v.from_job_group
  from (values ('Per diem', 1, true), ('Mileage', 2, false)) as v(name, position, from_job_group)
  where not exists (select 1 from public.reimbursement_types t where t.tenant_id = p_tenant)
$$;

revoke all on function public.ensure_reimbursement_types(uuid) from public, anon, authenticated;

create or replace function public.reimbursement_types_for_new_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_reimbursement_types(new.id);
  return null;
end $$;

drop trigger if exists reimbursement_types_for_new_company on public.tenants;
create trigger reimbursement_types_for_new_company after insert on public.tenants
  for each row execute function public.reimbursement_types_for_new_company();

do $$
declare r record;
begin
  for r in select id from public.tenants loop
    perform public.ensure_reimbursement_types(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- each job group's monthly per diem, and the job groups screen shows it
-- ---------------------------------------------------------------------------------------------
alter table public.job_group_rates add column if not exists per_diem numeric(14, 2) not null default 0 check (per_diem >= 0);

drop function if exists public.job_groups_overview();
create function public.job_groups_overview()
returns table (
  id uuid, code text, name text, active boolean, employee_count integer,
  effective_from date, basic_salary numeric, basic_min numeric, basic_max numeric,
  house_allowance numeric, travel_allowance numeric, other_allowances numeric, per_diem numeric,
  next_effective_from date
)
language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_tenant_id();
begin
  if t is null or not public.manages_job_groups() then
    raise exception 'You may not see job groups' using errcode = '42501';
  end if;
  return query
  select j.id, j.code, j.name, j.active,
    (select count(*)::integer from public.employees e where e.tenant_id = t and e.job_group_id = j.id),
    r.effective_from, r.basic_salary, r.basic_min, r.basic_max, r.house_allowance, r.travel_allowance, r.other_allowances, r.per_diem,
    (select min(n.effective_from) from public.job_group_rates n where n.job_group_id = j.id and n.effective_from > current_date)
  from public.job_groups j
  left join lateral (
    select x.* from public.job_group_rates x
    where x.job_group_id = j.id and x.effective_from <= current_date
    order by x.effective_from desc limit 1
  ) r on true
  where j.tenant_id = t
  order by j.active desc, lower(j.code);
end $$;
revoke all on function public.job_groups_overview() from public, anon;
grant execute on function public.job_groups_overview() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- the per diem share of basic salary ends: 0 from October 2026 (the typed-in per diem replaces it)
-- ---------------------------------------------------------------------------------------------
update public.statutory_rates set effective_to = date '2026-09-30'
where tenant_id is null and lower(country) = 'kenya' and code = 'per_diem_rate'
  and effective_from < date '2026-10-01' and (effective_to is null or effective_to >= date '2026-10-01');

insert into public.statutory_rates (tenant_id, country, code, value, bands, effective_from, effective_to, source)
select null, 'Kenya', 'per_diem_rate', 0, null, date '2026-10-01', null,
       'Per diem is now typed in on the payroll page as a reimbursement, not a share of basic salary (set your own share on the Rates tab)'
where not exists (
  select 1 from public.statutory_rates r
  where r.tenant_id is null and lower(r.country) = 'kenya' and r.code = 'per_diem_rate' and r.effective_from = date '2026-10-01'
);
