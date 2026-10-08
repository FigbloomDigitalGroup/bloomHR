-- HR Lifecycle reads employment status from hr_employment_status, but the employee form saves it on the employee
-- ("Employee Type", "Start Date", "Probation End Date", "Contract End Date"). Nothing copied one to the other, so an
-- employee added as on probation never appeared under HR Lifecycle > On Probation.
--
--   1. One status row per employee per company. The app saves with upsert on ("tenant_id", "Employee Number"), which
--      needs this unique key (without it every save in HR Lifecycle failed, while saying "saved").
--   2. Adding or editing an employee writes their status: "Employee Type" says Permanent, Probation, Contract or
--      Attachment/Intern(ship). Any other type (or none) is left alone, so HR sets it in HR Lifecycle.
--      Joining date is the Start Date; end dates are the ones typed on the form, else joining date + the company's
--      default probation/contract months (HR Lifecycle settings, 3 and 12 if unset).
--      Only runs when one of those employee fields changes, so confirmations and extensions made in HR Lifecycle stay.
--      A failure here never blocks saving the employee; it only skips the sync (with a warning in the logs).
--   3. Existing employees without a status row get one the same way.

-- ---------------------------------------------------------------------------------------------
-- 1. one row per employee
-- ---------------------------------------------------------------------------------------------
delete from public.hr_employment_status s
using public.hr_employment_status newer
where newer."tenant_id" = s."tenant_id"
  and newer."Employee Number" = s."Employee Number"
  and newer.id > s.id;

alter table public.hr_employment_status drop constraint if exists hr_employment_status_tenant_employee_key;
alter table public.hr_employment_status
  add constraint hr_employment_status_tenant_employee_key unique ("tenant_id", "Employee Number");

-- ---------------------------------------------------------------------------------------------
-- 2. employee form -> HR Lifecycle
-- ---------------------------------------------------------------------------------------------
-- employee dates are text (form: YYYY-MM-DD; uploads may hold anything)
create or replace function public.try_date(v text) returns date
language plpgsql immutable as $$
begin
  if v is null or btrim(v) = '' then return null; end if;
  return btrim(v)::date;
exception when others then
  return null;
end $$;

create or replace function public.employment_type_from_employee(employee_type text) returns text
language sql immutable as $$
  select case
    when employee_type ilike '%perman%' then 'Permanent'
    when employee_type ilike '%probation%' then 'Probation'
    when employee_type ilike '%contract%' then 'Contract'
    when employee_type ilike '%attach%' or employee_type ilike '%intern%' then 'Attachment'
  end
$$;

create or replace function public.sync_employment_status_from_employee(e public.employees) returns void
language plpgsql security definer set search_path = public as $$
declare
  kind text := public.employment_type_from_employee(e."Employee Type");
  joined date;
  probation_months integer;
  contract_months integer;
  probation_end date;
  contract_end date;
begin
  if kind is null or e."Employee Number" is null then return; end if;

  select cs.default_probation_months, cs.default_contract_months
    into probation_months, contract_months
  from public.hr_contract_settings cs where cs.tenant_id = e.tenant_id
  order by cs.id limit 1;
  probation_months := coalesce(probation_months, 3);
  contract_months := coalesce(contract_months, 12);

  joined := coalesce(
    public.try_date(e."Start Date"),
    case kind when 'Probation' then public.try_date(e."Probation Start Date")
              when 'Contract' then public.try_date(e."Contract Start Date") end);

  if kind = 'Probation' then
    probation_end := coalesce(public.try_date(e."Probation End Date"), (joined + make_interval(months => probation_months))::date);
  elsif kind = 'Contract' then
    contract_end := coalesce(public.try_date(e."Contract End Date"), (joined + make_interval(months => contract_months))::date);
  end if;

  insert into public.hr_employment_status as s (
    "tenant_id", "Employee Number", employment_type, joining_date,
    probation_duration_months, contract_duration_months, probation_end_date, contract_end_date, is_confirmed)
  values (
    e.tenant_id, e."Employee Number", kind, joined,
    probation_months, contract_months, probation_end, contract_end, kind = 'Permanent')
  on conflict ("tenant_id", "Employee Number") do update set
    employment_type = excluded.employment_type,
    joining_date = excluded.joining_date,
    probation_end_date = excluded.probation_end_date,
    contract_end_date = excluded.contract_end_date,
    -- someone moved back onto probation needs confirming again; anyone else keeps what HR decided
    is_confirmed = case
      when excluded.employment_type = 'Permanent' then true
      when excluded.employment_type = 'Probation' and s.employment_type is distinct from 'Probation' then false
      else s.is_confirmed end,
    updated_at = now();
end $$;

create or replace function public.employees_sync_employment_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new."Employee Type" is not distinct from old."Employee Type"
     and new."Start Date" is not distinct from old."Start Date"
     and new."Probation Start Date" is not distinct from old."Probation Start Date"
     and new."Probation End Date" is not distinct from old."Probation End Date"
     and new."Contract Start Date" is not distinct from old."Contract Start Date"
     and new."Contract End Date" is not distinct from old."Contract End Date" then
    return new;
  end if;
  begin
    perform public.sync_employment_status_from_employee(new);
  exception when others then
    raise warning 'employment status sync skipped for employee %: %', new."Employee Number", sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists employees_sync_employment_status on public.employees;
create trigger employees_sync_employment_status
  after insert or update on public.employees
  for each row execute function public.employees_sync_employment_status();

revoke all on function public.sync_employment_status_from_employee(public.employees) from public, anon, authenticated;
revoke all on function public.employees_sync_employment_status() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. existing employees
-- ---------------------------------------------------------------------------------------------
do $$
declare e public.employees;
begin
  for e in
    select emp.* from public.employees emp
    where not exists (
      select 1 from public.hr_employment_status s
      where s."tenant_id" = emp."tenant_id" and s."Employee Number" = emp."Employee Number")
  loop
    begin
      perform public.sync_employment_status_from_employee(e);
    exception when others then
      raise warning 'employment status backfill skipped for employee %: %', e."Employee Number", sqlerrm;
    end;
  end loop;
end $$;
