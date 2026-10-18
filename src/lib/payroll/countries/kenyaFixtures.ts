import type { PayslipContext } from '../../payslipCalc';
import type { Rates } from '../../statutoryCalc';
import type { OvertimeMonth } from '../../overtimePay';
import { DEFAULT_OVERTIME_SETTINGS } from '../../overtimePay';
import type { PayslipOverride } from '../../payslipOverrides';
import type { WorkSettlementRow } from '../../workSettlement';

// A broad set of Kenya payslips for the regression test (kenyaEngine.test.ts): the numbers kenyaGolden.json holds were
// worked out by lib/payslipCalc BEFORE the calculation moved behind the country engine (FIG-905 stage 2), so any
// change to a single figure fails the test.

/** Kenya's default rates (20261012100000_employee_onboarding.sql and later), as statutory_rates_on() returns them. */
export const KENYA_RATES: Rates = {
  paye_bands: [
    { upto: 24000, rate: 0.1 },
    { upto: 32333, rate: 0.25 },
    { upto: 500000, rate: 0.3 },
    { upto: 800000, rate: 0.325 },
    { upto: null, rate: 0.35 },
  ],
  personal_relief: 2400,
  insurance_relief_rate: 0.15,
  insurance_relief_cap: 5000,
  pension_deduction_cap: 30000,
  prmf_deduction_cap: 15000,
  mortgage_interest_cap: 30000,
  non_cash_benefit_exempt_limit: 5000,
  meals_exempt_limit: 5000,
  pwd_exempt_income: 150000,
  shif_deductible: 1,
  ahl_deductible: 1,
  shif_rate: 0.0275,
  shif_minimum: 300,
  ahl_rate: 0.015,
  ahl_employer_rate: 0.015,
  nssf_rate: 0.06,
  nssf_employer_rate: 0.06,
  nssf_lower_limit: 9000,
  nssf_upper_limit: 108000,
  nita_levy: 50,
  wht_contractual: 0.03,
  wht_professional: 0.05,
};

const PERIOD = '2026-10';

/* eslint-disable @typescript-eslint/no-explicit-any -- employee rows are the untyped rows the payroll page uses */
const person = (number: string, extra: Record<string, any> = {}): Record<string, any> => ({
  id: `id-${number}`,
  'Employee Number': number,
  'First Name': `First${number}`,
  'Last Name': `Last${number}`,
  'Job Title': 'Officer',
  Department: 'Operations',
  'Basic Salary': 60000,
  'Tax PIN': 'A012345678Z',
  'NSSF Number': '123456789',
  'SHIF Number': 'CR1234567890123-4',
  'ID Number': '12345678',
  'Mobile Number': '0712345678',
  payment_method: 'bank',
  Bank: 'Equity Bank',
  'Account Number': '0123456789',
  ...extra,
});

const overtimeMonth: OvertimeMonth = {
  settings: { ...DEFAULT_OVERTIME_SETTINGS },
  rows: new Map([
    [
      'KE-003',
      {
        employee_number: 'KE-003',
        normal_hours: 6,
        rest_hours: 4,
        holiday_hours: 2,
        over_cap_hours: 0,
        entries: [
          { id: 'o1', work_date: '2026-10-03', day_type: 'normal', hours: 6, paid_hours: 6 },
          { id: 'o2', work_date: '2026-10-04', day_type: 'rest', hours: 4, paid_hours: 4 },
          { id: 'o3', work_date: '2026-10-20', day_type: 'holiday', hours: 2, paid_hours: 2 },
        ],
      },
    ],
  ]),
};

const work = (row: Partial<WorkSettlementRow> & { employee_number: string }): WorkSettlementRow => ({
  work_gross: 0, jobs_gross: 0, paid_out_gross: 0, work_lines: [], job_count: 0, payouts: 0,
  paid: 0, ahl: 0, reserve: 0, wht: 0, rounding: 0, arrears: 0, ...row,
});

/** The month's context every fixture shares (each fixture can change parts of it). */
export function baseContext(over: Partial<PayslipContext> = {}): PayslipContext {
  return {
    period: PERIOD,
    rates: KENYA_RATES,
    overrideStatutoryChecks: false,
    voluntaryByEmployee: new Map([
      ['KE-008', [{ name: 'SACCO', amount: 3000 }, { name: 'Welfare', amount: 500 }]],
    ]),
    payrollLoans: [
      {
        id: 'loan-1',
        employee_number: 'KE-008',
        product_name: 'Emergency loan',
        status: 'repaying',
        schedule: [
          { instalment_no: 1, period: '2026-09', payment: 5000, principal: 4800, interest: 200, balance: 4800 },
          { instalment_no: 2, period: '2026-10', payment: 5000, principal: 4800, interest: 200, balance: 0 },
        ],
        repayments: [{ pay_period: '2026-09', amount: 5000 }],
      },
    ],
    earningsByEmployee: new Map([
      [
        'KE-007',
        [
          { name: 'Sales commission', amount: 12000, taxable: true, pensionable: false },
          { name: 'Performance bonus', amount: 8000, taxable: true, pensionable: true },
          { name: 'Meal allowance (not taxed)', amount: 2500, taxable: false, pensionable: false },
        ],
      ],
    ]),
    leaveByEmployee: new Map([
      [
        'KE-005',
        {
          employee_number: 'KE-005',
          unpaid_days: 2,
          half_pay_days: 2,
          month_working_days: 22,
          applications: [
            { id: 'l1', leave_type: 'Unpaid Leave', start_date: '2026-10-05', end_date: '2026-10-06', days_in_month: 2, unpaid_days: 2, half_pay_days: 0 },
            { id: 'l2', leave_type: 'Sick Leave', start_date: '2026-10-12', end_date: '2026-10-13', days_in_month: 2, unpaid_days: 0, half_pay_days: 2 },
          ],
        },
      ],
    ]),
    leaveBasis: 'working_days',
    absenceByEmployee: new Map([
      ['KE-005', { employee_number: 'KE-005', absence_days: 1, month_working_days: 22, absences: [{ id: 'a1', start_date: '2026-10-19', end_date: '2026-10-19', days_in_month: 1 }] }],
    ]),
    leavePayouts: new Map([
      ['KE-006', [{ id: 'p1', employee_number: 'KE-006', leave_type: 'Annual Leave', days: 5, year: 2025, pay_period: PERIOD, month_working_days: 22 }]],
    ]),
    overtimeMonth,
    advanceFor: (employeeNumber: string) => (employeeNumber === 'KE-008' ? 7000 : 0),
    workByEmployee: new Map([
      ['KE-009', work({ employee_number: 'KE-009', work_gross: 42000, paid_out_gross: 30000, paid: 24500, ahl: 450, reserve: 3000, wht: 0, rounding: 0.5, arrears: 1200, payouts: 3, work_lines: [{ name: 'Crates', unit: 'crate', quantity: 600, amount: 42000 }] })],
      ['KE-010', work({ employee_number: 'KE-010', worker_kind: 'contractor', wht_category: 'professional', jobs_gross: 90000, paid_out_gross: 50000, paid: 45000, wht: 2500, reserve: 2500, job_count: 3, payouts: 1 })],
      ['KE-015', work({ employee_number: 'KE-015', work_gross: 9000, paid: 2000, arrears: 15000, payouts: 1 })],
    ]),
    deductionCap: true,
    ...over,
  };
}

export interface KenyaFixture {
  name: string;
  employee: Record<string, any>;
  ctx?: Partial<PayslipContext>;
  /** a hand edit applied on top (FIG-883) */
  override?: PayslipOverride;
}

export const KENYA_FIXTURES: KenyaFixture[] = [
  { name: 'salaried with allowances', employee: person('KE-001', { 'Basic Salary': 80000, house_allowance: 10000, travel_allowance: 5000, medical_allowance: 2000 }) },
  { name: 'salaried with no KRA PIN, NSSF or SHA number', employee: person('KE-002', { 'Tax PIN': '', 'NSSF Number': '', 'SHIF Number': '' }) },
  { name: 'missing details with statutory override on', employee: person('KE-002', { 'Tax PIN': '', 'NSSF Number': '', 'SHIF Number': '' }), ctx: { overrideStatutoryChecks: true } },
  { name: 'approved overtime entries', employee: person('KE-003', { 'Basic Salary': 45000 }) },
  { name: 'old overtime fields on the record', employee: person('KE-004', { overtime: 10, 'Overtime Rate': 350 }), ctx: { overtimeMonth: undefined } },
  { name: 'unpaid, half-pay leave and absence', employee: person('KE-005', { 'Basic Salary': 66000 }) },
  { name: 'unpaid leave on basic / 30', employee: person('KE-005', { 'Basic Salary': 66000 }), ctx: { leaveBasis: 'basic_30' } },
  { name: 'leave paid out', employee: person('KE-006', { 'Basic Salary': 55000 }) },
  { name: 'commission, bonus and an untaxed earning', employee: person('KE-007', { 'Basic Salary': 70000 }) },
  { name: 'voluntary deductions, a loan and an advance', employee: person('KE-008', { 'Basic Salary': 50000, other_pension_contribution: 4000, post_retirement_medical_fund: 1500 }) },
  { name: 'piece rate worker settled at month end', employee: person('KE-009', { 'Basic Salary': 0, pay_basis: 'work', worker_kind: 'employee' }) },
  { name: 'contractor paid per job with WHT', employee: person('KE-010', { 'Basic Salary': 0, worker_kind: 'contractor', wht_category: 'professional' }) },
  { name: 'contractor on a salary with WHT', employee: person('KE-011', { 'Basic Salary': 120000, worker_kind: 'contractor', wht_category: 'contractual' }) },
  { name: 'PWD with benefits, pension, insurance and mortgage', employee: person('KE-012', { 'Basic Salary': 250000, is_pwd: true, car_benefit: 15000, meals_benefit: 8000, non_cash_benefit: 6000, housing_benefit: 20000, other_pension_contribution: 40000, insurance_premium: 6000, mortgage_interest: 35000 }) },
  { name: 'high earner on the top band', employee: person('KE-013', { 'Basic Salary': 950000, house_allowance: 50000 }) },
  { name: 'low earner on the SHIF minimum', employee: person('KE-014', { 'Basic Salary': 8000 }) },
  { name: 'arrears over the two-thirds cap', employee: person('KE-015', { 'Basic Salary': 0, pay_basis: 'work' }) },
  { name: 'arrears with the cap off', employee: person('KE-015', { 'Basic Salary': 0, pay_basis: 'work' }), ctx: { deductionCap: false } },
  { name: 'NITA not charged on a casual record', employee: person('KE-016', { worker_kind: 'casual' }) },
  { name: 'Branch and office text', employee: person('KE-017', { Office: 'Mombasa', 'Middle Name': 'Wanjiru', 'Job Group': 'G4' }) },
  {
    name: 'payslip edited by hand',
    employee: person('KE-018', { 'Basic Salary': 75000, house_allowance: 8000 }),
    override: {
      fields: { basic_salary: 78000, transport_allowance: 3000 },
      one_off_earnings: [{ label: 'Acting allowance', amount: 6000, taxable: true }, { label: 'Refund', amount: 1500, taxable: false }],
      one_off_deductions: [{ label: 'Lost badge', amount: 800 }],
      note: 'Acting manager in October',
    },
  },
];
/* eslint-enable @typescript-eslint/no-explicit-any */
