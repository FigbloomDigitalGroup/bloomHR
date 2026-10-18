-- Tanzania payroll (FIG-905 stage 3). Builds on 20261020900000_payroll_countries.sql (statutory_rates.country,
-- statutory_rates_on(day, country), payslips with a country and currency). Everyone in a Tanzania branch is worked out
-- by the Tanzania engine (src/lib/payroll/countries/tanzania.ts) in TZS with the rates below. Written to run again
-- safely.
--
-- The rates (statutory_rates, country 'Tanzania', company-wide defaults). Every one is dated data: a company can set
-- its own from a date on the Rates tab, and a change in the law is a new dated row. Checked 2026-10-18 against the
-- official pages below. All of them were in force on 1 July 2023 and are unchanged by the Finance Acts 2024, 2025 and
-- 2026, so they are seeded from 2023-07-01 (the date of the most recent change among them: the SDL cut to 3.5%).
--
--   paye_bands             resident employee, monthly (TZS): up to 270,000 nil; to 520,000 8%; to 760,000 20%; to
--                          1,000,000 25%; above 30% (20,000 / 68,000 / 128,000 at the band tops).
--                          TRA, https://www.tra.go.tz/page/income-tax-for-individuals and /page/pay-as-you-earn
--                          (Income Tax Act Cap 332, First Schedule). The bands themselves date from the 2022 cut of the
--                          second band to 8%; that original date is not verified and does not matter from 2023.
--   nonresident_paye_rate  15% of a non-resident employee's gross employment income, a final withholding (TRA PAYE page)
--   secondary_paye_rate    30%: a secondary employer withholds at the highest individual rate (TRA PAYE page)
--   nssf_rate              10% employee and nssf_employer_rate 10% employer of wages (20% in all; the employee's share
--   nssf_employer_rate     may not exceed 10%, and 5/15 or 0/20 splits are allowed: set the company's own rates).
--                          No ceiling. NSSF Act Cap 50 s.12, https://www.nssf.go.tz/pages/payment-of-contributions
--   nssf_deductible        1: the employee's contribution to an approved retirement fund comes off pay before PAYE
--                          (TRA PAYE page)
--   sdl_rate               3.5% of gross emoluments, paid by the employer, from 1 July 2023 (Finance Act 2023, VETA
--                          Act Cap 82). https://www.tra.go.tz/page/skills-development-levy-sdl
--   sdl_min_employees      10: SDL is paid by an employer with ten or more employees (permanent, part time, secondary
--                          and casual all count). The payroll counts the people it pays in Tanzania that month. A company
--                          that is exempt (government, charities with a ruling, educational institutions, farm staff...)
--                          sets sdl_rate to 0 from a date on the Rates tab.
--   wcf_rate               0.5% of gross earnings, paid by the employer, private and public sector alike (Workers
--                          Compensation Act Cap 263, reg. 5(2) as amended 2022). https://www.wcf.go.tz/pages/contribution
--                          WCF's gross earnings are basic pay and the fixed allowances paid every month, so the engine
--                          leaves out overtime and one-off earnings.
--   heslb_rate             15% of a borrower's basic salary (HESLB Act as amended 2016), taken after tax, for employees
--                          flagged heslb_borrower. https://www.heslb.go.tz/loanrepayment/obligation
--   wht_resident           5% withholding tax on a resident contractor's service fees; wht_nonresident 15%
--   wht_nonresident        (TRA, https://www.tra.go.tz/page/withholding-tax)
--
-- Assumptions (no finance team signs these off; each is a setting or a dated rate):
--   * NSSF is on the month's pensionable pay: gross less earnings marked not pensionable. Secondary guides say gross;
--     the statute's "wage" was not read in full.
--   * HESLB is on the basic salary earned that month (after unpaid leave).
--   * Health insurance (NHIF / the Universal Health Insurance Act 2023) has no set payroll rate for private employers
--     in 2026: it is a voluntary deduction per employee, not a default.
--   * Statutory amounts are rounded to the whole shilling (no official rule found; GePG takes whole shillings).
--   * PAYE and NSSF are taken even while the TIN or NSSF number is missing (they are owed either way); payroll lists
--     who is missing them.
--   * Kenya's two-thirds cap on deductions (Employment Act s.19(3)) does not apply. Tanzania's ELRA s.28 limits
--     deductions differently (reported as a quarter of pay for non-statutory deductions; the wording was not verified),
--     so the engine does not apply a cap. Loan repayments still never take net pay below 0.
--   * Filing layouts (TRA PAYE ITX 215.01.E, NSSF, SDL, WCF, HESLB) follow the commonly used columns; the portals'
--     own templates need a login and were not seen.
--
-- Employees (Tanzania's details):
--   tz_tin                the TRA TIN (9 digits; kept without dashes, unique in the company). The existing "Tax PIN"
--                         can't hold it: it is checked as a KRA PIN (employees_onboarding_rules)
--   kra_residency         "Residency (for tax)", already there: Non-Resident means the flat 15%; empty means resident
--   tz_nssf_number        NSSF (Tanzania) membership number
--   heslb_borrower        repays a HESLB loan (15% of basic each month); heslb_index_number is the Form Four index
--   heslb_index_number    number HESLB identifies the borrower by
--   secondary_employment  this is not the employee's main job: PAYE at the flat 30%
--
-- Payslips (salary_history): heslb_deduction (taken from pay, in total_deductions), the employer's costs nssf_employer,
-- sdl_levy and wcf_levy (never taken from pay), taxable_pay and tax_resident as worked out.
--
-- Piece rate payouts during the month: a Tanzania worker's payout holds back the company's reserve only (no Kenyan
-- housing levy), and a Tanzania contractor's withholding tax is at Tanzania's rate (5% resident, 15% non-resident).

-- ---------------------------------------------------------------------------------------------
-- 1. Tanzania's statutory rates
-- ---------------------------------------------------------------------------------------------
insert into public.statutory_rates (tenant_id, country, code, value, bands, effective_from, effective_to, source)
select null, 'Tanzania', v.code, v.value, v.bands, date '2023-07-01', null, v.source
from (values
  ('paye_bands', null::numeric,
   '[{"upto": 270000, "rate": 0}, {"upto": 520000, "rate": 0.08}, {"upto": 760000, "rate": 0.20}, {"upto": 1000000, "rate": 0.25}, {"upto": null, "rate": 0.30}]'::jsonb,
   'Income Tax Act Cap 332, First Schedule: resident individual monthly bands (TRA)'),
  ('nonresident_paye_rate', 0.15, null, 'Income Tax Act Cap 332: non-resident employment income, 15% final (TRA)'),
  ('secondary_paye_rate', 0.30, null, 'Income Tax Act Cap 332: secondary employment at the highest individual rate (TRA)'),
  ('nssf_rate', 0.10, null, 'NSSF Act Cap 50 s.12: employee share, 10% of wages'),
  ('nssf_employer_rate', 0.10, null, 'NSSF Act Cap 50 s.12: employer share, 10% of wages'),
  ('nssf_deductible', 1, null, 'Income Tax Act Cap 332: approved retirement contributions come off pay before PAYE (TRA)'),
  ('sdl_rate', 0.035, null, 'VETA Act Cap 82 as amended by the Finance Act 2023: 3.5% of gross emoluments (TRA)'),
  ('sdl_min_employees', 10, null, 'VETA Act Cap 82: employers with 10 or more employees pay SDL (TRA)'),
  ('wcf_rate', 0.005, null, 'Workers Compensation Act Cap 263, reg. 5(2) as amended 2022: 0.5% of gross earnings (WCF)'),
  ('heslb_rate', 0.15, null, 'Higher Education Students'' Loans Board Act as amended 2016: 15% of basic salary (HESLB)'),
  ('wht_resident', 0.05, null, 'Income Tax Act Cap 332: service fees to a resident, 5% (TRA)'),
  ('wht_nonresident', 0.15, null, 'Income Tax Act Cap 332: service fees to a non-resident, 15% (TRA)')
) as v(code, value, bands, source)
where not exists (
  select 1 from public.statutory_rates r where r.tenant_id is null and lower(r.country) = 'tanzania' and r.code = v.code
);

-- ---------------------------------------------------------------------------------------------
-- 2. employees: Tanzania's details
-- ---------------------------------------------------------------------------------------------
alter table public.employees add column if not exists tz_tin text;
alter table public.employees add column if not exists tz_nssf_number text;
alter table public.employees add column if not exists heslb_borrower boolean not null default false;
alter table public.employees add column if not exists heslb_index_number text;
alter table public.employees add column if not exists secondary_employment boolean not null default false;

-- the TIN and NSSF number tidied (no spaces or dashes), the TIN checked and unique within the company
create or replace function public.employees_tanzania_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.tz_tin := nullif(regexp_replace(coalesce(new.tz_tin, ''), '[\s-]', '', 'g'), '');
  new.tz_nssf_number := nullif(regexp_replace(coalesce(new.tz_nssf_number, ''), '[\s-]', '', 'g'), '');
  new.heslb_index_number := nullif(upper(btrim(coalesce(new.heslb_index_number, ''))), '');
  if new.tz_tin is not null and (tg_op = 'INSERT' or new.tz_tin is distinct from old.tz_tin) then
    if new.tz_tin !~ '^\d{9}$' then
      raise exception 'TIN "%" should be 9 digits, like 123-456-789', new.tz_tin using errcode = '23514';
    end if;
    if exists (select 1 from public.employees where tenant_id = new.tenant_id and tz_tin = new.tz_tin and id <> new.id) then
      raise exception 'Another employee in this company already has TIN %', new.tz_tin using errcode = '23505';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.employees_tanzania_rules() from public, anon, authenticated;
drop trigger if exists employees_tanzania_rules on public.employees;
create trigger employees_tanzania_rules before insert or update on public.employees
  for each row execute function public.employees_tanzania_rules();

-- ---------------------------------------------------------------------------------------------
-- 3. payslips: Tanzania's figures
-- ---------------------------------------------------------------------------------------------
alter table public.salary_history add column if not exists heslb_deduction numeric(14, 2) not null default 0;
alter table public.salary_history add column if not exists nssf_employer numeric(14, 2) not null default 0;
alter table public.salary_history add column if not exists sdl_levy numeric(14, 2) not null default 0;
alter table public.salary_history add column if not exists wcf_levy numeric(14, 2) not null default 0;
alter table public.salary_history add column if not exists taxable_pay numeric(14, 2);
alter table public.salary_history add column if not exists tax_resident boolean;
alter table public.salary_history drop constraint if exists salary_history_tz_amounts;
alter table public.salary_history add constraint salary_history_tz_amounts
  check (heslb_deduction >= 0 and nssf_employer >= 0 and sdl_levy >= 0 and wcf_levy >= 0);

-- ---------------------------------------------------------------------------------------------
-- 4. piece rate payouts for Tanzania workers: the reserve only, and Tanzania's withholding tax for contractors
-- ---------------------------------------------------------------------------------------------
create or replace function public.work_payout_line_tanzania() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_day date;
  v_rates jsonb;
  v_resident boolean;
begin
  if lower(coalesce(public.employee_country(new.tenant_id, new.employee_number), '')) <> 'tanzania' then
    return new;
  end if;
  -- no Kenyan housing levy outside Kenya
  new.ahl := 0;
  new.ahl_rate := 0;
  if new.worker_kind = 'contractor' then
    select b.period_to into v_day from public.work_payout_batches b where b.id = new.batch_id;
    v_rates := public.statutory_rates_on(coalesce(v_day, current_date), 'Tanzania');
    select not (coalesce(e.kra_residency, '') ilike 'non%') into v_resident
    from public.employees e where e.tenant_id = new.tenant_id and e."Employee Number" = new.employee_number;
    new.wht_rate := case when coalesce(v_resident, true)
                         then coalesce((v_rates->>'wht_resident')::numeric, 0.05)
                         else coalesce((v_rates->>'wht_nonresident')::numeric, 0.15) end;
    new.wht := round(new.gross * new.wht_rate, 2);
  end if;
  new.net := greatest(0, floor(new.gross - new.reserve - new.wht));
  new.rounding := new.gross - new.reserve - new.wht - new.net;
  return new;
end $$;
revoke all on function public.work_payout_line_tanzania() from public, anon, authenticated;
drop trigger if exists work_payout_line_tanzania on public.work_payout_lines;
create trigger work_payout_line_tanzania before insert on public.work_payout_lines
  for each row execute function public.work_payout_line_tanzania();
