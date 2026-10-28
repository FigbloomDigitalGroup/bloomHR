import type { RateVersion } from './rateVersions';

// The platform's default statutory_rates rows (tenant_id null) exactly as the migrations seed them, for the tests that
// pin each Finance Act year's rules on the dated rows (financeActYears.test.ts). supabase/tests/finance_bill_readiness
// checks this list against the database, so it can't drift from the migrations.

type Row = [country: string, code: string, value: number | null, bands: Record<string, unknown>[] | null, from: string, to: string | null];

const KENYA_BANDS_2023 = [
  { upto: 24000, rate: 0.1 },
  { upto: 32333, rate: 0.25 },
  { upto: 500000, rate: 0.3 },
  { upto: 800000, rate: 0.325 },
  { upto: null, rate: 0.35 },
];
const TANZANIA_BANDS = [
  { upto: 270000, rate: 0 },
  { upto: 520000, rate: 0.08 },
  { upto: 760000, rate: 0.2 },
  { upto: 1000000, rate: 0.25 },
  { upto: null, rate: 0.3 },
];
const UGANDA_BANDS_2012 = [
  { upto: 235000, rate: 0 },
  { upto: 335000, rate: 0.1 },
  { upto: 410000, rate: 0.2 },
  { upto: null, rate: 0.3 },
];
const UGANDA_BANDS_2026 = [
  { upto: 335000, rate: 0 },
  { upto: 410000, rate: 0.2 },
  { upto: 485000, rate: 0.25 },
  { upto: null, rate: 0.3 },
];
const UGANDA_NON_RESIDENT = [
  { upto: 335000, rate: 0.1 },
  { upto: 410000, rate: 0.2 },
  { upto: null, rate: 0.3 },
];
const UGANDA_LST = [
  { upto: 100000, amount: 0 },
  { upto: 200000, amount: 5000 },
  { upto: 300000, amount: 10000 },
  { upto: 400000, amount: 20000 },
  { upto: 500000, amount: 30000 },
  { upto: 600000, amount: 40000 },
  { upto: 700000, amount: 60000 },
  { upto: 800000, amount: 70000 },
  { upto: 900000, amount: 80000 },
  { upto: 1000000, amount: 90000 },
  { upto: null, amount: 100000 },
];

const ROWS: Row[] = [
  // Kenya (20261012100000_employee_onboarding, 20261014100000_piece_rate, 20261019000000_contributions_nita,
  // 20261021800000_finance_bill_readiness)
  ['Kenya', 'paye_bands', null, KENYA_BANDS_2023, '2023-07-01', null],
  ['Kenya', 'personal_relief', 2400, null, '2023-07-01', null],
  ['Kenya', 'insurance_relief_rate', 0.15, null, '2023-07-01', null],
  ['Kenya', 'insurance_relief_cap', 5000, null, '2023-07-01', null],
  ['Kenya', 'pension_deduction_cap', 30000, null, '2024-12-27', null],
  ['Kenya', 'prmf_deduction_cap', 15000, null, '2024-12-27', null],
  ['Kenya', 'mortgage_interest_cap', 30000, null, '2024-12-27', null],
  ['Kenya', 'non_cash_benefit_exempt_limit', 5000, null, '2024-12-27', null],
  ['Kenya', 'meals_exempt_limit', 5000, null, '2024-12-27', null],
  ['Kenya', 'pwd_exempt_income', 150000, null, '2023-07-01', null],
  ['Kenya', 'shif_deductible', 1, null, '2024-12-27', null],
  ['Kenya', 'ahl_deductible', 1, null, '2024-12-27', null],
  ['Kenya', 'shif_rate', 0.0275, null, '2024-10-01', null],
  ['Kenya', 'shif_minimum', 300, null, '2024-10-01', null],
  ['Kenya', 'ahl_rate', 0.015, null, '2024-03-19', null],
  ['Kenya', 'ahl_employer_rate', 0.015, null, '2024-03-19', null],
  ['Kenya', 'nssf_rate', 0.06, null, '2024-02-01', null],
  ['Kenya', 'nssf_employer_rate', 0.06, null, '2024-02-01', null],
  ['Kenya', 'nssf_lower_limit', 7000, null, '2024-02-01', '2025-01-31'],
  ['Kenya', 'nssf_upper_limit', 36000, null, '2024-02-01', '2025-01-31'],
  ['Kenya', 'nssf_lower_limit', 8000, null, '2025-02-01', '2026-01-31'],
  ['Kenya', 'nssf_upper_limit', 72000, null, '2025-02-01', '2026-01-31'],
  ['Kenya', 'nssf_lower_limit', 9000, null, '2026-02-01', null],
  ['Kenya', 'nssf_upper_limit', 108000, null, '2026-02-01', null],
  ['Kenya', 'wht_contractual', 0.03, null, '2023-07-01', null],
  ['Kenya', 'wht_professional', 0.05, null, '2023-07-01', null],
  ['Kenya', 'nita_levy', 50, null, '2012-01-01', null],
  ['Kenya', 'per_diem_rate', 0.33, null, '2000-01-01', '2026-09-30'],
  // per diem is typed in as a reimbursement from October 2026 (20261028100000_payroll_reimbursements)
  ['Kenya', 'per_diem_rate', 0, null, '2026-10-01', null],
  // Tanzania (20261021000000_tanzania_payroll)
  ['Tanzania', 'paye_bands', null, TANZANIA_BANDS, '2023-07-01', null],
  ['Tanzania', 'nonresident_paye_rate', 0.15, null, '2023-07-01', null],
  ['Tanzania', 'secondary_paye_rate', 0.3, null, '2023-07-01', null],
  ['Tanzania', 'nssf_rate', 0.1, null, '2023-07-01', null],
  ['Tanzania', 'nssf_employer_rate', 0.1, null, '2023-07-01', null],
  ['Tanzania', 'nssf_deductible', 1, null, '2023-07-01', null],
  ['Tanzania', 'sdl_rate', 0.035, null, '2023-07-01', null],
  ['Tanzania', 'sdl_min_employees', 10, null, '2023-07-01', null],
  ['Tanzania', 'wcf_rate', 0.005, null, '2023-07-01', null],
  ['Tanzania', 'heslb_rate', 0.15, null, '2023-07-01', null],
  ['Tanzania', 'wht_resident', 0.05, null, '2023-07-01', null],
  ['Tanzania', 'wht_nonresident', 0.15, null, '2023-07-01', null],
  // Uganda (20261021100000_uganda_payroll)
  ['Uganda', 'paye_bands', null, UGANDA_BANDS_2012, '2012-07-01', '2026-06-30'],
  ['Uganda', 'paye_bands', null, UGANDA_BANDS_2026, '2026-07-01', null],
  ['Uganda', 'paye_bands_non_resident', null, UGANDA_NON_RESIDENT, '2012-07-01', null],
  ['Uganda', 'paye_surcharge_threshold', 10000000, null, '2012-07-01', null],
  ['Uganda', 'paye_surcharge_rate', 0.1, null, '2012-07-01', null],
  ['Uganda', 'nssf_rate', 0.05, null, '1985-07-01', null],
  ['Uganda', 'nssf_employer_rate', 0.1, null, '1985-07-01', null],
  ['Uganda', 'nssf_deductible', 0, null, '1985-07-01', null],
  ['Uganda', 'lst_bands', null, UGANDA_LST, '2008-07-01', null],
  ['Uganda', 'lst_deductible', 1, null, '2008-07-01', null],
  ['Uganda', 'lst_first_month', 7, null, '2008-07-01', null],
  ['Uganda', 'lst_months', 4, null, '2008-07-01', null],
  ['Uganda', 'wht_contractual', 0.06, null, '2014-07-01', null],
  ['Uganda', 'wht_professional', 0.06, null, '2014-07-01', null],
];

/** Every platform default rate row, as the migrations leave statutory_rates. */
export const PLATFORM_RATE_ROWS: RateVersion[] = ROWS.map(([country, code, value, bands, from, to]) => ({
  tenant_id: null,
  country,
  code,
  value,
  bands,
  effective_from: from,
  effective_to: to,
}));
