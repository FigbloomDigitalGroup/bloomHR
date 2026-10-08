-- Voluntary deductions: SACCO, insurance, welfare, loan repayments, union dues... set up per company and per employee.
--
-- Payroll used to take a fixed KSh 300 "welfare" from everyone and nothing else (the code said "REMOVED VOLUNTARY
-- DEDUCTIONS"). Now:
--
--   deduction_types(tenant_id, name, active)                 the company's list (archived types stay on old payslips)
--   employee_deductions(tenant_id, employee_number, deduction_type_id, amount, start_period, end_period, notes)
--       taken every month from start_period (or always, if empty) to end_period (or until removed), both 'YYYY-MM'
--   salary_history.deduction_items                           the deductions on that payslip: [{"name", "amount"}]
--
-- Companies whose payslips took the fixed welfare get a "Welfare" type, and each of their employees a welfare deduction
-- of the same amount, so their next payroll comes out the same until finance changes it.

create table if not exists public.deduction_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists deduction_types_tenant_name on public.deduction_types (tenant_id, lower(btrim(name)));

create table if not exists public.employee_deductions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null,
  deduction_type_id uuid not null references public.deduction_types(id) on delete restrict,
  amount numeric not null check (amount > 0),
  start_period text check (start_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  end_period text check (end_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  notes text,
  created_at timestamptz not null default now(),
  check (start_period is null or end_period is null or start_period <= end_period)
);

create index if not exists employee_deductions_tenant_employee on public.employee_deductions (tenant_id, employee_number);

-- a deduction's type must belong to the same company
create or replace function public.employee_deduction_same_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.deduction_types where id = new.deduction_type_id and tenant_id = new.tenant_id) then
    raise exception 'Unknown deduction type';
  end if;
  return new;
end $$;

drop trigger if exists employee_deduction_same_tenant on public.employee_deductions;
create trigger employee_deduction_same_tenant before insert or update on public.employee_deductions
  for each row execute function public.employee_deduction_same_tenant();

do $$
declare t text;
begin
  foreach t in array array['deduction_types', 'employee_deductions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    -- managed from the payroll page
    execute format('drop policy if exists module_access on public.%I', t);
    execute format($p$create policy module_access on public.%I for all to authenticated
      using (public.has_module('payroll')) with check (public.has_module('payroll'))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- renumbering an employee follows through to their deductions
create or replace function public.employee_deductions_follow_renumber() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.employee_deductions set employee_number = new."Employee Number"
  where tenant_id = new.tenant_id and employee_number = old."Employee Number";
  return new;
end $$;

drop trigger if exists employee_deductions_follow_renumber on public.employees;
create trigger employee_deductions_follow_renumber
  after update of "Employee Number" on public.employees
  for each row when (old."Employee Number" is distinct from new."Employee Number")
  execute function public.employee_deductions_follow_renumber();

alter table public.salary_history add column if not exists deduction_items jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------------------------
-- the fixed welfare, as data
-- ---------------------------------------------------------------------------------------------
with welfare as (
  select distinct on (tenant_id) tenant_id, welfare_deduction as amount
  from public.salary_history
  where welfare_deduction > 0
  order by tenant_id, pay_period desc, created_at desc
), new_types as (
  insert into public.deduction_types (tenant_id, name)
  select tenant_id, 'Welfare' from welfare
  on conflict do nothing
  returning id, tenant_id
)
insert into public.employee_deductions (tenant_id, employee_number, deduction_type_id, amount, notes)
select e.tenant_id, e."Employee Number", nt.id, w.amount, 'Was a fixed deduction for everyone'
from new_types nt
join welfare w on w.tenant_id = nt.tenant_id
join public.employees e on e.tenant_id = nt.tenant_id
where e."Employee Number" is not null and btrim(e."Employee Number") <> '';
