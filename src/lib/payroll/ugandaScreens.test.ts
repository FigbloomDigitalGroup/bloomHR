import { describe, expect, it } from 'vitest';
import { baseContext } from './countries/kenyaFixtures';
import { UGANDA_RATES } from './countries/ugandaFixtures';
import { calculateUgandaPayslip, recalculateUgandaPayslip } from './countries/uganda';
import { countryPayslipLines, isKenyaPayslip } from './payslipLines';
import { UGANDA_REGISTER_COLUMNS, registerByCountry } from '../payrollPdf';
import { applyPayslipOverride, statutoryContextFor } from '../payslipOverrides';
import { ugandaRateSections } from '../../components/Payroll/PayrollRatesTab';
import type { RateRow } from '../statutoryRates';
import { fieldProblem, taxNumberLabel } from '../onboardingValidation';

// FIG-905 stage 4: Uganda on the payslip, the register, hand edits, the Rates tab and the onboarding formats.

const employee = { 'Employee Number': 'U1', 'First Name': 'Akello', 'Last Name': 'Grace', 'Basic Salary': 1500000, 'Tax PIN': '1000123456', 'NSSF Number': 'NS1234567' };
const slip = calculateUgandaPayslip(employee, { ...baseContext({ workByEmployee: undefined }), period: '2026-10', rates: UGANDA_RATES, lstPaidThisYear: new Map([['U1', 75000]]) });

describe('the payslip', () => {
  it('shows PAYE, NSSF and LST, with the employer NSSF as an employer cost', () => {
    expect(isKenyaPayslip(slip)).toBe(false);
    expect(isKenyaPayslip({})).toBe(true);
    expect(countryPayslipLines({ country: 'Kenya' })).toBeNull();
    expect(countryPayslipLines(slip)).toEqual({
      deductions: [{ label: 'PAYE', amount: 330750 }, { label: 'NSSF', amount: 75000 }, { label: 'Local service tax', amount: 25000 }],
      employerCosts: [{ label: 'NSSF (employer)', amount: 150000 }],
    });
  });
});

describe('the register', () => {
  it("gives Uganda its own columns and subtotal, apart from Kenya's", () => {
    const groups = registerByCountry([slip as never, { employee_id: 'K1', country: 'Kenya', currency: 'KES', basic_salary: 50000, gross_pay: 50000, net_pay: 40000, total_deductions: 10000 } as never]);
    expect(groups.map((g) => [g.country, g.currency])).toEqual([['Kenya', 'KES'], ['Uganda', 'UGX']]);
    const ug = groups[1];
    expect(ug.columns).toEqual(expect.arrayContaining(UGANDA_REGISTER_COLUMNS.filter((c) => c !== 'Basic' && c !== 'Gross pay')));
    const at = (col: string) => ug.lines[0].amounts[ug.columns.indexOf(col) - 3];
    expect([at('Basic pay'), at('PAYE'), at('NSSF'), at('LST'), at('Other deductions'), at('Gross pay'), at('Net pay'), at('NSSF (employer)')]).toEqual([
      1500000, 330750, 75000, 25000, 0, 1069250, 1069250, 150000,
    ]);
  });
});

describe('a hand edit on a Ugandan payslip', () => {
  it("works PAYE and NSSF out again on Uganda's rules (LST stays as worked out)", () => {
    const ctx = { ...statutoryContextFor(employee, UGANDA_RATES, false), recalculate: (p: Record<string, unknown>) => recalculateUgandaPayslip(p, UGANDA_RATES, employee) };
    const edited = applyPayslipOverride(slip, { fields: { basic_salary: 2000000 } }, ctx);
    // gross 2,000,000; chargeable 1,975,000: 33,750 + 30% x 1,490,000 = 480,750; NSSF 100,000
    expect(edited).toMatchObject({ gross_pay: 2000000, paye_tax: 480750, nssf_deduction: 100000, employer_nssf: 200000, lst_deduction: 25000, housing_levy: 0 });
    expect(edited.total_deductions).toBe(605750);
    expect(edited.net_pay).toBe(1394250);
  });
});

describe('the Rates tab', () => {
  const row = (code: string, value: number | null, bands: RateRow['bands'] = null): RateRow => ({
    id: code, tenant_id: null, code, value, bands, effective_from: '2026-07-01', effective_to: null, source: 'test', country: 'Uganda',
  });
  it('shows resident and non-resident PAYE, the extra 10%, NSSF and the LST bands', () => {
    const rows = Object.entries(UGANDA_RATES).map(([code, v]) => (Array.isArray(v) ? row(code, null, v as RateRow['bands']) : row(code, Number(v))));
    const sections = ugandaRateSections(rows);
    expect(sections.map((s) => s.title)).toEqual(['PAYE (resident)', 'PAYE (non-resident)', 'NSSF', 'Local service tax (LST)', 'Withholding tax (contractors)']);
    expect(sections[0].lines.map((l) => [l.label, l.value])).toEqual([
      ['Resident: Up to USh 335,000', '0%'],
      ['Resident: USh 335,001 to USh 410,000', '20%'],
      ['Resident: USh 410,001 to USh 485,000', '25%'],
      ['Resident: Above USh 485,000', '30%'],
      ['Extra PAYE on high incomes', '10% of income above USh 10,000,000 a month'],
    ]);
    const lst = sections[3].lines;
    expect(lst[0]).toMatchObject({ label: 'Monthly gross pay: Up to USh 100,000', value: 'USh 0 a year' });
    expect(lst[10]).toMatchObject({ label: 'Monthly gross pay: Above USh 1,000,000', value: 'USh 100,000 a year' });
    expect(lst.find((l) => l.label === 'Collected from')?.value).toBe('July');
  });
});

describe('onboarding formats in Uganda', () => {
  it('checks a TIN, an NSSF Uganda number and a NIN', () => {
    expect(taxNumberLabel('Uganda')).toBe('TIN');
    expect(taxNumberLabel(null)).toBe('KRA PIN');
    expect(fieldProblem('Tax PIN', '1000123456', {}, 'Uganda')).toBeNull();
    expect(fieldProblem('Tax PIN', 'A012345678Z', {}, 'Uganda')).toBe('TIN should be 10 digits');
    expect(fieldProblem('Tax PIN', '1000123456', {})).toBe('KRA PIN should look like A123456789B');
    expect(fieldProblem('NSSF Number', 'NS1234567', {}, 'Uganda')).toBeNull();
    expect(fieldProblem('ID Number', 'CM90012345ABCD', { 'Type of Identification': 'National ID' }, 'Uganda')).toBeNull();
    expect(fieldProblem('ID Number', '12345678', { 'Type of Identification': 'National ID' }, 'Uganda')).toBe('A NIN is 14 letters and digits');
  });
});
