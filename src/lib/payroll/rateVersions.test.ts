import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabase: {} }));

import { calculatePayslip } from '../payslipCalc';
import { groupAnnouncements } from '../platformRates';
import { KENYA_RATES, baseContext } from './countries/kenyaFixtures';
import { RATES_CHANGED, calculateRun, countryReadiness } from './multiCountry';
import { PLATFORM_RATE_ROWS } from './platformRateRows';
import {
  type RateChange, type RateVersion, lineAmount, periodEnd, previewChange, previewFigures, previewLabels, rateChangeProblems, ratesOn, withVersion,
} from './rateVersions';

const change = (over: Partial<RateChange>): RateChange => ({
  country: 'Kenya', code: 'ahl_rate', value: 0.02, bands: null, from: '2027-07-01', source: 'Finance Act 2027', ...over,
});
const platform = (code: string, value: number, from: string, to: string | null = null): RateVersion => ({
  tenant_id: null, country: 'Kenya', code, value, bands: null, effective_from: from, effective_to: to,
});

describe('dated versions', () => {
  it('a new version ends the one in force the day before; months before keep theirs', () => {
    const rows = withVersion(PLATFORM_RATE_ROWS, change({}));
    expect(ratesOn(rows, '2027-06-30', 'Kenya').ahl_rate).toBe(0.015);
    expect(ratesOn(rows, '2027-07-31', 'Kenya').ahl_rate).toBe(0.02);
    expect(rows.filter((r) => r.code === 'ahl_rate').map((r) => [r.effective_from, r.effective_to])).toEqual([
      ['2024-03-19', '2027-06-30'],
      ['2027-07-01', null],
    ]);
  });

  it('a version before a later one ends the day before it; one on the same day replaces it', () => {
    const rows = [platform('x_rate', 0.1, '2020-01-01', '2026-12-31'), platform('x_rate', 0.2, '2027-01-01')];
    const between = withVersion(rows, change({ code: 'x_rate', value: 0.15, from: '2026-07-01' }));
    expect(between.map((r) => [r.effective_from, r.effective_to, r.value])).toEqual([
      ['2020-01-01', '2026-06-30', 0.1],
      ['2027-01-01', null, 0.2],
      ['2026-07-01', '2026-12-31', 0.15],
    ]);
    const same = withVersion(between, change({ code: 'x_rate', value: 0.16, from: '2026-07-01' }));
    expect(same).toHaveLength(3);
    expect(ratesOn(same, '2026-08-31', 'Kenya').x_rate).toBe(0.16);
  });

  it("never touches a company's own rows or another country's", () => {
    const own: RateVersion = { ...platform('ahl_rate', 0.01, '2025-01-01'), tenant_id: 'co' };
    const rows = withVersion([...PLATFORM_RATE_ROWS, own], change({}));
    expect(rows.find((r) => r.tenant_id === 'co')).toEqual(own);
    expect(ratesOn(rows, '2027-07-31', 'Kenya', 'co').ahl_rate).toBe(0.01);
    expect(withVersion(PLATFORM_RATE_ROWS, change({ country: 'Uganda', code: 'nssf_rate', value: 0.06 })).filter((r) => r.country === 'Kenya')).toEqual(
      PLATFORM_RATE_ROWS.filter((r) => r.country === 'Kenya')
    );
  });

  it('periodEnd is the last day of the month', () => {
    expect([periodEnd('2026-02'), periodEnd('2028-02'), periodEnd('2026-12')]).toEqual(['2026-02-28', '2028-02-29', '2026-12-31']);
  });
});

describe('validation', () => {
  it('accepts a good rate or band set', () => {
    expect(rateChangeProblems(change({}))).toEqual([]);
    expect(rateChangeProblems(change({ code: 'paye_bands', value: null, bands: [{ upto: 24000, rate: 0.1 }, { upto: null, rate: 0.3 }] }))).toEqual([]);
    expect(rateChangeProblems(change({ code: 'lst_bands', country: 'Uganda', value: null, bands: [{ upto: 100000, amount: 0 }, { upto: null, amount: 100000 }] }))).toEqual([]);
  });

  it('rates between 0 and 1, amounts not below 0, flags 0 or 1', () => {
    expect(rateChangeProblems(change({ value: 1.5 }))).toEqual(['A rate is a share between 0 and 1 (e.g. 0.015 for 1.5%)']);
    expect(rateChangeProblems(change({ code: 'wht_professional', value: 5 }))[0]).toMatch(/between 0 and 1/);
    expect(rateChangeProblems(change({ code: 'personal_relief', value: -1 }))).toEqual(["The value can't be below 0"]);
    expect(rateChangeProblems(change({ code: 'personal_relief', value: 2600 }))).toEqual([]);
    expect(rateChangeProblems(change({ code: 'shif_deductible', value: 2 }))).toEqual(['Deductible is 1 (yes) or 0 (no)']);
    expect(rateChangeProblems(change({ value: NaN }))).toEqual(['Enter a number']);
  });

  it('bands go up, the last open-ended, each with a rate between 0 and 1 or an amount', () => {
    const bands = (b: RateChange['bands']) => rateChangeProblems(change({ code: 'paye_bands', value: null, bands: b }));
    expect(bands([{ upto: 30000, rate: 0.1 }, { upto: 24000, rate: 0.2 }, { upto: null, rate: 0.3 }])).toEqual(['Band 2: each band\'s "up to" must be above the one before']);
    expect(bands([{ upto: 24000, rate: 0.1 }, { upto: 50000, rate: 0.3 }])).toEqual(['The last band is for everything above: leave its "up to" empty']);
    expect(bands([{ upto: 24000, rate: 1.1 }, { upto: null, rate: 0.3 }])).toEqual(['Band 1: a rate is a share between 0 and 1']);
    expect(bands([{ upto: null }])).toEqual(['Band 1: give a rate or an amount']);
    expect(bands([])).toEqual(['Add at least one band']);
  });

  it('needs a code, a date and a source', () => {
    expect(rateChangeProblems(change({ code: 'Bad Code', from: '', source: ' ' }))).toEqual([
      'Choose a rate code (lower case letters, digits and _)',
      'Choose the date the rate starts',
      'Say where the rate comes from (the Act or notice)',
    ]);
  });

  it('a date inside an approved month needs confirming', () => {
    expect(rateChangeProblems(change({ from: '2026-07-01' }), { latestApproved: '2026-09' })[0]).toMatch(/Payroll for 2026-09 is already approved.*confirm/);
    expect(rateChangeProblems(change({ from: '2026-09-30' }), { latestApproved: '2026-09' })).toHaveLength(1);
    expect(rateChangeProblems(change({ from: '2026-07-01' }), { latestApproved: '2026-09', confirmBackdate: true })).toEqual([]);
    expect(rateChangeProblems(change({ from: '2026-10-01' }), { latestApproved: '2026-09' })).toEqual([]);
  });
});

describe('the preview', () => {
  it('shows old vs new net pay, PAYE and each deduction for sample salaries, by the country engine', () => {
    const rows = PLATFORM_RATE_ROWS;
    const c = change({ from: '2027-07-01' });
    const rowsAfter = withVersion(rows, c);
    const p = previewChange('Kenya', [30000, 100000, 500000], '2027-07', ratesOn(rows, '2027-07-31', 'Kenya'), ratesOn(rowsAfter, '2027-07-31', 'Kenya'));
    expect(p.map((r) => r.salary)).toEqual([30000, 100000, 500000]);
    expect(previewLabels(p)).toEqual(['PAYE', 'NSSF', 'SHIF', 'Housing levy']);
    const mid = p[1];
    // cash pay 100,000 (no per diem share since October 2026): the levy 1,500 -> 2,000, and PAYE a little lower as the
    // levy is deductible
    expect(lineAmount(mid.before.deductions, 'Housing levy')).toBe(1500);
    expect(lineAmount(mid.after.deductions, 'Housing levy')).toBe(2000);
    expect(mid.after.tax).toBeLessThan(mid.before.tax);
    expect(mid.after.net).toBeCloseTo(mid.before.net - 500 + (mid.before.tax - mid.after.tax), 2);
    expect(lineAmount(mid.after.employerCosts, 'Housing levy (employer)')).toBe(1500);
  });

  it('leaves out salaries that are not amounts, and countries without an engine', () => {
    expect(previewChange('Kenya', [0, NaN, -5], '2026-10', KENYA_RATES, KENYA_RATES)).toEqual([]);
    expect(previewChange('Rwanda', [100000], '2026-10', {}, {})).toEqual([]);
  });

  it('works out Tanzania and Uganda with their own engines', () => {
    const tz = previewFigures('Tanzania', 1500000, '2026-10', ratesOn(PLATFORM_RATE_ROWS, '2026-10-31', 'Tanzania'));
    expect(tz?.deductions.map((l) => l.label)).toContain('NSSF');
    const ug = previewFigures('Uganda', 2000000, '2026-10', ratesOn(PLATFORM_RATE_ROWS, '2026-10-31', 'Uganda'));
    expect(ug?.deductions.map((l) => l.label)).toEqual(['PAYE', 'NSSF', 'Local service tax']);
  });
});

describe('the per diem share (per_diem_rate)', () => {
  const employee = { 'Employee Number': 'KE-001', 'Basic Salary': 60000, 'Tax PIN': 'A1', 'NSSF Number': '1', 'SHIF Number': '2' };

  it('at the default 33% gives the figures payroll always gave', () => {
    const slip = calculatePayslip(employee, baseContext());
    expect(slip.per_diem).toBeCloseTo(19800, 2);
    // the same as before the rate existed: 33% of basic
    expect(calculatePayslip(employee, baseContext({ rates: { ...KENYA_RATES, per_diem_rate: 0.33 } }))).toEqual(slip);
  });

  it("changing it changes the per diem, taxable pay and PAYE (a company's own rate)", () => {
    const at33 = calculatePayslip(employee, baseContext());
    const at20 = calculatePayslip(employee, baseContext({ rates: { ...KENYA_RATES, per_diem_rate: 0.2 } }));
    const none = calculatePayslip(employee, baseContext({ rates: { ...KENYA_RATES, per_diem_rate: 0 } }));
    expect(at20.per_diem).toBe(12000);
    expect(none.per_diem).toBe(0);
    expect(at20.paye_tax).toBeGreaterThan(at33.paye_tax);
    expect(none.paye_tax).toBeGreaterThan(at20.paye_tax);
    expect(at20.gross_pay).toBe(at33.gross_pay);
  });

  it('a Kenya month without the rate is held back as missing it', () => {
    const { per_diem_rate: _gone, ...without } = KENYA_RATES;
    void _gone;
    const run = calculateRun([{ ...employee, branch_id: null }], [], () => ({ ...baseContext(), rates: without }));
    expect(run.records).toEqual([]);
    expect(run.notCalculated[0].reason).toMatch(/per_diem_rate/);
  });
});

describe('a draft worked out before the rates changed', () => {
  const employee = { 'Employee Number': 'K1', 'First Name': 'A', 'Basic Salary': 60000, 'Tax PIN': 'A1', 'NSSF Number': '1', 'SHIF Number': '2', payment_method: 'cash' };
  const { records } = calculateRun([employee], [], () => ({ ...baseContext({ workByEmployee: undefined }), rates: KENYA_RATES }));
  const input = { employees: [employee], branches: [], payslips: records, runStarted: true, ratesByCountry: new Map([['Kenya', KENYA_RATES]]) };

  it('is held back until recalculated (a block, not a warning)', () => {
    const before = countryReadiness({ ...input, runCountries: [{ country: 'Kenya', status: 'draft' }] });
    expect(before[0].state).toBe('ready');
    const stale = countryReadiness({ ...input, runCountries: [{ country: 'Kenya', status: 'draft' }], ratesChanged: ['kenya'] });
    expect(stale[0].state).toBe('blocked');
    expect(stale[0].blocking).toEqual([RATES_CHANGED]);
  });

  it('an approved or paid country is never flagged', () => {
    for (const status of ['approved', 'paid'] as const) {
      const r = countryReadiness({ ...input, runCountries: [{ country: 'Kenya', status }], ratesChanged: ['Kenya'] });
      expect(r[0].state).toBe(status);
      expect(r[0].blocking).toEqual([]);
    }
  });
});

describe('announcements', () => {
  it('groups new platform rows by country and start date, newest first', () => {
    const a = groupAnnouncements([
      { country: 'Kenya', code: 'paye_bands', effective_from: '2027-07-01', created_at: '2027-06-20T10:00:00Z' },
      { country: 'Kenya', code: 'personal_relief', effective_from: '2027-07-01', created_at: '2027-06-20T10:05:00Z' },
      { country: 'Uganda', code: 'paye_bands', effective_from: '2026-07-01', created_at: '2026-08-21T09:00:00Z' },
    ]);
    expect(a).toEqual([
      { country: 'Kenya', from: '2027-07-01', codes: ['paye_bands', 'personal_relief'], addedAt: '2027-06-20T10:05:00Z' },
      { country: 'Uganda', from: '2026-07-01', codes: ['paye_bands'], addedAt: '2026-08-21T09:00:00Z' },
    ]);
  });
});
