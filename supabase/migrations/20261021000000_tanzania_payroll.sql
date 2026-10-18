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
--   "Tax PIN"             holds the tax number of the employee's country: the TRA TIN (9 digits, kept without dashes,
--                         unique in the company) for staff in Tanzania
--   "NSSF Number"         holds the employee's NSSF member number: NSSF Tanzania's for staff in Tanzania
--   kra_residency         "Residency (for tax)", already there: Non-Resident means the flat 15%; empty means resident
--   heslb_borrower        repays a HESLB loan (15% of basic each month); heslb_index_number is the Form Four index
--   heslb_index_number    number HESLB identifies the borrower by
--   secondary_employment  this is not the employee's main job: PAYE at the flat 30%
--   The format checks of "Tax PIN", "NSSF Number" and "ID Number" (a NIDA number), what onboarding asks for (a TIN,
--   no SHA number) and the tidying of heslb_index_number follow the employee's branch's country. They are defined once
--   for every country in 20261021100000_uganda_payroll.sql (tax_number_ok, social_security_number_ok,
--   identity_number_ok_in, needs_sha_number, employees_onboarding_rules, onboarding_missing_details).
--
-- Payslips (salary_history), shared with Uganda: employer_nssf (the employer's NSSF, never taken from pay),
-- taxable_pay (the pay PAYE was worked out on: Tanzania's taxable pay, Uganda's chargeable income) and tax_resident
-- (taxed as a resident). Tanzania's own: heslb_deduction (taken from pay, in total_deductions), and the employer's
-- sdl_levy and wcf_levy (never taken from pay).
--
-- Piece rate payouts during the month: a Tanzania worker's payout holds back the company's reserve only (no Kenyan
-- housing levy), and a Tanzania contractor's withholding tax is at Tanzania's rate (5% resident, 15% non-resident).
-- create_work_payout_batch does this for every country in 20261021100000_uganda_payroll.sql.

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
-- 2. employees: Tanzania's details (the TIN and NSSF number are in "Tax PIN" and "NSSF Number")
-- ---------------------------------------------------------------------------------------------
alter table public.employees add column if not exists heslb_borrower boolean not null default false;
alter table public.employees add column if not exists heslb_index_number text;
alter table public.employees add column if not exists secondary_employment boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- 3. payslips: Tanzania's figures, and the columns Tanzania and Uganda share
-- ---------------------------------------------------------------------------------------------
-- shared with Uganda (20261021100000 adds them too, if not there): the employer's NSSF, the pay PAYE was worked out on
-- (taxable pay; Uganda calls it chargeable income) and whether the employee was taxed as a resident
alter table public.salary_history add column if not exists employer_nssf numeric(14, 2) not null default 0;
alter table public.salary_history add column if not exists taxable_pay numeric(16, 2);
alter table public.salary_history add column if not exists tax_resident boolean;
-- Tanzania's own
alter table public.salary_history add column if not exists heslb_deduction numeric(14, 2) not null default 0;
alter table public.salary_history add column if not exists sdl_levy numeric(14, 2) not null default 0;
alter table public.salary_history add column if not exists wcf_levy numeric(14, 2) not null default 0;
alter table public.salary_history drop constraint if exists salary_history_tz_amounts;
alter table public.salary_history add constraint salary_history_tz_amounts
  check (heslb_deduction >= 0 and employer_nssf >= 0 and sdl_levy >= 0 and wcf_levy >= 0);
