-- Uganda payroll (FIG-905 stage 4): PAYE, NSSF, Local Service Tax and the Uganda returns. Builds on
-- 20261020900000_payroll_countries.sql (statutory_rates.country, statutory_rates_on(day, country), one run with a row
-- per country). The engine is src/lib/payroll/countries/uganda.ts; every figure it uses is a dated row here, so a
-- Finance Act changes a row (or the Rates tab gives a company its own), not code.
--
-- Sources and assumptions (no finance team signs these off; each is a default the Rates tab can change):
--
--   PAYE, resident individuals, monthly (Income Tax Act, Third Schedule Part I as replaced by the Income Tax
--   (Amendment) Act 2026, assented 20 Aug 2026, in force from 1 Jul 2026; URA notice "Changes to PAYE return form
--   following the Income Tax (Amendment) Act, 2026"):
--     up to 335,000 nil; 335,000-410,000 20% of the excess; 410,000-485,000 15,000 + 25% of the excess over 410,000;
--     above 485,000 33,750 + 30% of the excess over 485,000; plus 10% of income above 10,000,000.
--     Stored as marginal bands (0% / 20% / 25% / 30%) and the surcharge (paye_surcharge_threshold, _rate).
--   PAYE, resident, 1 Jul 2012 to 30 Jun 2026: up to 235,000 nil; 235,000-335,000 10%; 335,000-410,000 10,000 + 20%;
--     above 410,000 25,000 + 30%; plus 10% above 10,000,000. (July and August 2026 were paid on these before the
--     2026 Act was assented; URA asks employers to amend those returns: recalculate them if they are still drafts.)
--   PAYE, non-resident individuals (no nil band): up to 335,000 10%; 335,000-410,000 33,500 + 20%; above 410,000
--     48,500 + 30%; plus 10% above 10,000,000. UNCERTAIN: the 2026 Act replaced the resident table; we found
--     nothing official on whether the non-resident table changed, so it is kept as it was.
--   NSSF (National Social Security Fund Act s.11-12; the NSSF (Amendment) Act 2022 extended it to every employer):
--     5% of gross wages from the employee, 10% from the employer, no ceiling, due by the 15th of the next month.
--     The employee's 5% is NOT deductible for PAYE (nssf_deductible 0): PAYE is worked out on gross pay.
--   Local Service Tax (Local Governments Act s.80 and its schedule, from the Local Governments (Amendment) Act 2008;
--     the KCCA and district LST guides): an annual amount by monthly income band, nil up to 100,000 a month, then
--     5,000 / 10,000 / 20,000 / 30,000 / 40,000 / 60,000 / 70,000 / 80,000 / 90,000 for each 100,000 band, and
--     100,000 a year above 1,000,000 a month. The employer deducts it in the first four months of the financial
--     year (July to October), in four instalments (default) or at once (company_payroll_settings.lst_collection),
--     and pays it to the local government where the employee works. Banded on monthly gross pay (the regulations
--     define "take-home salary" as gross). LST paid is an allowable deduction for PAYE in the month it is paid
--     (lst_deductible 1, as in the KCCA guide's worked example). Someone who joins after October pays no LST through
--     payroll that year (an assumption: some councils ask for it pro rata). LST already paid this financial year
--     with another employer or straight to the council is recorded in lst_years, so it isn't taken twice. Soldiers
--     and anyone else exempt: employees.lst_exempt.
--   Withholding tax on contractors (Income Tax Act s.119, payments for services by designated agents): 6%
--     (wht_contractual, wht_professional). UNCERTAIN: s.119 applies to designated withholding agents and above a
--     threshold per payment; we take 6% on every contractor payment.
--   Health insurance: none is statutory in Uganda yet (the National Health Insurance Bill isn't law); medical cover is
--     an ordinary voluntary deduction.
--   Rounding: whole shillings for every statutory figure (UGX is not used with cents).
--
-- Employees, in every country (this migration defines the checks once for Kenya, Tanzania and Uganda; it runs after
-- 20261021000000_tanzania_payroll.sql, which leaves them to it):
--   "Tax PIN" holds the employee's tax number for their country: a KRA PIN in Kenya, a TRA TIN (9 digits, kept
--     without dashes) in Tanzania, a URA TIN (10 digits) in Uganda. Unique in the company, as before.
--   "NSSF Number" holds their member number of their country's NSSF: Kenya's format in Kenya; NSSF Tanzania and NSSF
--     Uganda don't publish one, so 6 to 15 letters and digits (it only catches typos).
--   kra_residency ('Resident' / 'Non-Resident') is the employee's tax residency in every country (empty = resident).
--   "ID Number" for a National ID is the NIN in Uganda (14 letters and digits) and the NIDA number in Tanzania (20
--     digits, kept without dashes).
--   The format checks and what onboarding asks for follow the employee's branch's country: a TIN instead of a KRA
--   PIN, and no SHA number, in Tanzania and Uganda; a HESLB index number for a Tanzanian HESLB borrower.
--   A country without payroll rules yet (Rwanda) keeps Kenya's formats.
--
-- Payslips: employer_nssf (the employer's NSSF, never taken from pay) and taxable_pay (the pay PAYE is worked out on;
-- Uganda's chargeable income) are shared with Tanzania (20261021000000 adds them first); lst_deduction is Uganda's.
--
-- Piece rate payouts: each worker's holdbacks use their own country's rates. Kenya holds back the housing levy;
-- Tanzania and Uganda have none, so a payout holds back the reserve only (and withholding tax for a contractor: 6% in
-- Uganda; 5% resident or 15% non-resident in Tanzania). A payout is in one currency, never a sum across currencies:
-- payroll picks the country when the company pays people in more than one, and a payout that would mix currencies is
-- refused. Each batch keeps its country and currency, and notifications show amounts in it.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. Uganda's statutory rates
-- ---------------------------------------------------------------------------------------------
insert into public.statutory_rates (tenant_id, country, code, value, bands, effective_from, effective_to, source)
select null, 'Uganda', v.code, v.value, v.bands::jsonb, v.from_day::date, v.to_day::date, v.source
from (values
  ('paye_bands', null::numeric,
   '[{"upto": 235000, "rate": 0}, {"upto": 335000, "rate": 0.10}, {"upto": 410000, "rate": 0.20}, {"upto": null, "rate": 0.30}]',
   '2012-07-01', '2026-06-30', 'Income Tax Act, Third Schedule (resident individuals, monthly)'),
  ('paye_bands', null,
   '[{"upto": 335000, "rate": 0}, {"upto": 410000, "rate": 0.20}, {"upto": 485000, "rate": 0.25}, {"upto": null, "rate": 0.30}]',
   '2026-07-01', null, 'Income Tax (Amendment) Act 2026 (resident individuals, monthly; URA PAYE return notice)'),
  ('paye_bands_non_resident', null,
   '[{"upto": 335000, "rate": 0.10}, {"upto": 410000, "rate": 0.20}, {"upto": null, "rate": 0.30}]',
   '2012-07-01', null, 'Income Tax Act, Third Schedule (non-resident individuals, monthly; confirm after the 2026 Act)'),
  ('paye_surcharge_threshold', 10000000, null, '2012-07-01', null, 'Income Tax Act, Third Schedule: extra 10% on income above 10,000,000 a month'),
  ('paye_surcharge_rate', 0.10, null, '2012-07-01', null, 'Income Tax Act, Third Schedule: extra 10% on income above 10,000,000 a month'),
  ('nssf_rate', 0.05, null, '1985-07-01', null, 'NSSF Act s.11: employee 5% of gross wages'),
  ('nssf_employer_rate', 0.10, null, '1985-07-01', null, 'NSSF Act s.11: employer 10% of gross wages'),
  ('nssf_deductible', 0, null, '1985-07-01', null, 'Income Tax Act: the employee''s NSSF contribution is not deductible for PAYE'),
  ('lst_bands', null,
   '[{"upto": 100000, "amount": 0}, {"upto": 200000, "amount": 5000}, {"upto": 300000, "amount": 10000}, {"upto": 400000, "amount": 20000}, {"upto": 500000, "amount": 30000}, {"upto": 600000, "amount": 40000}, {"upto": 700000, "amount": 60000}, {"upto": 800000, "amount": 70000}, {"upto": 900000, "amount": 80000}, {"upto": 1000000, "amount": 90000}, {"upto": null, "amount": 100000}]',
   '2008-07-01', null, 'Local Governments Act, Local Service Tax schedule (annual amount by monthly income)'),
  ('lst_deductible', 1, null, '2008-07-01', null, 'Income Tax Act: LST paid is deductible from employment income (KCCA LST guide)'),
  ('lst_first_month', 7, null, '2008-07-01', null, 'Local Governments Act: LST is paid in the first four months of the financial year (from July)'),
  ('lst_months', 4, null, '2008-07-01', null, 'Local Governments Act: LST is paid in the first four months of the financial year'),
  ('wht_contractual', 0.06, null, '2014-07-01', null, 'Income Tax Act s.119: 6% on payments for services (designated agents)'),
  ('wht_professional', 0.06, null, '2014-07-01', null, 'Income Tax Act s.119: 6% on payments for services (designated agents)')
) as v(code, value, bands, from_day, to_day, source)
where not exists (
  select 1 from public.statutory_rates r
  where r.tenant_id is null and r.country = 'Uganda' and r.code = v.code and r.effective_from = v.from_day::date
);

-- ---------------------------------------------------------------------------------------------
-- 2. payslips: LST, and the columns shared with Tanzania (the employer's NSSF; taxable_pay holds Uganda's chargeable
--    income; tax_resident)
-- ---------------------------------------------------------------------------------------------
alter table public.salary_history add column if not exists lst_deduction numeric(14, 2) not null default 0;
alter table public.salary_history add column if not exists employer_nssf numeric(14, 2) not null default 0;
alter table public.salary_history add column if not exists taxable_pay numeric(16, 2);
alter table public.salary_history add column if not exists tax_resident boolean;

-- ---------------------------------------------------------------------------------------------
-- 3. employees and the company setting
-- ---------------------------------------------------------------------------------------------
alter table public.employees add column if not exists lst_exempt boolean not null default false;

alter table public.company_payroll_settings add column if not exists lst_collection text not null default 'instalments';
alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_lst_collection_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_lst_collection_check
  check (lst_collection in ('instalments', 'lump_sum'));

-- ---------------------------------------------------------------------------------------------
-- 4. LST per employee per financial year
-- ---------------------------------------------------------------------------------------------
-- What payroll took is on the payslips (salary_history.lst_deduction). lst_years records what an employee already
-- paid this financial year elsewhere (another employer, straight to the council), so payroll takes only the rest.
create table if not exists public.lst_years (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null check (btrim(employee_number) <> ''),
  -- the financial year by the year it starts: 2026 = July 2026 to June 2027
  fy_start integer not null check (fy_start between 2000 and 2100),
  paid_elsewhere numeric(14, 2) not null default 0 check (paid_elsewhere >= 0),
  note text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, employee_number, fy_start)
);
alter table public.lst_years enable row level security;
drop policy if exists tenant_isolation on public.lst_years;
create policy tenant_isolation on public.lst_years as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists payroll_all on public.lst_years;
create policy payroll_all on public.lst_years for all to authenticated
  using ((select public.has_module('payroll'))) with check ((select public.has_module('payroll')));
revoke all on public.lst_years from anon;
drop trigger if exists audit_lst_years on public.lst_years;
create trigger audit_lst_years after insert or update or delete on public.lst_years
  for each row execute function public.audit_row_change();

-- The financial year (July to June) a pay period is in, by the year it starts: '2026-10' -> 2026, '2027-03' -> 2026.
create or replace function public.ug_fy_start(p_period text) returns integer
language sql immutable as $$
  select case when split_part(p_period, '-', 2)::int >= 7 then split_part(p_period, '-', 1)::int
              else split_part(p_period, '-', 1)::int - 1 end
$$;

-- LST already paid this financial year by each employee in Uganda, not counting the period being worked out (so
-- working a draft month out again doesn't count it twice): every other Ugandan payslip of the year, plus lst_years.
create or replace function public.lst_paid_this_year(p_period text)
returns table (employee_number text, paid numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_fy integer;
begin
  if not public.has_module('payroll') then raise exception 'Only payroll can see LST paid' using errcode = '42501'; end if;
  if p_period is null or p_period !~ '^\d{4}-\d{2}$' then raise exception 'Give the pay period as YYYY-MM' using errcode = '22023'; end if;
  v_fy := public.ug_fy_start(p_period);
  return query
  select x.emp, sum(x.amount)::numeric
  from (
    select s.employee_id as emp, s.lst_deduction as amount
    from public.salary_history s
    where s.tenant_id = v_tenant and s.country = 'Uganda' and s.lst_deduction > 0
      and s.pay_period ~ '^\d{4}-\d{2}$' and public.ug_fy_start(s.pay_period) = v_fy and s.pay_period <> p_period
    union all
    select y.employee_number, y.paid_elsewhere
    from public.lst_years y
    where y.tenant_id = v_tenant and y.fy_start = v_fy and y.paid_elsewhere > 0
  ) x
  group by x.emp;
end $$;
revoke all on function public.lst_paid_this_year(text) from public, anon;
grant execute on function public.lst_paid_this_year(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. employee details by country (formats, and what onboarding asks for)
-- ---------------------------------------------------------------------------------------------
-- An employee row's country before it is saved: its branch's, else the branch named in "Branch", else the default
-- branch's, else the company's.
create or replace function public.employee_row_country(p_tenant uuid, p_branch_id uuid, p_branch text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select public.tidy_country(b.country) from public.branches b where b.id = p_branch_id and b.tenant_id = p_tenant),
    (select public.tidy_country(b.country) from public.branches b
      where b.tenant_id = p_tenant and lower(btrim(b.name)) = lower(btrim(p_branch)) limit 1),
    (select public.tidy_country(b.country) from public.branches b where b.tenant_id = p_tenant and b.is_default limit 1),
    public.company_country(p_tenant))
$$;
revoke all on function public.employee_row_country(uuid, uuid, text) from public, anon, authenticated;

-- the employee's tax number in their country: a TRA TIN (9 digits) in Tanzania, a URA TIN (10 digits) in Uganda, a KRA
-- PIN elsewhere (as before)
create or replace function public.tax_number_ok(p_country text, p text) returns boolean language sql immutable as $$
  select case public.tidy_country(p_country)
    when 'Tanzania' then p ~ '^\d{9}$'
    when 'Uganda' then p ~ '^\d{10}$'
    else public.kra_pin_ok(p) end
$$;
create or replace function public.tax_number_label(p_country text) returns text language sql immutable as $$
  select case when public.tidy_country(p_country) in ('Tanzania', 'Uganda') then 'TIN' else 'KRA PIN' end
$$;
create or replace function public.tax_number_hint(p_country text) returns text language sql immutable as $$
  select case public.tidy_country(p_country)
    when 'Tanzania' then 'should be 9 digits, like 123-456-789'
    when 'Uganda' then 'should be 10 digits'
    else 'should look like A123456789B' end
$$;
-- a tax number as saved: no spaces, upper case; outside Kenya also without dashes (a TRA TIN is written 123-456-789)
create or replace function public.tidy_tax_number(p_country text, p text) returns text language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(p, ''),
    case when coalesce(public.tidy_country(p_country), 'Kenya') = 'Kenya' then '\s' else '[\s-]' end, '', 'g')), '')
$$;
-- NSSF number: NSSF Tanzania's and NSSF Uganda's member numbers (6 to 15 letters and digits; neither publishes a
-- format) in those countries, Kenya's format elsewhere
create or replace function public.social_security_number_ok(p_country text, p text) returns boolean language sql immutable as $$
  select case when public.tidy_country(p_country) in ('Tanzania', 'Uganda') then upper(p) ~ '^[A-Z0-9]{6,15}$'
              else public.nssf_number_ok(p) end
$$;
create or replace function public.social_security_number_hint(p_country text) returns text language sql immutable as $$
  select case when public.tidy_country(p_country) in ('Tanzania', 'Uganda') then 'should be 6 to 15 letters and digits'
              else 'should be 5 to 12 digits' end
$$;
-- a National ID number: the NIN in Uganda (14 letters and digits, e.g. CM12345678ABCD), the NIDA number in Tanzania
-- (20 digits); Kenya's formats elsewhere
create or replace function public.identity_number_ok_in(p_country text, p_type text, p_number text) returns boolean
language sql immutable as $$
  select case when p_type = 'National ID' and public.tidy_country(p_country) = 'Uganda' then p_number ~ '^[A-Z0-9]{14}$'
              when p_type = 'National ID' and public.tidy_country(p_country) = 'Tanzania' then p_number ~ '^\d{20}$'
              else public.identity_number_ok(p_type, p_number) end
$$;
-- an SHA number is asked for in Kenya only (and in a country without payroll rules yet, which keeps Kenya's details)
create or replace function public.needs_sha_number(p_country text) returns boolean language sql immutable as $$
  select coalesce(public.tidy_country(p_country), 'Kenya') not in ('Tanzania', 'Uganda')
$$;

-- the employee record's checks (from 20261012100000_employee_onboarding.sql), with the tax number, NSSF number and
-- national ID formats of the employee's country (Kenya, Tanzania, Uganda), and Tanzania's HESLB index number tidied
create or replace function public.employees_onboarding_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_insert boolean := tg_op = 'INSERT';
  in_transition boolean := coalesce(current_setting('app.onboarding_transition', true), '') = 'on';
  is_staff boolean := auth.uid() is not null and not public.can_write_employees();
  changed text[];
  v_country text := coalesce(public.employee_row_country(new.tenant_id, new.branch_id, new."Branch"), 'Kenya');
begin
  -- tidy: identifiers without spaces, upper case; blanks are empty
  new."Tax PIN" := public.tidy_tax_number(v_country, new."Tax PIN");
  new."ID Number" := nullif(upper(regexp_replace(coalesce(new."ID Number", ''), '\s', '', 'g')), '');
  new."SHIF Number" := nullif(upper(regexp_replace(coalesce(new."SHIF Number", ''), '\s', '', 'g')), '');
  new."NSSF Number" := nullif(regexp_replace(coalesce(new."NSSF Number", ''), '[\s-]', '', 'g'), '');
  new."Mobile Number" := nullif(regexp_replace(coalesce(new."Mobile Number", ''), '[\s().-]', '', 'g'), '');
  new."Type of Identification" := nullif(btrim(new."Type of Identification"), '');
  -- the older forms only ask for a national ID number and have no identity type
  if new."ID Number" is not null and new."Type of Identification" is null then
    new."Type of Identification" := 'National ID';
  end if;
  new."Disability Cert No" := nullif(btrim(new."Disability Cert No"), '');
  -- a Tanzanian National ID (NIDA) is written with dashes: kept as its 20 digits
  if v_country = 'Tanzania' and new."Type of Identification" = 'National ID' then
    new."ID Number" := nullif(replace(coalesce(new."ID Number", ''), '-', ''), '');
  end if;
  -- Tanzania: the HESLB Form Four index number, upper case (20261021000000)
  new.heslb_index_number := nullif(upper(btrim(coalesce(new.heslb_index_number, ''))), '');

  -- formats, checked when a value is new or changed
  if new."Tax PIN" is not null and (is_insert or new."Tax PIN" is distinct from old."Tax PIN")
     and not public.tax_number_ok(v_country, new."Tax PIN") then
    raise exception '% "%" %', public.tax_number_label(v_country), new."Tax PIN", public.tax_number_hint(v_country) using errcode = '23514';
  end if;
  if new."ID Number" is not null and (is_insert or new."ID Number" is distinct from old."ID Number"
     or new."Type of Identification" is distinct from old."Type of Identification") then
    if not public.identity_number_ok_in(v_country, new."Type of Identification", new."ID Number") then
      raise exception '"%" is not a valid % number', new."ID Number", new."Type of Identification" using errcode = '23514';
    end if;
  end if;
  if new."SHIF Number" is not null and (is_insert or new."SHIF Number" is distinct from old."SHIF Number")
     and not public.sha_number_ok(new."SHIF Number") then
    raise exception 'SHA number "%" should be letters and digits only', new."SHIF Number" using errcode = '23514';
  end if;
  if new."NSSF Number" is not null and (is_insert or new."NSSF Number" is distinct from old."NSSF Number")
     and not public.social_security_number_ok(v_country, new."NSSF Number") then
    raise exception 'NSSF number "%" %', new."NSSF Number", public.social_security_number_hint(v_country) using errcode = '23514';
  end if;
  if new."Mobile Number" is not null and (is_insert or new."Mobile Number" is distinct from old."Mobile Number")
     and not public.phone_ok(new."Mobile Number") then
    raise exception 'Phone number "%" should look like 0712345678, or start with + and the country code', new."Mobile Number"
      using errcode = '23514';
  end if;

  -- unique within the company (the unique indexes back this up); the message does not say who has it
  if new."ID Number" is not null and (is_insert or new."ID Number" is distinct from old."ID Number") and exists (
    select 1 from public.employees where tenant_id = new.tenant_id and "ID Number" = new."ID Number" and id <> new.id) then
    raise exception 'Another employee in this company already has ID number %', new."ID Number" using errcode = '23505';
  end if;
  if new."Tax PIN" is not null and (is_insert or new."Tax PIN" is distinct from old."Tax PIN") and exists (
    select 1 from public.employees where tenant_id = new.tenant_id and "Tax PIN" = new."Tax PIN" and id <> new.id) then
    raise exception 'Another employee in this company already has % %', public.tax_number_label(v_country), new."Tax PIN" using errcode = '23505';
  end if;
  if new."SHIF Number" is not null and (is_insert or new."SHIF Number" is distinct from old."SHIF Number") and exists (
    select 1 from public.employees where tenant_id = new.tenant_id and "SHIF Number" = new."SHIF Number" and id <> new.id) then
    raise exception 'Another employee in this company already has SHA number %', new."SHIF Number" using errcode = '23505';
  end if;
  if new."NSSF Number" is not null and (is_insert or new."NSSF Number" is distinct from old."NSSF Number") and exists (
    select 1 from public.employees where tenant_id = new.tenant_id and "NSSF Number" = new."NSSF Number" and id <> new.id) then
    raise exception 'Another employee in this company already has NSSF number %', new."NSSF Number" using errcode = '23505';
  end if;

  -- payroll number: generated, never typed (the backend may bring one over from another system)
  if is_insert then
    if auth.uid() is not null or coalesce(btrim(new."Payroll Number"), '') = '' then
      new."Payroll Number" := public.next_payroll_number(new.tenant_id);
    end if;
  elsif auth.uid() is not null then
    new."Payroll Number" := old."Payroll Number";
  end if;

  -- onboarding status: a new record starts as a draft; afterwards only the onboarding functions move it
  if is_insert then
    if auth.uid() is not null then
      new.onboarding_status := 'draft';
      new.onboarding_submitted_at := null;
      new.onboarding_reviewed_by := null;
      new.onboarding_reviewed_at := null;
      new.onboarding_review_comment := null;
    end if;
    return new;
  end if;

  if auth.uid() is not null and not in_transition then
    if new.onboarding_status is distinct from old.onboarding_status then
      raise exception 'Onboarding moves on by submitting or reviewing the record, not by editing it' using errcode = '42501';
    end if;
    new.onboarding_submitted_at := old.onboarding_submitted_at;
    new.onboarding_reviewed_by := old.onboarding_reviewed_by;
    new.onboarding_reviewed_at := old.onboarding_reviewed_at;
    new.onboarding_review_comment := old.onboarding_review_comment;
  end if;

  -- an employee changing an approved record's details sends it back to HR (and out of payroll until approved)
  if is_staff and not in_transition and old.onboarding_status = 'approved' then
    select array_agg(k order by k) into changed
    from unnest(public.onboarding_review_fields()) k
    where (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k);
    if changed is not null then
      new.onboarding_status := 'submitted';
      new.onboarding_submitted_at := now();
      insert into public.employee_onboarding_reviews (tenant_id, employee_id, action, changed_fields, actor)
      values (new.tenant_id, new.id, 'resubmitted', changed, auth.uid());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists employees_onboarding_rules on public.employees;
create trigger employees_onboarding_rules before insert or update on public.employees
  for each row execute function public.employees_onboarding_rules();

-- what is still missing on a record (from 20261012100000; onboarding_missing adds documents, referees and policies on
-- top): the tax number by its name in the employee's country, an SHA number only in Kenya, and a Tanzanian HESLB
-- borrower's index number
create or replace function public.onboarding_missing_details(e public.employees, p_part text default 'all') returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  m text[] := '{}';
  blank constant text := '^\s*$';
  by_bank boolean := coalesce(e.payment_method, '') !~* 'mpesa|m-pesa|mobile|airtel|safaricom|cash'
                     and coalesce(btrim(e.payment_method), '') <> '';
  v_country text := public.employee_row_country(e.tenant_id, e.branch_id, e."Branch");
  v_tax text := public.tax_number_label(v_country);
begin
  if p_part in ('employee', 'all') then
    if coalesce(e."Last Name", '') ~ blank then m := m || text 'Surname'; end if;
    if coalesce(e."First Name", '') ~ blank then m := m || text 'First name'; end if;
    if coalesce(e."Date of Birth", '') ~ blank then m := m || text 'Date of birth'; end if;
    if coalesce(e."Gender", '') ~ blank then m := m || text 'Sex'; end if;
    if coalesce(e.nationality, '') ~ blank then m := m || text 'Nationality'; end if;
    if coalesce(e.residential_address, '') ~ blank then m := m || text 'Residential address'; end if;
    if coalesce(e."Personal Email", '') ~ blank then m := m || text 'Personal email'; end if;
    if e."Type of Identification" is null then m := m || text 'Identity type'; end if;
    if e."ID Number" is null then m := m || text 'ID number';
    elsif not public.identity_number_ok_in(v_country, e."Type of Identification", e."ID Number") then m := m || text 'ID number (not valid)'; end if;
    if e."Tax PIN" is null then m := m || v_tax;
    elsif not public.tax_number_ok(v_country, e."Tax PIN") then m := m || (v_tax || ' (not valid)'); end if;
    if public.needs_sha_number(v_country) then
      if e."SHIF Number" is null then m := m || text 'SHA number';
      elsif not public.sha_number_ok(e."SHIF Number") then m := m || text 'SHA number (not valid)'; end if;
    end if;
    if e."NSSF Number" is null then m := m || text 'NSSF number';
    elsif not public.social_security_number_ok(v_country, e."NSSF Number") then m := m || text 'NSSF number (not valid)'; end if;
    if public.tidy_country(v_country) = 'Tanzania' and e.heslb_borrower and e.heslb_index_number is null then
      m := m || text 'HESLB index number';
    end if;
    if e."Mobile Number" is null then m := m || text 'Phone number';
    elsif not public.phone_ok(e."Mobile Number") then m := m || text 'Phone number (not valid)'; end if;
    if e.kra_residency is null then m := m || text 'Residency'; end if;
    if e.is_pwd is null then m := m || text 'Disability (PWD) status';
    elsif e.is_pwd and e."Disability Cert No" is null then m := m || text 'Exemption certificate number'; end if;
    if by_bank then
      if coalesce(e."Bank", '') ~ blank then m := m || text 'Bank name'; end if;
      if coalesce(e."Bank Branch", '') ~ blank then m := m || text 'Bank branch'; end if;
      if coalesce(e.account_number_name, '') ~ blank then m := m || text 'Account name'; end if;
      if coalesce(e."Account Number", '') ~ blank then m := m || text 'Account number'; end if;
    end if;
    if not exists (select 1 from public.emergency_contact c where c.tenant_id = e.tenant_id
                   and c."Employee Number" = e."Employee Number" and coalesce(c.full_name, '') !~ blank
                   and coalesce(c.phone_number, '') !~ blank) then
      m := m || text 'Emergency contact';
    end if;
    if not exists (select 1 from public.next_of_kin k where k.tenant_id = e.tenant_id
                   and k."Employee Number" = e."Employee Number") then
      m := m || text 'Next of kin';
    end if;
  end if;

  if p_part in ('employer', 'all') then
    if coalesce(e."Job Title", '') ~ blank then m := m || text 'Position'; end if;
    if e.kra_employee_type is null then m := m || text 'Type of employee'; end if;
    if coalesce(e."Basic Salary", 0) <= 0 then m := m || text 'Basic salary'; end if;
    if coalesce(e.payment_method, '') ~ blank then m := m || text 'Payment method'; end if;
  end if;
  return m;
end $$;
revoke all on function public.onboarding_missing_details(public.employees, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. piece rate payouts on each worker's country's rates, one currency per payout
--    (from 20261020200000_piece_rate_payouts.sql; Kenya, Tanzania and Uganda)
-- ---------------------------------------------------------------------------------------------
-- An amount in a currency, for notifications: KES with cents as before (public.kes), whole shillings for TZS and UGX.
create or replace function public.money_text(p_amount numeric, p_currency text) returns text language sql immutable as $$
  select case coalesce(nullif(upper(btrim(p_currency)), ''), 'KES')
    when 'KES' then public.kes(p_amount)
    else upper(btrim(p_currency)) || ' ' || to_char(round(coalesce(p_amount, 0)), 'FM999,999,999,999,990') end
$$;

-- each batch's country and currency: everyone in it is paid in that currency (the batches so far are Kenya's)
alter table public.work_payout_batches add column if not exists country text;
alter table public.work_payout_batches add column if not exists currency text;
update public.work_payout_batches set country = coalesce(country, 'Kenya'), currency = coalesce(currency, 'KES')
where country is null or currency is null;
alter table public.work_payout_batches drop constraint if exists work_payout_batches_currency_code;
alter table public.work_payout_batches add constraint work_payout_batches_currency_code
  check (currency is null or currency ~ '^[A-Z]{3}$');

-- 20261021000000 (before it was merged with this one) held back Tanzania's payouts with a trigger; the batch does it now
drop trigger if exists work_payout_line_tanzania on public.work_payout_lines;
drop function if exists public.work_payout_line_tanzania();

-- p_country: the country to pay (its workers only). Without it, everyone the payout picks must be paid in one
-- currency: a payout that would mix currencies is refused, never added up across them.
drop function if exists public.create_work_payout_batch(text, date, date, text[], text);
create or replace function public.create_work_payout_batch(
  p_kind text, p_from date, p_to date, p_workers text[] default null, p_notes text default null, p_country text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_today date := public.work_today();
  v_only text := public.tidy_country(nullif(btrim(p_country), ''));
  v_id uuid;
  v_rates jsonb;
  v_ahl_rate numeric;
  v_country text;
  v_currency text;
  v_batch_country text;
  v_batch_currency text;
  v_resident boolean;
  v_wht_c numeric;
  v_wht_p numeric;
  v_reserve_rate numeric;
  v_contractor_reserve boolean;
  e record;
  v_entries uuid[];
  v_jobs uuid[];
  v_work numeric;
  v_jobs_amt numeric;
  v_first date;
  v_last date;
  v_gross numeric;
  v_contractor boolean;
  v_ahl numeric;
  v_reserve numeric;
  v_wht numeric;
  v_wht_rate numeric;
  v_res_rate numeric;
  v_net numeric;
  v_line uuid;
  b public.work_payout_batches;
begin
  if not public.manages_work() then raise exception 'Only payroll can make payouts' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('daily', 'weekly', 'job', 'ad_hoc') then
    raise exception 'Pick daily, weekly, job completion or ad hoc' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a first day, and a last day that is the same day or later' using errcode = '22023';
  end if;
  if p_to > v_today then raise exception 'A payout can''t include days still to come' using errcode = '22023'; end if;
  if date_trunc('month', p_from) <> date_trunc('month', p_to) then
    raise exception 'A payout stays within one month, so the month-end payroll can settle it; make one for each month'
      using errcode = '22023';
  end if;
  if public.pay_month_closed(v_tenant, p_from) then
    raise exception 'Payroll for % is approved; that month is locked', to_char(p_from, 'Mon YYYY') using errcode = '22023';
  end if;
  if p_kind = 'ad_hoc' and coalesce(array_length(p_workers, 1), 0) = 0 then
    raise exception 'Pick who to pay' using errcode = '22023';
  end if;

  v_reserve_rate := coalesce((select s.payout_reserve_rate from public.company_payroll_settings s where s.tenant_id = v_tenant), 0.10);
  v_contractor_reserve := public.contractor_reserve(v_tenant);

  insert into public.work_payout_batches (tenant_id, kind, period_from, period_to, pay_period, notes, created_by, country, currency)
  values (v_tenant, p_kind, p_from, p_to, to_char(p_from, 'YYYY-MM'), nullif(btrim(p_notes), ''), auth.uid(),
          v_only, case when v_only is not null then public.country_currency(v_only) end)
  returning id into v_id;

  for e in
    select x."Employee Number" as num, x.worker_kind, x.wht_category, x.pay_frequency, x.kra_residency
    from public.employees x
    where x.tenant_id = v_tenant and x."Employee Number" is not null
      and coalesce(x.worker_kind, 'employee') <> 'casual'
      and case p_kind
            when 'daily' then x.pay_basis = 'work' and x.pay_frequency = 'daily'
            when 'weekly' then x.pay_basis = 'work' and x.pay_frequency = 'weekly'
            when 'job' then x.pay_frequency = 'per_job'
            else x."Employee Number" = any (p_workers)
          end
    order by x."First Name", x."Last Name", x."Employee Number"
  loop
    -- each worker's country and currency (their branch's, FIG-905); a payout for one country skips everyone else
    v_country := coalesce(public.tidy_country(public.employee_country(v_tenant, e.num)), 'Kenya');
    v_currency := coalesce(nullif(upper(btrim(public.employee_currency(v_tenant, e.num))), ''), public.country_currency(v_country));
    continue when v_only is not null and v_country <> v_only;

    select coalesce(array_agg(w.id order by w.work_date), '{}'), coalesce(sum(w.amount), 0), min(w.work_date), max(w.work_date)
      into v_entries, v_work, v_first, v_last
    from public.work_entries w
    where p_kind <> 'job' and w.tenant_id = v_tenant and w.employee_number = e.num
      and w.status = 'approved' and w.paid_out_at is null and w.work_date between p_from and p_to
      and not exists (select 1 from public.work_payout_lines l join public.work_payout_batches ob on ob.id = l.batch_id
                      where ob.tenant_id = v_tenant and ob.status = 'draft' and w.id = any (l.entry_ids));

    select coalesce(array_agg(j.id order by j.approved_at), '{}'), coalesce(sum(j.amount), 0)
      into v_jobs, v_jobs_amt
    from public.contract_jobs j
    where j.tenant_id = v_tenant and j.employee_number = e.num
      and j.status = 'approved' and j.paid_out_at is null and j.approved_at is not null
      and (j.approved_at at time zone 'Africa/Nairobi')::date <= p_to
      and not public.pay_month_closed(v_tenant, (j.approved_at at time zone 'Africa/Nairobi')::date)
      and not exists (select 1 from public.work_payout_lines l join public.work_payout_batches ob on ob.id = l.batch_id
                      where ob.tenant_id = v_tenant and ob.status = 'draft' and j.id = any (l.job_ids));

    v_gross := round(v_work + v_jobs_amt, 2);
    continue when v_gross <= 0;

    -- one currency per payout: the first worker paid sets it; anyone in another currency is refused, not added up
    if v_batch_currency is null then
      v_batch_country := v_country;
      v_batch_currency := v_currency;
    elsif v_currency <> v_batch_currency then
      raise exception 'This payout would mix % (%) and % (%): make one payout for each country', v_batch_currency, v_batch_country, v_currency, v_country
        using errcode = '22023';
    end if;

    -- each worker on their own country's rates (FIG-905): Kenya holds back the housing levy; Tanzania and Uganda have
    -- none, so the reserve only. Contractors: Kenya and Uganda by the kind of service, Tanzania by residency.
    v_rates := public.statutory_rates_on(p_to, v_country);
    v_ahl_rate := coalesce((v_rates->>'ahl_rate')::numeric, case when v_country = 'Kenya' then 0.015 else 0 end);
    if v_country = 'Tanzania' then
      v_resident := not (coalesce(e.kra_residency, '') ilike 'non%');
      v_wht_c := case when v_resident then coalesce((v_rates->>'wht_resident')::numeric, 0.05)
                      else coalesce((v_rates->>'wht_nonresident')::numeric, 0.15) end;
      v_wht_p := v_wht_c;
    else
      v_wht_c := coalesce((v_rates->>'wht_contractual')::numeric, case when v_country = 'Kenya' then 0.03 else 0 end);
      v_wht_p := coalesce((v_rates->>'wht_professional')::numeric, case when v_country = 'Kenya' then 0.05 else 0 end);
    end if;

    v_contractor := e.worker_kind = 'contractor';
    if v_contractor then
      v_wht_rate := case when e.wht_category = 'professional' then v_wht_p else v_wht_c end;
      v_res_rate := case when v_contractor_reserve then v_reserve_rate else 0 end;
      v_ahl := 0;
      v_wht := round(v_gross * v_wht_rate, 2);
    else
      v_wht_rate := 0;
      v_res_rate := v_reserve_rate;
      v_ahl := round(v_gross * v_ahl_rate, 2);
      v_wht := 0;
    end if;
    v_reserve := round(v_gross * v_res_rate, 2);
    v_net := greatest(0, floor(v_gross - v_ahl - v_reserve - v_wht));

    insert into public.work_payout_lines (
      tenant_id, batch_id, employee_number, worker_kind, wht_category, pay_frequency, entry_ids, job_ids, work_from, work_to,
      work_amount, jobs_amount, gross, ahl_rate, reserve_rate, wht_rate, ahl, reserve, wht, rounding, net)
    values (
      v_tenant, v_id, e.num, coalesce(e.worker_kind, 'employee'), case when v_contractor then e.wht_category end, e.pay_frequency,
      v_entries, v_jobs, v_first, v_last, v_work, v_jobs_amt, v_gross,
      case when v_contractor then 0 else v_ahl_rate end, v_res_rate, v_wht_rate, v_ahl, v_reserve, v_wht,
      v_gross - v_ahl - v_reserve - v_wht - v_net, v_net)
    returning id into v_line;
    perform public.work_payout_details(v_line);
  end loop;

  -- the batch's country and currency: the one asked for, else its workers' (the company's for an empty batch)
  update public.work_payout_batches
     set country = coalesce(country, v_batch_country, public.company_country(v_tenant)),
         currency = coalesce(currency, v_batch_currency, public.country_currency(public.company_country(v_tenant)))
   where id = v_id;
  perform public.work_payout_recount(v_id);
  select * into b from public.work_payout_batches where id = v_id;

  if b.worker_count > 0 and public.payout_needs_second_approver(v_tenant) then
    perform public.work_notify(v_tenant, array(select public.work_payroll_numbers(v_tenant)), 'approval_needed',
      'Payout waiting for approval',
      coalesce(public.work_worker_name(v_tenant, public.current_employee_number()), 'Payroll') || ' made a payout for '
      || public.work_payout_days(p_from, p_to) || ' (' || b.worker_count || ' ' || case when b.worker_count = 1 then 'worker' else 'workers' end
      || ', ' || public.money_text(b.net_total, b.currency) || ' to pay). Someone else must approve it: open Piece rate > Payouts.');
  end if;
  return v_id;
end $$;
revoke all on function public.create_work_payout_batch(text, date, date, text[], text, text) from public, anon;
grant execute on function public.create_work_payout_batch(text, date, date, text[], text, text) to authenticated;

-- approving: as in 20261020200000, with each worker told the amount in the payout's currency
create or replace function public.approve_work_payout_batch(p_batch uuid) returns public.work_payout_batches
language plpgsql security definer set search_path = public as $$
declare
  b public.work_payout_batches;
  v_l record;
  v_changed integer;
begin
  b := public.work_payout_open(p_batch, array['draft']);
  if public.payout_needs_second_approver(b.tenant_id) and b.created_by = auth.uid() then
    raise exception 'Someone other than who made this payout must approve it' using errcode = '42501';
  end if;
  if public.pay_month_closed(b.tenant_id, b.period_from) then
    raise exception 'Payroll for % is approved; that month is locked. Cancel this payout', to_char(b.period_from, 'Mon YYYY');
  end if;
  if not exists (select 1 from public.work_payout_lines where batch_id = p_batch) then
    raise exception 'There is nobody to pay in this payout';
  end if;
  if exists (select 1 from public.work_payout_lines where batch_id = p_batch and problem is not null) then
    raise exception 'Some workers have payment details missing: fix their records and refresh, or remove them from this payout';
  end if;

  -- everything in it must still be approved and unpaid (work can be reopened while a batch is a draft)
  select count(*) into v_changed
  from public.work_payout_lines l, unnest(l.entry_ids) as x(id)
  where l.batch_id = p_batch and not exists (
    select 1 from public.work_entries w where w.id = x.id and w.tenant_id = b.tenant_id and w.status = 'approved' and w.paid_out_at is null);
  select v_changed + count(*) into v_changed
  from public.work_payout_lines l, unnest(l.job_ids) as x(id)
  where l.batch_id = p_batch and not exists (
    select 1 from public.contract_jobs j where j.id = x.id and j.tenant_id = b.tenant_id and j.status = 'approved' and j.paid_out_at is null);
  if v_changed > 0 then
    raise exception 'Some work in this payout changed after it was made (reopened or paid another way). Cancel it and make a new one';
  end if;

  perform set_config('app.work_payout', 'on', true);
  perform set_config('app.work_payout_at', now()::text, true);
  update public.work_entries w set payout_line_id = l.id, paid_out_at = now()
  from public.work_payout_lines l
  where l.batch_id = p_batch and w.id = any (l.entry_ids);
  update public.contract_jobs j set payout_line_id = l.id, paid_out_at = now()
  from public.work_payout_lines l
  where l.batch_id = p_batch and j.id = any (l.job_ids);
  perform set_config('app.work_payout', 'off', true);
  perform set_config('app.work_payout_at', '', true);

  update public.work_payout_batches set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_batch returning * into b;

  for v_l in select * from public.work_payout_lines where batch_id = p_batch loop
    perform public.notify_employee_number(b.tenant_id, v_l.employee_number, 'employment_update', 'Payout on its way',
      public.money_text(v_l.net, b.currency) || ' is being paid to you for '
      || coalesce('work ' || public.work_payout_days(v_l.work_from, v_l.work_to), '')
      || case when v_l.work_from is not null and cardinality(v_l.job_ids) > 0 then ' and ' else '' end
      || case when cardinality(v_l.job_ids) = 1 then 'a contract job' when cardinality(v_l.job_ids) > 1 then cardinality(v_l.job_ids) || ' contract jobs' else '' end
      || '.' || case when v_l.gross > v_l.net
                     then ' ' || public.money_text(v_l.gross - v_l.net, b.currency) || ' is held back and settled with your month-end pay.' else '' end);
  end loop;
  return b;
end $$;
revoke all on function public.approve_work_payout_batch(uuid) from public, anon;
grant execute on function public.approve_work_payout_batch(uuid) to authenticated;

-- cancelling: as in 20261020200000, with the amount in the payout's currency
create or replace function public.cancel_work_payout_batch(p_batch uuid, p_reason text default null) returns public.work_payout_batches
language plpgsql security definer set search_path = public as $$
declare
  b public.work_payout_batches;
  v_was text;
  v_l record;
begin
  b := public.work_payout_open(p_batch, array['draft', 'approved']);
  v_was := b.status;
  if v_was = 'approved' then
    if public.pay_month_closed(b.tenant_id, b.period_from) then
      raise exception 'Payroll for % is approved, so this payout can''t be cancelled', to_char(b.period_from, 'Mon YYYY');
    end if;
    perform set_config('app.work_payout', 'on', true);
    perform set_config('app.work_payout_at', '', true);
    update public.work_entries set payout_line_id = null, paid_out_at = null
    where payout_line_id in (select id from public.work_payout_lines where batch_id = p_batch);
    update public.contract_jobs set payout_line_id = null, paid_out_at = null
    where payout_line_id in (select id from public.work_payout_lines where batch_id = p_batch);
    perform set_config('app.work_payout', 'off', true);
  end if;
  update public.work_payout_batches
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = nullif(btrim(p_reason), ''),
         updated_at = now()
   where id = p_batch returning * into b;
  if v_was = 'approved' then
    for v_l in select * from public.work_payout_lines where batch_id = p_batch loop
      perform public.notify_employee_number(b.tenant_id, v_l.employee_number, 'employment_update', 'Payout cancelled',
        'The payout of ' || public.money_text(v_l.net, b.currency) || ' to you was cancelled before it was sent. The work in it will be paid in a later payout.');
    end loop;
  end if;
  return b;
end $$;
revoke all on function public.cancel_work_payout_batch(uuid, text) from public, anon;
grant execute on function public.cancel_work_payout_batch(uuid, text) to authenticated;

notify pgrst, 'reload schema';
