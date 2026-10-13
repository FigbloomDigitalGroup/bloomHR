import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('jspdf', () => ({ default: vi.fn() }));
vi.mock('jspdf-autotable', () => ({}));

import { P9_COLUMNS, buildP9 } from './p9';
import { p10Figures } from './payrollExports';

const rates = {
  paye_bands: [{ upto: 24000, rate: 0.1 }, { upto: 32333, rate: 0.25 }, { upto: 500000, rate: 0.3 }, { upto: 800000, rate: 0.325 }, { upto: null, rate: 0.35 }],
  personal_relief: 2400, shif_deductible: 1, ahl_deductible: 1, insurance_relief_rate: 0.15, insurance_relief_cap: 5000,
  pension_deduction_cap: 30000, prmf_deduction_cap: 15000, mortgage_interest_cap: 30000,
};
const employee = { 'Employee Number': 'E9', 'Payroll Number': 'PR-00009', 'First Name': 'Ian', 'Last Name': 'Duncan', 'Tax PIN': 'A007044200W' };
// Ian Duncan, September 2026 (finance's PAYE return): 65,870.76 after the per diem, PAYE 10,119.05
const september = { pay_period: '2026-09', gross_pay: 98315.46, per_diem: 32444.7, nhif_deduction: 1811.45, nssf_deduction: 3952.25, housing_levy: 988.06, paye_tax: 10119.05, tax_relief: 2400 };
const october = { ...september, pay_period: '2026-10' };
const col = (name: (typeof P9_COLUMNS)[number]) => P9_COLUMNS.indexOf(name) - 1;

describe('buildP9', () => {
  const p9 = buildP9(2026, [october, september], employee, { '2026-09': rates, '2026-10': rates }, { name: 'Figbloom Ltd', pin: 'P051234567X' });

  it('has a row for every month, with each payslip in its month and zeros where there is none', () => {
    expect(p9.rows.map((r) => r.month)).toHaveLength(12);
    expect(p9.rows[8].values[col('Cash pay')]).toBeCloseTo(65870.76, 2);
    expect(p9.rows[9].values[col('PAYE')]).toBe(10119.05);
    expect(p9.rows[0].values.every((v) => v === 0)).toBe(true);
  });

  it('works out taxable pay and tax the way the P10 does', () => {
    const f = p10Figures(september, employee, rates);
    expect(p9.rows[8].values[col('Taxable pay')]).toBeCloseTo(f.taxablePay, 2);
    expect(p9.rows[8].values[col('Taxable pay')]).toBeCloseTo(59119, 2);
    expect(p9.rows[8].values[col('Tax charged')]).toBeCloseTo(12519.05, 1); // before the 2,400 relief
    expect(p9.rows[8].values[col('Personal relief')]).toBe(2400);
  });

  it('adds up the year', () => {
    expect(p9.totals[col('PAYE')]).toBeCloseTo(20238.1, 2);
    expect(p9.totals[col('Gross pay')]).toBeCloseTo(196630.92, 2);
  });

  it('names the employer and the employee', () => {
    expect(p9.employer).toEqual({ name: 'Figbloom Ltd', pin: 'P051234567X' });
    expect(p9.employee).toEqual({ name: 'Ian Duncan', pin: 'A007044200W', payrollNumber: 'PR-00009', employeeNumber: 'E9' });
  });
});

describe('saveEmployerPin', () => {
  it('refuses something that is not a KRA PIN', async () => {
    const { saveEmployerPin } = await import('./p9');
    await expect(saveEmployerPin('12345')).rejects.toThrow(/9 digits/);
  });
});
