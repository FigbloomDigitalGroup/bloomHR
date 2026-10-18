import { describe, expect, it } from 'vitest';
import { applyPayslipOverride } from '../../payslipOverrides';
import { taxByBands, bandsOf } from '../../statutoryCalc';
import type { Branch } from '../../branches';
import { calculateRun, filesByCountry } from '../multiCountry';
import { KENYA_FIXTURES, KENYA_RATES, baseContext } from './kenyaFixtures';
import golden from './kenyaGolden.json';
import { TANZANIA_RATES } from './tanzaniaFixtures';
import {
  HESLB_HEADERS,
  SDL_HEADERS,
  TRA_PAYE_HEADERS,
  TZ_NSSF_HEADERS,
  TZ_WHT_HEADERS,
  WCF_HEADERS,
  isValidTin,
  sdlApplies,
  tanzaniaEditContext,
  tanzaniaEngine,
  tanzaniaRemittance,
  tanzaniaStatutory,
} from './tanzania';

// FIG-905 stage 3: Tanzania's payroll. Every expected figure below is worked out by hand from the official monthly
// bands (TRA: up to 270,000 nil; 8% to 520,000; 20% to 760,000; 25% to 1,000,000; 30% above) and rates (NSSF 10% + 10%,
// SDL 3.5%, WCF 0.5%, HESLB 15% of basic, non-resident 15%).

/* eslint-disable @typescript-eslint/no-explicit-any -- employee rows are untyped */
const tz = (number: string, extra: Record<string, any> = {}): Record<string, any> => ({
  id: `id-${number}`,
  'Employee Number': number,
  'First Name': `Juma${number}`,
  'Last Name': 'Mwita',
  'Basic Salary': 1500000,
  // "Tax PIN" and "NSSF Number" hold the numbers of the employee's country: a TRA TIN and an NSSF Tanzania number
  'Tax PIN': '123-456-789',
  'NSSF Number': '1002003004',
  payment_method: 'Bank Transfer',
  Bank: 'CRDB',
  'Account Number': '0150000000',
  ...extra,
});
const ctx = (over: Record<string, any> = {}) => baseContext({ rates: TANZANIA_RATES, countryHeadcount: 12, ...over });
const calc = (e: Record<string, any>, over: Record<string, any> = {}) => tanzaniaEngine.calculate({ employee: e, ctx: ctx(over) });

describe('PAYE: the resident monthly bands', () => {
  const bands = bandsOf(TANZANIA_RATES);
  it.each([
    [0, 0],
    [270000, 0], // top of the nil band
    [300000, 2400], // 8% of 30,000
    [520000, 20000], // 8% of 250,000
    [760000, 68000], // 20,000 + 20% of 240,000
    [1000000, 128000], // 68,000 + 25% of 240,000
    [1350000, 233000], // 128,000 + 30% of 350,000
  ])('taxable %i -> PAYE %i', (taxable, paye) => {
    expect(taxByBands(taxable, bands)).toBe(paye);
  });
});

describe('a worked payslip: gross TZS 1,500,000, resident', () => {
  const r = calc(tz('TZ-001'));
  it('takes NSSF 10% before PAYE and works out PAYE on what is left', () => {
    // NSSF 1,500,000 x 10% = 150,000; taxable 1,350,000; PAYE 128,000 + 30% x 350,000 = 233,000
    expect(r.record.gross_pay).toBe(1500000);
    expect(r.record.nssf_deduction).toBe(150000);
    expect(r.record.taxable_pay).toBe(1350000);
    expect(r.record.paye_tax).toBe(233000);
    // net 1,500,000 - 150,000 - 233,000
    expect(r.record.total_deductions).toBe(383000);
    expect(r.record.net_pay).toBe(1117000);
  });
  it('shows the employer costs apart: NSSF 150,000, SDL 3.5% = 52,500, WCF 0.5% = 7,500', () => {
    expect(r.employerCosts).toEqual([
      { label: 'NSSF (employer)', amount: 150000 },
      { label: 'SDL (skills levy)', amount: 52500 },
      { label: 'WCF (workers compensation)', amount: 7500 },
    ]);
    expect(r.statutoryDeductions).toEqual([{ label: 'PAYE', amount: 233000 }, { label: 'NSSF (10%)', amount: 150000 }]);
  });
  it('is in TZS with none of Kenya’s lines', () => {
    expect([r.country, r.currency, r.record.country, r.record.currency]).toEqual(['Tanzania', 'TZS', 'Tanzania', 'TZS']);
    expect([r.record.nhif_deduction, r.record.housing_levy, r.record.per_diem, r.record.tax_relief, r.record.nita_levy]).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('the other rules', () => {
  it('NSSF is deductible: without it PAYE would be on the full gross', () => {
    const noDeduction = tanzaniaStatutory(
      { taxablePay: 1500000, pensionablePay: 1500000, grossPay: 1500000, basicPay: 1500000, resident: true, heslb: false, sdl: true },
      { ...TANZANIA_RATES, nssf_deductible: 0 }
    );
    // 128,000 + 30% x 500,000 = 278,000
    expect(noDeduction.paye).toBe(278000);
    expect(noDeduction.taxablePay).toBe(1500000);
  });

  it('SDL applies from 10 people in Tanzania (a setting), and not below', () => {
    expect(sdlApplies(10, TANZANIA_RATES)).toBe(true);
    expect(sdlApplies(9, TANZANIA_RATES)).toBe(false);
    expect(sdlApplies(undefined, TANZANIA_RATES)).toBe(true);
    expect(sdlApplies(3, { ...TANZANIA_RATES, sdl_min_employees: 0 })).toBe(true);
    expect(calc(tz('TZ-001'), { countryHeadcount: 9 }).record.sdl_levy).toBe(0);
    expect(calc(tz('TZ-001'), { countryHeadcount: 10 }).record.sdl_levy).toBe(52500);
  });

  it('WCF is 0.5% of basic and fixed allowances, not overtime or one-off earnings', () => {
    const e = tz('KE-007', { 'Basic Salary': 800000, house_allowance: 200000 });
    const r = calc(e);
    // KE-007's earnings in the fixtures (commission 12,000, bonus 8,000, meals 2,500) are in gross and SDL, not WCF
    expect(r.record.gross_pay).toBe(1022500);
    expect(r.record.wcf_levy).toBe(5000);
    expect(r.record.sdl_levy).toBe(35788); // 3.5% x 1,022,500 = 35,787.5
  });

  it('HESLB: 15% of basic for a borrower, after tax', () => {
    const r = calc(tz('TZ-002', { heslb_borrower: true, heslb_index_number: 'S0101/0001/2010' }));
    expect(r.record.heslb_deduction).toBe(225000);
    expect(r.record.paye_tax).toBe(233000); // unchanged: not deductible
    expect(r.record.net_pay).toBe(1117000 - 225000);
    expect(r.statutoryDeductions.map((l) => l.label)).toContain('HESLB loan repayment');
    expect(calc(tz('TZ-003')).record.heslb_deduction).toBe(0);
  });

  it('a non-resident pays a flat 15% of gross employment income', () => {
    const r = calc(tz('TZ-004', { kra_residency: 'Non-Resident' }));
    expect(r.record.paye_tax).toBe(225000);
    expect(r.record.taxable_pay).toBe(1500000);
    expect(r.record.tax_resident).toBe(false);
    expect(r.statutoryDeductions[0].label).toBe('PAYE (non-resident, flat)');
  });

  it('a secondary employment pays a flat 30% on pay less NSSF', () => {
    expect(calc(tz('TZ-005', { secondary_employment: true })).record.paye_tax).toBe(405000);
  });

  it('a contractor pays withholding tax (5% resident, 15% non-resident) and no NSSF, SDL or WCF', () => {
    const r = calc(tz('TZ-006', { worker_kind: 'contractor', 'Basic Salary': 1000000 }));
    expect([r.record.wht_tax, r.record.paye_tax, r.record.nssf_deduction, r.record.sdl_levy, r.record.wcf_levy]).toEqual([50000, 0, 0, 0, 0]);
    expect(calc(tz('TZ-007', { worker_kind: 'contractor', 'Basic Salary': 1000000, kra_residency: 'Non-Resident' })).record.wht_tax).toBe(150000);
  });

  it('rounds each statutory line to the whole shilling', () => {
    const r = calc(tz('TZ-008', { 'Basic Salary': 333333 }));
    // NSSF 33,333.3 -> 33,333; taxable 300,000; PAYE 2,400
    expect(r.record.nssf_deduction).toBe(33333);
    expect(r.record.paye_tax).toBe(2400);
    expect(r.record.wcf_levy).toBe(1667);
  });

  it('PAYE and NSSF are taken even with no TIN or NSSF number (listed as missing instead)', () => {
    const e = tz('TZ-009', { 'Tax PIN': '', 'NSSF Number': '', payment_method: 'bank', Bank: '' });
    expect(calc(e).record.paye_tax).toBe(233000);
    expect(tanzaniaEngine.validate(e).map((p) => p.problem)).toEqual(['TIN', 'NSSF number', 'Bank']);
    expect(tanzaniaEngine.validate(e).every((p) => !p.blocking)).toBe(true);
    expect(tanzaniaEngine.validate(tz('TZ-010', { 'Tax PIN': '12345' })).map((p) => p.problem)).toEqual(['TIN (9 digits)']);
    // a KRA PIN is not a TRA TIN
    expect(tanzaniaEngine.validate(tz('TZ-011', { 'Tax PIN': 'A012345678Z', 'NSSF Number': '12' })).map((p) => p.problem)).toEqual(['TIN (9 digits)', 'NSSF number (not valid)']);
    expect(isValidTin('123-456-789')).toBe(true);
    expect(isValidTin('1000123456')).toBe(false);
  });

  it('loans, advances and voluntary deductions are the shared ones', () => {
    // KE-008 in the fixtures: SACCO 3,000 + Welfare 500, a 5,000 loan instalment and a 7,000 advance
    const r = calc(tz('KE-008'));
    expect(r.record.other_deductions).toBe(3500);
    expect(r.record.loan_deduction).toBe(5000);
    expect(r.record.advance_deduction).toBe(7000);
    expect(r.record.net_pay).toBe(1117000 - 3500 - 5000 - 7000);
  });

  it('settles a month of piece rate work with the shared settlement maths, without Kenya’s cap', () => {
    // KE-009: work 42,000, paid 24,500 during the month, 1,200 arrears
    const r = calc(tz('KE-009', { 'Basic Salary': 0, pay_basis: 'work' }));
    expect(r.record.gross_pay).toBe(42000);
    expect(r.record.nssf_deduction).toBe(4200);
    expect(r.record.paye_tax).toBe(0);
    expect(r.record.work_settlement).toBe(true);
    // 42,000 - 4,200 NSSF - 24,500 paid - 1,200 arrears
    expect(r.record.net_pay).toBe(12100);
  });

  it('a hand edit is worked out again on Tanzania’s rules', () => {
    const e = tz('TZ-011');
    const base = calc(e).record;
    const edited = applyPayslipOverride(base, { fields: { basic_salary: 1000000 } }, tanzaniaEditContext(e, TANZANIA_RATES, 12));
    // NSSF 100,000; taxable 900,000; PAYE 68,000 + 25% x 140,000 = 103,000
    expect([edited.gross_pay, edited.nssf_deduction, edited.paye_tax, edited.sdl_levy, edited.wcf_levy]).toEqual([1000000, 100000, 103000, 35000, 5000]);
    expect(edited.net_pay).toBe(797000);
    expect(edited.housing_levy).toBe(0);
  });
});

describe('the returns', () => {
  const employees = [
    tz('TZ-001', { 'Payroll Number': 'P1', 'Job Title': 'Driver', heslb_borrower: true, heslb_index_number: 'S0101/0001/2010' }),
    tz('TZ-006', { worker_kind: 'contractor', 'Basic Salary': 1000000 }),
  ];
  const payslips = employees.map((e) => calc(e).record);
  const build = (key: string) => tanzaniaEngine.returns().find((r) => r.key === key)!.build(payslips, employees, { payPeriod: '2026-10', rates: TANZANIA_RATES });

  it('lists TRA PAYE, NSSF, SDL, WCF, HESLB and the WHT return', () => {
    expect(tanzaniaEngine.returns().map((r) => [r.key, r.authority])).toEqual([
      ['tra-paye', 'TRA'], ['tz-nssf', 'NSSF'], ['sdl', 'TRA'], ['wcf', 'WCF'], ['heslb', 'HESLB'], ['tz-wht', 'TRA'],
    ]);
  });

  it('TRA PAYE: TIN, name, gross, NSSF, taxable and PAYE', () => {
    const f = build('tra-paye');
    expect(f.headers).toEqual(TRA_PAYE_HEADERS);
    expect(f.rows).toEqual([
      ['1', 'JumaTZ-001 Mwita', '123456789', 'P1', 'Y', '1500000.00', '0.00', '1500000.00', '150000.00', '1350000.00', '233000.00'],
    ]);
  });

  it('NSSF: member number, names, gross, both shares', () => {
    const f = build('tz-nssf');
    expect(f.headers).toEqual(TZ_NSSF_HEADERS);
    expect(f.rows[0]).toEqual(['1', '1002003004', 'JumaTZ-001', '', 'Mwita', 'P1', '1500000.00', '150000.00', '150000.00', '300000.00']);
  });

  it('SDL, WCF and HESLB', () => {
    expect(build('sdl').headers).toEqual(SDL_HEADERS);
    expect(build('sdl').rows[0]).toEqual(['1', 'JumaTZ-001 Mwita', '123456789', 'P1', '1500000.00', '3.50', '52500.00']);
    expect(build('wcf').headers).toEqual(WCF_HEADERS);
    expect(build('wcf').rows[0]).toEqual(['1', 'JumaTZ-001', '', 'Mwita', 'P1', 'Driver', '1500000.00', '7500.00']);
    expect(build('heslb').headers).toEqual(HESLB_HEADERS);
    expect(build('heslb').rows[0]).toEqual(['1', 'S0101/0001/2010', 'JumaTZ-001 Mwita', 'P1', '1500000.00', '225000.00']);
  });

  it('contractors are on the WHT return only', () => {
    const f = build('tz-wht');
    expect(f.headers).toEqual(TZ_WHT_HEADERS);
    expect(f.rows).toEqual([['1', 'JumaTZ-006 Mwita', '123456789', 'TZ-006', '2026-10', 'Y', '1000000.00', '5.00', '50000.00']]);
    expect(build('tra-paye').rows.some((r) => r[2] === '123456789' && r[1].includes('TZ-006'))).toBe(false);
  });

  it('sums what is owed to each body', () => {
    expect(tanzaniaRemittance(payslips).map((r) => [r.label, r.amount])).toEqual([
      ['PAYE (TRA)', 233000 + 50000], ['NSSF', 300000], ['SDL (TRA)', 52500], ['WCF', 7500], ['HESLB', 225000],
    ]);
  });

  it('flags a missing TIN and NSSF number on the returns', () => {
    const missing = [tz('TZ-001', { 'Tax PIN': '', 'NSSF Number': '' })];
    const ps = missing.map((e) => calc(e).record);
    const r = (key: string) => tanzaniaEngine.returns().find((x) => x.key === key)!.build(ps, missing, { payPeriod: '2026-10', rates: TANZANIA_RATES });
    expect(r('tra-paye').problems[0].missing).toEqual(['TIN']);
    expect(r('tz-nssf').problems[0].missing).toEqual(['NSSF number']);
  });
});

describe('one run with a Kenya and a Tanzania employee', () => {
  const branches: Branch[] = [
    { id: 'nbo', name: 'Nairobi', country: 'Kenya', currency: 'KES', city: null, address: null, active: true, is_default: true } as Branch,
    { id: 'dar', name: 'Dar es Salaam', country: 'Tanzania', currency: 'TZS', city: null, address: null, active: true, is_default: false } as Branch,
  ];
  const kenyan: Record<string, any> = { ...KENYA_FIXTURES[0].employee, branch_id: 'nbo' };
  const tanzanian = tz('TZ-001', { branch_id: 'dar' });
  const rates = new Map([['Kenya', KENYA_RATES], ['Tanzania', TANZANIA_RATES]]);
  const { records, notCalculated } = calculateRun([kenyan, tanzanian], branches, (country) => ({ ...baseContext(), rates: rates.get(country)! }));

  it('works each out with their own engine and currency', () => {
    expect(notCalculated).toEqual([]);
    expect(records.map((r) => [r.employee_id, r.country, r.currency])).toEqual([[kenyan['Employee Number'], 'Kenya', 'KES'], ['TZ-001', 'Tanzania', 'TZS']]);
    // a run of 1 in Tanzania: under the SDL threshold
    expect(records[1].sdl_levy).toBe(0);
    expect(records[1].paye_tax).toBe(233000);
  });

  it('leaves Kenya’s figures exactly as before', () => {
    const { country: _c, currency: _cur, ...kenyaRecord } = records[0];
    expect(JSON.parse(JSON.stringify(kenyaRecord))).toEqual((golden as Record<string, unknown>)[KENYA_FIXTURES[0].name]);
  });

  it('files each country’s returns from its own payslips', () => {
    const files = filesByCountry({
      payslips: records, employees: [kenyan, tanzanian],
      runCountries: [{ country: 'Kenya', status: 'approved' }, { country: 'Tanzania', status: 'approved' }],
      ratesByCountry: rates, payPeriod: '2026-10', debitAccount: '',
    });
    expect(files.map((f) => [f.country, f.currency])).toEqual([['Kenya', 'KES'], ['Tanzania', 'TZS']]);
    const p10 = files[0].returns.find((r) => r.key === 'p10')!;
    expect(p10.file.rows).toHaveLength(1);
    const tra = files[1].returns.find((r) => r.key === 'tra-paye')!;
    expect(tra.file.rows.map((r) => r[1])).toEqual(['JumaTZ-001 Mwita']);
    expect(files[1].returns.map((r) => r.key)).not.toContain('p10');
    expect(files[1].payments.map((p) => p.key)).toEqual(['bank-tzs', 'mobile-tzs']);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
