import { describe, expect, it } from 'vitest';
import type { Branch } from '../branches';
import { calculateRun, countryReadiness, currencyMismatch, filesByCountry, usdRateMissing } from './multiCountry';
import { KENYA_FIXTURES, KENYA_RATES, baseContext } from './countries/kenyaFixtures';
import golden from './countries/kenyaGolden.json';
import { TANZANIA_RATES } from './countries/tanzaniaFixtures';
import { UGANDA_RATES } from './countries/ugandaFixtures';
import { kenyaEngine } from './countries/kenya';
import { tanzaniaEngine } from './countries/tanzania';
import { ugandaEngine } from './countries/uganda';
import {
  calculateInUsd,
  cents,
  employeeInLocal,
  fxExportColumns,
  localPayslip,
  localStatutorySection,
  parseRate,
  payCurrencyOf,
  recordInUsd,
  usdBankFile,
} from './usdPay';

// FIG-906: a country paid in USD at the rate the company types in for the month. The engine works in local currency
// unchanged; the payslip is in USD (each amount converted back and rounded to cents, net = gross less deductions),
// with the local statutory figures kept for the returns. Local-currency staff are exactly as before.

/* eslint-disable @typescript-eslint/no-explicit-any -- employee rows and payslips are untyped */
const ctx = (rates = KENYA_RATES) => ({ ...baseContext(), rates });
const kenyan = (over: Record<string, any> = {}) => ({
  id: 'id-U1', 'Employee Number': 'USD-1', 'First Name': 'Wanjiru', 'Last Name': 'Otieno', 'Basic Salary': 2000,
  'Tax PIN': 'A012345678Z', 'NSSF Number': '123456789', 'SHIF Number': 'CR1234567890123-4', 'ID Number': '12345678',
  payment_method: 'Bank', Bank: 'Equity', 'Account Number': '0123456789', account_number_name: 'Wanjiru Otieno', ...over,
});
const usd = (rate: number, e = kenyan(), c = ctx()) => {
  const out = calculateInUsd(kenyaEngine, e, c, rate);
  if (!out.record) throw new Error(out.heldBack);
  return out.record;
};

describe('a USD-paid Kenya employee ($2,000 a month)', () => {
  it('is worked out in KES at the month’s rate: 129 and 130 give different KES PAYE', () => {
    const at129 = usd(129);
    const at130 = usd(130);
    expect(at129.local_amounts.gross_pay).toBe(258000);
    expect(at130.local_amounts.gross_pay).toBe(260000);
    expect(at129.local_amounts.paye_tax).not.toBe(at130.local_amounts.paye_tax);
    expect(at130.local_amounts.paye_tax).toBeGreaterThan(at129.local_amounts.paye_tax);
    // the KES figures are exactly Kenya's engine on KES 258,000
    const kes = kenyaEngine.calculate({ employee: { ...kenyan(), 'Basic Salary': 258000 }, ctx: ctx() }).record;
    for (const k of ['gross_pay', 'paye_tax', 'nssf_deduction', 'nhif_deduction', 'housing_levy', 'net_pay'] as const) {
      expect(at129.local_amounts[k]).toBe(kes[k]);
    }
  });

  it('is paid in USD: each deduction back in USD to the cent, net = gross less those deductions (by hand)', () => {
    const r = usd(129);
    const l = r.local_amounts;
    // by hand, in KES: gross 2,000 x 129 = 258,000, of which the 33% per diem is not taxed: 172,860 counts
    const counted = 258000 * 0.67;
    const nssfKes = 6480; // 6% of the KES 108,000 upper limit
    const shifKes = cents(counted * 0.0275); // 4,753.65
    const ahlKes = cents(counted * 0.015); // 2,592.90
    const taxable = counted - nssfKes - shifKes - ahlKes; // 159,033.45
    const payeKes = 24000 * 0.1 + (32333 - 24000) * 0.25 + (taxable - 32333) * 0.3 - 2400; // 40,093.385
    expect([l.nssf_deduction, l.nhif_deduction, l.housing_levy]).toEqual([nssfKes, shifKes, ahlKes]);
    expect(l.paye_tax).toBeCloseTo(payeKes, 1);
    // back in USD at 129, each to the cent
    const paye = cents(l.paye_tax / 129);
    const nssf = cents(nssfKes / 129);
    const shif = cents(shifKes / 129);
    const ahl = cents(ahlKes / 129);
    expect([nssf, shif, ahl]).toEqual([50.23, 36.85, 20.1]);
    expect(paye).toBeCloseTo(310.8, 1);
    expect(r).toMatchObject({ currency: 'USD', fx_rate: 129, local_currency: 'KES', gross_pay: 2000, basic_salary: 2000 });
    expect([r.paye_tax, r.nssf_deduction, r.nhif_deduction, r.housing_levy]).toEqual([paye, nssf, shif, ahl]);
    expect(r.total_deductions).toBe(cents(paye + nssf + shif + ahl));
    expect(r.net_pay).toBe(cents(2000 - (paye + nssf + shif + ahl)));
    // the NITA levy (employer cost) is KES 50 locally, its USD value on the payslip
    expect(l.nita_levy).toBe(50);
    expect(r.nita_levy).toBe(0.39);
  });

  it('converts earnings, deductions and loans entered in USD', () => {
    const c = {
      ...ctx(),
      earningsByEmployee: new Map([['USD-1', [{ name: 'Bonus', amount: 100, taxable: true, pensionable: false }]]]),
      voluntaryByEmployee: new Map([['USD-1', [{ name: 'SACCO', amount: 25.5 }]]]),
    };
    const r = usd(129, kenyan(), c);
    expect(r.local_amounts.gross_pay).toBe(2100 * 129);
    expect(r.gross_pay).toBe(2100);
    expect(r.bonus).toBe(100);
    expect(r.other_deductions).toBe(25.5);
    expect(r.deduction_items).toEqual([{ name: 'SACCO', amount: 25.5 }]);
    expect(r.earning_items[0].amount).toBe(100);
  });

  it('holds back someone with piece rate work: it stays in KES', () => {
    const c = { ...ctx(), workByEmployee: new Map([['USD-1', { employee_number: 'USD-1', work_gross: 1290, jobs_gross: 0, paid: 0, ahl: 0, reserve: 0, rounding: 0, wht: 0, arrears: 0, work_lines: [] } as any]]) };
    const out = calculateInUsd(kenyaEngine, kenyan(), c, 129);
    expect(out.record).toBeUndefined();
    expect(out.heldBack).toMatch(/piece rate work.*stay in KES/);
  });
});

describe('Tanzania and Uganda paid in USD', () => {
  it('Tanzania: $1,000 at 2,600 is worked out on TSh 2,600,000 and paid in USD', () => {
    const out = calculateInUsd(tanzaniaEngine, { 'Employee Number': 'TZ-1', 'Basic Salary': 1000, 'Tax PIN': '123-456-789', 'NSSF Number': '1' }, ctx(TANZANIA_RATES), 2600);
    const r = out.record!;
    const tzs = tanzaniaEngine.calculate({ employee: { 'Employee Number': 'TZ-1', 'Basic Salary': 2600000, 'Tax PIN': '123-456-789', 'NSSF Number': '1' }, ctx: ctx(TANZANIA_RATES) }).record;
    expect(r.local_amounts.gross_pay).toBe(2600000);
    expect(r.local_amounts.paye_tax).toBe(tzs.paye_tax);
    expect(r.local_amounts.nssf_deduction).toBe(260000);
    expect(r).toMatchObject({ currency: 'USD', local_currency: 'TZS', gross_pay: 1000, nssf_deduction: 100 });
    expect(r.paye_tax).toBe(cents(tzs.paye_tax / 2600));
    expect(r.net_pay).toBe(cents(1000 - r.total_deductions));
    expect(localStatutorySection(r)?.title).toBe('Statutory deductions in TZS at 1 USD = 2,600 TZS');
  });

  it('Uganda: $1,000 at 3,700 is worked out on USh 3,700,000 and paid in USD', () => {
    const e = { 'Employee Number': 'UG-1', 'Basic Salary': 1000, 'Tax PIN': '1000123456', 'NSSF Number': 'NS1' };
    const r = calculateInUsd(ugandaEngine, e, { ...ctx(UGANDA_RATES), period: '2026-11' }, 3700).record!;
    const ugx = ugandaEngine.calculate({ employee: { ...e, 'Basic Salary': 3700000 }, ctx: { ...ctx(UGANDA_RATES), period: '2026-11' } }).record;
    expect(r.local_amounts.paye_tax).toBe(ugx.paye_tax);
    expect(r.local_amounts.nssf_deduction).toBe(185000);
    expect(r.nssf_deduction).toBe(50);
    expect(r.net_pay).toBe(cents(1000 - r.total_deductions));
    expect(r.local_currency).toBe('UGX');
  });
});

describe('rounding', () => {
  it('rounds every converted amount to the cent, and net always equals gross less deductions', () => {
    for (const rate of [129, 129.37, 130.5, 3.3333]) {
      const r = usd(rate, kenyan({ 'Basic Salary': 1234.56, house_allowance: 99.99 }));
      for (const k of ['gross_pay', 'paye_tax', 'nssf_deduction', 'nhif_deduction', 'housing_levy', 'total_deductions', 'net_pay'] as const) {
        expect(Math.round(r[k] * 100) / 100).toBe(r[k]);
      }
      expect(r.net_pay).toBe(cents(r.gross_pay - r.total_deductions));
      expect(r.gross_pay).toBe(cents(1234.56 + 99.99));
    }
  });

  it('reads the rate as typed', () => {
    expect(parseRate('129')).toBe(129);
    expect(parseRate(' 129.5 ')).toBe(129.5);
    expect(parseRate('1,290.25')).toBe(1290.25);
    expect(parseRate('0')).toBeNull();
    expect(parseRate('-5')).toBeNull();
    expect(parseRate('abc')).toBeNull();
    expect(parseRate('1.123456')).toBeNull();
  });

  it('converts only money on the employee record', () => {
    const e = employeeInLocal(kenyan({ 'Overtime Rate': 10, overtime: 4 }), 129);
    expect(e['Basic Salary']).toBe(258000);
    expect(e['Overtime Rate']).toBe(1290);
    expect(e.overtime).toBe(4); // hours
    expect(e['Tax PIN']).toBe('A012345678Z');
  });
});

describe('local-currency staff are unchanged', () => {
  it('the Kenya golden figures, run without and with a USD setup for another country', () => {
    const branches: Branch[] = [
      { id: 'nbo', name: 'Nairobi', country: 'Kenya', currency: 'KES', city: null, address: null, active: true, is_default: true },
      { id: 'kla', name: 'Kampala', country: 'Uganda', currency: 'UGX', city: null, address: null, active: true, is_default: false },
    ];
    const usdSetup = { payCurrencies: new Map([['Uganda', 'USD']]), fxRates: new Map([['Uganda', 3700]]) };
    let compared = 0;
    for (const f of KENYA_FIXTURES.filter((x) => !x.override)) {
      const run = calculateRun([{ ...f.employee, branch_id: 'nbo' }], branches, () => baseContext(f.ctx), usdSetup);
      expect(run.records).toHaveLength(1);
      const { country: _c, currency, ...rest } = run.records[0];
      expect(currency).toBe('KES');
      expect(JSON.parse(JSON.stringify(rest))).toEqual((golden as Record<string, unknown>)[f.name]);
      compared += 1;
    }
    expect(compared).toBeGreaterThanOrEqual(15);
  });

  it('a local payslip is its own local payslip', () => {
    const p = { currency: 'KES', paye_tax: 100 };
    expect(localPayslip(p)).toBe(p);
    expect(localStatutorySection(p)).toBeNull();
    expect(fxExportColumns(p)['USD Rate']).toBe('');
  });
});

describe('the run, readiness and files for a USD country', () => {
  const branches: Branch[] = [
    { id: 'nbo', name: 'Nairobi', country: 'Kenya', currency: 'KES', city: null, address: null, active: true, is_default: true },
    { id: 'dar', name: 'Dar es Salaam', country: 'Tanzania', currency: 'TZS', city: null, address: null, active: true, is_default: false },
  ];
  const tz = { id: 'id-T1', 'Employee Number': 'T1', 'First Name': 'Juma', 'Basic Salary': 1500000, branch_id: 'dar', 'Tax PIN': '123-456-789', 'NSSF Number': '1002003004', payment_method: 'Bank' };
  const ke = { ...kenyan(), branch_id: 'nbo' };
  const ctxFor = (c: string) => ({ ...baseContext(), rates: c === 'Kenya' ? KENYA_RATES : TANZANIA_RATES });
  const payCurrencies = new Map([['Kenya', 'USD']]);

  it("isn't worked out until this month's rate is entered: Kenya is held back", () => {
    const run = calculateRun([ke, tz], branches, ctxFor, { payCurrencies, fxRates: new Map() });
    expect(run.records.map((r) => r.country)).toEqual(['Tanzania']);
    expect(run.notCalculated).toEqual([expect.objectContaining({ country: 'Kenya', reason: usdRateMissing('Kenya') })]);
    const readiness = countryReadiness({
      employees: [ke, tz], branches, payslips: run.records, runCountries: [], runStarted: false,
      ratesByCountry: new Map([['Kenya', KENYA_RATES], ['Tanzania', TANZANIA_RATES]]), payCurrencies, fxRates: new Map(),
    });
    const kenya = readiness.find((r) => r.country === 'Kenya')!;
    expect(kenya).toMatchObject({ state: 'blocked', currency: 'USD' });
    expect(kenya.blocking).toContain("Enter this month's USD rate for Kenya");
    expect(readiness.find((r) => r.country === 'Tanzania')!.state).toBe('ready');
  });

  it('with the rate: Kenya in USD, Tanzania in TZS, totals never added; a payslip at an old rate holds Kenya back', () => {
    const run = calculateRun([ke, tz], branches, ctxFor, { payCurrencies, fxRates: new Map([['Kenya', 129]]) });
    expect(run.records.map((r) => `${r.country}:${r.currency}`)).toEqual(['Kenya:USD', 'Tanzania:TZS']);
    const input = {
      employees: [ke, tz], branches, payslips: run.records, runCountries: [], runStarted: false,
      ratesByCountry: new Map([['Kenya', KENYA_RATES], ['Tanzania', TANZANIA_RATES]]), payCurrencies,
    };
    expect(countryReadiness({ ...input, fxRates: new Map([['Kenya', 129]]) }).find((r) => r.country === 'Kenya')!.state).toBe('ready');
    const stale = countryReadiness({ ...input, fxRates: new Map([['Kenya', 130]]) }).find((r) => r.country === 'Kenya')!;
    expect(stale.state).toBe('blocked');
    expect(stale.blocking.join(' ')).toMatch(/another USD rate than this month's 1 USD = 130 KES: press Recalculate/);
    expect(currencyMismatch(run.records[0], payCurrencies)).toBeNull();
    expect(currencyMismatch(run.records[0])).toMatch(/Kenya payslips are in KES, not USD/);
  });

  it('files the returns in KES from the local figures, and pays USD by bank in a USD file', () => {
    const run = calculateRun([ke, tz], branches, ctxFor, { payCurrencies, fxRates: new Map([['Kenya', 129]]) });
    const files = filesByCountry({
      payslips: run.records, employees: [ke, tz] as any, payPeriod: '2026-10', debitAccount: '',
      runCountries: [{ country: 'Kenya', status: 'approved' }, { country: 'Tanzania', status: 'approved' }],
      ratesByCountry: new Map([['Kenya', KENYA_RATES], ['Tanzania', TANZANIA_RATES]]),
    });
    const kenya = files.find((f) => f.country === 'Kenya')!;
    expect(kenya.currency).toBe('USD');
    // the same returns as for someone paid KES 258,000 (2,000 x 129) in KES: every figure local
    const kes = kenyaEngine.calculate({ employee: { ...ke, 'Basic Salary': 258000 }, ctx: ctxFor('Kenya') }).record;
    const asKes = filesByCountry({
      payslips: [{ ...kes, nita_levy: 50 }], employees: [ke] as any, payPeriod: '2026-10', debitAccount: '',
      runCountries: [{ country: 'Kenya', status: 'approved' }], ratesByCountry: new Map([['Kenya', KENYA_RATES]]),
    })[0];
    for (const key of ['p10', 'nssf', 'sha', 'ahl', 'nita']) {
      const usdFile = kenya.returns.find((r) => r.key === key)!.file;
      expect(usdFile.rows.length).toBeGreaterThan(0);
      expect(usdFile.rows).toEqual(asKes.returns.find((r) => r.key === key)!.file.rows);
    }
    expect(kenya.statutoryPayslips[0].currency).toBe('KES');
    expect(kenya.payments.map((p) => p.key)).toEqual(['bank-usd']);
    const bank = kenya.payments[0].file;
    expect(bank.rows).toHaveLength(1);
    expect(bank.rows[0]).toContain(run.records[0].net_pay.toFixed(2));
    expect(files.find((f) => f.country === 'Tanzania')!.payments.map((p) => p.key)).toEqual(['bank-tzs', 'mobile-tzs']);
  });

  it('lists USD staff not paid by bank as missing a bank account', () => {
    const r = recordInUsd({ employee_id: 'X1', employee_name: 'Mobile Person', gross_pay: 1290, net_pay: 1290, payment_method: 'M-Pesa' }, 129, 'KES');
    const f = usdBankFile([r], [{ 'Employee Number': 'X1' }] as any, '2026-10');
    expect(f.rows).toHaveLength(0);
    expect(f.problems).toEqual([expect.objectContaining({ employeeNumber: 'X1', missing: ['A bank account (USD is paid by bank)'] })]);
  });

  it('the pay currency is local unless USD is chosen', () => {
    expect(payCurrencyOf('Kenya', new Map())).toBe('KES');
    expect(payCurrencyOf('Uganda', new Map([['Uganda', 'USD']]))).toBe('USD');
    expect(payCurrencyOf('Tanzania', new Map([['Tanzania', 'EUR']]))).toBe('TZS');
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
