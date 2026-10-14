-- Piece rate and contract jobs, stage 1: the data (FIG-812).
--
-- Some workers are paid for the work they record (kgs picked, pieces made, days worked), usually daily, sometimes
-- weekly or monthly; some are paid a set amount for a job, once it is done. Payouts during the month hold back AHL and
-- a reserve; the monthly payroll run works out the exact deductions on the month's total and pays the balance (later
-- stages). This stage adds:
--
--   employees.worker_kind         'employee' (PAYE, NSSF, SHIF, AHL) or 'contractor' (withholding tax instead)
--   employees.pay_basis           'salary' (Basic Salary, as before) or 'work' (paid for recorded work)
--   employees.pay_frequency       'daily', 'weekly' or 'monthly': how often work pay is paid out
--   employees.wht_category        a contractor's withholding tax category: 'contractual' or 'professional'
--   work_types(name, unit, rate)  the company's kinds of work and what one unit pays ("Tea picked", kg, 12)
--   work_entries                  one worker's quantity of one kind of work on one day; amount = quantity x rate
--   contract_jobs                 a job for a set amount, paid once it is completed and approved
--   company_payroll_settings.payout_reserve_rate   share of each payout held back for the month's deductions
--   statutory_rates               withholding tax rates, dated like the other rates
--
-- Who does what (enforced by the triggers below, not only by the screens):
--   payroll ('work-records' or 'payroll' module)   everything; what they enter or upload is approved
--   supervisor (the worker's manager_email or regional_manager)   enters and approves their team's work; creates,
--                                                  approves and cancels their team's jobs
--   the worker                                     sees their own; submits work (counts once approved); marks a job done
-- Nothing can change in a month whose payroll run is approved or paid, nor once it has been paid out.

-- ---------------------------------------------------------------------------------------------
-- 1. the worker's pay setup
-- ---------------------------------------------------------------------------------------------
alter table public.employees
  add column if not exists worker_kind text not null default 'employee',
  add column if not exists pay_basis text not null default 'salary',
  add column if not exists pay_frequency text not null default 'monthly',
  add column if not exists wht_category text;

alter table public.employees drop constraint if exists employees_worker_kind_check;
alter table public.employees add constraint employees_worker_kind_check check (worker_kind in ('employee', 'contractor'));
alter table public.employees drop constraint if exists employees_pay_basis_check;
alter table public.employees add constraint employees_pay_basis_check check (pay_basis in ('salary', 'work'));
alter table public.employees drop constraint if exists employees_pay_frequency_check;
alter table public.employees add constraint employees_pay_frequency_check check (pay_frequency in ('daily', 'weekly', 'monthly'));
alter table public.employees drop constraint if exists employees_wht_category_check;
alter table public.employees add constraint employees_wht_category_check check (
  (worker_kind = 'employee' and wht_category is null)
  or (worker_kind = 'contractor' and wht_category is not null and wht_category in ('contractual', 'professional'))
);

alter table public.company_payroll_settings
  add column if not exists payout_reserve_rate numeric(5, 4) not null default 0.10;
alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_payout_reserve_rate_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_payout_reserve_rate_check
  check (payout_reserve_rate >= 0 and payout_reserve_rate <= 0.5);

-- Income Tax Act, Third Schedule: payments to resident contractors. Rates change with Finance Acts like the others.
insert into public.statutory_rates (tenant_id, code, value, bands, effective_from, effective_to, source)
select null, v.code, v.value, null, date '2023-07-01', null, 'Income Tax Act, Third Schedule (resident)'
from (values ('wht_contractual', 0.03), ('wht_professional', 0.05)) as v(code, value)
where not exists (select 1 from public.statutory_rates r where r.tenant_id is null and r.code = v.code);

insert into public.permissions (module_id, module_name, description, category)
select 'work-records', 'Work & Piece Rate', 'Set up kinds of work and rates, record and approve work and contract jobs', 'finance'
where not exists (select 1 from public.permissions where module_id = 'work-records');

-- ---------------------------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.manages_work() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_module('work-records', 'payroll')
$$;

-- the signed-in user is this worker's supervisor (their manager or regional manager)
create or replace function public.supervises(p_employee_number text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e join auth.users u on u.id = auth.uid()
    where e.tenant_id = public.current_tenant_id() and e."Employee Number" = p_employee_number
      and lower(u.email) in (lower(btrim(e.manager_email)), lower(btrim(e.regional_manager)))
  )
$$;

-- the month's payroll run is approved or paid, so its pay can no longer change
create or replace function public.pay_month_closed(p_tenant uuid, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.payroll_runs r
    where r.tenant_id = p_tenant and r.pay_period = to_char(p_day, 'YYYY-MM') and r.status in ('approved', 'paid')
  )
$$;

revoke all on function public.manages_work() from public, anon;
revoke all on function public.supervises(text) from public, anon;
revoke all on function public.pay_month_closed(uuid, date) from public, anon;
grant execute on function public.manages_work() to authenticated;
grant execute on function public.supervises(text) to authenticated;
grant execute on function public.pay_month_closed(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. kinds of work
-- ---------------------------------------------------------------------------------------------
create table if not exists public.work_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  unit text not null check (btrim(unit) <> ''),       -- kg, piece, crate, day, hour...
  rate numeric(12, 2) not null check (rate > 0),       -- KSh for one unit
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists work_types_tenant_name on public.work_types (tenant_id, lower(btrim(name)));

-- ---------------------------------------------------------------------------------------------
-- 4. recorded work
-- ---------------------------------------------------------------------------------------------
create table if not exists public.work_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null,
  work_date date not null,
  work_type_id uuid not null references public.work_types(id) on delete restrict,
  quantity numeric(12, 3) not null check (quantity > 0),
  rate numeric(12, 2) not null check (rate > 0),     -- the type's rate when recorded, so later rate changes don't alter it
  amount numeric(14, 2) generated always as (round(quantity * rate, 2)) stored,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  source text not null check (source in ('payroll', 'upload', 'supervisor', 'self')),
  notes text,
  rejection_reason text,
  entered_by uuid default auth.uid() references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  paid_out_at timestamptz,                             -- set by the payout stage; the entry is then fixed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'rejected' or nullif(btrim(rejection_reason), '') is not null)
);
create index if not exists work_entries_tenant_employee_date on public.work_entries (tenant_id, employee_number, work_date);
create index if not exists work_entries_tenant_date on public.work_entries (tenant_id, work_date);

-- ---------------------------------------------------------------------------------------------
-- 5. contract jobs
-- ---------------------------------------------------------------------------------------------
--   open       agreed, being worked on
--   completed  the worker (or their supervisor) says it is done
--   approved   checked and accepted: payable
--   cancelled  not going ahead
-- A completed job that is sent back returns to open with the reason.
create table if not exists public.contract_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null,
  title text not null check (btrim(title) <> ''),
  description text,
  amount numeric(14, 2) not null check (amount > 0),
  start_date date,
  due_date date,
  status text not null default 'open' check (status in ('open', 'completed', 'approved', 'cancelled')),
  completed_at timestamptz,
  completion_notes text,
  sent_back_reason text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paid_out_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);
create index if not exists contract_jobs_tenant_employee on public.contract_jobs (tenant_id, employee_number);
create index if not exists contract_jobs_tenant_status on public.contract_jobs (tenant_id, status);

-- ---------------------------------------------------------------------------------------------
-- 6. access
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['work_types', 'work_entries', 'contract_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- everyone in the company reads the kinds of work (supervisors and workers pick from them); payroll changes them
drop policy if exists read_company on public.work_types;
create policy read_company on public.work_types for select to authenticated using (true);
drop policy if exists manage on public.work_types;
create policy manage on public.work_types for all to authenticated
  using (public.manages_work()) with check (public.manages_work());

-- work and jobs: payroll, the worker's supervisor and the worker; the triggers decide what each may do
do $$
declare t text;
begin
  foreach t in array array['work_entries', 'contract_jobs'] loop
    execute format('drop policy if exists involved on public.%I', t);
    execute format($p$create policy involved on public.%I for all to authenticated
      using (public.manages_work() or public.supervises(employee_number) or employee_number = public.current_employee_number())
      with check (public.manages_work() or public.supervises(employee_number) or employee_number = public.current_employee_number())$p$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. rules for recorded work
-- ---------------------------------------------------------------------------------------------
create or replace function public.work_entry_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_payroll boolean := public.manages_work();
  v_self boolean;
  v_supervisor boolean;
  v_type public.work_types;
begin
  -- an employee renumbered (work_follow_renumber): only employee_number changes (a generated column like amount
  -- isn't filled in yet in a BEFORE trigger, so it is left out of the comparison)
  if tg_op = 'UPDATE' and current_setting('app.renumbering_worker', true) = 'on'
     and (to_jsonb(new) - 'employee_number' - 'amount') = (to_jsonb(old) - 'employee_number' - 'amount') then
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.paid_out_at is not null then raise exception 'This work has been paid out and can''t be removed'; end if;
    if public.pay_month_closed(old.tenant_id, old.work_date) then
      raise exception 'Payroll for % is approved; this work can''t be removed', to_char(old.work_date, 'Mon YYYY');
    end if;
    if auth.uid() is not null and not v_payroll and not public.supervises(old.employee_number)
       and not (old.employee_number = public.current_employee_number() and old.status <> 'approved') then
      raise exception 'Only payroll or the supervisor can remove approved work';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.paid_out_at is not null and new.paid_out_at is not distinct from old.paid_out_at then
      raise exception 'This work has been paid out and can''t be changed';
    end if;
    if public.pay_month_closed(old.tenant_id, old.work_date) then
      raise exception 'Payroll for % is approved; this work can''t be changed', to_char(old.work_date, 'Mon YYYY');
    end if;
    if new.employee_number is distinct from old.employee_number and auth.uid() is not null and not v_payroll then
      raise exception 'Only payroll can move work to another worker';
    end if;
  end if;

  if public.pay_month_closed(new.tenant_id, new.work_date) then
    raise exception 'Payroll for % is approved; record this work in an open month', to_char(new.work_date, 'Mon YYYY');
  end if;
  if new.work_date > current_date + 1 then raise exception 'Work can''t be recorded for a future day'; end if;

  if not exists (select 1 from public.employees e where e.tenant_id = new.tenant_id and e."Employee Number" = new.employee_number) then
    raise exception 'Unknown worker %', new.employee_number;
  end if;

  select * into v_type from public.work_types where id = new.work_type_id and tenant_id = new.tenant_id;
  if not found then raise exception 'Unknown kind of work'; end if;
  if tg_op = 'INSERT' or new.work_type_id is distinct from old.work_type_id then
    if not v_type.active then raise exception '% is paused; pick another kind of work', v_type.name; end if;
    new.rate := v_type.rate;
  end if;

  new.updated_at := now();

  -- the server and SQL scripts (no signed-in user) are trusted
  if auth.uid() is null then return new; end if;

  v_self := new.employee_number = public.current_employee_number();
  v_supervisor := not v_self and public.supervises(new.employee_number);

  if tg_op = 'INSERT' then
    new.entered_by := auth.uid();
    new.paid_out_at := null;
    if v_payroll then
      new.source := case when new.source = 'upload' then 'upload' else 'payroll' end;
    elsif v_supervisor then
      new.source := 'supervisor';
    elsif v_self then
      new.source := 'self';
    else
      raise exception 'You can only record work for yourself or your team';
    end if;
    -- payroll and supervisors check work as they enter it; a worker's own entry waits for approval
    if new.source = 'self' then
      new.status := 'submitted';
      new.decided_by := null; new.decided_at := null;
    else
      new.status := 'approved';
      new.decided_by := auth.uid(); new.decided_at := now();
    end if;
    return new;
  end if;

  -- UPDATE
  new.paid_out_at := old.paid_out_at;
  new.source := old.source;
  new.entered_by := old.entered_by;
  if new.status is distinct from old.status then
    if not (v_payroll or v_supervisor) then
      -- a worker may only send rejected work back for approval, after correcting it
      if not (v_self and old.status = 'rejected' and new.status = 'submitted') then
        raise exception 'Only payroll or the supervisor can approve or reject work';
      end if;
    end if;
    if new.status = 'submitted' then
      new.decided_by := null; new.decided_at := null; new.rejection_reason := null;
    else
      new.decided_by := auth.uid(); new.decided_at := now();
      if new.status = 'approved' then new.rejection_reason := null; end if;
    end if;
  elsif not (v_payroll or v_supervisor) then
    if old.status = 'approved' then raise exception 'Approved work can only be changed by payroll or the supervisor'; end if;
    new.decided_by := old.decided_by; new.decided_at := old.decided_at;
  else
    new.decided_by := old.decided_by; new.decided_at := old.decided_at;
  end if;
  return new;
end $$;

drop trigger if exists work_entry_rules on public.work_entries;
create trigger work_entry_rules before insert or update or delete on public.work_entries
  for each row execute function public.work_entry_rules();

-- ---------------------------------------------------------------------------------------------
-- 8. rules for contract jobs
-- ---------------------------------------------------------------------------------------------
create or replace function public.contract_job_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_payroll boolean := public.manages_work();
  v_self boolean;
  v_supervisor boolean;
  v_manager boolean;
begin
  -- an employee renumbered (work_follow_renumber): only employee_number changes (a generated column like amount
  -- isn't filled in yet in a BEFORE trigger, so it is left out of the comparison)
  if tg_op = 'UPDATE' and current_setting('app.renumbering_worker', true) = 'on'
     and (to_jsonb(new) - 'employee_number' - 'amount') = (to_jsonb(old) - 'employee_number' - 'amount') then
    return new;
  end if;
  if tg_op = 'DELETE' then
    if auth.uid() is not null and not v_payroll then raise exception 'Only payroll can delete a job; cancel it instead'; end if;
    if old.status = 'approved' or old.paid_out_at is not null then raise exception 'An approved job can''t be deleted'; end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.paid_out_at is not null and new.paid_out_at is not distinct from old.paid_out_at then
    raise exception 'This job has been paid and can''t be changed';
  end if;

  if not exists (select 1 from public.employees e where e.tenant_id = new.tenant_id and e."Employee Number" = new.employee_number) then
    raise exception 'Unknown worker %', new.employee_number;
  end if;
  new.updated_at := now();

  if auth.uid() is null then return new; end if;

  v_self := new.employee_number = public.current_employee_number();
  v_supervisor := not v_self and public.supervises(new.employee_number);
  v_manager := v_payroll or v_supervisor;

  if tg_op = 'INSERT' then
    if not v_manager then raise exception 'Only payroll or the supervisor can give someone a job'; end if;
    new.created_by := auth.uid();
    new.status := 'open';
    new.completed_at := null; new.completion_notes := null; new.sent_back_reason := null;
    new.approved_by := null; new.approved_at := null; new.paid_out_at := null;
    return new;
  end if;

  -- UPDATE
  new.paid_out_at := old.paid_out_at;
  new.created_by := old.created_by;
  if old.status = 'approved' and new.status = 'approved' and auth.uid() is not null and not v_payroll then
    raise exception 'An approved job can only be changed by payroll';
  end if;

  if not v_manager then
    -- the worker: only to say an open job is done
    if not (v_self and old.status = 'open' and new.status = 'completed') then
      raise exception 'You can only mark your own open job as completed';
    end if;
    if (new.title, new.amount, new.employee_number, new.start_date, new.due_date, new.description)
       is distinct from (old.title, old.amount, old.employee_number, old.start_date, old.due_date, old.description) then
      raise exception 'Only payroll or the supervisor can change a job''s details';
    end if;
  elsif new.employee_number is distinct from old.employee_number and not v_payroll then
    raise exception 'Only payroll can move a job to another worker';
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'open' and new.status in ('completed', 'cancelled'))
         or (old.status = 'completed' and new.status in ('approved', 'open', 'cancelled'))
         or (old.status = 'approved' and new.status = 'completed' and v_payroll)) then
      raise exception 'A job can''t go from % to %', old.status, new.status;
    end if;
    if new.status = 'completed' and old.status = 'open' then
      new.completed_at := now(); new.sent_back_reason := null;
    end if;
    if new.status = 'open' then
      if nullif(btrim(new.sent_back_reason), '') is null then raise exception 'Say why the job is sent back'; end if;
      new.completed_at := null;
    end if;
    if new.status = 'approved' then
      if v_self then raise exception 'Someone else must approve your job'; end if;
      new.approved_by := auth.uid(); new.approved_at := now();
    else
      new.approved_by := null; new.approved_at := null;
    end if;
  else
    new.completed_at := old.completed_at;
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  return new;
end $$;

drop trigger if exists contract_job_rules on public.contract_jobs;
create trigger contract_job_rules before insert or update or delete on public.contract_jobs
  for each row execute function public.contract_job_rules();

-- ---------------------------------------------------------------------------------------------
-- 9. follow renumbering, and keep a history of changes
-- ---------------------------------------------------------------------------------------------
create or replace function public.work_follow_renumber() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- the rules triggers would refuse changes in closed months; a renumber is not a change of pay
  perform set_config('app.renumbering_worker', 'on', true);
  update public.work_entries set employee_number = new."Employee Number"
  where tenant_id = new.tenant_id and employee_number = old."Employee Number";
  update public.contract_jobs set employee_number = new."Employee Number"
  where tenant_id = new.tenant_id and employee_number = old."Employee Number";
  perform set_config('app.renumbering_worker', 'off', true);
  return new;
end $$;

drop trigger if exists work_follow_renumber on public.employees;
create trigger work_follow_renumber
  after update of "Employee Number" on public.employees
  for each row when (old."Employee Number" is distinct from new."Employee Number")
  execute function public.work_follow_renumber();

do $$
declare t text;
begin
  foreach t in array array['work_types', 'work_entries', 'contract_jobs'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
      for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
