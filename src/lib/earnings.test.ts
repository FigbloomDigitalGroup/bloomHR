import { describe, expect, it } from 'vitest';
import {
  earningsForPeriod,
  employeeEarnings,
  nonTaxableEarningsOf,
  parseEarningSheet,
  payslipEarningLines,
  pensionableAdjustmentOf,
  statutoryPayWith,
  summariseEarnings,
  type EarningItem,
  type EarningType,
  type EmployeeEarning,
} from './earnings';
import { statutoryFor } from './statutoryCalc';
import { cashPayOf, p10Figures, pensionablePayOf } from './payrollExports';
import { buildP9 } from './p9';

const type = (id: string, name: string, extra: Partial<EarningType> = {}): EarningType => ({
  id, name, taxable: true, pensionable: true, description: null, active: true, ...extra,
});
const TYPES = [
  type('bonus', 'Bonus'),
  type('comm', 'Commission'),
  type('grat', 'Gratuity', { pensionable: false }),
  type('meal', 'Meal refund', { taxable: false }),
  type('old', 'Old scheme', { active: false }),
];

let n = 0;
const earning = (employee_number: string, earning_type_id: string, amount: number, start_period: string, end_period: string | null = start_period): EmployeeEarning => ({
  id: `e${++n}`, employee_number, earning_type_id, amount, start_period, end_period, notes: null,
});

describe('earningsForPeriod', () => {
  const earnings = [
    earning('E1', 'comm', 4500, '2026-10'),
    earning('E1', 'bonus', 10000, '2026-10'),
    earning('E1', 'bonus', 2000, '2026-09'), // last month only
    earning('E2', 'bonus', 1000, '2026-08', null), // every month from August
    earning('E2', 'meal', 500, '2026-10', '2026-12'),
    earning('E3', 'old', 9999, '2026-10'), // paused type
  ];

  it("gives each employee the month's earnings, in the order of the type list", () => {
    const oct = earningsForPeriod(TYPES, earnings, '2026-10');
    expect(oct.get('E1')).toEqual([
      { name: 'Bonus', amount: 10000, taxable: true, pensionable: true },
      { name: 'Commission', amount: 4500, taxable: true, pensionable: true },
    ]);
    expect(oct.get('E2')?.map((i) => [i.name, i.amount])).toEqual([['Bonus', 1000], ['Meal refund', 500]]);
  });

  it('pays a one-off only in its month, a recurring one between its months, and nothing of a paused type', () => {
    expect(earningsForPeriod(TYPES, earnings, '2026-09').get('E1')).toEqual([{ name: 'Bonus', amount: 2000, taxable: true, pensionable: true }]);
    expect(earningsForPeriod(TYPES, earnings, '2027-01').get('E2')?.map((i) => i.name)).toEqual(['Bonus']);
    expect(earningsForPeriod(TYPES, earnings, '2026-07').has('E2')).toBe(false);
    expect(earningsForPeriod(TYPES, earnings, '2026-10').has('E3')).toBe(false);
  });

  it("works out one employee's month split into taxable / not taxable and commission / bonus", () => {
    const e1 = employeeEarnings(TYPES, earnings, 'E1', '2026-10');
    expect([e1.total, e1.taxable, e1.nonTaxable, e1.commission, e1.bonus]).toEqual([14500, 14500, 0, 4500, 10000]);
    const e2 = employeeEarnings(TYPES, earnings, 'E2', '2026-10');
    expect([e2.total, e2.taxable, e2.nonTaxable, e2.commission, e2.bonus]).toEqual([1500, 1000, 500, 0, 1500]);
    expect(employeeEarnings(TYPES, earnings, 'NOBODY', '2026-10').total).toBe(0);
  });
});

describe('summariseEarnings and statutoryPayWith', () => {
  const items: EarningItem[] = [
    { name: 'Bonus', amount: 10000, taxable: true, pensionable: true },
    { name: 'Gratuity', amount: 3000, taxable: true, pensionable: false },
    { name: 'Meal refund', amount: 500, taxable: false, pensionable: false },
  ];

  it('splits taxable / pensionable', () => {
    const s = summariseEarnings(items);
    expect([s.total, s.taxable, s.nonTaxable, s.pensionable, s.nonPensionable]).toEqual([13500, 13000, 500, 10000, 3500]);
  });

  it('every earning is cash pay for SHIF and AHL, taxable ones for PAYE, pensionable ones for NSSF', () => {
    expect(statutoryPayWith(50000, items)).toEqual({ cashPay: 63000, nonTaxableCashPay: 500, pensionablePay: 60000 });
    expect(statutoryPayWith(50000, [])).toEqual({ cashPay: 50000, nonTaxableCashPay: 0, pensionablePay: 50000 });
  });
});

// The rates seeded in statutory_rates for October 2026 (as in statutoryCalc.test)
const rates = {
  paye_bands: [{ upto: 24000, rate: 0.1 }, { upto: 32333, rate: 0.25 }, { upto: 500000, rate: 0.3 }, { upto: 800000, rate: 0.325 }, { upto: null, rate: 0.35 }],
  personal_relief: 2400, insurance_relief_rate: 0.15, insurance_relief_cap: 5000, pension_deduction_cap: 30000,
  prmf_deduction_cap: 15000, mortgage_interest_cap: 30000, non_cash_benefit_exempt_limit: 5000, meals_exempt_limit: 5000,
  pwd_exempt_income: 150000, shif_deductible: 1, ahl_deductible: 1, shif_rate: 0.0275, shif_minimum: 300, ahl_rate: 0.015,
  nssf_rate: 0.06, nssf_lower_limit: 9000, nssf_upper_limit: 108000,
};

describe('payroll with a KSh 10,000 taxable bonus', () => {
  // an employee on KSh 60,000 a month of cash pay (gross less per diem), as PayrollDashboard works it out
  const salaryCashPay = 60000;
  const bonus: EarningItem[] = [{ name: 'Bonus', amount: 10000, taxable: true, pensionable: true }];
  const before = statutoryFor({ ...statutoryPayWith(salaryCashPay, []) }, rates);
  const after = statutoryFor({ ...statutoryPayWith(salaryCashPay, bonus) }, rates);

  it('raises gross (cash) pay by the bonus', () => {
    expect(statutoryPayWith(salaryCashPay, bonus).cashPay - salaryCashPay).toBe(10000);
  });

  it('raises SHIF, AHL and NSSF on the bonus, and PAYE at the 30% band on what is left', () => {
    expect(after.shif - before.shif).toBeCloseTo(275, 2); // 2.75% of 10,000
    expect(after.ahl - before.ahl).toBeCloseTo(150, 2); // 1.5%
    expect(after.nssf - before.nssf).toBeCloseTo(600, 2); // 6%, under the upper limit
    // taxable pay rises by 10,000 less the deductible SHIF, AHL and NSSF on it: 10,000 - 275 - 150 - 600 = 8,975
    expect(after.taxablePay - before.taxablePay).toBeCloseTo(8975, 2);
    // all of it in the 30% band (taxable pay is above 32,333 either way)
    expect(after.paye - before.paye).toBeCloseTo(8975 * 0.3, 2);
    // the figures in full
    expect(before).toMatchObject({ shif: 1650, ahl: 900, nssf: 3600, taxablePay: 53850, paye: 8538.35 });
    expect(after).toMatchObject({ shif: 1925, ahl: 1050, nssf: 4200, taxablePay: 62825, paye: 11230.85 });
  });

  it('a bonus that is not taxed adds to SHIF and AHL but not PAYE', () => {
    const untaxed = statutoryFor(statutoryPayWith(salaryCashPay, [{ ...bonus[0], taxable: false, pensionable: false }]), rates);
    expect(untaxed.shif - before.shif).toBeCloseTo(275, 2);
    expect(untaxed.ahl - before.ahl).toBeCloseTo(150, 2);
    expect(untaxed.nssf).toBe(before.nssf);
    // taxable pay only falls by the deductible SHIF and AHL on it
    expect(untaxed.taxablePay - before.taxablePay).toBeCloseTo(-425, 2);
  });
});

describe('saved payslips', () => {
  const payslip = {
    gross_pay: 90000, per_diem: 20000, commission: 4500, bonus: 10500, nssf_deduction: 4200, nhif_deduction: 1925, housing_levy: 1050,
    paye_tax: 14000, pay_period: '2026-10',
    earning_items: [
      { name: 'Commission', amount: 4500, taxable: true, pensionable: true },
      { name: 'Bonus', amount: 10000, taxable: true, pensionable: true },
      { name: 'Meal refund', amount: 500, taxable: false, pensionable: false },
    ],
  };

  it('lists each earning by name', () => {
    expect(payslipEarningLines(payslip).map((l) => [l.name, l.amount])).toEqual([['Commission', 4500], ['Bonus', 10000], ['Meal refund', 500]]);
  });

  it('shows the commission and bonus of payslips saved before earnings were itemised', () => {
    expect(payslipEarningLines({ commission: 1000, bonus: '2500', earning_items: [] }).map((l) => [l.name, l.amount])).toEqual([
      ['Commission', 1000],
      ['Bonus', 2500],
    ]);
    expect(payslipEarningLines({ commission: 0, bonus: null })).toEqual([]);
  });

  it('the P10, NSSF return and P9 leave untaxed earnings out of cash pay', () => {
    expect(nonTaxableEarningsOf(payslip)).toBe(500);
    expect(cashPayOf(payslip)).toBe(69500); // 90,000 - 20,000 per diem - 500 not taxed
    expect(pensionableAdjustmentOf(payslip)).toBe(0);
    expect(pensionablePayOf(payslip)).toBe(69500);
    expect(p10Figures(payslip, {}, rates).cashPay).toBe(69500);
    const p9 = buildP9(2026, [payslip], {}, { '2026-10': rates }, { name: 'Co', pin: 'P0' });
    expect(p9.rows[9].values.slice(0, 3)).toEqual([90000, 20500, 69500]);
  });

  it('NSSF pay leaves out taxable earnings that are not pensionable', () => {
    const withGratuity = { gross_pay: 70000, per_diem: 0, earning_items: [{ name: 'Gratuity', amount: 20000, taxable: true, pensionable: false }] };
    expect(cashPayOf(withGratuity)).toBe(70000);
    expect(pensionablePayOf(withGratuity)).toBe(50000);
  });
});

describe('parseEarningSheet', () => {
  const employees = new Set(['E1', 'E2']);

  it('reads rows in any column order and case, amounts as typed in Excel, and an empty period as the month on screen', () => {
    const { valid, errors } = parseEarningSheet(
      [
        { 'employee number': 'E1', EARNING: 'Bonus', Amount: 'KSh 10,000', Period: 'Oct 2026' },
        { Period: '2026-11', Amount: 4500, Earning: 'Commission', 'Employee Number': ' E2 ' },
        { 'Employee Number': 'E2', Earning: 'Arrears', Amount: '1200.50', Period: '' },
        { 'Employee Number': '', Earning: '', Amount: '' }, // blank line
      ],
      employees,
      '2026-10'
    );
    expect(errors).toEqual([]);
    expect(valid).toEqual([
      { employee_number: 'E1', earning: 'Bonus', amount: 10000, period: '2026-10' },
      { employee_number: 'E2', earning: 'Commission', amount: 4500, period: '2026-11' },
      { employee_number: 'E2', earning: 'Arrears', amount: 1200.5, period: '2026-10' },
    ]);
  });

  it('says what is wrong with each bad row, numbered as in Excel', () => {
    const { valid, errors } = parseEarningSheet(
      [
        { 'Employee Number': 'X9', Earning: 'Bonus', Amount: 100, Period: '2026-10' },
        { 'Employee Number': 'E1', Earning: '', Amount: 'lots', Period: 'someday' },
        { 'Employee Number': 'E1', Earning: 'Bonus', Amount: 0, Period: '2026-10' },
      ],
      employees,
      '2026-10'
    );
    expect(valid).toEqual([]);
    expect(errors).toEqual([
      'Row 2: no employee with number X9',
      'Row 3: no earning name, amount should be a number above 0, "Period" should be a month like 2026-10',
      'Row 4: amount should be a number above 0',
    ]);
  });
});
