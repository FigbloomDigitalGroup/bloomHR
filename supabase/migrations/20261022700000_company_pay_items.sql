-- The company's standard deductions, allowances and benefits, applied automatically to the people they cover.
--
-- Until now each deduction (deduction_types / employee_deductions) and earning (earning_types / employee_earnings)
-- was entered person by person, and a casual pay run only had a one-off "Add or deduct" per line. Companies asked for
-- "deductions like lunch for casual workers" and to "set the company's deductions and benefits" once. This adds:
--
--   company_pay_items(tenant_id, name, kind, amount_type, amount, applies_to, scope_id, employee_numbers,
--                     tax_treatment, tax_rule_id, tax_source, tax_confirmed_by, tax_confirmed_at, active, notes)
--       kind          deduction | allowance (cash) | benefit (non-cash)
--       amount_type   fixed_monthly (once per casual pay run) | per_day (per day worked) | percent_of_basic (0-100)
--       applies_to    all (monthly payroll) | department | branch | job_group (scope_id = its id) | casuals | chosen
--                     (employee_numbers, casual workers included)
--       tax_treatment taxable | not_taxable | reduces_taxable_pay | relief | depends, confirmed by a person before it
--                     is saved: from the cited rules table (src/lib/kenyaTaxTreatment.ts, tax_rule_id) or from the
--                     AI's suggestion (ai_routes.js "tax_treatment"). Who confirmed it, and when, is recorded here.
--   The monthly payroll applies them in the browser through its existing item mechanisms (src/lib/payItems.ts):
--   deduction lines, earning lines and the employee's benefit / tax detail figures. The PAYE engine is unchanged.
--
--   casual_pay_lines.standing_additions / standing_deductions / standing_items
--       a casual pay run's line now carries the standing items that cover the worker (applies_to 'casuals' or
--       'chosen'), worked out with the days: per day worked (full days + half of each half day) x amount, once per run,
--       or a % of the days' pay. The one-off additions and deductions stay as they were, on top.
--       net_pay = days_amount + standing_additions + additions - standing_deductions - deductions, never below 0.
--       With the company's deduction cap on (company_payroll_settings.deduction_cap, the default), all deductions
--       together stay within two-thirds of the line's wages (Employment Act 2007 s.19(3)): standing deductions stop
--       at the limit and a one-off deduction over it is refused.
--
-- Who does what: payroll (the 'payroll' module) manages the items; whoever runs casual pay ('work-records' or
-- 'payroll') can read them. Defensive throughout: safe to run again, and on companies with no casual pay runs.

-- ---------------------------------------------------------------------------------------------
-- 1. the catalogue
-- ---------------------------------------------------------------------------------------------
create table if not exists public.company_pay_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  kind text not null check (kind in ('deduction', 'allowance', 'benefit')),
  amount_type text not null default 'fixed_monthly' check (amount_type in ('fixed_monthly', 'per_day', 'percent_of_basic')),
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  applies_to text not null default 'all' check (applies_to in ('all', 'department', 'branch', 'job_group', 'casuals', 'chosen')),
  scope_id uuid,
  employee_numbers text[] not null default '{}',
  tax_treatment text not null check (tax_treatment in ('taxable', 'not_taxable', 'reduces_taxable_pay', 'relief', 'depends')),
  tax_rule_id text check (tax_rule_id is null or char_length(tax_rule_id) <= 60),
  tax_source text check (tax_source is null or char_length(tax_source) <= 600),
  tax_confirmed_by uuid default auth.uid() references auth.users(id) on delete set null,
  tax_confirmed_at timestamptz not null default now(),
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_type <> 'percent_of_basic' or amount <= 100),
  check (applies_to not in ('department', 'branch', 'job_group') or scope_id is not null),
  check (applies_to <> 'chosen' or cardinality(employee_numbers) > 0)
);

create unique index if not exists company_pay_items_tenant_name on public.company_pay_items (tenant_id, lower(btrim(name)));
create index if not exists company_pay_items_tenant_active on public.company_pay_items (tenant_id) where active;

-- the tenant can't be moved; a change of tax treatment records who confirmed it and when
create or replace function public.company_pay_item_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then raise exception 'A pay item can''t move to another company'; end if;
    if new.tax_treatment is distinct from old.tax_treatment or new.tax_source is distinct from old.tax_source
       or new.tax_rule_id is distinct from old.tax_rule_id then
      new.tax_confirmed_by := auth.uid();
      new.tax_confirmed_at := now();
    else
      new.tax_confirmed_by := old.tax_confirmed_by;
      new.tax_confirmed_at := old.tax_confirmed_at;
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.tax_confirmed_by := auth.uid();
    new.tax_confirmed_at := now();
  end if;
  new.name := btrim(new.name);
  -- only the chosen scope keeps a list of people
  if new.applies_to <> 'chosen' then new.employee_numbers := '{}'; end if;
  if new.applies_to not in ('department', 'branch', 'job_group') then new.scope_id := null; end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists company_pay_item_rules on public.company_pay_items;
create trigger company_pay_item_rules before insert or update on public.company_pay_items
  for each row execute function public.company_pay_item_rules();

alter table public.company_pay_items enable row level security;
drop policy if exists tenant_isolation on public.company_pay_items;
create policy tenant_isolation on public.company_pay_items as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
-- payroll manages them
drop policy if exists module_access on public.company_pay_items;
create policy module_access on public.company_pay_items for all to authenticated
  using ((select public.has_module('payroll'))) with check ((select public.has_module('payroll')));
-- whoever pays casuals sees what their pay runs take
drop policy if exists work_read on public.company_pay_items;
create policy work_read on public.company_pay_items for select to authenticated
  using ((select public.manages_work()));
revoke all on public.company_pay_items from anon;

-- renumbering an employee follows through to the people an item was chosen for
create or replace function public.company_pay_items_follow_renumber() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.company_pay_items
  set employee_numbers = array_replace(employee_numbers, old."Employee Number", new."Employee Number")
  where tenant_id = new.tenant_id and old."Employee Number" = any(employee_numbers);
  return new;
end $$;

drop trigger if exists company_pay_items_follow_renumber on public.employees;
create trigger company_pay_items_follow_renumber
  after update of "Employee Number" on public.employees
  for each row when (old."Employee Number" is distinct from new."Employee Number")
  execute function public.company_pay_items_follow_renumber();

-- who added, changed or removed a pay item is audited (it changes many people's pay at once)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'audit_row_change' and pronamespace = 'public'::regnamespace) then
    drop trigger if exists audit_company_pay_items on public.company_pay_items;
    create trigger audit_company_pay_items after insert or update or delete on public.company_pay_items
      for each row execute function public.audit_row_change();
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. casual pay-run lines carry their standing items
-- ---------------------------------------------------------------------------------------------
alter table public.casual_pay_lines add column if not exists standing_additions numeric(14, 2) not null default 0;
alter table public.casual_pay_lines add column if not exists standing_deductions numeric(14, 2) not null default 0;
alter table public.casual_pay_lines add column if not exists standing_items jsonb not null default '[]'::jsonb;

do $$
declare
  c record;
begin
  -- the old "never below nothing" check (days + additions - deductions >= 0) is replaced by one counting standing items
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.casual_pay_lines'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%days_amount%' and pg_get_constraintdef(con.oid) like '%deductions%'
      and pg_get_constraintdef(con.oid) not like '%adjustment_note%' and pg_get_constraintdef(con.oid) not like '%standing%'
  loop
    execute format('alter table public.casual_pay_lines drop constraint %I', c.conname);
  end loop;

  -- net pay counts the standing items (a generated column's formula can't be changed in place)
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'casual_pay_lines' and column_name = 'net_pay'
      and generation_expression like '%standing%'
  ) then
    alter table public.casual_pay_lines drop column if exists net_pay;
    alter table public.casual_pay_lines add column net_pay numeric(14, 2)
      generated always as (days_amount + standing_additions + additions - standing_deductions - deductions) stored;
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.casual_pay_lines'::regclass and conname = 'casual_pay_lines_standing_check') then
    alter table public.casual_pay_lines add constraint casual_pay_lines_standing_check
      check (standing_additions >= 0 and standing_deductions >= 0 and jsonb_typeof(standing_items) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.casual_pay_lines'::regclass and conname = 'casual_pay_lines_net_check') then
    alter table public.casual_pay_lines add constraint casual_pay_lines_net_check
      check (days_amount + standing_additions + additions - standing_deductions - deductions >= 0);
  end if;
end $$;

-- the company's deduction cap (on unless turned off)
create or replace function public.casual_deduction_cap(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.deduction_cap from public.company_payroll_settings s where s.tenant_id = p_tenant), true)
$$;
revoke all on function public.casual_deduction_cap(uuid) from public, anon, authenticated;

-- the most all of a line's deductions can be: two-thirds of its wages with the cap on, all of them with it off
create or replace function public.casual_deduction_limit(p_wages numeric, p_cap boolean) returns numeric
language sql immutable set search_path = public as $$
  select case when p_cap then round(greatest(p_wages, 0) * 2 / 3, 2) else round(greatest(p_wages, 0), 2) end
$$;
revoke all on function public.casual_deduction_limit(numeric, boolean) from public, anon;
grant execute on function public.casual_deduction_limit(numeric, boolean) to authenticated;

-- a direct change to a line: still only the one-off additions, deductions and their note, and (with the cap on)
-- all deductions together within two-thirds of the wages
create or replace function public.casual_pay_line_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_limit numeric;
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
  v_limit := public.casual_deduction_limit(new.days_amount + new.standing_additions + new.additions, public.casual_deduction_cap(old.tenant_id));
  if new.deductions > 0 and new.standing_deductions + new.deductions > v_limit then
    raise exception 'Deductions can be at most KSh % for this line (%)', greatest(v_limit - new.standing_deductions, 0),
      case when public.casual_deduction_cap(old.tenant_id) then 'two-thirds of the wages, Employment Act s.19(3)' else 'all of the pay' end
      using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists casual_pay_line_rules on public.casual_pay_lines;
create trigger casual_pay_line_rules before insert or update or delete on public.casual_pay_lines
  for each row execute function public.casual_pay_line_rules();

-- (re)work out a draft run's lines: as before (20261017900000), plus each line's standing items. Kept the same as
-- casualStanding in src/lib/payItems.ts.
create or replace function public.casual_pay_run_lines(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.casual_pay_runs;
  v_line record;
  v_item record;
  v_cap boolean;
  v_days numeric;
  v_full numeric;
  v_take numeric;
  v_add numeric;
  v_ded numeric;
  v_items jsonb;
begin
  select * into r from public.casual_pay_runs where id = p_run;
  perform set_config('app.casual_pay', 'on', true);
  v_cap := public.casual_deduction_cap(r.tenant_id);

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
  update public.casual_pay_lines l set full_days = 0, half_days = 0, days_amount = 0, deductions = 0,
    standing_additions = 0, standing_deductions = 0, standing_items = '[]'::jsonb
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

  -- each line's standing items: allowances first, then deductions by name, deductions within the limit
  for v_line in select * from public.casual_pay_lines where run_id = r.id loop
    v_days := v_line.full_days + v_line.half_days * 0.5;
    v_add := 0;
    v_ded := 0;
    v_items := '[]'::jsonb;
    if v_days > 0 then
      for v_item in
        select * from public.company_pay_items p
        where p.tenant_id = r.tenant_id and p.active and p.kind in ('deduction', 'allowance')
          and (p.applies_to = 'casuals' or (p.applies_to = 'chosen' and v_line.employee_number = any(p.employee_numbers)))
        order by (p.kind = 'deduction'), lower(p.name) collate "C", p.id
      loop
        v_full := case v_item.amount_type
          when 'per_day' then round(v_item.amount * v_days, 2)
          when 'percent_of_basic' then round(v_line.days_amount * v_item.amount / 100, 2)
          else round(v_item.amount, 2) end;
        if v_item.kind = 'allowance' then
          v_take := v_full;
          v_add := v_add + v_take;
        else
          v_take := least(v_full, greatest(public.casual_deduction_limit(v_line.days_amount + v_add, v_cap) - v_ded, 0));
          v_ded := v_ded + v_take;
        end if;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'id', v_item.id, 'name', v_item.name, 'kind', v_item.kind, 'amount', v_take, 'full', v_full));
      end loop;
    end if;
    update public.casual_pay_lines set standing_additions = v_add, standing_deductions = v_ded, standing_items = v_items
    where id = v_line.id;
  end loop;

  -- a one-off deduction can't take anyone below nothing, nor (with the cap on) past two-thirds of the wages
  update public.casual_pay_lines l
  set deductions = greatest(public.casual_deduction_limit(l.days_amount + l.standing_additions + l.additions, v_cap) - l.standing_deductions, 0)
  where l.run_id = r.id
    and l.standing_deductions + l.deductions > public.casual_deduction_limit(l.days_amount + l.standing_additions + l.additions, v_cap);

  update public.casual_pay_runs set total = coalesce((select sum(net_pay) from public.casual_pay_lines where run_id = r.id), 0),
    updated_at = now()
  where id = r.id;
  perform set_config('app.casual_pay', 'off', true);
end $$;
revoke all on function public.casual_pay_run_lines(uuid) from public, anon, authenticated;
