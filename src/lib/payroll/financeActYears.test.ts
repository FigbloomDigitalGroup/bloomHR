import { describe, expect, it } from 'vitest';
import { statutoryFor, taxByBands, bandsOf, type Rates } from '../statutoryCalc';
import { ugandaPaye } from './countries/uganda';
import { KENYA_RATES } from './countries/kenyaFixtures';
import { TANZANIA_RATES } from './countries/tanzaniaFixtures';
import { UGANDA_RATES } from './countries/ugandaFixtures';
import { PLATFORM_RATE_ROWS } from './platformRateRows';
import { previewFigures, ratesOn, withVersion, type RateChange } from './rateVersions';

// The rules of each Finance Act year, pinned on the dated platform rows themselves (platformRateRows.ts, which the
// database test checks against the migrations): a month gets the rows in force on its last day, and adding a row
// changes results from its date only (FIG-813). A new Finance Act gets a test here when its row is added.

const kenya = (day: string, rows = PLATFORM_RATE_ROWS) => ratesOn(rows, day, 'Kenya');
const tanzania = (day: string, rows = PLATFORM_RATE_ROWS) => ratesOn(rows, day, 'Tanzania');
const uganda = (day: string, rows = PLATFORM_RATE_ROWS) => ratesOn(rows, day, 'Uganda');
const change = (over: Partial<RateChange> & Pick<RateChange, 'country' | 'code'>): RateChange => ({
  value: null, bands: null, from: '2027-07-01', source: 'test', ...over,
});
const sdlOf = (lines: { label: string; amount: number }[]) => lines.find((l) => /SDL/.test(l.label))?.amount;

describe('the dated rows', () => {
  it("give today's rates exactly as the engines' fixtures (so the golden payslips are on the real rows)", () => {
    // except the per diem share of basic: none by default from October 2026 (typed in as a reimbursement since); the
    // golden payslips keep 33%, as a company's own rate
    expect(kenya('2026-10-31')).toEqual({ ...KENYA_RATES, per_diem_rate: 0 });
    expect(kenya('2026-09-30').per_diem_rate).toBe(0.33);
    expect(tanzania('2026-10-31')).toEqual(TANZANIA_RATES);
    expect(uganda('2026-10-31')).toEqual(UGANDA_RATES);
  });

  it("let a company's own row win over the default, for that company only", () => {
    const rows = [
      ...PLATFORM_RATE_ROWS,
      { tenant_id: 'co-1', country: 'Kenya', code: 'per_diem_rate', value: 0, bands: null, effective_from: '2026-01-01', effective_to: null },
    ];
    expect(ratesOn(rows, '2026-10-31', 'Kenya', 'co-1').per_diem_rate).toBe(0);
    expect(ratesOn(rows, '2026-09-30', 'Kenya', 'co-2').per_diem_rate).toBe(0.33);
    expect(ratesOn(rows, '2025-12-31', 'Kenya', 'co-1').per_diem_rate).toBe(0.33);
  });
});

describe('Kenya', () => {
  it('Finance Act 2023 (from July 2023): the 32.5% and 35% bands', () => {
    const r = kenya('2023-07-31');
    expect(bandsOf(r).map((b) => b.rate)).toEqual([0.1, 0.25, 0.3, 0.325, 0.35]);
    // 900,000: 2,400 + 2,083.25 + 140,300.10 + 97,500 + 35,000
    expect(taxByBands(900000, bandsOf(r))).toBe(277283.35);
    expect(statutoryFor({ cashPay: 900000 }, r).paye).toBe(274883.35);
  });

  it('Affordable Housing Act 2024: the 1.5% housing levy from 19 March 2024, none before', () => {
    expect(statutoryFor({ cashPay: 100000 }, kenya('2024-03-18')).ahl).toBe(0);
    expect(statutoryFor({ cashPay: 100000 }, kenya('2024-03-31')).ahl).toBe(1500);
  });

  it('NSSF Act 2013 phases: the upper earnings limit 36,000 (Feb 2024), 72,000 (Feb 2025), 108,000 (Feb 2026)', () => {
    const nssf = (day: string) => statutoryFor({ cashPay: 150000 }, kenya(day)).nssf;
    expect(nssf('2024-06-30')).toBe(2160);
    expect(nssf('2025-01-31')).toBe(2160);
    expect(nssf('2025-02-28')).toBe(4320);
    expect(nssf('2026-01-31')).toBe(4320);
    expect(nssf('2026-02-28')).toBe(6480);
  });

  it('SHIF at 2.75% (minimum 300) from October 2024', () => {
    expect(statutoryFor({ cashPay: 100000 }, kenya('2024-09-30')).shif).toBe(0);
    expect(statutoryFor({ cashPay: 100000 }, kenya('2024-10-31')).shif).toBe(2750);
    expect(statutoryFor({ cashPay: 8000 }, kenya('2024-10-31')).shif).toBe(300);
  });

  it('Tax Laws (Amendment) Act, December 2024: SHIF and the housing levy come off pay before PAYE', () => {
    const nov = statutoryFor({ cashPay: 100000 }, kenya('2024-11-30'));
    const dec = statutoryFor({ cashPay: 100000 }, kenya('2024-12-31'));
    expect([nov.shif, nov.ahl, nov.nssf]).toEqual([2750, 1500, 2160]);
    expect(nov.taxablePay).toBe(97840);
    expect(nov.paye).toBe(21735.35);
    expect(dec.taxablePay).toBe(93590);
    expect(dec.paye).toBe(20460.35);
    // and the pension cap of 30,000 a month from 27 December 2024
    expect(statutoryFor({ cashPay: 100000, pension: 40000 }, kenya('2024-12-31')).pension).toBe(30000);
  });

  it("this year (October 2026): finance's September 2026 PAYE file", () => {
    const r = statutoryFor({ cashPay: 65870.76 }, kenya('2026-10-31'));
    expect([r.shif, r.ahl, r.paye]).toEqual([1811.45, 988.06, 10119.05]);
  });

  it('a new row changes results from its date only', () => {
    const rows = withVersion(PLATFORM_RATE_ROWS, change({ country: 'Kenya', code: 'personal_relief', value: 2600, from: '2027-07-01' }));
    const paye = (day: string, rs = rows) => previewFigures('Kenya', 100000, day.slice(0, 7), kenya(day, rs))?.tax ?? NaN;
    expect(paye('2027-06-30')).toBe(paye('2027-06-30', PLATFORM_RATE_ROWS));
    expect(paye('2027-07-31')).toBeCloseTo(paye('2027-07-31', PLATFORM_RATE_ROWS) - 200, 2);
    // the old row now ends the day before
    expect(rows.find((r) => r.code === 'personal_relief' && r.effective_from === '2023-07-01')?.effective_to).toBe('2027-06-30');
  });
});

describe('Tanzania', () => {
  it('Finance Act 2023: SDL at 3.5% of gross from July 2023 (an employer cost), with every rate from that date', () => {
    expect(tanzania('2023-06-30')).toEqual({});
    const r = tanzania('2023-07-31');
    expect(r.sdl_rate).toBe(0.035);
    expect(sdlOf(previewFigures('Tanzania', 1000000, '2023-07', r)?.employerCosts ?? [])).toBe(35000);
  });

  it('a new SDL row changes the levy from its date only', () => {
    const rows = withVersion(PLATFORM_RATE_ROWS, change({ country: 'Tanzania', code: 'sdl_rate', value: 0.04, from: '2027-07-01' }));
    const sdl = (day: string) => sdlOf(previewFigures('Tanzania', 1000000, day.slice(0, 7), tanzania(day, rows))?.employerCosts ?? []);
    expect(sdl('2027-06-30')).toBe(35000);
    expect(sdl('2027-07-31')).toBe(40000);
  });
});

describe('Uganda', () => {
  it('Income Tax (Amendment) Act 2026: the new resident bands from July 2026 (backdated), the old ones before', () => {
    const june: Rates = uganda('2026-06-30');
    const july: Rates = uganda('2026-07-31');
    // 400,000 chargeable: 10% of 235k-335k + 20% of 335k-400k before; only 20% of 335k-400k after
    expect(ugandaPaye(400000, june)).toBe(23000);
    expect(ugandaPaye(400000, july)).toBe(13000);
    // 1,000,000: before 25,000 + 30% above 410,000; after 33,750 + 30% above 485,000
    expect(ugandaPaye(1000000, june)).toBe(202000);
    expect(ugandaPaye(1000000, july)).toBe(188250);
    // the non-resident table did not change, nor the extra 10% above 10,000,000
    expect(july.paye_bands_non_resident).toEqual(june.paye_bands_non_resident);
    expect(ugandaPaye(12000000, july) - ugandaPaye(10000000, july)).toBe(800000);
  });
});
