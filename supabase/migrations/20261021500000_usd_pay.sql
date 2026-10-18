-- FIG-906: pay a country in US dollars at the rate the company types in each month. No exchange rates are fetched
-- ("don't complicate it with FX"): if the company uses 129 this month, it enters 129 and payroll is worked out at 129.
-- Builds on 20261020500000_branches.sql (each employee's country) and 20261020900000_payroll_countries.sql (payslip
-- country and currency, per-country approval).
--
--   company_pay_currencies(tenant, country, currency)
--                                     the currency each country is paid in: its own (KES, TZS, UGX, RWF; the default
--                                     when there is no row) or USD. Payroll chooses it (Payroll settings).
--   country_pay_currency(tenant, country), employee_pay_currency(tenant, employee number)
--                                     the chosen pay currency of a country / of an employee's country.
--   payroll_fx_rates(tenant, pay_period, country, rate, entered_by, entered_at)
--                                     the month's rate for a country paid in USD: 1 USD = rate local currency. Entered
--                                     by payroll, audited, changed freely while that country's month is a draft and
--                                     locked once it is approved (or paid). Kept by pay period, not run, because it is
--                                     entered before the month's payslips (and so the run) exist.
--   salary_history.fx_rate / local_currency / local_amounts
--                                     a USD payslip's rate, its country's currency, and the local figures the country's
--                                     engine worked out (jsonb, the same keys as the payslip's own amount columns:
--                                     gross_pay, taxable_pay, paye_tax, nssf_deduction, nhif_deduction, housing_levy,
--                                     nita_levy, heslb_deduction, lst_deduction, employer_nssf, sdl_levy, wcf_levy...,
--                                     plus earning_items / deduction_items). Every amount column of a USD payslip is in
--                                     USD; returns to KRA, TRA, URA, NSSF and SHA are filed from local_amounts. The
--                                     columns are null on a payslip in local currency.
--
-- The rules:
--   * a payslip is in its country's own currency, or in USD when the company pays that country in USD; one currency
--     per country per month (as before), except that payslips in the currency chosen now may replace ones saved
--     before the choice changed;
--   * a USD payslip needs the month's rate for its country and is saved at exactly that rate, with its local figures;
--   * piece rate work, contract jobs and arrears stay in the local currency: a USD payslip carries none of them
--     (salaried monthly payroll only; casual pay runs are separate and stay local);
--   * a country is approved only when its payslips are in the currency it is paid in now and, paid in USD, the month's
--     rate is entered and every payslip was worked out at it;
--   * the NITA levy on a Kenya USD payslip is KES 50 in local_amounts (what the NITA return files) and its USD value on
--     the payslip; nita_levy_for() reads the KES figure.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the pay currency per country
-- ---------------------------------------------------------------------------------------------
create table if not exists public.company_pay_currencies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  country text not null check (btrim(country) <> ''),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, country)
);

create or replace function public.company_pay_currencies_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.country := public.tidy_country(new.country);
  if new.country is null then
    raise exception 'Choose a country' using errcode = '22023';
  end if;
  new.currency := upper(btrim(coalesce(new.currency, '')));
  if new.currency = '' then
    new.currency := public.country_currency(new.country);
  end if;
  if new.currency not in (public.country_currency(new.country), 'USD') then
    raise exception '% can be paid in % or USD, not %', new.country, public.country_currency(new.country), new.currency using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.company_pay_currencies_rules() from public, anon, authenticated;
drop trigger if exists company_pay_currencies_rules on public.company_pay_currencies;
create trigger company_pay_currencies_rules before insert or update on public.company_pay_currencies
  for each row execute function public.company_pay_currencies_rules();

alter table public.company_pay_currencies enable row level security;
drop policy if exists tenant_isolation on public.company_pay_currencies;
create policy tenant_isolation on public.company_pay_currencies as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
-- anyone in the company can see which currency a country is paid in (salary amounts are labelled with it); payroll
-- chooses it
drop policy if exists member_read on public.company_pay_currencies;
create policy member_read on public.company_pay_currencies for select to authenticated using (true);
drop policy if exists payroll_write on public.company_pay_currencies;
create policy payroll_write on public.company_pay_currencies for all to authenticated
  using ((select public.has_module('payroll')))
  with check ((select public.has_module('payroll')));
revoke all on public.company_pay_currencies from anon;
revoke truncate on public.company_pay_currencies from authenticated;
grant select, insert, update, delete on public.company_pay_currencies to authenticated;

drop trigger if exists audit_company_pay_currencies on public.company_pay_currencies;
create trigger audit_company_pay_currencies after insert or update or delete on public.company_pay_currencies
  for each row execute function public.audit_row_change();

-- the currency a country is paid in: the company's choice, else the country's own
create or replace function public.country_pay_currency(p_tenant uuid, p_country text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.currency from public.company_pay_currencies c
     where c.tenant_id = p_tenant and lower(c.country) = lower(coalesce(public.tidy_country(p_country), 'Kenya'))),
    public.country_currency(coalesce(public.tidy_country(p_country), 'Kenya')))
$$;
revoke all on function public.country_pay_currency(uuid, text) from public, anon, authenticated;

-- the currency an employee is paid in: their country's pay currency
create or replace function public.employee_pay_currency(p_tenant uuid, p_employee_number text) returns text
language sql stable security definer set search_path = public as $$
  select public.country_pay_currency(p_tenant, public.employee_country(p_tenant, p_employee_number))
$$;
revoke all on function public.employee_pay_currency(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. the month's USD rate per country
-- ---------------------------------------------------------------------------------------------
create table if not exists public.payroll_fx_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  pay_period text not null check (pay_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  country text not null check (btrim(country) <> ''),
  currency text not null default 'USD' check (currency = 'USD'),
  local_currency text not null check (local_currency ~ '^[A-Z]{3}$'),
  rate numeric(14, 4) not null check (rate > 0),
  entered_by uuid references auth.users(id) on delete set null,
  entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, pay_period, country)
);
create index if not exists payroll_fx_rates_tenant_idx on public.payroll_fx_rates (tenant_id, country, pay_period);

-- a country's month is approved (or paid): its status then, else null
create or replace function public.fx_month_closed(p_tenant uuid, p_period text, p_country text) returns text
language sql stable security definer set search_path = public as $$
  select c.status from public.payroll_runs r
  join public.payroll_run_countries c on c.run_id = r.id
  where r.tenant_id = p_tenant and r.pay_period = p_period and lower(c.country) = lower(p_country)
    and c.status in ('approved', 'paid')
  limit 1
$$;
revoke all on function public.fx_month_closed(uuid, text, text) from public, anon, authenticated;

create or replace function public.payroll_fx_rates_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_closed text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_closed := public.fx_month_closed(old.tenant_id, old.pay_period, old.country);
    if v_closed is not null then
      raise exception 'The USD rate for % in % is locked: % is %. Reopen it first.', old.country, old.pay_period, old.country, v_closed
        using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  new.country := public.tidy_country(new.country);
  if new.country is null then
    raise exception 'Choose a country' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (new.tenant_id <> old.tenant_id or new.pay_period <> old.pay_period or lower(new.country) <> lower(old.country)) then
    raise exception 'A USD rate can''t be moved to another month or country: enter a new one' using errcode = '22023';
  end if;
  v_closed := public.fx_month_closed(new.tenant_id, new.pay_period, new.country);
  if v_closed is not null then
    raise exception 'The USD rate for % in % is locked: % is %. Reopen it first.', new.country, new.pay_period, new.country, v_closed
      using errcode = '42501';
  end if;
  if public.country_pay_currency(new.tenant_id, new.country) <> 'USD' then
    raise exception '% is paid in %, not USD: choose USD for % in Payroll settings first',
      new.country, public.country_pay_currency(new.tenant_id, new.country), new.country using errcode = '22023';
  end if;
  new.currency := 'USD';
  new.local_currency := public.country_currency(new.country);
  new.entered_by := auth.uid();
  new.entered_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
revoke all on function public.payroll_fx_rates_rules() from public, anon, authenticated;
drop trigger if exists payroll_fx_rates_rules on public.payroll_fx_rates;
create trigger payroll_fx_rates_rules before insert or update or delete on public.payroll_fx_rates
  for each row execute function public.payroll_fx_rates_rules();

alter table public.payroll_fx_rates enable row level security;
drop policy if exists tenant_isolation on public.payroll_fx_rates;
create policy tenant_isolation on public.payroll_fx_rates as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists module_read on public.payroll_fx_rates;
create policy module_read on public.payroll_fx_rates for select to authenticated
  using ((select public.has_any_module('payroll', 'hr-lifecycle')));
drop policy if exists payroll_write on public.payroll_fx_rates;
create policy payroll_write on public.payroll_fx_rates for all to authenticated
  using ((select public.has_module('payroll')))
  with check ((select public.has_module('payroll')));
revoke all on public.payroll_fx_rates from anon;
revoke truncate on public.payroll_fx_rates from authenticated;
grant select, insert, update, delete on public.payroll_fx_rates to authenticated;

drop trigger if exists audit_payroll_fx_rates on public.payroll_fx_rates;
create trigger audit_payroll_fx_rates after insert or update or delete on public.payroll_fx_rates
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- 3. a USD payslip's rate and local figures
-- ---------------------------------------------------------------------------------------------
alter table public.salary_history add column if not exists fx_rate numeric(14, 4);
alter table public.salary_history add column if not exists local_currency text;
alter table public.salary_history add column if not exists local_amounts jsonb;
alter table public.salary_history drop constraint if exists salary_history_usd_figures;
alter table public.salary_history add constraint salary_history_usd_figures check (
  (fx_rate is null or fx_rate > 0)
  and (local_currency is null or local_currency ~ '^[A-Z]{3}$')
  and (currency <> 'USD' or (fx_rate is not null and local_currency is not null and jsonb_typeof(local_amounts) = 'object'))
);

-- ---------------------------------------------------------------------------------------------
-- 4. payslips: their country, currency (local or USD) and lock
-- ---------------------------------------------------------------------------------------------
create or replace function public.salary_history_in_draft_run() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  run public.payroll_runs;
  v_status text;
  v_other text;
  v_first boolean;
  v_known boolean;
  v_local text;
  v_rate numeric;
begin
  -- renumbering an employee (propagate_employee_number) follows through locked payslips; no figure changes
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'employee_id') = (to_jsonb(old) - 'employee_id') then
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.run_id is not null then
    v_status := public.payroll_country_status(old.run_id, old.country);
    if v_status is not null and v_status <> 'draft' then
      select * into run from public.payroll_runs where id = old.run_id;
      raise exception 'Payroll for % in % is %, so its payslips can''t be changed. Reopen it first.',
        run.pay_period, coalesce(old.country, 'Kenya'), v_status;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.pay_period is null or new.pay_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Pay period "%" should look like 2026-09 (year-month)', coalesce(new.pay_period, '');
  end if;

  -- the payslip's country: as given, else the employee's branch's
  new.country := coalesce(public.tidy_country(new.country), public.employee_country(new.tenant_id, new.employee_id), 'Kenya');
  v_known := lower(new.country) in ('kenya', 'tanzania', 'uganda', 'rwanda');
  v_local := public.country_currency(new.country);
  -- its currency: as given, else the currency the company pays the country in (a known country), else the branch's
  -- (for the employee's own country) or the country's
  if nullif(btrim(new.currency), '') is null then
    new.currency := case when v_known then public.country_pay_currency(new.tenant_id, new.country)
                         when lower(new.country) = lower(public.employee_country(new.tenant_id, new.employee_id))
                         then public.employee_currency(new.tenant_id, new.employee_id)
                         else v_local end;
  end if;
  new.currency := upper(btrim(new.currency));

  if v_known and new.currency = 'USD' then
    -- paid in USD (FIG-906): only when the company pays the country in USD, at the month's rate, with its local figures
    if public.country_pay_currency(new.tenant_id, new.country) <> 'USD' then
      raise exception '% is paid in %, so its payslips can''t be in USD (%): choose USD for % in Payroll settings, then recalculate',
        new.country, v_local, coalesce(new.employee_id, ''), new.country using errcode = '22023';
    end if;
    select f.rate into v_rate from public.payroll_fx_rates f
    where f.tenant_id = new.tenant_id and f.pay_period = new.pay_period and lower(f.country) = lower(new.country);
    if v_rate is null then
      raise exception 'Enter the USD rate for % in % before working out its payslips', new.country, new.pay_period using errcode = '22023';
    end if;
    if new.fx_rate is null then
      new.fx_rate := v_rate;
    elsif new.fx_rate <> v_rate then
      raise exception 'This payslip (%) was worked out at 1 USD = % %, but the rate for % in % is %: recalculate',
        coalesce(new.employee_id, ''), new.fx_rate, v_local, new.country, new.pay_period, v_rate using errcode = '22023';
    end if;
    if new.local_currency is not null and upper(btrim(new.local_currency)) <> v_local then
      raise exception '% payslips keep their statutory figures in %, not %', new.country, v_local, new.local_currency using errcode = '22023';
    end if;
    new.local_currency := v_local;
    if new.local_amounts is null or jsonb_typeof(new.local_amounts) <> 'object' then
      raise exception 'A USD payslip (%) needs its % statutory figures', coalesce(new.employee_id, ''), v_local using errcode = '22023';
    end if;
    -- piece rate work, contract jobs and arrears stay in the local currency: never on a USD payslip
    if coalesce(new.work_pay, 0) <> 0 or coalesce(new.jobs_pay, 0) <> 0 or coalesce(new.paid_out, 0) <> 0
       or coalesce(new.ahl_withheld, 0) <> 0 or coalesce(new.reserve_released, 0) <> 0 or coalesce(new.wht_withheld, 0) <> 0
       or coalesce(new.arrears_brought_forward, 0) <> 0 or coalesce(new.arrears_carried_forward, 0) <> 0 or coalesce(new.work_settlement, false) then
      raise exception 'Piece rate work, contract jobs and arrears are paid in %, so they can''t go on a USD payslip (%)',
        v_local, coalesce(new.employee_id, '') using errcode = '22023';
    end if;
  else
    -- a known country's payslips are in its own currency (or USD, above): never another
    if v_known and new.currency <> v_local then
      raise exception '% payslips are in %, not % (%): change the branch''s currency, then recalculate',
        new.country, v_local, new.currency, coalesce(new.employee_id, '') using errcode = '22023';
    end if;
    new.fx_rate := null;
    new.local_currency := null;
    new.local_amounts := null;
  end if;

  insert into public.payroll_runs (tenant_id, pay_period)
  values (new.tenant_id, new.pay_period)
  on conflict (tenant_id, pay_period) do nothing;
  select * into run from public.payroll_runs where tenant_id = new.tenant_id and pay_period = new.pay_period;

  -- the country's part of the run, started as a draft with its first payslip (a run from before countries, with no
  -- rows yet, starts its first country with the run's own status)
  v_first := not exists (select 1 from public.payroll_run_countries c where c.run_id = run.id);
  insert into public.payroll_run_countries (tenant_id, run_id, country, currency, status, approved_by, approved_at, paid_by, paid_at)
  values (new.tenant_id, run.id, new.country, new.currency,
          case when v_first then run.status else 'draft' end,
          case when v_first then run.approved_by end, case when v_first then run.approved_at end,
          case when v_first then run.paid_by end, case when v_first then run.paid_at end)
  on conflict (run_id, country) do nothing;

  v_status := public.payroll_country_status(run.id, new.country);
  if v_status <> 'draft' then
    raise exception 'Payroll for % in % is %, so its payslips can''t be changed. Reopen it first.', run.pay_period, new.country, v_status;
  end if;

  -- one currency per country in a month. A payslip in the currency the company pays the country in now may replace
  -- payslips saved in the other one before the choice changed (recalculating rewrites them all); approving the
  -- country refuses while any is left in the old currency (payroll_run_country_fx).
  select h.currency into v_other from public.salary_history h
  where h.run_id = run.id and lower(h.country) = lower(new.country) and h.currency <> new.currency and h.id is distinct from new.id
  limit 1;
  if v_other is not null and not (v_known and new.currency = public.country_pay_currency(new.tenant_id, new.country)) then
    raise exception '% payslips for % are in %; this one is in %', new.country, run.pay_period, v_other, new.currency using errcode = '22023';
  end if;

  new.run_id := run.id;
  return new;
end $$;

-- the run's country row keeps the currency its payslips are in (USD for a country paid in USD)
create or replace function public.salary_history_run_country_currency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.run_id is not null then
    update public.payroll_run_countries c set currency = new.currency
    where c.run_id = new.run_id and lower(c.country) = lower(new.country) and c.currency is distinct from new.currency and c.status = 'draft';
  end if;
  return null;
end $$;
revoke all on function public.salary_history_run_country_currency() from public, anon, authenticated;
drop trigger if exists salary_history_run_country_currency on public.salary_history;
create trigger salary_history_run_country_currency after insert or update of currency on public.salary_history
  for each row execute function public.salary_history_run_country_currency();

-- ---------------------------------------------------------------------------------------------
-- 5. approving a country: its payslips in the currency it is paid in, at the month's rate
-- ---------------------------------------------------------------------------------------------
create or replace function public.payroll_run_country_fx() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.payroll_runs;
  v_pay text;
  v_rate numeric;
  v_wrong text;
begin
  if not (old.status = 'draft' and new.status = 'approved') then
    return new;
  end if;
  select * into r from public.payroll_runs where id = new.run_id;
  v_pay := public.country_pay_currency(new.tenant_id, new.country);
  if lower(new.country) in ('kenya', 'tanzania', 'uganda', 'rwanda') then
    select string_agg(distinct h.currency, ', ') into v_wrong from public.salary_history h
    where h.run_id = new.run_id and lower(h.country) = lower(new.country) and h.currency <> v_pay;
    if v_wrong is not null then
      raise exception '% is paid in %, but its payslips for % are in %: recalculate, then approve', new.country, v_pay, r.pay_period, v_wrong
        using errcode = '22023';
    end if;
  end if;
  if v_pay = 'USD' then
    select f.rate into v_rate from public.payroll_fx_rates f
    where f.tenant_id = new.tenant_id and f.pay_period = r.pay_period and lower(f.country) = lower(new.country);
    if v_rate is null then
      raise exception 'Enter this month''s USD rate for % before approving %', new.country, r.pay_period using errcode = '22023';
    end if;
    if exists (select 1 from public.salary_history h
               where h.run_id = new.run_id and lower(h.country) = lower(new.country) and h.fx_rate is distinct from v_rate) then
      raise exception 'The USD rate for % in % is now %, but some payslips were worked out at another rate: recalculate, then approve',
        new.country, r.pay_period, v_rate using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.payroll_run_country_fx() from public, anon, authenticated;
drop trigger if exists payroll_run_country_fx on public.payroll_run_countries;
create trigger payroll_run_country_fx before update of status on public.payroll_run_countries
  for each row execute function public.payroll_run_country_fx();

-- ---------------------------------------------------------------------------------------------
-- 6. the NITA levy on a Kenya USD payslip: KES in local_amounts, its USD value on the payslip
-- ---------------------------------------------------------------------------------------------
create or replace function public.salary_history_nita_levy() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_status text;
  v_levy numeric;
begin
  if tg_op = 'UPDATE' then
    -- renumbering follows through locked payslips without changing figures
    if (to_jsonb(new) - 'employee_id' - 'nita_levy') = (to_jsonb(old) - 'employee_id' - 'nita_levy') then
      new.nita_levy := old.nita_levy;
      return new;
    end if;
    v_status := public.payroll_country_status(new.run_id, new.country);
    if v_status is not null and v_status <> 'draft' then
      return new;
    end if;
  end if;
  if new.pay_period is null or new.pay_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return new;
  end if;
  if lower(coalesce(new.country, 'Kenya')) <> 'kenya' then
    new.nita_levy := 0;
    return new;
  end if;
  select coalesce(e.worker_kind, 'employee') into v_kind
  from public.employees e where e.tenant_id = new.tenant_id and e."Employee Number" = new.employee_id;
  v_levy := case when v_kind in ('casual', 'contractor') then 0
                 else coalesce(public.statutory_rate_for(new.tenant_id, 'nita_levy',
                        (to_date(new.pay_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date, 'Kenya'), 0) end;
  if new.currency = 'USD' and coalesce(new.fx_rate, 0) > 0 then
    new.local_amounts := coalesce(new.local_amounts, '{}'::jsonb) || jsonb_build_object('nita_levy', v_levy);
    new.nita_levy := round(v_levy / new.fx_rate, 2);
  else
    new.nita_levy := v_levy;
  end if;
  return new;
end $$;

-- payroll: the month's NITA levy per employee, Kenya's payslips only, in KES (a USD payslip's local figure)
create or replace function public.nita_levy_for(p_period text)
returns table (employee_number text, employee_name text, nita_number text, levy numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not public.has_module('payroll') then
    raise exception 'Only payroll can see the NITA levy' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Pay period "%" should look like 2026-09 (year-month)', coalesce(p_period, '') using errcode = '22023';
  end if;
  return query
  select x.employee_id, x.name, x.nita, x.levy
  from (
    select h.employee_id,
           coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), h.employee_name, h.employee_id) as name,
           nullif(btrim(e."NITA"), '') as nita,
           case when h.currency = 'USD' then coalesce((h.local_amounts ->> 'nita_levy')::numeric, 0) else h.nita_levy end as levy
    from public.salary_history h
    left join public.employees e on e.tenant_id = h.tenant_id and e."Employee Number" = h.employee_id
    where h.tenant_id = v_tenant and h.pay_period = p_period and lower(h.country) = 'kenya'
  ) x
  where x.levy > 0
  order by x.employee_id;
end $$;
