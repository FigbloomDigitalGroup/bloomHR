-- Bonuses and incentives: one-off or recurring earnings on top of salary, set up per company and per employee.
--
-- Payroll used to hard-code commission and bonus to 0, so there was no way to pay either. Now (the earnings
-- counterpart of voluntary deductions, 20261008300000):
--
--   earning_types(tenant_id, name, taxable, pensionable, description, active)
--       the company's kinds of earnings. Each company starts with Bonus, Commission, Performance incentive,
--       Sales incentive, Overtime adjustment, Arrears, Leave pay and Gratuity.
--       taxable      counts towards PAYE taxable pay (bonuses, commissions and incentives are taxable cash pay in Kenya)
--       pensionable  counts towards the pay NSSF is worked out on
--       Every earning is cash pay, so SHIF and the housing levy are worked out on it either way.
--   employee_earnings(tenant_id, employee_number, earning_type_id, amount, start_period, end_period, notes, created_by)
--       paid in every month from start_period to end_period ('YYYY-MM'); a one-off earning has both the same,
--       a recurring one may leave end_period empty (until removed)
--   salary_history.earning_items   the earnings on that payslip: [{"name", "amount", "taxable", "pensionable"}]
--
-- Payroll users (the 'payroll' module: payroll, HR, admin) manage them. Staff see their own earnings on their published
-- payslips (salary_history.earning_items), not here, so an earning entered for a month that hasn't been paid stays
-- private until the payslip is published.

create table if not exists public.earning_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  taxable boolean not null default true,
  pensionable boolean not null default true,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists earning_types_tenant_name on public.earning_types (tenant_id, lower(btrim(name)));

create table if not exists public.employee_earnings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null check (btrim(employee_number) <> ''),
  earning_type_id uuid not null references public.earning_types(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  start_period text not null check (start_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  end_period text check (end_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_period is null or start_period <= end_period)
);

create index if not exists employee_earnings_tenant_employee on public.employee_earnings (tenant_id, employee_number);
create index if not exists employee_earnings_tenant_period on public.employee_earnings (tenant_id, start_period);

-- an earning's type must belong to the same company
create or replace function public.employee_earning_same_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.earning_types where id = new.earning_type_id and tenant_id = new.tenant_id) then
    raise exception 'Unknown earning type';
  end if;
  return new;
end $$;

drop trigger if exists employee_earning_same_tenant on public.employee_earnings;
create trigger employee_earning_same_tenant before insert or update on public.employee_earnings
  for each row execute function public.employee_earning_same_tenant();

do $$
declare t text;
begin
  foreach t in array array['earning_types', 'employee_earnings'] loop
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

-- renumbering an employee follows through to their earnings
create or replace function public.employee_earnings_follow_renumber() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.employee_earnings set employee_number = new."Employee Number"
  where tenant_id = new.tenant_id and employee_number = old."Employee Number";
  return new;
end $$;

drop trigger if exists employee_earnings_follow_renumber on public.employees;
create trigger employee_earnings_follow_renumber
  after update of "Employee Number" on public.employees
  for each row when (old."Employee Number" is distinct from new."Employee Number")
  execute function public.employee_earnings_follow_renumber();

alter table public.salary_history add column if not exists earning_items jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------------------------
-- every company's starting list
-- ---------------------------------------------------------------------------------------------
create or replace function public.ensure_earning_types(p_tenant uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.earning_types (tenant_id, name, taxable, pensionable, description)
  select p_tenant, v.name, v.taxable, v.pensionable, v.description
  from (values
    ('Bonus', true, true, 'A one-off or periodic bonus'),
    ('Commission', true, true, 'Commission on sales or business brought in'),
    ('Performance incentive', true, true, 'Pay for meeting performance targets'),
    ('Sales incentive', true, true, 'Pay for meeting sales targets'),
    ('Overtime adjustment', true, true, 'Overtime not paid in an earlier month, or a correction to it'),
    ('Arrears', true, true, 'Pay owed from earlier months, such as a backdated raise'),
    ('Leave pay', true, true, 'Pay for leave days not taken'),
    ('Gratuity', true, false, 'A lump sum at the end of a contract or of service')
  ) as v(name, taxable, pensionable, description)
  where not exists (select 1 from public.earning_types t where t.tenant_id = p_tenant)
$$;

revoke all on function public.ensure_earning_types(uuid) from public, anon, authenticated;

create or replace function public.earning_types_for_new_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_earning_types(new.id);
  return null;
end $$;

drop trigger if exists earning_types_for_new_company on public.tenants;
create trigger earning_types_for_new_company after insert on public.tenants
  for each row execute function public.earning_types_for_new_company();

do $$
declare r record;
begin
  for r in select id from public.tenants loop
    perform public.ensure_earning_types(r.id);
  end loop;
end $$;

-- who added, changed or removed an employee's earning is audited, like recorded work (the types are not, so a new
-- company's starting list doesn't fill its audit log)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'audit_row_change' and pronamespace = 'public'::regnamespace) then
    drop trigger if exists audit_employee_earnings on public.employee_earnings;
    create trigger audit_employee_earnings after insert or update or delete on public.employee_earnings
      for each row execute function public.audit_row_change();
  end if;
end $$;

notify pgrst, 'reload schema';
