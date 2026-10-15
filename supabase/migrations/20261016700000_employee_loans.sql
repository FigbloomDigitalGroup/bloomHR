-- Employee loans with interest: staff apply (or HR sets one up), HR approves, finance pays it outside the app and marks
-- it disbursed, and payroll takes the monthly instalment (principal + interest) back until the balance is 0.
--
--   loan_settings(tenant_id, annual_rate, interest_method, min_months, max_months, max_amount, max_salary_multiple,
--                 staff_can_apply)                 the company's terms; no row = 12% a year, reducing balance, 1-12 months
--   loan_products(name, annual_rate, interest_method, max_months, active)
--                                                  optional loan types ("School fees loan") with their own terms
--   employee_loans(employee_number, product_id, principal, annual_rate, interest_method, months, start_period, status...)
--       requested -> approved | rejected | cancelled;  approved -> disbursed | cancelled;
--       disbursed -> repaying -> completed (payroll moves these, as approved payroll months record repayments)
--   employee_loan_instalments(loan_id, instalment_no, period, payment, principal, interest, balance)
--       the amortisation schedule, built by loan_schedule() whenever the terms change (they lock once disbursed)
--   employee_loan_repayments(loan_id, pay_period, amount, run_id)
--       what payroll actually took: written when a payroll month is approved (from the payslips' "Loan repayment" lines,
--       salary_history.deduction_items entries with a loan_id), removed again if the month is reopened
--
-- The rate and method are copied onto the loan when it is approved, so changing the settings later never changes a
-- loan already given. What payroll takes in a month is everything the schedule has due up to that month less what was
-- already repaid, so a month where pay could not cover the instalment carries the shortfall to the next
-- (src/lib/loans.ts, loanDueFor). Nothing here moves money.
--
-- Access: everyone in the company reads the settings and loan types (staff need them for the preview); HR, admins and
-- payroll users manage everything; staff see their own loans and their schedules, ask for a loan for themselves and
-- withdraw a request still waiting. Each company only ever sees its own.

-- ---------------------------------------------------------------------------------------------
-- 1. who manages loans
-- ---------------------------------------------------------------------------------------------
create or replace function public.manages_loans() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.role in ('ADMIN', 'HR') from public.user_profiles p where p.user_id = auth.uid()), false)
      or public.has_module('payroll')
$$;
revoke all on function public.manages_loans() from public, anon;
grant execute on function public.manages_loans() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.loan_settings (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  annual_rate numeric not null default 12 check (annual_rate >= 0 and annual_rate <= 100),
  interest_method text not null default 'reducing_balance' check (interest_method in ('reducing_balance', 'flat')),
  min_months integer not null default 1 check (min_months between 1 and 120),
  max_months integer not null default 12 check (max_months between 1 and 120),
  -- the most anyone may borrow: a fixed amount, a multiple of their basic salary, both (the lower wins) or neither
  max_amount numeric check (max_amount is null or max_amount > 0),
  max_salary_multiple numeric check (max_salary_multiple is null or max_salary_multiple > 0),
  staff_can_apply boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  check (min_months <= max_months)
);

create table if not exists public.loan_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(name) <= 60),
  annual_rate numeric not null check (annual_rate >= 0 and annual_rate <= 100),
  interest_method text not null default 'reducing_balance' check (interest_method in ('reducing_balance', 'flat')),
  max_months integer not null check (max_months between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists loan_products_tenant_name on public.loan_products (tenant_id, lower(btrim(name)));

create table if not exists public.employee_loans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null,
  product_id uuid references public.loan_products(id) on delete restrict,
  -- the loan type's name when the loan was made, for the payslip line
  product_name text,
  principal numeric not null check (principal > 0),
  -- filled in from the loan type or the company's settings (the trigger), and copied again on approval
  annual_rate numeric not null check (annual_rate >= 0 and annual_rate <= 100),
  interest_method text not null check (interest_method in ('reducing_balance', 'flat')),
  months integer not null check (months between 1 and 120),
  -- the first month payroll takes an instalment ('YYYY-MM')
  start_period text not null check (start_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  monthly_instalment numeric,
  total_interest numeric,
  total_repayable numeric,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'disbursed', 'repaying', 'completed', 'cancelled')),
  reason text check (reason is null or length(reason) <= 1000),
  decided_by uuid references auth.users(id) on delete set null,
  decided_by_email text,
  decided_at timestamptz,
  decision_comment text check (decision_comment is null or length(decision_comment) <= 1000),
  disbursed_by uuid references auth.users(id) on delete set null,
  disbursed_by_email text,
  disbursed_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, employee_number) references public.employees(tenant_id, "Employee Number") on update cascade on delete cascade
);
create index if not exists employee_loans_tenant_status on public.employee_loans (tenant_id, status);
create index if not exists employee_loans_tenant_employee on public.employee_loans (tenant_id, employee_number);

create table if not exists public.employee_loan_instalments (
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  loan_id uuid not null references public.employee_loans(id) on delete cascade,
  instalment_no integer not null check (instalment_no >= 1),
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  payment numeric not null,
  principal numeric not null,
  interest numeric not null,
  balance numeric not null,
  primary key (loan_id, instalment_no)
);
create index if not exists employee_loan_instalments_tenant on public.employee_loan_instalments (tenant_id);

create table if not exists public.employee_loan_repayments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  loan_id uuid not null references public.employee_loans(id) on delete cascade,
  pay_period text not null check (pay_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount numeric not null check (amount >= 0),
  run_id uuid references public.payroll_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (loan_id, pay_period)
);
create index if not exists employee_loan_repayments_tenant on public.employee_loan_repayments (tenant_id);
create index if not exists employee_loan_repayments_run on public.employee_loan_repayments (run_id);

-- ---------------------------------------------------------------------------------------------
-- 3. the schedule (the same sums as src/lib/loans.ts loanSchedule: whole shillings, the last instalment evens out)
-- ---------------------------------------------------------------------------------------------
--   reducing balance: a fixed payment P·r / (1 − (1 + r)^−n), r the monthly rate; each month's interest is r on what
--                     is still owed, the rest of the payment is principal. A 0% loan is P / n a month.
--   flat:             interest is the annual rate on the whole amount for the whole term, spread evenly with the
--                     principal.
create or replace function public.loan_schedule(p_principal numeric, p_annual_rate numeric, p_method text, p_months integer, p_start text)
returns table (instalment_no integer, period text, payment numeric, principal numeric, interest numeric, balance numeric)
language plpgsql immutable set search_path = public as $$
declare
  n integer := greatest(coalesce(p_months, 1), 1);
  rate numeric := coalesce(p_annual_rate, 0);
  bal numeric := p_principal;
  a numeric;
  part_principal numeric;
  part_interest numeric;
  total_interest numeric;
  i integer;
  first_month date := to_date(p_start || '-01', 'YYYY-MM-DD');
begin
  if p_principal is null or p_principal <= 0 or p_start is null then
    return;
  end if;
  if p_method = 'flat' then
    total_interest := round(p_principal * rate * n / 1200);
    for i in 1..n loop
      if i = n then
        part_principal := bal;
        part_interest := total_interest - round(total_interest / n) * (n - 1);
      else
        part_principal := round(p_principal / n);
        part_interest := round(total_interest / n);
      end if;
      bal := bal - part_principal;
      return query select i, to_char(first_month + make_interval(months => i - 1), 'YYYY-MM'),
        part_principal + part_interest, part_principal, part_interest, bal;
    end loop;
  else
    if rate = 0 then
      a := round(p_principal / n);
    else
      a := round(p_principal * (rate / 1200) / (1 - power(1 + rate / 1200, -n)));
    end if;
    for i in 1..n loop
      part_interest := round(bal * rate / 1200);
      part_principal := case when i = n then bal else greatest(least(a - part_interest, bal), 0) end;
      bal := bal - part_principal;
      return query select i, to_char(first_month + make_interval(months => i - 1), 'YYYY-MM'),
        part_principal + part_interest, part_principal, part_interest, bal;
    end loop;
  end if;
end $$;
grant execute on function public.loan_schedule(numeric, numeric, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. the rules a loan follows (whoever writes it)
-- ---------------------------------------------------------------------------------------------
create or replace function public.employee_loans_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_manager boolean := public.manages_loans();
  -- payroll moving a loan between disbursed, repaying and completed (refresh_loan_statuses)
  v_system boolean := coalesce(current_setting('figbloom.loan_payroll', true), '') = 'on';
  s public.loan_settings;
  p public.loan_products;
  v_max_months integer;
  v_limit numeric;
  v_basic numeric;
  v_me_email text;
  v_this_month text := to_char(now(), 'YYYY-MM');
  v_terms_changed boolean;
  v_moving boolean;
begin
  select * into s from public.loan_settings where tenant_id = new.tenant_id;
  if not found then
    s.annual_rate := 12;
    s.interest_method := 'reducing_balance';
    s.min_months := 1;
    s.max_months := 12;
    s.staff_can_apply := true;
  end if;
  if new.product_id is not null then
    select * into p from public.loan_products where id = new.product_id and tenant_id = new.tenant_id;
    if not found then
      raise exception 'Unknown loan type';
    end if;
  end if;
  select email into v_me_email from auth.users where id = auth.uid();

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.decided_by := null; new.decided_by_email := null; new.decided_at := null;
    new.disbursed_by := null; new.disbursed_by_email := null; new.disbursed_at := null;
    new.cancelled_at := null; new.completed_at := null;
    if new.status not in ('requested', 'approved') then
      raise exception 'A new loan is either a request or an approved loan';
    end if;
    if not v_manager then
      if new.employee_number is distinct from public.current_employee_number() then
        raise exception 'You can only apply for a loan for yourself';
      end if;
      if new.status <> 'requested' then
        raise exception 'A new loan starts as a request';
      end if;
      if not s.staff_can_apply then
        raise exception 'Loan applications are closed. Please speak to HR.';
      end if;
      if p.id is not null and not p.active then
        raise exception 'That loan type is no longer offered';
      end if;
      if exists (select 1 from public.employee_loans l
                 where l.tenant_id = new.tenant_id and l.employee_number = new.employee_number and l.status = 'requested') then
        raise exception 'You already have a loan request waiting for a decision';
      end if;
      -- staff borrow on the company's terms, never their own
      new.annual_rate := null;
      new.interest_method := null;
    end if;
    new.product_name := p.name;
    new.annual_rate := coalesce(new.annual_rate, p.annual_rate, s.annual_rate);
    new.interest_method := coalesce(new.interest_method, p.interest_method, s.interest_method);
    -- payroll starts the month after, unless HR says otherwise
    new.start_period := coalesce(new.start_period, to_char(now() + interval '1 month', 'YYYY-MM'));
    v_terms_changed := true;
    v_moving := new.status = 'approved';
  else
    if new.tenant_id <> old.tenant_id or new.id <> old.id then
      raise exception 'A loan can''t move to another company';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    v_moving := new.status is distinct from old.status;
    v_terms_changed := (new.principal, new.annual_rate, new.interest_method, new.months, new.start_period, new.product_id)
      is distinct from (old.principal, old.annual_rate, old.interest_method, old.months, old.start_period, old.product_id);

    if not v_manager and not v_system then
      -- staff may only withdraw their own request that is still waiting
      if not (old.status = 'requested' and new.status = 'cancelled'
              and (to_jsonb(new) - 'status' - 'updated_at' - 'cancelled_at') = (to_jsonb(old) - 'status' - 'updated_at' - 'cancelled_at')) then
        raise exception 'Only HR can change a loan';
      end if;
    end if;

    if v_moving and not (
      (old.status = 'requested' and new.status in ('approved', 'rejected', 'cancelled'))
      or (old.status = 'approved' and new.status in ('disbursed', 'cancelled'))
      or (v_system and old.status in ('disbursed', 'repaying', 'completed') and new.status in ('disbursed', 'repaying', 'completed'))
    ) then
      raise exception 'A loan that is % can''t become %', old.status, new.status;
    end if;

    if v_terms_changed and old.status not in ('requested', 'approved') then
      raise exception 'A loan''s amount, interest and months can''t change once it is %', old.status;
    end if;
    if new.product_id is distinct from old.product_id then
      new.product_name := p.name;
    end if;

    -- only these steps stamp who did what
    if not v_moving then
      new.decided_by := old.decided_by; new.decided_by_email := old.decided_by_email; new.decided_at := old.decided_at;
      new.disbursed_by := old.disbursed_by; new.disbursed_by_email := old.disbursed_by_email; new.disbursed_at := old.disbursed_at;
      new.cancelled_at := old.cancelled_at; new.completed_at := old.completed_at;
    end if;
  end if;

  if v_moving and new.status in ('approved', 'rejected') then
    if new.employee_number = public.current_employee_number() then
      raise exception 'Someone else must decide on your own loan';
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.decision_comment), '') = '' then
      raise exception 'Give a reason for turning the loan down';
    end if;
    new.decided_by := auth.uid();
    new.decided_by_email := v_me_email;
    new.decided_at := now();
  end if;

  if v_moving and new.status = 'approved' then
    -- the terms are copied now, so later changes to the settings never change this loan; an approver who set the rate
    -- or method in the same step keeps theirs
    if tg_op = 'UPDATE' and (new.annual_rate, new.interest_method) is not distinct from (old.annual_rate, old.interest_method) then
      new.annual_rate := coalesce(p.annual_rate, s.annual_rate);
      new.interest_method := coalesce(p.interest_method, s.interest_method);
      v_terms_changed := v_terms_changed or (new.annual_rate, new.interest_method) is distinct from (old.annual_rate, old.interest_method);
    end if;
  end if;

  if v_moving and new.status = 'disbursed' and tg_op = 'UPDATE' and old.status = 'approved' then
    new.disbursed_by := auth.uid();
    new.disbursed_by_email := v_me_email;
    new.disbursed_at := now();
    -- paid out after the first instalment was due: payroll starts this month instead of taking several at once
    if new.start_period < v_this_month then
      new.start_period := v_this_month;
      v_terms_changed := true;
    end if;
  end if;
  if v_moving and new.status = 'cancelled' then
    new.cancelled_at := now();
  end if;
  if v_moving and new.status = 'completed' then
    new.completed_at := now();
  elsif v_moving and tg_op = 'UPDATE' and old.status = 'completed' then
    new.completed_at := null;
  end if;

  -- the company's limits, for what staff ask for
  if not v_manager and not v_system and new.status = 'requested' and v_terms_changed then
    v_max_months := coalesce(p.max_months, s.max_months);
    if new.months < s.min_months or new.months > v_max_months then
      raise exception 'Choose between % and % months', s.min_months, v_max_months;
    end if;
    select nullif(regexp_replace(coalesce("Basic Salary"::text, ''), '[^0-9.]', '', 'g'), '')::numeric into v_basic
    from public.employees where tenant_id = new.tenant_id and "Employee Number" = new.employee_number;
    v_limit := least(s.max_amount, case when s.max_salary_multiple is not null then coalesce(v_basic, 0) * s.max_salary_multiple end);
    if v_limit is not null and new.principal > v_limit then
      raise exception 'The most you can borrow is %', public.kes(v_limit);
    end if;
  end if;

  if v_terms_changed then
    select sch.payment into new.monthly_instalment
    from public.loan_schedule(new.principal, new.annual_rate, new.interest_method, new.months, new.start_period) sch
    where sch.instalment_no = 1;
    select sum(sch.interest), sum(sch.payment) into new.total_interest, new.total_repayable
    from public.loan_schedule(new.principal, new.annual_rate, new.interest_method, new.months, new.start_period) sch;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists employee_loans_guard on public.employee_loans;
create trigger employee_loans_guard before insert or update on public.employee_loans
  for each row execute function public.employee_loans_guard();

-- after a loan is saved: its schedule follows its terms, and the people concerned hear of it
create or replace function public.employee_loans_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
  who text;
  what text;
  month_name text := to_char(to_date(new.start_period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
begin
  if tg_op = 'INSERT' or (new.principal, new.annual_rate, new.interest_method, new.months, new.start_period)
     is distinct from (old.principal, old.annual_rate, old.interest_method, old.months, old.start_period) then
    delete from public.employee_loan_instalments where loan_id = new.id;
    insert into public.employee_loan_instalments (tenant_id, loan_id, instalment_no, period, payment, principal, interest, balance)
    select new.tenant_id, new.id, s.instalment_no, s.period, s.payment, s.principal, s.interest, s.balance
    from public.loan_schedule(new.principal, new.annual_rate, new.interest_method, new.months, new.start_period) s;
  end if;

  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  what := coalesce(new.product_name, 'loan');
  if tg_op = 'INSERT' and new.status = 'requested' then
    select * into e from public.employees where tenant_id = new.tenant_id and "Employee Number" = new.employee_number;
    who := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), new.employee_number);
    insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message)
    values (new.tenant_id, new.employee_number, who, e."Work Email", 'loan_requested', 'Loan request to review',
      who || ' asked for a ' || lower(what) || ' of ' || public.kes(new.principal) || ' over ' || new.months || ' months.'
      || public.with_note('Reason', new.reason));
  elsif new.status = 'approved' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_approved', 'Loan approved',
      'Your ' || lower(what) || ' of ' || public.kes(new.principal) || ' was approved: ' || public.kes(new.monthly_instalment)
      || ' a month for ' || new.months || ' months from ' || month_name || ' pay.' || public.with_note('Notes', new.decision_comment));
  elsif new.status = 'rejected' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_rejected', 'Loan not approved',
      'Your ' || lower(what) || ' request of ' || public.kes(new.principal) || ' was not approved.'
      || public.with_note('Reason', new.decision_comment));
  elsif new.status = 'disbursed' and tg_op = 'UPDATE' and old.status = 'approved' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_disbursed', 'Loan paid out',
      'Your ' || lower(what) || ' of ' || public.kes(new.principal) || ' has been paid out. Repayments come off your pay from '
      || month_name || '.');
  elsif new.status = 'completed' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_repaid', 'Loan repaid',
      'Your ' || lower(what) || ' of ' || public.kes(new.principal) || ' is fully repaid.');
  end if;
  return null;
end $$;

drop trigger if exists employee_loans_after on public.employee_loans;
create trigger employee_loans_after after insert or update on public.employee_loans
  for each row execute function public.employee_loans_after();

-- ---------------------------------------------------------------------------------------------
-- 5. payroll: an approved month records what its payslips took; reopening it takes that back
-- ---------------------------------------------------------------------------------------------
-- Disbursed -> repaying -> completed, from what has been repaid.
create or replace function public.refresh_loan_statuses(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('figbloom.loan_payroll', 'on', true);
  update public.employee_loans l
  set status = x.next_status
  from (
    select l2.id,
      case when coalesce(r.repaid, 0) >= l2.total_repayable then 'completed'
           when coalesce(r.repaid, 0) > 0 then 'repaying'
           else 'disbursed' end as next_status
    from public.employee_loans l2
    left join (select loan_id, sum(amount) as repaid from public.employee_loan_repayments group by loan_id) r on r.loan_id = l2.id
    where l2.tenant_id = p_tenant and l2.status in ('disbursed', 'repaying', 'completed')
  ) x
  where l.id = x.id and l.status <> x.next_status;
  perform set_config('figbloom.loan_payroll', 'off', true);
end $$;
revoke all on function public.refresh_loan_statuses(uuid) from public, anon, authenticated;

create or replace function public.payroll_run_loan_repayments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  if old.status = 'draft' and new.status = 'approved' then
    insert into public.employee_loan_repayments (tenant_id, loan_id, pay_period, amount, run_id)
    select new.tenant_id, l.id, new.pay_period, sum((i.item->>'amount')::numeric), new.id
    from public.salary_history h
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(h.deduction_items) = 'array' then h.deduction_items else '[]'::jsonb end) as i(item)
    join public.employee_loans l
      on l.id::text = i.item->>'loan_id' and l.tenant_id = new.tenant_id and l.employee_number = h.employee_id
    where h.run_id = new.id and (i.item->>'amount') ~ '^\d+(\.\d+)?$'
      and l.status in ('disbursed', 'repaying', 'completed')
    group by l.id
    on conflict (loan_id, pay_period) do update set amount = excluded.amount, run_id = excluded.run_id;
  elsif old.status = 'approved' and new.status = 'draft' then
    delete from public.employee_loan_repayments where run_id = new.id;
  else
    return null;
  end if;
  perform public.refresh_loan_statuses(new.tenant_id);
  return null;
end $$;

drop trigger if exists payroll_run_loan_repayments on public.payroll_runs;
create trigger payroll_run_loan_repayments after update of status on public.payroll_runs
  for each row execute function public.payroll_run_loan_repayments();

-- ---------------------------------------------------------------------------------------------
-- 6. access
-- ---------------------------------------------------------------------------------------------
-- the signed-in employee's own loans, worked out once per query
create or replace function public.my_loan_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select l.id from public.employee_loans l
  where l.tenant_id = public.current_tenant_id() and l.employee_number = public.current_employee_number()
$$;
revoke all on function public.my_loan_ids() from public, anon;
grant execute on function public.my_loan_ids() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['loan_settings', 'loan_products', 'employee_loans', 'employee_loan_instalments', 'employee_loan_repayments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- settings and loan types: everyone in the company reads them; HR, admins and payroll change them
drop policy if exists company_read on public.loan_settings;
create policy company_read on public.loan_settings for select to authenticated using (true);
drop policy if exists manage on public.loan_settings;
create policy manage on public.loan_settings for all to authenticated
  using ((select public.manages_loans())) with check ((select public.manages_loans()));

drop policy if exists company_read on public.loan_products;
create policy company_read on public.loan_products for select to authenticated using (true);
drop policy if exists manage on public.loan_products;
create policy manage on public.loan_products for all to authenticated
  using ((select public.manages_loans())) with check ((select public.manages_loans()));

-- loans: HR, admins and payroll all of them; staff their own (the guard limits what they may do)
drop policy if exists manage on public.employee_loans;
create policy manage on public.employee_loans for all to authenticated
  using ((select public.manages_loans())) with check ((select public.manages_loans()));
drop policy if exists own_select on public.employee_loans;
create policy own_select on public.employee_loans for select to authenticated
  using (employee_number = (select public.current_employee_number()));
drop policy if exists own_insert on public.employee_loans;
create policy own_insert on public.employee_loans for insert to authenticated
  with check (employee_number = (select public.current_employee_number()) and status = 'requested');
drop policy if exists own_update on public.employee_loans;
create policy own_update on public.employee_loans for update to authenticated
  using (employee_number = (select public.current_employee_number()) and status = 'requested')
  with check (employee_number = (select public.current_employee_number()));

-- the schedule and the repayments: read only (the triggers write them)
drop policy if exists read_own_or_manage on public.employee_loan_instalments;
create policy read_own_or_manage on public.employee_loan_instalments for select to authenticated
  using ((select public.manages_loans()) or loan_id in (select public.my_loan_ids()));
drop policy if exists read_own_or_manage on public.employee_loan_repayments;
create policy read_own_or_manage on public.employee_loan_repayments for select to authenticated
  using ((select public.manages_loans()) or loan_id in (select public.my_loan_ids()));

-- ---------------------------------------------------------------------------------------------
-- 7. notifications: HR hears of a request; the employee of the decision, the payout and the last repayment
-- ---------------------------------------------------------------------------------------------
alter table public.hr_notifications drop constraint if exists hr_notifications_notification_type_check;
alter table public.hr_notifications add constraint hr_notifications_notification_type_check check (notification_type in (
  'contract_expiring', 'probation_expiring', 'leave_recommended', 'leave_approved', 'leave_rejected', 'leave_year_end_reminder',
  'document_accepted', 'document_rejected', 'onboarding_approved', 'onboarding_changes_requested', 'photo_removed',
  'document_requested',
  'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
  'payslip_ready', 'salary_paid', 'expense_approved', 'expense_rejected', 'phone_change_approved', 'phone_change_rejected',
  'incident_update', 'warning_issued', 'suspended', 'reactivated', 'employment_update', 'leave_scheduled', 'policy_to_accept',
  'task_assigned', 'asset_assigned',
  -- from the approval workflows (20261015800000): every type added since must stay in this list
  'approval_needed', 'approval_progress',
  'exit_requested', 'exit_approved', 'exit_declined',
  'application_received',
  'loan_requested', 'loan_disbursed', 'loan_repaid'
));

-- a loan request to decide is for HR (the employee's bell doesn't show it, and it isn't emailed to them)
create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested')
$$;
