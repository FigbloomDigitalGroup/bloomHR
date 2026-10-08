-- Payroll runs: one per company per month, Draft -> Approved -> Paid.
--
-- Saved payslips (salary_history) used to be written whenever someone pressed "Save History", and the payroll page
-- re-saved them by itself every time it was opened after the 27th, so a payslip staff had already seen could change
-- under them. Now every payslip row belongs to its month's run:
--
--   payroll_runs(tenant_id, pay_period 'YYYY-MM', status, approved_by/at, paid_by/at, notes)
--
--   1. Saving a payslip row attaches it to its month's run, starting a draft run if the month has none.
--   2. Payslips can only be added, changed or removed while the run is a draft. Approving locks them; reopening an
--      approved run unlocks them again. A paid run stays locked. (Renumbering an employee still renumbers them.)
--   3. Staff see their own payslips only once the run is approved or paid.
--   4. Months saved before runs existed become approved runs (staff already saw those payslips).

-- ---------------------------------------------------------------------------------------------
-- table
-- ---------------------------------------------------------------------------------------------
create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  pay_period text not null check (pay_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  unique (tenant_id, pay_period)
);

alter table public.payroll_runs enable row level security;

drop policy if exists tenant_isolation on public.payroll_runs;
create policy tenant_isolation on public.payroll_runs as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- read by the same people who read salary_history; started, approved and paid from the payroll page
drop policy if exists module_read on public.payroll_runs;
create policy module_read on public.payroll_runs for select to authenticated
  using (public.has_any_module('payroll', 'hr-lifecycle'));
drop policy if exists module_write on public.payroll_runs;
create policy module_write on public.payroll_runs for all to authenticated
  using (public.has_module('payroll'))
  with check (public.has_module('payroll'));

revoke all on public.payroll_runs from anon;

-- ---------------------------------------------------------------------------------------------
-- 4. months saved before runs existed
-- ---------------------------------------------------------------------------------------------
alter table public.salary_history
  add column if not exists run_id uuid references public.payroll_runs(id) on delete cascade;
create index if not exists salary_history_run_id_idx on public.salary_history (run_id);

insert into public.payroll_runs (tenant_id, pay_period, status, created_by, created_at, approved_at, notes)
select tenant_id, pay_period, 'approved', null, min(created_at), max(created_at), 'Saved before payroll runs existed'
from public.salary_history
where run_id is null and pay_period ~ '^\d{4}-(0[1-9]|1[0-2])$'
group by tenant_id, pay_period
on conflict (tenant_id, pay_period) do nothing;

update public.salary_history h
set run_id = r.id
from public.payroll_runs r
where h.run_id is null and r.tenant_id = h.tenant_id and r.pay_period = h.pay_period;

-- ---------------------------------------------------------------------------------------------
-- 2. status changes
-- ---------------------------------------------------------------------------------------------
create or replace function public.payroll_run_status_change() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.tenant_id <> old.tenant_id or new.pay_period <> old.pay_period then
    raise exception 'A payroll run''s month can''t be changed';
  end if;

  if new.status <> old.status then
    if old.status = 'draft' and new.status = 'approved' then
      if not exists (select 1 from public.salary_history where run_id = new.id) then
        raise exception 'Payroll for % has no payslips to approve', new.pay_period;
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();
    elsif old.status = 'approved' and new.status = 'draft' then
      new.approved_by := null;
      new.approved_at := null;
    elsif old.status = 'approved' and new.status = 'paid' then
      new.paid_by := auth.uid();
      new.paid_at := now();
    else
      raise exception 'Payroll for % can''t go from % to %', new.pay_period, old.status, new.status;
    end if;
  else
    -- only the status change stamps these
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
    new.paid_by := old.paid_by;
    new.paid_at := old.paid_at;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists payroll_run_status_change on public.payroll_runs;
create trigger payroll_run_status_change before update on public.payroll_runs
  for each row execute function public.payroll_run_status_change();

create or replace function public.payroll_run_delete_draft_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status <> 'draft' then
    raise exception 'Payroll for % is %, so it can''t be deleted', old.pay_period, old.status;
  end if;
  return old;
end $$;

drop trigger if exists payroll_run_delete_draft_only on public.payroll_runs;
create trigger payroll_run_delete_draft_only before delete on public.payroll_runs
  for each row execute function public.payroll_run_delete_draft_only();

-- ---------------------------------------------------------------------------------------------
-- 1 + 2. payslip rows belong to their month's run and change only while it is a draft
-- ---------------------------------------------------------------------------------------------
create or replace function public.salary_history_in_draft_run() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  run public.payroll_runs;
begin
  -- renumbering an employee (propagate_employee_number) follows through locked payslips; no figure changes
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'employee_id') = (to_jsonb(old) - 'employee_id') then
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.run_id is not null then
    select * into run from public.payroll_runs where id = old.run_id;
    if found and run.status <> 'draft' then
      raise exception 'Payroll for % is %, so its payslips can''t be changed. Reopen it first.', run.pay_period, run.status;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.pay_period is null or new.pay_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Pay period "%" should look like 2026-09 (year-month)', coalesce(new.pay_period, '');
  end if;

  insert into public.payroll_runs (tenant_id, pay_period)
  values (new.tenant_id, new.pay_period)
  on conflict (tenant_id, pay_period) do nothing;

  select * into run from public.payroll_runs where tenant_id = new.tenant_id and pay_period = new.pay_period;
  if run.status <> 'draft' then
    raise exception 'Payroll for % is %, so its payslips can''t be changed. Reopen it first.', run.pay_period, run.status;
  end if;

  new.run_id := run.id;
  return new;
end $$;

drop trigger if exists salary_history_in_draft_run on public.salary_history;
create trigger salary_history_in_draft_run before insert or update or delete on public.salary_history
  for each row execute function public.salary_history_in_draft_run();

-- ---------------------------------------------------------------------------------------------
-- 3. staff see their payslips once the run is approved or paid
-- ---------------------------------------------------------------------------------------------
create or replace function public.payroll_run_published(p_run_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.payroll_runs
    where id = p_run_id and tenant_id = (select public.current_tenant_id()) and status in ('approved', 'paid')
  )
$$;

revoke all on function public.payroll_run_published(uuid) from public, anon;
grant execute on function public.payroll_run_published(uuid) to authenticated, service_role;

drop policy if exists own_select on public.salary_history;
create policy own_select on public.salary_history for select to authenticated
  using (employee_id = (select public.current_employee_number()) and public.payroll_run_published(run_id));
