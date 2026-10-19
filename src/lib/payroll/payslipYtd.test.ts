import { describe, expect, it } from 'vitest';
import { earlierTotals, payslipYtd, payslipYtdFromRows, taxYearOf, type YtdPayslip } from './payslipYtd';

// FIG-814: the year to date on a payslip, per country's tax year, from approved payslips only, never mixing currencies.

const slip = (pay_period: string, gross: number, extra: Partial<YtdPayslip> = {}): YtdPayslip => ({
  employee_id: 'E1', pay_period, country: 'Kenya', currency: 'KES', gross_pay: gross, taxable_pay: gross * 0.9, paye_tax: gross * 0.1,
  nssf_deduction: 100, net_pay: gross * 0.8, approved: true, ...extra,
});

describe('the tax year', () => {
  it('is January to December in Kenya and Tanzania', () => {
    expect(taxYearOf('Kenya', '2026-10')).toEqual({ start: '2026-01', end: '2026-12', label: '2026' });
    expect(taxYearOf('tanzania', '2026-01')).toEqual({ start: '2026-01', end: '2026-12', label: '2026' });
  });

  it('is July to June in Uganda', () => {
    expect(taxYearOf('Uganda', '2026-07')).toEqual({ start: '2026-07', end: '2027-06', label: '2026/27' });
    expect(taxYearOf('Uganda', '2026-06')).toEqual({ start: '2025-07', end: '2026-06', label: '2025/26' });
    expect(taxYearOf('Uganda', '2027-01')).toEqual({ start: '2026-07', end: '2027-06', label: '2026/27' });
  });
});

describe('the year to date', () => {
  it('adds this payslip to the approved payslips earlier in the tax year', () => {
    const rows = [slip('2025-12', 999), slip('2026-01', 1000), slip('2026-02', 2000), slip('2026-03', 4000, { approved: false }), slip('2026-05', 7)];
    const ytd = payslipYtdFromRows(slip('2026-04', 8000, { approved: false }), rows);
    expect(ytd).toMatchObject({ currency: 'KES', months: 3, gross_pay: 11000, taxable_pay: 9900, paye_tax: 1100, nssf_deduction: 300, net_pay: 8800, other_currencies: [] });
    expect(ytd.taxYear.label).toBe('2026');
  });

  it('January is the first month of a Kenyan year: nothing before it counts', () => {
    expect(payslipYtdFromRows(slip('2026-01', 1000), [slip('2025-12', 999)]).months).toBe(1);
  });

  it("Uganda's year starts in July", () => {
    const ug = (p: string, g: number) => slip(p, g, { country: 'Uganda', currency: 'UGX' });
    const rows = [ug('2026-06', 50), ug('2026-07', 100), ug('2026-08', 200)];
    expect(payslipYtdFromRows(ug('2026-09', 400), rows)).toMatchObject({ months: 3, gross_pay: 700, currency: 'UGX' });
    expect(payslipYtdFromRows(ug('2026-07', 100), rows)).toMatchObject({ months: 1, gross_pay: 100 });
    expect(payslipYtdFromRows(ug('2026-06', 50), [ug('2026-01', 10), ug('2025-07', 5), ug('2025-06', 1)]).gross_pay).toBe(65);
  });

  it('only the same employee and country', () => {
    const rows = [slip('2026-01', 1000, { employee_id: 'E2' }), slip('2026-02', 2000, { country: 'Tanzania', currency: 'TZS' })];
    expect(payslipYtdFromRows(slip('2026-03', 10), rows).months).toBe(1);
  });

  it('never mixes currencies: other currencies are named, not added', () => {
    const rows = [slip('2026-01', 1000), slip('2026-02', 20, { currency: 'USD' }), slip('2026-03', 30, { currency: 'USD' })];
    const usd = payslipYtdFromRows(slip('2026-04', 40, { currency: 'USD' }), rows);
    expect(usd).toMatchObject({ currency: 'USD', months: 3, gross_pay: 90, other_currencies: [{ currency: 'KES', months: 1 }] });
    const kes = payslipYtdFromRows(slip('2026-04', 500), rows);
    expect(kes).toMatchObject({ currency: 'KES', months: 2, gross_pay: 1500, other_currencies: [{ currency: 'USD', months: 2 }] });
  });

  it('months without taxable pay recorded are counted apart', () => {
    const ytd = payslipYtdFromRows(slip('2026-03', 100), [slip('2026-01', 100, { taxable_pay: null }), slip('2026-02', 100)]);
    expect(ytd).toMatchObject({ months: 3, taxable_pay: 180, taxable_missing: 1 });
    const none = payslipYtdFromRows(slip('2026-02', 100, { taxable_pay: null }), [slip('2026-01', 100, { taxable_pay: null })]);
    expect(none.taxable_pay).toBeNull();
  });

  it('takes the database function’s totals (numbers as text) the same way', () => {
    const earlier = [{ currency: 'KES', months: 2, gross_pay: '3000' as unknown as number, taxable_pay: 2700, taxable_months: 2, paye_tax: 300, nssf_deduction: 200, net_pay: 2400 }];
    expect(payslipYtd(slip('2026-04', 8000), earlier)).toMatchObject({ months: 3, gross_pay: 11000, net_pay: 8800 });
    expect(earlierTotals([slip('2026-01', 1000)], slip('2026-02', 1))).toEqual([
      { currency: 'KES', months: 1, gross_pay: 1000, taxable_pay: 900, taxable_months: 1, paye_tax: 100, nssf_deduction: 100, net_pay: 800 },
    ]);
  });
});
