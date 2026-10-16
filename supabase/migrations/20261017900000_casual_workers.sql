-- Casual workers paid by the day, on their own page and outside the monthly PAYE payroll.
--
-- Farms and companies take on people for a few days or weeks at a daily rate. They are not on the monthly payroll
-- (no PAYE, NSSF, SHIF or AHL is worked out for them) and they don't go through the full onboarding. This adds:
--
--   employees.worker_kind 'casual'      a third kind of worker, next to 'employee' and 'contractor' (20261014100000)
--   employees.daily_rate                what one full day pays; required for a casual
--   company_payroll_settings.casual_day_limit   how many working days in a row before HR is warned (default 30)
--   casual_days(employee, date, portion)   one casual's day: a full day, a half day or absent, at their daily rate
--   casual_pay_runs / casual_pay_lines     paying casuals for a period: days x rate, plus one-off additions and
--                                          deductions; approved (the lines are then fixed), then marked paid
--
-- Why a table of its own rather than work_entries with a "Day's work" kind of work: a work entry always takes its
-- kind of work's rate (one rate for everyone), can't record an absent day (quantity must be more than 0), and is closed
-- by the monthly payroll run. A casual is paid their own daily rate, absences are part of the register, and casual
-- days are closed by their own pay runs, not by the month's payroll.
--
-- Who does what (enforced here, not only by the screens):
--   payroll ('work-records' or 'payroll' module)   everything: register casuals, record and approve days, pay runs
--   HR ('employees' module)                        register casuals, mark them finished, see the day-limit warning
--   supervisor (the casual's manager_email or regional_manager)   sees their team and records their days; their days
--                                                  wait for payroll's approval
-- Days in an approved or paid run can't change. A run's lines can't change once it is approved.
--
-- Casuals are also kept out of the monthly payroll (no payslip can be saved for one), the leave engine (no leave
-- accrues), and HR's onboarding queue.
--
-- Employment Act s.37: a casual who works continuously for about a month becomes a term employee. The page warns when
-- a casual's latest run of working days is longer than the company's limit (breaks of 2 days or less, such as a
-- weekend, don't end a run).

-- ---------------------------------------------------------------------------------------------
-- 1. the casual worker
-- ---------------------------------------------------------------------------------------------
alter table public.employees add column if not exists daily_rate numeric(12, 2);

alter table public.employees drop constraint if exists employees_worker_kind_check;
alter table public.employees add constraint employees_worker_kind_check check (worker_kind in ('employee', 'contractor', 'casual'));
alter table public.employees drop constraint if exists employees_wht_category_check;
alter table public.employees add constraint employees_wht_category_check check (
  (worker_kind in ('employee', 'casual') and wht_category is null)
  or (worker_kind = 'contractor' and wht_category is not null and wht_category in ('contractual', 'professional'))
);
alter table public.employees drop constraint if exists employees_daily_rate_check;
alter table public.employees add constraint employees_daily_rate_check check (
  (daily_rate is null or daily_rate > 0) and (worker_kind <> 'casual' or daily_rate is not null)
);

alter table public.company_payroll_settings add column if not exists casual_day_limit integer not null default 30;
alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_casual_day_limit_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_casual_day_limit_check
  check (casual_day_limit between 1 and 366);

-- ---------------------------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------------------------
-- registers casuals and marks them finished: payroll or HR
create or replace function public.manages_casuals() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_module('work-records', 'payroll', 'employees')
$$;

create or replace function public.is_casual(p_tenant uuid, p_employee text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees e
                 where e.tenant_id = p_tenant and e."Employee Number" = p_employee and e.worker_kind = 'casual')
$$;

create or replace function public.casual_day_limit() returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select s.casual_day_limit from public.company_payroll_settings s
                   where s.tenant_id = public.current_tenant_id()), 30)
$$;

revoke all on function public.manages_casuals() from public, anon;
revoke all on function public.is_casual(uuid, text) from public, anon;
revoke all on function public.casual_day_limit() from public, anon;
grant execute on function public.manages_casuals() to authenticated;
grant execute on function public.is_casual(uuid, text) to authenticated;
grant execute on function public.casual_day_limit() to authenticated;

create or replace function public.set_casual_day_limit(p_days integer) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.manages_casuals() then raise exception 'Only payroll or HR can change this' using errcode = '42501'; end if;
  if p_days is null or p_days < 1 or p_days > 366 then raise exception 'Pick between 1 and 366 days' using errcode = '22023'; end if;
  insert into public.company_payroll_settings (tenant_id, casual_day_limit, updated_by, updated_at)
  values (public.current_tenant_id(), p_days, auth.uid(), now())
  on conflict (tenant_id) do update set casual_day_limit = excluded.casual_day_limit, updated_by = auth.uid(), updated_at = now();
  return p_days;
end $$;
revoke all on function public.set_casual_day_limit(integer) from public, anon;
grant execute on function public.set_casual_day_limit(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. registering casuals
-- ---------------------------------------------------------------------------------------------
-- One casual, new (no employee_number) or changed. p: first_name, last_name, id_number, phone, daily_rate, start_date,
-- department_id, supervisor_email, payment_method ('M-Pesa' or 'Bank Transfer'), bank, bank_branch, bank_code,
-- branch_code, account_name, account_number. Returns the employee number.
create or replace function public.casual_save_one(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_number text := nullif(btrim(p->>'employee_number'), '');
  v_first text := nullif(btrim(p->>'first_name'), '');
  v_last text := nullif(btrim(p->>'last_name'), '');
  v_rate numeric;
  v_start date;
  v_method text;
  v_dept uuid;
  v_super text := nullif(lower(btrim(p->>'supervisor_email')), '');
begin
  if v_first is null or v_last is null then raise exception 'Add a first and last name' using errcode = '22023'; end if;
  begin
    v_rate := nullif(btrim(p->>'daily_rate'), '')::numeric;
  exception when others then
    raise exception 'The daily rate "%" is not an amount', p->>'daily_rate' using errcode = '22023';
  end;
  if v_rate is null or v_rate <= 0 then raise exception 'Add a daily rate of more than 0' using errcode = '22023'; end if;
  begin
    v_start := coalesce(nullif(btrim(p->>'start_date'), '')::date, current_date);
  exception when others then
    raise exception 'The start date "%" should look like 2026-10-16', p->>'start_date' using errcode = '22023';
  end;
  v_method := case when lower(coalesce(p->>'payment_method', '')) like 'bank%' then 'Bank Transfer' else 'M-Pesa' end;
  if v_method = 'M-Pesa' and nullif(btrim(p->>'phone'), '') is null then
    raise exception 'Add an M-Pesa phone number, or bank details' using errcode = '22023';
  end if;
  if v_method = 'Bank Transfer' and (nullif(btrim(p->>'bank'), '') is null or nullif(btrim(p->>'account_number'), '') is null) then
    raise exception 'Add the bank and account number' using errcode = '22023';
  end if;
  if nullif(btrim(p->>'department_id'), '') is not null then
    select d.id into v_dept from public.departments d where d.id = (p->>'department_id')::uuid and d.tenant_id = v_tenant;
    if v_dept is null then raise exception 'Unknown department' using errcode = '22023'; end if;
  end if;

  if v_number is null then
    insert into public.employees (
      "First Name", "Last Name", "ID Number", "Mobile Number", daily_rate, "Start Date", department_id, manager_email,
      payment_method, "Bank", "Bank Branch", bank_code, branch_code, account_number_name, "Account Number",
      worker_kind, pay_basis, pay_frequency, "Employee Type", "Status", tenant_id)
    values (
      v_first, v_last, nullif(btrim(p->>'id_number'), ''), nullif(btrim(p->>'phone'), ''), v_rate, to_char(v_start, 'YYYY-MM-DD'),
      v_dept, v_super, v_method, nullif(btrim(p->>'bank'), ''), nullif(btrim(p->>'bank_branch'), ''),
      nullif(btrim(p->>'bank_code'), ''), nullif(btrim(p->>'branch_code'), ''), nullif(btrim(p->>'account_name'), ''),
      nullif(btrim(p->>'account_number'), ''), 'casual', 'work', 'daily', 'Casual', 'Active', v_tenant)
    returning "Employee Number" into v_number;
    return v_number;
  end if;

  if not public.is_casual(v_tenant, v_number) then raise exception 'No casual worker % in this company', v_number; end if;
  update public.employees set
    "First Name" = v_first, "Last Name" = v_last, "ID Number" = nullif(btrim(p->>'id_number'), ''),
    "Mobile Number" = nullif(btrim(p->>'phone'), ''), daily_rate = v_rate, "Start Date" = to_char(v_start, 'YYYY-MM-DD'),
    department_id = v_dept, manager_email = v_super, payment_method = v_method,
    "Bank" = nullif(btrim(p->>'bank'), ''), "Bank Branch" = nullif(btrim(p->>'bank_branch'), ''),
    bank_code = nullif(btrim(p->>'bank_code'), ''), branch_code = nullif(btrim(p->>'branch_code'), ''),
    account_number_name = nullif(btrim(p->>'account_name'), ''), "Account Number" = nullif(btrim(p->>'account_number'), '')
  where tenant_id = v_tenant and "Employee Number" = v_number;
  return v_number;
end $$;
revoke all on function public.casual_save_one(jsonb) from public, anon, authenticated;

create or replace function public.save_casual(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.manages_casuals() then raise exception 'Only payroll or HR can register casual workers' using errcode = '42501'; end if;
  return public.casual_save_one(p);
end $$;
revoke all on function public.save_casual(jsonb) from public, anon;
grant execute on function public.save_casual(jsonb) to authenticated;

-- a spreadsheet of casuals: each row is added on its own; returns, per row, the new employee number or the problem
create or replace function public.register_casuals(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_i integer := 0;
  v_out jsonb := '[]'::jsonb;
  v_number text;
begin
  if not public.manages_casuals() then raise exception 'Only payroll or HR can register casual workers' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Send a list of rows' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'At most 2000 rows at a time' using errcode = '22023'; end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      v_number := public.casual_save_one(v_row - 'employee_number');
      v_out := v_out || jsonb_build_object('row', v_i, 'employee_number', v_number);
    exception when others then
      v_out := v_out || jsonb_build_object('row', v_i, 'error', sqlerrm);
    end;
  end loop;
  return v_out;
end $$;
revoke all on function public.register_casuals(jsonb) from public, anon;
grant execute on function public.register_casuals(jsonb) to authenticated;

-- finished: their last day; they stay on record (and in past pay runs)
create or replace function public.finish_casual(p_employee text, p_last_day date default current_date) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if not public.manages_casuals() then raise exception 'Only payroll or HR can do this' using errcode = '42501'; end if;
  if not public.is_casual(v_tenant, p_employee) then raise exception 'No casual worker % in this company', p_employee; end if;
  if exists (select 1 from public.casual_days d where d.tenant_id = v_tenant and d.employee_number = p_employee
             and d.work_date > coalesce(p_last_day, current_date) and d.portion <> 'absent') then
    raise exception 'They have days recorded after %; remove those first', to_char(coalesce(p_last_day, current_date), 'DD Mon YYYY');
  end if;
  update public.employees set "Status" = 'Inactive', "Termination Date" = to_char(coalesce(p_last_day, current_date), 'YYYY-MM-DD')
  where tenant_id = v_tenant and "Employee Number" = p_employee;
end $$;
revoke all on function public.finish_casual(text, date) from public, anon;
grant execute on function public.finish_casual(text, date) to authenticated;

-- taken on again
create or replace function public.rejoin_casual(p_employee text, p_start date default current_date) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if not public.manages_casuals() then raise exception 'Only payroll or HR can do this' using errcode = '42501'; end if;
  if not public.is_casual(v_tenant, p_employee) then raise exception 'No casual worker % in this company', p_employee; end if;
  update public.employees set "Status" = 'Active', "Termination Date" = null, "Start Date" = to_char(coalesce(p_start, current_date), 'YYYY-MM-DD')
  where tenant_id = v_tenant and "Employee Number" = p_employee;
end $$;
revoke all on function public.rejoin_casual(text, date) from public, anon;
grant execute on function public.rejoin_casual(text, date) to authenticated;

-- the casuals this user may see: payroll and HR all of them, a supervisor their team. Bank details only for payroll
-- and HR.
create or replace function public.casual_workers()
returns table (
  id uuid, employee_number text, first_name text, last_name text, id_number text, phone text, daily_rate numeric,
  start_date text, finished_on text, department_id uuid, department text, supervisor_email text, payment_method text,
  bank text, bank_branch text, bank_code text, branch_code text, account_name text, account_number text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_all boolean := public.manages_casuals();
begin
  return query
  select e.id, e."Employee Number", e."First Name", e."Last Name", e."ID Number"::text, e."Mobile Number", e.daily_rate,
         e."Start Date", nullif(btrim(e."Termination Date"), ''), e.department_id, e."Job Level", e.manager_email, e.payment_method,
         case when v_all then e."Bank" end, case when v_all then e."Bank Branch" end, case when v_all then e.bank_code end,
         case when v_all then e.branch_code end, case when v_all then e.account_number_name end,
         case when v_all then e."Account Number" end
  from public.employees e
  where e.tenant_id = public.current_tenant_id() and e.worker_kind = 'casual'
    and (v_all or public.supervises(e."Employee Number"))
  order by e."First Name", e."Last Name", e."Employee Number";
end $$;
revoke all on function public.casual_workers() from public, anon;
grant execute on function public.casual_workers() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. pay runs (created before days, which point at them)
-- ---------------------------------------------------------------------------------------------
--   draft     being put together: lines follow the approved days, additions and deductions can change
--   approved  checked: lines are fixed and the days in it can't change; download the payout files
--   paid      the money has gone out (the platform prepares the files; it doesn't send money)
create table if not exists public.casual_pay_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  notes text,
  total numeric(14, 2) not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paid_on date,
  paid_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  check (period_end - period_start <= 92)
);
create index if not exists casual_pay_runs_tenant_period on public.casual_pay_runs (tenant_id, period_start desc);

create table if not exists public.casual_pay_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  run_id uuid not null references public.casual_pay_runs(id) on delete cascade,
  employee_number text not null,
  worker_name text not null default '',
  full_days integer not null default 0 check (full_days >= 0),
  half_days integer not null default 0 check (half_days >= 0),
  daily_rate numeric(12, 2),                     -- their rate when the line was last worked out (for display)
  days_amount numeric(14, 2) not null default 0 check (days_amount >= 0),
  additions numeric(14, 2) not null default 0 check (additions >= 0),
  deductions numeric(14, 2) not null default 0 check (deductions >= 0),
  adjustment_note text,
  net_pay numeric(14, 2) generated always as (days_amount + additions - deductions) stored,
  payment_method text,
  phone text,
  bank text,
  bank_branch text,
  bank_code text,
  branch_code text,
  account_name text,
  account_number text,
  payroll_number text,
  check (days_amount + additions - deductions >= 0),
  check ((additions = 0 and deductions = 0) or nullif(btrim(adjustment_note), '') is not null),
  unique (run_id, employee_number)
);
create index if not exists casual_pay_lines_tenant_employee on public.casual_pay_lines (tenant_id, employee_number);

-- ---------------------------------------------------------------------------------------------
-- 5. days worked
-- ---------------------------------------------------------------------------------------------
create table if not exists public.casual_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null,
  work_date date not null,
  portion text not null check (portion in ('full', 'half', 'absent')),
  daily_rate numeric(12, 2) not null check (daily_rate > 0),   -- their rate when the day was recorded
  amount numeric(14, 2) generated always as (
    case portion when 'full' then daily_rate when 'half' then round(daily_rate / 2, 2) else 0 end
  ) stored,
  status text not null default 'submitted' check (status in ('submitted', 'approved')),
  source text not null default 'payroll' check (source in ('payroll', 'upload', 'supervisor')),
  entered_by uuid default auth.uid() references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  pay_run_id uuid references public.casual_pay_runs(id) on delete restrict,   -- set when a run with it is approved
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, employee_number, work_date)
);
create index if not exists casual_days_tenant_date on public.casual_days (tenant_id, work_date);
create index if not exists casual_days_run on public.casual_days (pay_run_id);

-- ---------------------------------------------------------------------------------------------
-- 6. access
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['casual_days', 'casual_pay_runs', 'casual_pay_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- days: payroll and the casual's supervisor (HR reads them, for the day-limit warning); the trigger decides the rest
drop policy if exists involved on public.casual_days;
create policy involved on public.casual_days for all to authenticated
  using ((select public.manages_work()) or employee_number in (select public.supervised_employee_numbers()))
  with check ((select public.manages_work()) or employee_number in (select public.supervised_employee_numbers()));
drop policy if exists hr_read on public.casual_days;
create policy hr_read on public.casual_days for select to authenticated
  using ((select public.has_module('employees')));

-- pay runs: payroll only
drop policy if exists payroll_all on public.casual_pay_runs;
create policy payroll_all on public.casual_pay_runs for all to authenticated
  using ((select public.manages_work())) with check ((select public.manages_work()));
drop policy if exists payroll_all on public.casual_pay_lines;
create policy payroll_all on public.casual_pay_lines for all to authenticated
  using ((select public.manages_work())) with check ((select public.manages_work()));

-- ---------------------------------------------------------------------------------------------
-- 7. rules for days
-- ---------------------------------------------------------------------------------------------
create or replace function public.casual_day_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_payroll boolean := public.manages_work();
  v_e record;
begin
  -- an employee renumbered: only employee_number changes
  if tg_op = 'UPDATE' and current_setting('app.renumbering_worker', true) = 'on'
     and (to_jsonb(new) - 'employee_number' - 'amount') = (to_jsonb(old) - 'employee_number' - 'amount') then
    return new;
  end if;
  -- the pay run functions put days in a run, release them and mark them paid
  if tg_op = 'UPDATE' and current_setting('app.casual_pay', true) = 'on'
     and (to_jsonb(new) - 'pay_run_id' - 'paid_at' - 'amount') = (to_jsonb(old) - 'pay_run_id' - 'paid_at' - 'amount') then
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    if old.paid_at is not null then raise exception 'This day has been paid and can''t be changed'; end if;
    if old.pay_run_id is not null then raise exception 'This day is in an approved pay run and can''t be changed'; end if;
  end if;

  if tg_op = 'DELETE' then
    if auth.uid() is not null and not v_payroll and old.status = 'approved' then
      raise exception 'Only payroll can remove an approved day';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.employee_number is distinct from old.employee_number or new.work_date is distinct from old.work_date) then
    raise exception 'Remove the day and record it again instead';
  end if;

  select e."Start Date", e."Termination Date", e.daily_rate, e.worker_kind, e."First Name" into v_e
  from public.employees e where e.tenant_id = new.tenant_id and e."Employee Number" = new.employee_number;
  if not found then raise exception 'Unknown worker %', new.employee_number; end if;
  if v_e.worker_kind <> 'casual' then raise exception '% is not a casual worker', coalesce(v_e."First Name", new.employee_number); end if;
  if new.work_date > current_date then raise exception 'Days can''t be recorded ahead'; end if;
  if public.employee_start_date(v_e."Start Date") is not null and new.work_date < public.employee_start_date(v_e."Start Date") then
    raise exception '% started on %', coalesce(v_e."First Name", new.employee_number), to_char(public.employee_start_date(v_e."Start Date"), 'DD Mon YYYY');
  end if;
  if public.employee_start_date(v_e."Termination Date") is not null and new.work_date > public.employee_start_date(v_e."Termination Date")
     and new.portion <> 'absent' then
    raise exception '% finished on %', coalesce(v_e."First Name", new.employee_number), to_char(public.employee_start_date(v_e."Termination Date"), 'DD Mon YYYY');
  end if;

  if tg_op = 'INSERT' or new.portion is distinct from old.portion then
    new.daily_rate := v_e.daily_rate;
  else
    new.daily_rate := old.daily_rate;
  end if;
  new.updated_at := now();
  new.pay_run_id := case when tg_op = 'UPDATE' then old.pay_run_id end;
  new.paid_at := case when tg_op = 'UPDATE' then old.paid_at end;

  -- the server and SQL scripts are trusted
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    new.entered_by := auth.uid();
    if v_payroll then
      new.source := case when new.source = 'upload' then 'upload' else 'payroll' end;
      new.status := 'approved'; new.approved_by := auth.uid(); new.approved_at := now();
    elsif public.supervises(new.employee_number) then
      new.source := 'supervisor';
      new.status := 'submitted'; new.approved_by := null; new.approved_at := null;
    else
      raise exception 'You can only record days for your own team';
    end if;
    return new;
  end if;

  -- UPDATE
  new.source := old.source;
  new.entered_by := old.entered_by;
  if v_payroll then
    if new.status = 'approved' and (old.status <> 'approved' or new.portion is distinct from old.portion) then
      new.approved_by := auth.uid(); new.approved_at := now();
    elsif new.status = 'submitted' then
      new.approved_by := null; new.approved_at := null;
    else
      new.approved_by := old.approved_by; new.approved_at := old.approved_at;
    end if;
  else
    -- a supervisor's change waits for payroll again
    if new.status = 'approved' and old.status <> 'approved' then raise exception 'Only payroll can approve days'; end if;
    if old.status = 'approved' then raise exception 'Only payroll can change an approved day'; end if;
    new.status := 'submitted'; new.approved_by := null; new.approved_at := null;
  end if;
  return new;
end $$;

drop trigger if exists casual_day_rules on public.casual_days;
create trigger casual_day_rules before insert or update or delete on public.casual_days
  for each row execute function public.casual_day_rules();

-- ---------------------------------------------------------------------------------------------
-- 8. rules for pay runs and their lines
-- ---------------------------------------------------------------------------------------------
create or replace function public.casual_pay_run_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.casual_pay', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then raise exception 'Start a pay run from the Casual workers page'; end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Only a draft pay run can be deleted'; end if;
    return old;
  end if;
  -- direct changes: only the notes, while it is a draft
  if old.status <> 'draft' then raise exception 'This pay run is % and can''t be changed', old.status; end if;
  if (to_jsonb(new) - 'notes' - 'updated_at') is distinct from (to_jsonb(old) - 'notes' - 'updated_at') then
    raise exception 'Approve or mark a pay run paid with its buttons';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists casual_pay_run_rules on public.casual_pay_runs;
create trigger casual_pay_run_rules before insert or update or delete on public.casual_pay_runs
  for each row execute function public.casual_pay_run_rules();

create or replace function public.casual_pay_line_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if current_setting('app.casual_pay', true) = 'on'
     or (tg_op = 'UPDATE' and current_setting('app.renumbering_worker', true) = 'on') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'UPDATE' then raise exception 'Pay run lines follow the days worked; refresh the run instead'; end if;
  select r.status into v_status from public.casual_pay_runs r where r.id = old.run_id;
  if v_status <> 'draft' then raise exception 'This pay run is % and its lines can''t be changed', v_status; end if;
  -- only the one-off additions and deductions, with their note
  if (to_jsonb(new) - 'additions' - 'deductions' - 'adjustment_note' - 'net_pay')
     is distinct from (to_jsonb(old) - 'additions' - 'deductions' - 'adjustment_note' - 'net_pay') then
    raise exception 'Only additions, deductions and their note can be changed';
  end if;
  return new;
end $$;

drop trigger if exists casual_pay_line_rules on public.casual_pay_lines;
create trigger casual_pay_line_rules before insert or update or delete on public.casual_pay_lines
  for each row execute function public.casual_pay_line_rules();

-- ---------------------------------------------------------------------------------------------
-- 9. working out and moving a pay run on
-- ---------------------------------------------------------------------------------------------
-- (re)work out a draft run's lines from the approved days in its period not yet in another run; keeps each person's
-- additions and deductions. Not callable directly: the functions below use it.
create or replace function public.casual_pay_run_lines(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.casual_pay_runs;
begin
  select * into r from public.casual_pay_runs where id = p_run;
  perform set_config('app.casual_pay', 'on', true);

  insert into public.casual_pay_lines as l (
    tenant_id, run_id, employee_number, worker_name, full_days, half_days, daily_rate, days_amount, payment_method, phone,
    bank, bank_branch, bank_code, branch_code, account_name, account_number, payroll_number)
  select r.tenant_id, r.id, e."Employee Number", btrim(concat_ws(' ', e."First Name", e."Middle Name", e."Last Name")),
         d.full_days, d.half_days, e.daily_rate, d.amount, coalesce(e.payment_method, 'M-Pesa'), e."Mobile Number",
         e."Bank", e."Bank Branch", e.bank_code, e.branch_code, e.account_number_name, e."Account Number", e."Payroll Number"
  from (
    select cd.employee_number,
           count(*) filter (where cd.portion = 'full')::int as full_days,
           count(*) filter (where cd.portion = 'half')::int as half_days,
           coalesce(sum(cd.amount), 0) as amount
    from public.casual_days cd
    where cd.tenant_id = r.tenant_id and cd.work_date between r.period_start and r.period_end
      and cd.status = 'approved' and cd.pay_run_id is null and cd.portion in ('full', 'half')
    group by cd.employee_number
  ) d
  join public.employees e on e.tenant_id = r.tenant_id and e."Employee Number" = d.employee_number
  on conflict (run_id, employee_number) do update set
    worker_name = excluded.worker_name, full_days = excluded.full_days, half_days = excluded.half_days,
    daily_rate = excluded.daily_rate, days_amount = excluded.days_amount, payment_method = excluded.payment_method,
    phone = excluded.phone, bank = excluded.bank, bank_branch = excluded.bank_branch, bank_code = excluded.bank_code,
    branch_code = excluded.branch_code, account_name = excluded.account_name, account_number = excluded.account_number,
    payroll_number = excluded.payroll_number;

  -- people with no paid days left: dropped, unless an addition was given to them
  update public.casual_pay_lines l set full_days = 0, half_days = 0, days_amount = 0, deductions = 0
  where l.run_id = r.id and l.additions > 0 and not exists (
    select 1 from public.casual_days cd
    where cd.tenant_id = r.tenant_id and cd.employee_number = l.employee_number
      and cd.work_date between r.period_start and r.period_end
      and cd.status = 'approved' and cd.pay_run_id is null and cd.portion in ('full', 'half'));
  delete from public.casual_pay_lines l
  where l.run_id = r.id and l.additions = 0 and not exists (
    select 1 from public.casual_days cd
    where cd.tenant_id = r.tenant_id and cd.employee_number = l.employee_number
      and cd.work_date between r.period_start and r.period_end
      and cd.status = 'approved' and cd.pay_run_id is null and cd.portion in ('full', 'half'));
  -- a deduction can't take anyone below nothing
  update public.casual_pay_lines l set deductions = l.days_amount + l.additions
  where l.run_id = r.id and l.deductions > l.days_amount + l.additions;

  update public.casual_pay_runs set total = coalesce((select sum(net_pay) from public.casual_pay_lines where run_id = r.id), 0),
    updated_at = now()
  where id = r.id;
  perform set_config('app.casual_pay', 'off', true);
end $$;
revoke all on function public.casual_pay_run_lines(uuid) from public, anon, authenticated;

create or replace function public.casual_pay_run_open(p_run uuid, p_status text) returns public.casual_pay_runs
language plpgsql security definer set search_path = public as $$
declare
  r public.casual_pay_runs;
begin
  if not public.manages_work() then raise exception 'Only payroll can do this' using errcode = '42501'; end if;
  select * into r from public.casual_pay_runs where id = p_run and tenant_id = public.current_tenant_id() for update;
  if not found then raise exception 'No such pay run'; end if;
  if p_status is not null and r.status <> p_status then raise exception 'This pay run is %, not %', r.status, p_status; end if;
  return r;
end $$;
revoke all on function public.casual_pay_run_open(uuid, text) from public, anon, authenticated;

create or replace function public.create_casual_pay_run(p_start date, p_end date, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.manages_work() then raise exception 'Only payroll can do this' using errcode = '42501'; end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Pick a first day, and a last day that is the same day or later' using errcode = '22023';
  end if;
  if p_end - p_start > 92 then raise exception 'A pay run covers at most 3 months' using errcode = '22023'; end if;
  if p_end > current_date then raise exception 'A pay run can''t include days still to come' using errcode = '22023'; end if;
  perform set_config('app.casual_pay', 'on', true);
  insert into public.casual_pay_runs (tenant_id, period_start, period_end, notes, created_by)
  values (public.current_tenant_id(), p_start, p_end, nullif(btrim(p_notes), ''), auth.uid())
  returning id into v_id;
  perform public.casual_pay_run_lines(v_id);
  return v_id;
end $$;
revoke all on function public.create_casual_pay_run(date, date, text) from public, anon;
grant execute on function public.create_casual_pay_run(date, date, text) to authenticated;

create or replace function public.refresh_casual_pay_run(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.casual_pay_run_open(p_run, 'draft');
  perform public.casual_pay_run_lines(p_run);
end $$;
revoke all on function public.refresh_casual_pay_run(uuid) from public, anon;
grant execute on function public.refresh_casual_pay_run(uuid) to authenticated;

-- approve: every day in the period must be approved; the lines are worked out one last time and fixed, and the days
-- in it are locked
create or replace function public.approve_casual_pay_run(p_run uuid) returns public.casual_pay_runs
language plpgsql security definer set search_path = public as $$
declare
  r public.casual_pay_runs;
  v_waiting integer;
begin
  r := public.casual_pay_run_open(p_run, 'draft');
  select count(*) into v_waiting from public.casual_days d
  where d.tenant_id = r.tenant_id and d.work_date between r.period_start and r.period_end
    and d.status = 'submitted' and d.pay_run_id is null;
  if v_waiting > 0 then
    raise exception '% day% in this period still wait% for approval', v_waiting,
      case when v_waiting = 1 then '' else 's' end, case when v_waiting = 1 then 's' else '' end;
  end if;
  perform public.casual_pay_run_lines(p_run);
  if not exists (select 1 from public.casual_pay_lines where run_id = p_run) then
    raise exception 'There is nobody to pay in this period';
  end if;

  perform set_config('app.casual_pay', 'on', true);
  update public.casual_days d set pay_run_id = p_run
  where d.tenant_id = r.tenant_id and d.work_date between r.period_start and r.period_end
    and d.status = 'approved' and d.pay_run_id is null
    and d.employee_number in (select l.employee_number from public.casual_pay_lines l where l.run_id = p_run);
  update public.casual_pay_runs set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_run returning * into r;
  perform set_config('app.casual_pay', 'off', true);
  return r;
end $$;
revoke all on function public.approve_casual_pay_run(uuid) from public, anon;
grant execute on function public.approve_casual_pay_run(uuid) to authenticated;

-- an approved run not paid yet goes back to draft (its days are released)
create or replace function public.reopen_casual_pay_run(p_run uuid) returns public.casual_pay_runs
language plpgsql security definer set search_path = public as $$
declare
  r public.casual_pay_runs;
begin
  r := public.casual_pay_run_open(p_run, 'approved');
  perform set_config('app.casual_pay', 'on', true);
  update public.casual_days set pay_run_id = null where pay_run_id = p_run;
  update public.casual_pay_runs set status = 'draft', approved_by = null, approved_at = null, updated_at = now()
  where id = p_run returning * into r;
  perform set_config('app.casual_pay', 'off', true);
  return r;
end $$;
revoke all on function public.reopen_casual_pay_run(uuid) from public, anon;
grant execute on function public.reopen_casual_pay_run(uuid) to authenticated;

create or replace function public.mark_casual_pay_run_paid(p_run uuid, p_paid_on date default current_date) returns public.casual_pay_runs
language plpgsql security definer set search_path = public as $$
declare
  r public.casual_pay_runs;
begin
  r := public.casual_pay_run_open(p_run, 'approved');
  if p_paid_on is null or p_paid_on > current_date then raise exception 'Pick the day it was paid' using errcode = '22023'; end if;
  if p_paid_on < r.period_start then raise exception 'It can''t be paid before the period starts' using errcode = '22023'; end if;
  perform set_config('app.casual_pay', 'on', true);
  update public.casual_days set paid_at = now() where pay_run_id = p_run;
  update public.casual_pay_runs set status = 'paid', paid_on = p_paid_on, paid_by = auth.uid(), updated_at = now()
  where id = p_run returning * into r;
  perform set_config('app.casual_pay', 'off', true);
  return r;
end $$;
revoke all on function public.mark_casual_pay_run_paid(uuid, date) from public, anon;
grant execute on function public.mark_casual_pay_run_paid(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10. the s.37 warning: casuals working many days in a row
-- ---------------------------------------------------------------------------------------------
-- Each current casual's latest run of working days (full or half), where a break of up to 2 days without work (a
-- weekend, a rest day) doesn't end the run. 'over' when longer than the company's limit, 'near' within 5 days of it.
create or replace function public.casual_limit_alerts()
returns table (employee_number text, worker_name text, days_in_a_row integer, since date, last_worked date, day_limit integer, level text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_limit integer := public.casual_day_limit();
  v_all boolean := public.manages_casuals();
begin
  return query
  with worked as (
    select d.employee_number, d.work_date
    from public.casual_days d
    join public.employees e on e.tenant_id = d.tenant_id and e."Employee Number" = d.employee_number
    where d.tenant_id = public.current_tenant_id() and d.portion in ('full', 'half') and e.worker_kind = 'casual'
      and nullif(btrim(e."Termination Date"), '') is null
      and (v_all or public.supervises(d.employee_number))
  ), marked as (
    select w.*, case when w.work_date - lag(w.work_date) over (partition by w.employee_number order by w.work_date) <= 3
                     then 0 else 1 end as breaks
    from worked w
  ), grouped as (
    select m.*, sum(m.breaks) over (partition by m.employee_number order by m.work_date) as grp from marked m
  ), runs as (
    select g.employee_number, g.grp, count(*)::int as n, min(g.work_date) as since, max(g.work_date) as last_day,
           row_number() over (partition by g.employee_number order by g.grp desc) as latest
    from grouped g group by g.employee_number, g.grp
  )
  select r.employee_number, btrim(concat_ws(' ', e."First Name", e."Last Name")), r.n, r.since, r.last_day, v_limit,
         case when r.n > v_limit then 'over' else 'near' end
  from runs r
  join public.employees e on e.tenant_id = public.current_tenant_id() and e."Employee Number" = r.employee_number
  where r.latest = 1 and r.n > v_limit - 5
  order by r.n desc, 2;
end $$;
revoke all on function public.casual_limit_alerts() from public, anon;
grant execute on function public.casual_limit_alerts() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 11. renumbering, history
-- ---------------------------------------------------------------------------------------------
create or replace function public.casual_follow_renumber() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.renumbering_worker', 'on', true);
  update public.casual_days set employee_number = new."Employee Number"
  where tenant_id = new.tenant_id and employee_number = old."Employee Number";
  update public.casual_pay_lines set employee_number = new."Employee Number"
  where tenant_id = new.tenant_id and employee_number = old."Employee Number";
  perform set_config('app.renumbering_worker', 'off', true);
  return new;
end $$;

drop trigger if exists casual_follow_renumber on public.employees;
create trigger casual_follow_renumber
  after update of "Employee Number" on public.employees
  for each row when (old."Employee Number" is distinct from new."Employee Number")
  execute function public.casual_follow_renumber();

do $$
declare t text;
begin
  foreach t in array array['casual_days', 'casual_pay_runs', 'casual_pay_lines'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
      for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 12. casuals stay out of the monthly payroll, the onboarding queue and the leave engine
-- ---------------------------------------------------------------------------------------------
-- 20261012200000's payroll gate, refusing casuals too
create or replace function public.salary_history_approved_employee() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e record;
begin
  -- the backend and migrations (imports, tests) are not limited; every payroll screen saves as the signed-in user
  if auth.uid() is null then
    return new;
  end if;
  select "First Name", "Last Name", onboarding_status, worker_kind into e
  from public.employees where tenant_id = new.tenant_id and "Employee Number" = new.employee_id;
  if not found then
    raise exception 'No employee % in this company', new.employee_id using errcode = '23503';
  end if;
  if e.worker_kind = 'casual' then
    raise exception '% % (%) is a casual worker: pay them from the Casual workers page, not the monthly payroll',
      coalesce(e."First Name", ''), coalesce(e."Last Name", ''), new.employee_id
      using errcode = '23514';
  end if;
  if e.onboarding_status <> 'approved' then
    raise exception '% % (%) can''t be paid yet: their onboarding is %, not approved',
      coalesce(e."First Name", ''), coalesce(e."Last Name", ''), new.employee_id, replace(e.onboarding_status, '_', ' ')
      using errcode = '23514';
  end if;
  return new;
end $$;

-- 20261013400000's onboarding queue, without casuals (they don't go through onboarding)
drop function if exists public.onboarding_overview();
create function public.onboarding_overview()
returns table (
  id uuid, employee_number text, payroll_number text, name text, job_title text, work_email text,
  status text, submitted_at timestamptz, reviewed_at timestamptz, review_comment text,
  employee_part text[], employer_part text[], documents_outstanding text[]
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_module('employees') then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  return query
  select e.id, e."Employee Number", e."Payroll Number",
         btrim(concat_ws(' ', e."First Name", e."Middle Name", e."Last Name")), e."Job Title", e."Work Email",
         e.onboarding_status, e.onboarding_submitted_at, e.onboarding_reviewed_at, e.onboarding_review_comment,
         public.onboarding_missing(e, 'employee'), public.onboarding_missing(e, 'employer'), public.documents_outstanding(e)
  from public.employees e
  where e.tenant_id = public.current_tenant_id() and coalesce(e.worker_kind, 'employee') <> 'casual'
  order by e."First Name", e."Last Name", e."Employee Number";
end $$;
revoke all on function public.onboarding_overview() from public, anon;
grant execute on function public.onboarding_overview() to authenticated;

-- 20261017100000's leave engine, skipping casuals (they earn no leave); otherwise unchanged
create or replace function public.run_annual_leave_reset(p_year integer)
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
      return next v_new_row;
    end if;
  end loop;
end;
$$;

create or replace function public.run_leave_accrual(p_year integer, p_month integer)
returns setof public.leave_balances
language plpgsql
as $$
declare
  r record;
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
      and cp.accrual_method = 'monthly_cumulative'
      and coalesce(e.worker_kind, 'employee') <> 'casual'
  loop
    -- earned from the month they joined (or January) to p_month
    v_due := public.leave_year_allowance(r.tenant_id, r.employee_number,
      public.leave_entitlement(r.tenant_id, r.employee_number, r.leave_type_id, r.days_allotted), p_year, p_month);

    select * into v_row from public.leave_balances b
    where b.employee_number = r.employee_number and b.leave_type_id = r.leave_type_id and b.year = p_year and b.month = 0;

    if not found then
      v_carry := greatest(least(coalesce(r.prev_remaining, 0), r.carry_forward_max_days), 0);
      insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days, last_accrual_date)
      values (r.tenant_id, r.employee_number, r.leave_type_id, p_year, 0, v_due, 0, v_carry, current_date)
      returning * into v_row;
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_row.id, 'monthly_accrual', v_due + v_carry, 0, 0, 0, v_due,
         format('Year %s started: %s days earned so far + %s carried forward from %s', p_year, v_due, v_carry, p_year - 1));
      return next v_row;
    elsif v_row.accrued_days < v_due then
      v_old := v_row.accrued_days;
      update public.leave_balances set accrued_days = v_due, last_accrual_date = current_date, updated_at = now()
      where id = v_row.id returning * into v_row;
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_row.id, 'monthly_accrual', v_due - v_old, v_row.used_days, v_row.used_days, v_old, v_due,
         format('Earned %s days by month %s of %s', v_due, p_month, p_year));
      return next v_row;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
