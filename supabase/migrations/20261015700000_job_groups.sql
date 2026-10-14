-- Job groups with pay amounts, set up by each company (FIG-828).
--
-- "Job Group" was free text on each employee and every salary was typed in by hand. Each company now keeps its job
-- groups and what they pay:
--
--   job_groups(code, name, active)      the company's groups; the code is unique in the company, ignoring case
--   job_group_rates(effective_from, ...) what a group pays from a date: a fixed basic salary, or a band (minimum and
--                                       maximum), and the standard house, travel and other cash allowances. The rate
--                                       in force on a day is the latest one from on or before it.
--   employees.job_group_id              the employee's group (of the same company)
--   employees.pay_overridden            HR set this employee's pay by hand, with pay_override_reason
--
-- An employee on a group whose pay is not overridden is paid the group's current rate: choosing the group fills
-- "Basic Salary" (a band keeps the salary, moved into the band), house_allowance, travel_allowance and
-- other_cash_allowances, and so does every later save. A new or changed rate updates those employees at once when it
-- is already in force, otherwise on the day it starts (a daily job; "apply_job_group_rate" does it by hand). Payroll
-- keeps reading the employee record. A rate can't start in a month whose payroll run is approved or paid.
-- "Job Group" (text, read by payslips, contracts and reports) is kept as the group's code.
--
-- Only ADMIN and people with the Payroll or Employees module see or change job groups and their amounts.
-- Existing groups are made from each company's distinct "Job Group" texts (without amounts) and employees linked.

-- ---------------------------------------------------------------------------------------------
-- 1. tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.job_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);
create unique index if not exists job_groups_tenant_code on public.job_groups (tenant_id, lower(btrim(code)));

create table if not exists public.job_group_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  job_group_id uuid not null,
  effective_from date not null,
  basic_salary numeric(14, 2) check (basic_salary >= 0),   -- a fixed basic salary, or
  basic_min numeric(14, 2) check (basic_min >= 0),         -- a band
  basic_max numeric(14, 2),
  house_allowance numeric(14, 2) not null default 0 check (house_allowance >= 0),
  travel_allowance numeric(14, 2) not null default 0 check (travel_allowance >= 0),
  other_allowances numeric(14, 2) not null default 0 check (other_allowances >= 0),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (job_group_id, tenant_id) references public.job_groups (id, tenant_id) on delete cascade,
  unique (job_group_id, effective_from),
  check ((basic_salary is not null and basic_min is null and basic_max is null)
      or (basic_salary is null and basic_min is not null and basic_max is not null and basic_min <= basic_max))
);
create index if not exists job_group_rates_tenant on public.job_group_rates (tenant_id);

alter table public.employees
  add column if not exists job_group_id uuid,
  add column if not exists pay_overridden boolean not null default false,
  add column if not exists pay_override_reason text;

-- the group must be the employee's company's; removing a group leaves its employees without one
alter table public.employees drop constraint if exists employees_job_group_fkey;
alter table public.employees add constraint employees_job_group_fkey
  foreign key (job_group_id, tenant_id) references public.job_groups (id, tenant_id) on delete set null (job_group_id);
alter table public.employees drop constraint if exists employees_pay_override_reason_check;
alter table public.employees add constraint employees_pay_override_reason_check
  check (not pay_overridden or nullif(btrim(pay_override_reason), '') is not null);
create index if not exists employees_job_group on public.employees (job_group_id) where job_group_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 2. access: ADMIN, Payroll and Employees only (the amounts are other people's pay)
-- ---------------------------------------------------------------------------------------------
create or replace function public.manages_job_groups() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_module('payroll', 'employees')
$$;
revoke all on function public.manages_job_groups() from public, anon;
grant execute on function public.manages_job_groups() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['job_groups', 'job_group_rates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('drop policy if exists manage on public.%I', t);
    execute format($p$create policy manage on public.%I for all to authenticated
      using ((select public.manages_job_groups())) with check ((select public.manages_job_groups()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. the rate in force on a day
-- ---------------------------------------------------------------------------------------------
create or replace function public.job_group_rate_on(p_group uuid, p_day date default current_date)
returns public.job_group_rates
language sql stable security definer set search_path = public as $$
  select r.* from public.job_group_rates r
  where r.job_group_id = p_group and r.effective_from <= p_day
  order by r.effective_from desc limit 1
$$;
revoke all on function public.job_group_rate_on(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. employees: the group's code, and the group's pay unless overridden
-- ---------------------------------------------------------------------------------------------
create or replace function public.employees_job_group() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_insert boolean := tg_op = 'INSERT';
  manager boolean := auth.uid() is null or public.manages_job_groups();
  r public.job_group_rates;
  g uuid;
begin
  if not manager and (
       (is_insert and (new.job_group_id is not null or new.pay_overridden))
       or (not is_insert and (new.job_group_id is distinct from old.job_group_id
                              or new.pay_overridden is distinct from old.pay_overridden
                              or new.pay_override_reason is distinct from old.pay_override_reason))) then
    raise exception 'Only HR or payroll may change an employee''s job group or pay override' using errcode = '42501';
  end if;

  -- the "Job Group" text was typed (an older form, the bulk upload): find the group with that code or name
  if manager and new.job_group_id is not distinct from (case when is_insert then null else old.job_group_id end)
     and (is_insert or new."Job Group" is distinct from old."Job Group") then
    if nullif(btrim(new."Job Group"), '') is null then
      new.job_group_id := null;
    else
      select j.id into g from public.job_groups j
      where j.tenant_id = new.tenant_id
        and (lower(btrim(j.code)) = lower(btrim(new."Job Group")) or lower(btrim(j.name)) = lower(btrim(new."Job Group")))
      order by (lower(btrim(j.code)) = lower(btrim(new."Job Group"))) desc, j.active desc
      limit 1;
      new.job_group_id := g;
    end if;
  end if;

  if new.job_group_id is null then
    -- no group: the pay is the employee's own; a group taken away leaves its code behind only if typed
    if not is_insert and old.job_group_id is not null and new."Job Group" is not distinct from old."Job Group" then
      new."Job Group" := null;
    end if;
    new.pay_overridden := false;
    new.pay_override_reason := null;
    return new;
  end if;

  select j.code into new."Job Group" from public.job_groups j where j.id = new.job_group_id;
  if new.pay_overridden then
    new.pay_override_reason := nullif(btrim(new.pay_override_reason), '');
    if new.pay_override_reason is null then
      raise exception 'Give a reason for setting this employee''s pay by hand' using errcode = '23514';
    end if;
    return new;
  end if;

  new.pay_override_reason := null;
  r := public.job_group_rate_on(new.job_group_id, current_date);
  if r.id is not null then
    new."Basic Salary" := coalesce(r.basic_salary, least(greatest(coalesce(new."Basic Salary", r.basic_min), r.basic_min), r.basic_max));
    new.house_allowance := r.house_allowance;
    new.travel_allowance := r.travel_allowance;
    new.other_cash_allowances := r.other_allowances;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. a group's new rate reaches its employees
-- ---------------------------------------------------------------------------------------------
-- brings the group's employees whose pay is not overridden to the rate in force today; the employees trigger does the
-- work, so this only saves them again. Returns how many were updated.
create or replace function public.apply_job_group_rate_now(p_group uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.employees e set job_group_id = e.job_group_id
  where e.job_group_id = p_group and not e.pay_overridden;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.apply_job_group_rate_now(uuid) from public, anon, authenticated;

-- by hand (the screens use it after saving a rate): nothing changes yet for a rate starting after today
create or replace function public.apply_job_group_rate(p_group uuid, p_from date default current_date) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.manages_job_groups()
     or not exists (select 1 from public.job_groups j where j.id = p_group and j.tenant_id = public.current_tenant_id()) then
    raise exception 'You may not change this job group' using errcode = '42501';
  end if;
  if p_from > current_date then
    return 0;
  end if;
  return public.apply_job_group_rate_now(p_group);
end $$;
revoke all on function public.apply_job_group_rate(uuid, date) from public, anon;
grant execute on function public.apply_job_group_rate(uuid, date) to authenticated;

-- a rate can't start, change or go in a month whose payroll is approved or paid; one in force is applied at once
create or replace function public.job_group_rates_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and public.pay_month_closed(old.tenant_id, old.effective_from) then
    raise exception 'The payroll for % is approved; this rate can no longer change', to_char(old.effective_from, 'FMMonth YYYY')
      using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.pay_month_closed(new.tenant_id, new.effective_from) then
    raise exception 'The payroll for % is approved; start the rate in a later month', to_char(new.effective_from, 'FMMonth YYYY')
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

create or replace function public.job_group_rates_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.effective_from <= current_date then perform public.apply_job_group_rate_now(old.job_group_id); end if;
    return old;
  end if;
  if new.effective_from <= current_date or (tg_op = 'UPDATE' and old.effective_from <= current_date) then
    perform public.apply_job_group_rate_now(new.job_group_id);
  end if;
  return new;
end $$;

drop trigger if exists job_group_rates_rules on public.job_group_rates;
create trigger job_group_rates_rules before insert or update or delete on public.job_group_rates
  for each row execute function public.job_group_rates_rules();
drop trigger if exists job_group_rates_apply on public.job_group_rates;
create trigger job_group_rates_apply after insert or update or delete on public.job_group_rates
  for each row execute function public.job_group_rates_apply();

-- every day: the rates that start today
create or replace function public.apply_due_job_group_rates() returns integer
language plpgsql security definer set search_path = public as $$
declare
  g uuid;
  n integer := 0;
begin
  for g in select distinct r.job_group_id from public.job_group_rates r where r.effective_from = current_date loop
    n := n + public.apply_job_group_rate_now(g);
  end loop;
  return n;
end $$;
revoke all on function public.apply_due_job_group_rates() from public, anon, authenticated;

create or replace function public.job_groups_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists job_groups_touch on public.job_groups;
create trigger job_groups_touch before update on public.job_groups
  for each row execute function public.job_groups_touch();

-- a group's new code reaches its employees' "Job Group"
create or replace function public.job_groups_code_follows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.employees set "Job Group" = new.code where job_group_id = new.id and "Job Group" is distinct from new.code;
  return new;
end $$;
drop trigger if exists job_groups_code_follows on public.job_groups;
create trigger job_groups_code_follows after update of code on public.job_groups
  for each row when (old.code is distinct from new.code) execute function public.job_groups_code_follows();

-- ---------------------------------------------------------------------------------------------
-- 6. the list for the Settings page: each group, its current and next rate and how many employees are on it
-- ---------------------------------------------------------------------------------------------
create or replace function public.job_groups_overview()
returns table (
  id uuid, code text, name text, active boolean, employee_count integer,
  effective_from date, basic_salary numeric, basic_min numeric, basic_max numeric,
  house_allowance numeric, travel_allowance numeric, other_allowances numeric,
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
    r.effective_from, r.basic_salary, r.basic_min, r.basic_max, r.house_allowance, r.travel_allowance, r.other_allowances,
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
-- 7. existing job groups: one per distinct "Job Group" text in each company, without amounts
-- ---------------------------------------------------------------------------------------------
insert into public.job_groups (tenant_id, code, name, created_by)
select distinct on (e.tenant_id, lower(btrim(e."Job Group"))) e.tenant_id, btrim(e."Job Group"), btrim(e."Job Group"), null::uuid
from public.employees e
where nullif(btrim(e."Job Group"), '') is not null
order by e.tenant_id, lower(btrim(e."Job Group")), btrim(e."Job Group")
on conflict do nothing;

update public.employees e set job_group_id = j.id
from public.job_groups j
where e.job_group_id is null and j.tenant_id = e.tenant_id and lower(btrim(j.code)) = lower(btrim(e."Job Group"));

-- (after the backfill, which needs no pay filled: the new groups have no rates)
drop trigger if exists employees_job_group on public.employees;
create trigger employees_job_group before insert or update on public.employees
  for each row execute function public.employees_job_group();

-- ---------------------------------------------------------------------------------------------
-- 8. scheduling (best effort, like the other daily jobs): rates that start today, just after midnight
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'job-group-rates-daily') then
      perform cron.unschedule('job-group-rates-daily');
    end if;
    perform cron.schedule('job-group-rates-daily', '5 0 * * *', $c$select public.apply_due_job_group_rates();$c$);
  else
    raise notice 'pg_cron is not available: a job group rate starting later reaches its employees when they are next saved, or by apply_job_group_rate.';
  end if;
end $$;

notify pgrst, 'reload schema';
