import { describe, expect, it } from 'vitest';
import type { Branch } from '../../branches';
import type { Rates } from '../../statutoryCalc';
import { KENYA_FIXTURES, KENYA_RATES, baseContext } from './kenyaFixtures';
import golden from './kenyaGolden.json';
import { UGANDA_RATES } from './ugandaFixtures';
import {
  LST_HEADERS,
  NSSF_UG_HEADERS,
  URA_PAYE_HEADERS,
  calculateUgandaPayslip,
  lstAnnual,
  lstFor,
  ugandaEngine,
  ugandaFinancialYear,
  ugandaPaye,
  ugandaPhone,
} from './uganda';
import { engineFor, kenyaEngine } from '.';
import { calculateRun, filesByCountry, paymentFilesFor } from '../multiCountry';

// FIG-905 stage 4: Uganda's payroll. Every expected figure below is worked out by hand from the formula in the law
// (supabase/migrations/20261021100000_uganda_payroll.sql has the sources), not from the code.

/** the resident bands before 1 July 2026 */
const RATES_2025: Rates = {
  ...UGANDA_RATES,
  paye_bands: [
    { upto: 235000, rate: 0 },
    { upto: 335000, rate: 0.1 },
    { upto: 410000, rate: 0.2 },
    { upto: null, rate: 0.3 },
  ],
};

const ug = (number: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${number}`,
  'Employee Number': number,
  'First Name': `Okello${number}`,
  'Last Name': `Achieng${number}`,
  'Job Title': 'Officer',
  'Basic Salary': 1500000,
  'Tax PIN': '1000123456',
  'NSSF Number': 'NS1234567',
  'ID Number': 'CM90012345ABCD',
  'Mobile Number': '0772123456',
  payment_method: 'Airtel Money',
  branch_id: 'Kampala',
  ...extra,
});
const ctx = (period = '2026-11', over: Record<string, unknown> = {}) => ({ ...baseContext({ workByEmployee: undefined }), period, rates: UGANDA_RATES, ...over });

describe('PAYE, resident (Income Tax (Amendment) Act 2026, from July 2026)', () => {
  // nil to 335,000; 20% of the excess to 410,000; 15,000 + 25% of the excess over 410,000 to 485,000;
  // 33,750 + 30% of the excess over 485,000; plus 10% of the excess over 10,000,000
  it.each([
    [0, 0],
    [335000, 0],
    [335001, 0], // 0.20 -> rounds to 0
    [400000, 13000], // 20% x 65,000
    [410000, 15000], // 20% x 75,000
    [450000, 25000], // 15,000 + 25% x 40,000
    [485000, 33750], // 15,000 + 25% x 75,000
    [1000000, 188250], // 33,750 + 30% x 515,000
    [1500000, 338250], // 33,750 + 30% x 1,015,000
    [10000000, 2888250], // 33,750 + 30% x 9,515,000
    [12000000, 3688250], // 33,750 + 30% x 11,515,000 + 10% x 2,000,000
  ])('chargeable income %i -> PAYE %i', (income, paye) => {
    expect(ugandaPaye(income, UGANDA_RATES, true)).toBe(paye);
  });

  it('before July 2026: nil to 235,000, 10% to 335,000, 10,000 + 20% to 410,000, 25,000 + 30% above', () => {
    expect(ugandaPaye(235000, RATES_2025)).toBe(0);
    expect(ugandaPaye(335000, RATES_2025)).toBe(10000);
    expect(ugandaPaye(410000, RATES_2025)).toBe(25000);
    expect(ugandaPaye(1500000, RATES_2025)).toBe(352000); // 25,000 + 30% x 1,090,000
    expect(ugandaPaye(11000000, RATES_2025)).toBe(3302000); // 25,000 + 30% x 10,590,000 + 10% x 1,000,000
  });
});

describe('PAYE, non-resident (no nil band)', () => {
  it.each([
    [200000, 20000], // 10%
    [335000, 33500], // 10% x 335,000
    [410000, 48500], // 33,500 + 20% x 75,000
    [1500000, 375500], // 48,500 + 30% x 1,090,000
    [12000000, 3725500], // 48,500 + 30% x 11,590,000 + 10% x 2,000,000
  ])('chargeable income %i -> PAYE %i', (income, paye) => {
    expect(ugandaPaye(income, UGANDA_RATES, false)).toBe(paye);
  });

  it('applies to an employee whose residency is Non-Resident', () => {
    const r = calculateUgandaPayslip(ug('U2', { kra_residency: 'Non-Resident' }), ctx());
    expect(r.paye_tax).toBe(375500);
  });
});

describe('a worked payslip: gross 1,500,000 UGX', () => {
  it('in November (no LST): NSSF 75,000 not deducted before PAYE, PAYE 338,250, net 1,086,750, employer NSSF 150,000', () => {
    const r = calculateUgandaPayslip(ug('U1'), ctx('2026-11'));
    expect(r).toMatchObject({
      country: 'Uganda', currency: 'UGX', gross_pay: 1500000, nssf_deduction: 75000, employer_nssf: 150000, lst_deduction: 0,
      taxable_pay: 1500000, tax_resident: true, paye_tax: 338250, nhif_deduction: 0, housing_levy: 0, per_diem: 0, nita_levy: 0,
      total_deductions: 413250, net_pay: 1086750,
    });
  });

  it('in October, the last LST instalment (25,000) comes off chargeable income: PAYE 330,750, net 1,069,250', () => {
    const r = calculateUgandaPayslip(ug('U1'), ctx('2026-10', { lstPaidThisYear: new Map([['U1', 75000]]) }));
    // chargeable 1,475,000: 33,750 + 30% x 990,000 = 330,750
    expect(r).toMatchObject({ lst_deduction: 25000, taxable_pay: 1475000, paye_tax: 330750, nssf_deduction: 75000, net_pay: 1069250 });
  });

  it('labels the lines: PAYE, NSSF (5%), LST; employer NSSF (10%) as an employer cost', () => {
    const r = ugandaEngine.calculate({ employee: ug('U1'), ctx: ctx('2026-07') });
    expect(r.currency).toBe('UGX');
    expect(r.statutoryDeductions).toEqual([
      { label: 'PAYE', amount: 330750 },
      { label: 'NSSF (5%)', amount: 75000 },
      { label: 'Local service tax', amount: 25000 },
    ]);
    expect(r.employerCosts).toEqual([{ label: 'NSSF (employer, 10%)', amount: 150000 }]);
    expect(r.taxablePay).toBe(1475000);
  });

  it('a contractor pays 6% withholding tax only', () => {
    const r = calculateUgandaPayslip(ug('C1', { worker_kind: 'contractor' }), ctx('2026-10'));
    expect(r).toMatchObject({ wht_tax: 90000, paye_tax: 0, nssf_deduction: 0, employer_nssf: 0, lst_deduction: 0, net_pay: 1410000 });
  });

  it('an untaxed earning is in gross pay (and NSSF) but not chargeable income', () => {
    const r = calculateUgandaPayslip(
      ug('U1'),
      ctx('2026-11', { earningsByEmployee: new Map([['U1', [{ name: 'Meal allowance', amount: 100000, taxable: false, pensionable: true }]]]) })
    );
    expect(r).toMatchObject({ gross_pay: 1600000, nssf_deduction: 80000, taxable_pay: 1500000, paye_tax: 338250 });
  });
});

describe('Local Service Tax', () => {
  it.each([
    [100000, 0],
    [100001, 5000],
    [200000, 5000],
    [450000, 30000],
    [650000, 60000],
    [1000000, 90000],
    [1000001, 100000],
    [1500000, 100000],
  ])('monthly gross %i -> %i a year', (gross, lst) => {
    expect(lstAnnual(gross, UGANDA_RATES)).toBe(lst);
  });

  const at = (period: string, monthlyGross: number, paidThisYear = 0, collection: 'instalments' | 'lump_sum' = 'instalments') =>
    lstFor({ monthlyGross, period, paidThisYear, collection, rates: UGANDA_RATES });

  it('four instalments in July to October, nothing from November to June', () => {
    let paid = 0;
    const taken = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2027-03', '2027-06'].map((p) => {
      const r = at(p, 450000, paid);
      paid += r.amount;
      return [r.instalment, r.amount];
    });
    expect(taken).toEqual([[1, 7500], [2, 7500], [3, 7500], [4, 7500], [0, 0], [0, 0], [0, 0]]);
    expect(paid).toBe(30000);
  });

  it('stops once the year is paid, and takes what was missed over the instalments left', () => {
    expect(at('2026-09', 1500000, 100000).amount).toBe(0);
    expect(at('2026-08', 1500000, 90000).amount).toBe(3333); // the 10,000 still owed over August to October
    expect(at('2026-10', 1500000, 90000).amount).toBe(10000); // never more than is owed
    // joined in September: the year's 100,000 over September and October
    expect(at('2026-09', 1500000, 0).amount).toBe(50000);
    expect(at('2026-10', 1500000, 50000).amount).toBe(50000);
  });

  it('as a lump sum: the whole year in the first month it applies, then nothing', () => {
    expect(at('2026-07', 1500000, 0, 'lump_sum').amount).toBe(100000);
    expect(at('2026-08', 1500000, 100000, 'lump_sum').amount).toBe(0);
    expect(at('2026-11', 1500000, 0, 'lump_sum').amount).toBe(0);
  });

  it('none below the first band, or for someone exempt', () => {
    expect(at('2026-07', 90000).amount).toBe(0);
    expect(calculateUgandaPayslip(ug('U1', { lst_exempt: true }), ctx('2026-07')).lst_deduction).toBe(0);
  });

  it('uses the company setting and what was paid this year in the calculation', () => {
    expect(calculateUgandaPayslip(ug('U1'), ctx('2026-07', { lstCollection: 'lump_sum' })).lst_deduction).toBe(100000);
    expect(calculateUgandaPayslip(ug('U1'), ctx('2026-08', { lstPaidThisYear: new Map([['U1', 100000]]) })).lst_deduction).toBe(0);
  });

  it('knows the financial year', () => {
    expect(ugandaFinancialYear('2026-10')).toEqual({ start: 2026, label: '2026/27' });
    expect(ugandaFinancialYear('2027-06')).toEqual({ start: 2026, label: '2026/27' });
  });
});

describe('the returns', () => {
  const employees = [
    { ...ug('U1'), 'Middle Name': '' },
    { ...ug('U2', { 'Tax PIN': '', 'NSSF Number': '' }) },
    ug('C1', { worker_kind: 'contractor', 'Tax PIN': '1000777777' }),
  ];
  const slips = [
    calculateUgandaPayslip(employees[0], ctx('2026-10', { lstPaidThisYear: new Map([['U1', 75000]]) })),
    calculateUgandaPayslip(employees[1], ctx('2026-10', { lstPaidThisYear: new Map([['U2', 75000]]) })),
    calculateUgandaPayslip(employees[2], ctx('2026-10')),
  ];
  const build = (key: string) => ugandaEngine.returns().find((r) => r.key === key)!.build(slips, employees, { payPeriod: '2026-10', rates: UGANDA_RATES });

  it('lists URA PAYE, NSSF Uganda, LST and the contractors’ WHT', () => {
    expect(ugandaEngine.returns().map((r) => [r.key, r.authority])).toEqual([
      ['ura-paye', 'URA'], ['nssf-ug', 'NSSF Uganda'], ['lst', 'Local government'], ['ura-wht', 'URA'],
    ]);
  });

  it('URA PAYE: TIN, name, gross, chargeable income and PAYE for employees only', () => {
    const f = build('ura-paye');
    expect(f.headers).toEqual(URA_PAYE_HEADERS);
    expect(f.headers).toEqual([
      'TIN', 'NIN / Passport No', 'Employee Name', 'Designation', 'Residency', 'Basic Salary', 'Allowances and Other Earnings',
      'Gross Employment Income', 'Untaxed Income', 'Allowable Deductions (LST)', 'Chargeable Income', 'PAYE',
    ]);
    expect(f.rows).toHaveLength(2);
    expect(f.rows[0]).toEqual(['1000123456', 'CM90012345ABCD', 'OkelloU1 AchiengU1', 'Officer', 'Resident', '1500000', '0', '1500000', '0', '25000', '1475000', '330750']);
    expect(f.problems).toEqual([{ name: 'OkelloU2 AchiengU2', employeeNumber: 'U2', missing: ['TIN'] }]);
  });

  it('NSSF Uganda: member number, names, gross and both shares', () => {
    const f = build('nssf-ug');
    expect(f.headers).toEqual(NSSF_UG_HEADERS);
    expect(f.rows[0]).toEqual(['NS1234567', 'AchiengU1', 'OkelloU1', 'CM90012345ABCD', '1500000', '75000', '150000', '225000']);
    expect(f.problems.map((p) => p.missing)).toEqual([['NSSF number']]);
  });

  it('LST: the year’s amount for the band and this month’s instalment', () => {
    const f = build('lst');
    expect(f.headers).toEqual(LST_HEADERS);
    expect(f.rows[0]).toEqual(['U1', 'OkelloU1 AchiengU1', '1000123456', 'CM90012345ABCD', 'Officer', '', '1500000', '100000', '25000']);
  });

  it('WHT: each contractor at 6%', () => {
    expect(build('ura-wht').rows).toEqual([['1000777777', 'OkelloC1 AchiengC1', 'Services', '1500000', '6%', '90000']]);
  });
});

describe('details', () => {
  it('asks for a TIN, an NSSF number and mobile money or bank details, as warnings', () => {
    const p = ugandaEngine.validate({ 'Employee Number': 'U9', 'First Name': 'Zed', 'Tax PIN': 'A012345678Z', payment_method: 'Bank Transfer' });
    expect(p.map((x) => x.problem)).toEqual(['TIN (not valid)', 'NSSF number', 'Bank', 'Account number', 'Account name']);
    expect(p.every((x) => !x.blocking)).toBe(true);
    expect(ugandaEngine.validate(ug('U1'))).toEqual([]);
    expect(ugandaEngine.validate({ ...ug('U1'), 'Mobile Number': '0712' }).map((x) => x.problem)).toEqual(['Mobile money number']);
  });

  it('reads Ugandan mobile numbers', () => {
    expect(ugandaPhone('0772 123 456')).toBe('256772123456');
    expect(ugandaPhone('+256 701 234567')).toBe('256701234567');
    expect(ugandaPhone('0712345')).toBe('');
  });
});

describe('one run with Kenya and Uganda staff', () => {
  const branch = (id: string, country: string, currency: string, is_default = false): Branch =>
    ({ id, name: id, country, currency, city: null, address: null, active: true, is_default });
  const branches = [branch('Nairobi', 'Kenya', 'KES', true), branch('Kampala', 'Uganda', 'UGX')];
  const kenyans = KENYA_FIXTURES.filter((f) => !f.override && !f.ctx).slice(0, 3);
  const staff = [...kenyans.map((f) => ({ ...f.employee, branch_id: 'Nairobi' })), ug('U1'), ug('U2', { kra_residency: 'Non-Resident' })];
  const ratesFor = new Map<string, Rates>([['Kenya', KENYA_RATES], ['Uganda', UGANDA_RATES]]);
  const { records, notCalculated } = calculateRun(staff, branches, (country) => ({
    ...baseContext(), period: '2026-10', rates: ratesFor.get(country)!, lstPaidThisYear: new Map([['U1', 75000], ['U2', 75000]]),
  }));

  it('works each person out with their own country’s engine and currency', () => {
    expect(engineFor('Uganda')).toBe(ugandaEngine);
    expect(notCalculated).toEqual([]);
    expect(records.map((r) => [r.employee_id, r.country, r.currency])).toEqual([
      ...kenyans.map((f) => [f.employee['Employee Number'], 'Kenya', 'KES']),
      ['U1', 'Uganda', 'UGX'],
      ['U2', 'Uganda', 'UGX'],
    ]);
    expect(records.find((r) => r.employee_id === 'U1')).toMatchObject({ paye_tax: 330750, lst_deduction: 25000, housing_levy: 0 });
  });

  it('leaves Kenya’s figures exactly as they were (kenyaGolden.json)', () => {
    for (const f of kenyans) {
      const r = records.find((x) => x.employee_id === f.employee['Employee Number'])!;
      const { country: _c, currency: _cu, ...rest } = r;
      expect(JSON.parse(JSON.stringify(rest))).toEqual((golden as Record<string, unknown>)[f.name]);
    }
    expect(kenyaEngine.returns().map((r) => r.key)).toEqual(['p10', 'sha', 'nssf', 'ahl', 'nita', 'wht']);
  });

  it('files each country’s returns from its own payslips, and UGX payment files', () => {
    const files = filesByCountry({
      payslips: records, employees: staff, runCountries: [{ country: 'Uganda', status: 'approved' }, { country: 'Kenya', status: 'approved' }],
      ratesByCountry: ratesFor, payPeriod: '2026-10', debitAccount: '',
    });
    expect(files.map((f) => [f.country, f.currency])).toEqual([['Kenya', 'KES'], ['Uganda', 'UGX']]);
    const kenya = files[0];
    expect(kenya.returns.find((r) => r.key === 'p10')!.file.rows).toHaveLength(kenyans.length);
    const uganda = files[1];
    expect(uganda.returns.map((r) => r.key)).toEqual(['ura-paye', 'nssf-ug', 'lst']);
    expect(uganda.returns[0].file.rows.map((r) => r[0])).toEqual(['1000123456', '1000123456']);
    expect(uganda.payments.map((p) => p.key)).toEqual(['bank-ugx', 'mobile-ugx']);
    expect(uganda.payments[1].file.rows.map((r) => r[0])).toEqual(['256772123456', '256772123456']);
    expect(paymentFilesFor('UGX', records, staff, '2026-10', '')[0].file.rows).toEqual([]);
  });
});
