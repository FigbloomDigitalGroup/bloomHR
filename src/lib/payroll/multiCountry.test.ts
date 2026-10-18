import { describe, expect, it } from 'vitest';
import type { Branch } from '../branches';
import { KENYA_RATES, baseContext } from './countries/kenyaFixtures';
import {
  approvalSummary,
  calculateRun,
  countriesToApprove,
  countryReadiness,
  currencyMismatch,
  filesByCountry,
  groupByCountry,
  payrollCountryOf,
  paymentFilesFor,
  savableRecords,
  totalsByCurrency,
} from './multiCountry';
import { currencyOf, money, moneyRounded, moneyShort } from './currency';

const branch = (id: string, country: string, currency: string, is_default = false): Branch =>
  ({ id, name: id, country, currency, city: null, address: null, active: true, is_default });
const branches = [branch('Nairobi', 'Kenya', 'KES', true), branch('Dar', 'Tanzania', 'TZS'), branch('Kigali', 'Rwanda', 'RWF')];

const emp = (n: string, branch_id: string | null, extra: Record<string, unknown> = {}) => ({
  'Employee Number': n, 'First Name': `F${n}`, 'Last Name': `L${n}`, branch_id, 'Basic Salary': 60000,
  'Tax PIN': 'A012345678Z', 'NSSF Number': '1', 'SHIF Number': '2', payment_method: 'cash', ...extra,
});
const staff = [emp('K1', 'Nairobi'), emp('K2', null), emp('T1', 'Dar'), emp('T2', 'Dar'), emp('R1', 'Kigali')];
const rates = new Map([['Kenya', KENYA_RATES]]);
const ctxFor = (country: string) => (rates.get(country) ? { ...baseContext({ workByEmployee: undefined }), rates: rates.get(country)! } : null);

describe('countries from branches', () => {
  it("is the branch's country and currency, the default branch's for someone with none, Kenya with no branches", () => {
    expect(payrollCountryOf(emp('T1', 'Dar'), branches)).toMatchObject({ country: 'Tanzania', currency: 'TZS' });
    expect(payrollCountryOf(emp('K2', null), branches)).toMatchObject({ country: 'Kenya', currency: 'KES' });
    expect(payrollCountryOf(emp('X', null), [])).toMatchObject({ country: 'Kenya', currency: 'KES' });
  });

  it('groups staff by country, Kenya first, with each engine (none for Tanzania and Rwanda yet)', () => {
    const g = groupByCountry(staff, branches);
    expect(g.map((x) => [x.country, x.employees.length, !!x.engine])).toEqual([['Kenya', 2, true], ['Rwanda', 1, false], ['Tanzania', 2, false]]);
  });
});

describe('one run for every country', () => {
  it('works everyone out with their own engine; staff without one are worked out by nobody', () => {
    const { records, notCalculated } = calculateRun(staff, branches, ctxFor);
    expect(records.map((r) => [r.employee_id, r.country, r.currency])).toEqual([['K1', 'Kenya', 'KES'], ['K2', 'Kenya', 'KES']]);
    expect(notCalculated.map((n) => [n.country, n.waiting, n.reason, n.employees.length])).toEqual([
      ['Rwanda', true, 'Waiting for Rwanda payroll rules', 1],
      ['Tanzania', true, 'Waiting for Tanzania payroll rules', 2],
    ]);
  });

  it('holds back a country with no rates for the month, or a branch paying in another currency', () => {
    const noRates = calculateRun(staff.slice(0, 2), branches, () => ({ ...baseContext(), rates: {} }));
    expect(noRates.records).toEqual([]);
    expect(noRates.notCalculated[0].reason).toMatch(/Kenya has no statutory rates for this month: paye_bands/);
    const usd = calculateRun([emp('K9', 'Mombasa')], [...branches, branch('Mombasa', 'Kenya', 'USD')], ctxFor);
    expect(usd.records).toEqual([]);
    expect(usd.notCalculated[0].reason).toBe("Mombasa pays in USD, but Kenya payroll is worked out in KES. Change the branch's currency to KES.");
  });
});

describe('totals per currency', () => {
  it('adds up each currency on its own, KES first, never across currencies', () => {
    const t = totalsByCurrency([
      { currency: 'TZS', gross_pay: 1000000, total_deductions: 100000, net_pay: 900000 },
      { country: 'Kenya', gross_pay: 50000, total_deductions: 10000, net_pay: 40000 },
      { currency: 'KES', gross_pay: 30000.1, total_deductions: 5000, net_pay: 25000.1 },
    ]);
    expect(t).toEqual([
      { currency: 'KES', count: 2, gross: 80000.1, deductions: 15000, net: 65000.1 },
      { currency: 'TZS', count: 1, gross: 1000000, deductions: 100000, net: 900000 },
    ]);
  });

  it('formats each currency', () => {
    expect(money(1234.5, 'KES')).toBe('KSh 1,234.5');
    expect(moneyRounded(1234.5, 'TZS')).toBe('TSh 1,235');
    expect(moneyRounded(10, 'UGX')).toBe('USh 10');
    expect(moneyShort(3100000, 'KES')).toBe('KSh 3.1M');
    expect(currencyOf({})).toBe('KES');
    expect(currencyOf({ currency: 'ugx' })).toBe('UGX');
  });
});

describe('readiness and approval per country', () => {
  const { records } = calculateRun(staff, branches, ctxFor);

  it('before approval: Kenya ready, Tanzania and Rwanda waiting; one Approve approves the ready ones', () => {
    const r = countryReadiness({ employees: staff, branches, payslips: records, runCountries: [{ country: 'Kenya', status: 'draft' }], runStarted: true, ratesByCountry: rates });
    expect(r.map((x) => [x.country, x.state])).toEqual([['Kenya', 'ready'], ['Rwanda', 'waiting'], ['Tanzania', 'waiting']]);
    expect(countriesToApprove(r)).toEqual(['Kenya']);
    expect(approvalSummary(r)).toMatch(/^Kenya 2 payslips KSh \d+K ✓ · Rwanda 1 waiting for rules · Tanzania 2 waiting for rules$/);
    expect(r[2].waitingNames).toEqual(['FT1 LT1', 'FT2 LT2']);
  });

  it('warns (without blocking) about missing details and pay below the minimum wage', () => {
    const missing = [emp('K1', 'Nairobi', { 'Tax PIN': '', payment_method: 'bank' })];
    const r = countryReadiness({
      employees: missing, branches, payslips: calculateRun(missing, branches, ctxFor).records, runCountries: [], runStarted: true,
      ratesByCountry: rates, belowMinimum: new Map([['Kenya', 1]]),
    });
    expect(r[0].state).toBe('ready');
    expect(r[0].warnings).toEqual(['1 person is missing a tax number, statutory number or payment details', '1 person is paid below the minimum wage']);
    expect(r[0].problems.map((p) => p.problem)).toContain('KRA PIN');
  });

  it('blocks a country with no rates, a payslip of someone who moved country, or one in the wrong currency', () => {
    const noRates = countryReadiness({ employees: staff.slice(0, 1), branches, payslips: [], runCountries: [], runStarted: true, ratesByCountry: new Map([['Kenya', {}]]) });
    expect(noRates[0].state).toBe('blocked');
    expect(noRates[0].blocking[0]).toMatch(/no statutory rates/);
    // K1 was worked out in Kenya, then moved to Dar es Salaam: recalculate
    const moved = countryReadiness({
      employees: [emp('K1', 'Dar'), emp('K2', null)], branches, payslips: records, runCountries: [{ country: 'Kenya', status: 'draft' }], runStarted: true, ratesByCountry: rates,
    });
    expect(moved[0].state).toBe('blocked');
    expect(moved[0].blocking).toContain('1 person has moved to a branch in another country since this was worked out: press Recalculate');
    const wrong = countryReadiness({
      employees: staff.slice(0, 2), branches, payslips: [{ ...records[0], currency: 'USD' }, records[1]], runCountries: [], runStarted: true, ratesByCountry: rates,
    });
    expect(wrong[0].blocking).toContain('1 payslip is not in KES: press Recalculate');
    // started but a country's staff not worked out
    const notYet = countryReadiness({ employees: staff.slice(0, 2), branches, payslips: [], runCountries: [], runStarted: true, ratesByCountry: rates });
    expect(notYet[0].blocking).toEqual(['Not worked out yet: press Recalculate']);
  });

  it('an approved country is locked and says who joined after approval', () => {
    const r = countryReadiness({
      employees: [...staff.slice(0, 2), emp('K3', 'Nairobi')], branches, payslips: records, runCountries: [{ country: 'Kenya', status: 'approved', approved_at: '2026-10-31' }], runStarted: true, ratesByCountry: rates,
    });
    expect(r[0].state).toBe('approved');
    expect(r[0].approvedAt).toBe('2026-10-31');
    expect(r[0].warnings[0]).toMatch(/^1 person is not on the approved payslips/);
    expect(countriesToApprove(r)).toEqual([]);
  });
});

describe('files per country', () => {
  const employees = [
    { 'Employee Number': 'K1', 'First Name': 'Amina', 'Last Name': 'W', 'Tax PIN': 'A012345678Z', payment_method: 'Bank Transfer', Bank: 'KCB', 'Account Number': '1100', account_number_name: 'Amina W' },
    { 'Employee Number': 'T1', 'First Name': 'Baraka', 'Last Name': 'M', payment_method: 'Bank Transfer', Bank: 'CRDB', 'Account Number': '2200', account_number_name: 'Baraka M' },
  ];
  const payslips = [
    { employee_id: 'K1', country: 'Kenya', currency: 'KES', gross_pay: 50000, net_pay: 40000, paye_tax: 5000, nhif_deduction: 1375, nssf_deduction: 3000, housing_levy: 750, nita_levy: 50 },
    { employee_id: 'T1', country: 'Tanzania', currency: 'TZS', gross_pay: 1000000, net_pay: 800000 },
  ];

  it("puts the P10 and Kenya's returns under Kenya, with Kenya's staff only; payment files per currency", () => {
    const files = filesByCountry({
      payslips, employees, runCountries: [{ country: 'Tanzania', status: 'approved' }, { country: 'Kenya', status: 'approved' }],
      ratesByCountry: rates, payPeriod: '2026-10', debitAccount: '0123456789',
    });
    expect(files.map((f) => [f.country, f.currency])).toEqual([['Kenya', 'KES'], ['Tanzania', 'TZS']]);
    const kenya = files[0];
    expect(kenya.returns.map((r) => r.key)).toEqual(['p10', 'sha', 'nssf', 'ahl', 'nita']); // no WHT: no contractors
    const p10 = kenya.returns.find((r) => r.key === 'p10')!;
    expect(p10.file.rows).toHaveLength(1);
    expect(p10.file.rows[0][1]).toBe('Amina W');
    expect(kenya.payments.map((p) => p.key)).toEqual(['mpesa', 'bank', 'equity']);
    expect(kenya.payments.find((p) => p.key === 'equity')!.file.rows[0][6]).toBe('KES');
    // Tanzania: no returns until its engine; a TZS bank file only
    expect(files[1].returns).toEqual([]);
    expect(files[1].payments.map((p) => [p.key, p.name, p.file.rows.length])).toEqual([['bank-tzs', 'bulk-pay-bank-tzs', 1]]);
    expect(files[1].payments[0].file.rows[0]).toContain('800000.00');
  });

  it('a draft country has no files yet', () => {
    const files = filesByCountry({ payslips, employees, runCountries: [{ country: 'Kenya', status: 'draft' }], ratesByCountry: rates, payPeriod: '2026-10', debitAccount: '' });
    expect(files).toEqual([]);
  });

  it('a payment file only takes its own currency', () => {
    expect(paymentFilesFor('KES', payslips, employees, '2026-10', '').find((p) => p.key === 'bank')!.file.rows).toHaveLength(1);
  });
});

describe('guards', () => {
  it('blocks a payslip in another currency than its country', () => {
    expect(currencyMismatch({ country: 'Kenya', currency: 'KES' })).toBeNull();
    expect(currencyMismatch({ country: 'Kenya', currency: 'TZS', employee_name: 'Amina' })).toBe('Amina: Kenya payslips are in KES, not TZS');
    expect(currencyMismatch({ country: 'Tanzania', currency: 'TZS' })).toBe("Tanzania payroll isn't supported yet");
  });

  it('never saves over an approved country', () => {
    const { save, lockedCountries } = savableRecords(
      [{ country: 'Kenya', employee_id: 'K1' }, { country: 'Uganda', employee_id: 'U1' }],
      [{ country: 'Kenya', status: 'approved' }, { country: 'Uganda', status: 'draft' }]
    );
    expect(save.map((r) => r.employee_id)).toEqual(['U1']);
    expect(lockedCountries).toEqual(['Kenya']);
  });
});
