import { describe, expect, it } from 'vitest';
import type { Branch } from '../branches';
import { calculateRun, countryReadiness, filesByCountry, totalsByCurrency } from './multiCountry';
import { KENYA_FIXTURES, KENYA_RATES, baseContext } from './countries/kenyaFixtures';
import golden from './countries/kenyaGolden.json';
import { TANZANIA_RATES } from './countries/tanzaniaFixtures';
import { UGANDA_RATES } from './countries/ugandaFixtures';
import { tanzaniaEngine, tanzaniaPhone } from './countries/tanzania';
import { ugandaEngine } from './countries/uganda';
import { fieldProblem, needsShaNumber, taxNumberLabel } from '../onboardingValidation';
import { TANZANIA_REGISTER_COLUMNS, UGANDA_REGISTER_COLUMNS, registerByCountry } from '../payrollPdf';

// FIG-905: one run with Kenya, Tanzania and Uganda staff. Each is worked out by their own country's engine in their own
// currency; Kenya's figures are exactly the golden ones; each country files its own returns and payment files; no total
// ever adds up two currencies. "Tax PIN" and "NSSF Number" hold each country's own numbers, checked by the shared rules.
// (That a piece rate payout never mixes currencies is the database's: supabase/tests/payout_currencies.test.ts.)

/* eslint-disable @typescript-eslint/no-explicit-any -- employee rows are untyped */
const branches: Branch[] = [
  { id: 'nbo', name: 'Nairobi', country: 'Kenya', currency: 'KES', city: null, address: null, active: true, is_default: true },
  { id: 'dar', name: 'Dar es Salaam', country: 'Tanzania', currency: 'TZS', city: null, address: null, active: true, is_default: false },
  { id: 'kla', name: 'Kampala', country: 'Uganda', currency: 'UGX', city: null, address: null, active: true, is_default: false },
];
const kenyan: Record<string, any> = { ...KENYA_FIXTURES[0].employee, branch_id: 'nbo' };
const tanzanian: Record<string, any> = {
  id: 'id-T1', 'Employee Number': 'T1', 'First Name': 'Juma', 'Last Name': 'Mwita', 'Basic Salary': 1500000, branch_id: 'dar',
  'Tax PIN': '123-456-789', 'NSSF Number': '1002003004', payment_method: 'M-Pesa', 'Mobile Number': '0754 123 456', 'Payroll Number': 'TZP1',
};
const ugandan: Record<string, any> = {
  id: 'id-U1', 'Employee Number': 'U1', 'First Name': 'Akello', 'Last Name': 'Grace', 'Basic Salary': 1500000, branch_id: 'kla',
  'Tax PIN': '1000123456', 'NSSF Number': 'NS1234567', payment_method: 'Mobile money', 'Mobile Number': '0772123456', 'Payroll Number': 'UGP1',
};
const staff = [kenyan, tanzanian, ugandan];
const rates = new Map([['Kenya', KENYA_RATES], ['Tanzania', TANZANIA_RATES], ['Uganda', UGANDA_RATES]]);
const { records, notCalculated } = calculateRun(staff, branches, (country) => ({ ...baseContext({ period: '2026-11' }), rates: rates.get(country)! }));
const byCountry = (c: string) => records.find((r) => r.country === c)!;

describe('one run with Kenya, Tanzania and Uganda staff', () => {
  it('works each person out with their own engine and currency', () => {
    expect(notCalculated).toEqual([]);
    expect(records.map((r) => [r.employee_id, r.country, r.currency])).toEqual([
      [kenyan['Employee Number'], 'Kenya', 'KES'], ['T1', 'Tanzania', 'TZS'], ['U1', 'Uganda', 'UGX'],
    ]);
    // Tanzania: NSSF 10%, PAYE on pay less NSSF (1,350,000), employer NSSF in the shared column
    expect(byCountry('Tanzania')).toMatchObject({ nssf_deduction: 150000, employer_nssf: 150000, taxable_pay: 1350000, paye_tax: 233000, tax_resident: true });
    // Uganda in November (no LST): NSSF 5% not deducted before PAYE; chargeable income in taxable_pay
    expect(byCountry('Uganda')).toMatchObject({ nssf_deduction: 75000, employer_nssf: 150000, taxable_pay: 1500000, paye_tax: 338250, lst_deduction: 0 });
    // no Kenyan lines on the others, no other country's columns on Kenya's
    for (const c of ['Tanzania', 'Uganda']) expect(byCountry(c)).toMatchObject({ nhif_deduction: 0, housing_levy: 0 });
    expect(byCountry('Kenya').employer_nssf).toBeUndefined();
  });

  it('leaves Kenya’s figures exactly as before', () => {
    const { country: _c, currency: _cur, ...kenyaRecord } = byCountry('Kenya');
    const before = calculateRun([kenyan], branches, () => ({ ...baseContext(), rates: KENYA_RATES })).records[0];
    const { country: _c2, currency: _cur2, ...kenyaAlone } = before;
    expect(JSON.parse(JSON.stringify(kenyaAlone))).toEqual((golden as Record<string, unknown>)[KENYA_FIXTURES[0].name]);
    // the same person in a three-country run: only the period differs
    expect({ ...JSON.parse(JSON.stringify(kenyaRecord)), pay_period: kenyaAlone.pay_period }).toEqual(JSON.parse(JSON.stringify(kenyaAlone)));
  });

  it('adds up each currency on its own, never across them', () => {
    expect(totalsByCurrency(records).map((t) => [t.currency, t.count])).toEqual([['KES', 1], ['TZS', 1], ['UGX', 1]]);
  });

  it('is ready to approve country by country', () => {
    const r = countryReadiness({ employees: staff, branches, payslips: records, runCountries: [], runStarted: true, ratesByCountry: rates });
    expect(r.map((x) => [x.country, x.state])).toEqual([['Kenya', 'ready'], ['Tanzania', 'ready'], ['Uganda', 'ready']]);
  });

  it('files each country’s returns and payments from its own payslips, in its own currency', () => {
    const files = filesByCountry({
      payslips: records, employees: staff,
      runCountries: ['Kenya', 'Tanzania', 'Uganda'].map((country) => ({ country, status: 'approved' as const })),
      ratesByCountry: rates, payPeriod: '2026-11', debitAccount: '0123456789',
    });
    expect(files.map((f) => [f.country, f.currency])).toEqual([['Kenya', 'KES'], ['Tanzania', 'TZS'], ['Uganda', 'UGX']]);
    const [ke, tz, ug] = files;
    expect(ke.returns.find((r) => r.key === 'p10')!.file.rows).toHaveLength(1);
    expect(tz.returns.map((r) => r.key)).toEqual(['tra-paye', 'tz-nssf', 'wcf']);
    expect(ug.returns.map((r) => r.key)).toEqual(['ura-paye', 'nssf-ug']);
    // the TIN and NSSF number come from "Tax PIN" and "NSSF Number"; nobody in Tanzania or Uganda is flagged
    expect(tz.returns[0].file.rows[0]).toEqual(expect.arrayContaining(['Juma Mwita', '123456789']));
    expect(tz.returns[1].file.rows[0][1]).toBe('1002003004');
    expect(ug.returns[0].file.rows[0][0]).toBe('1000123456');
    for (const f of files.slice(1)) for (const r of f.returns) expect(r.file.problems).toEqual([]);
    // payment files: each in its currency, mobile money numbers in each country's format
    expect(ke.payments.map((p) => p.key)).toEqual(['mpesa', 'bank', 'equity']);
    expect(tz.payments.map((p) => p.key)).toEqual(['bank-tzs', 'mobile-tzs']);
    expect(ug.payments.map((p) => p.key)).toEqual(['bank-ugx', 'mobile-ugx']);
    const tzMobile = tz.payments[1].file;
    expect(tzMobile.rows).toEqual([['255754123456', 'Juma Mwita', String(byCountry('Tanzania').net_pay), 'Salary 2026-11', 'TZP1']]);
    expect(ug.payments[1].file.rows[0][0]).toBe('256772123456');
    // nobody is paid in a file of another currency
    expect(tz.payments.flatMap((p) => p.file.rows).some((row) => row.includes('Akello Grace'))).toBe(false);
  });
});

describe('the register', () => {
  it("gives each country its own columns and subtotal, in its own currency", () => {
    const groups = registerByCountry(records as never);
    expect(groups.map((g) => [g.country, g.currency])).toEqual([['Kenya', 'KES'], ['Tanzania', 'TZS'], ['Uganda', 'UGX']]);
    expect(groups[1].columns).toBe(TANZANIA_REGISTER_COLUMNS);
    expect(groups[2].columns).toBe(UGANDA_REGISTER_COLUMNS);
    const tz = groups[1];
    const at = (col: string) => tz.lines[0].amounts[TANZANIA_REGISTER_COLUMNS.indexOf(col as never) - 3];
    const t = byCountry('Tanzania');
    expect([at('Gross pay'), at('PAYE'), at('NSSF'), at('Net pay'), at('NSSF (employer)'), at('WCF (employer)')]).toEqual([
      t.gross_pay, t.paye_tax, t.nssf_deduction, t.net_pay, t.employer_nssf, t.wcf_levy,
    ]);
  });
});

describe("each country's tax and NSSF numbers, one set of rules", () => {
  it('names and checks the number for the country', () => {
    expect([taxNumberLabel('Kenya'), taxNumberLabel('Tanzania'), taxNumberLabel('Uganda'), taxNumberLabel('Rwanda')]).toEqual(['KRA PIN', 'TIN', 'TIN', 'KRA PIN']);
    expect([needsShaNumber('Kenya'), needsShaNumber('Tanzania'), needsShaNumber('Uganda')]).toEqual([true, false, false]);
    expect(fieldProblem('Tax PIN', '123-456-789', {}, 'Tanzania')).toBeNull();
    expect(fieldProblem('Tax PIN', '1000123456', {}, 'Tanzania')).toBe('TIN should be 9 digits, like 123-456-789');
    expect(fieldProblem('Tax PIN', '123456789', {}, 'Uganda')).toBe('TIN should be 10 digits');
    expect(fieldProblem('Tax PIN', '123456789', {}, 'Kenya')).toBe('KRA PIN should look like A123456789B');
    expect(fieldProblem('NSSF Number', '1002003004', {}, 'Tanzania')).toBeNull();
    expect(fieldProblem('NSSF Number', 'N1', {}, 'Tanzania')).toBe('NSSF number should be 6 to 15 letters and digits');
    expect(fieldProblem('ID Number', '19900101-12345-00001-12', { 'Type of Identification': 'National ID' }, 'Tanzania')).toBeNull();
    expect(fieldProblem('ID Number', '12345678', { 'Type of Identification': 'National ID' }, 'Tanzania')).toBe('A NIDA number is 20 digits');
  });

  it("flags another country's number on payroll: a KRA PIN in Tanzania, a TRA TIN in Uganda", () => {
    expect(tanzaniaEngine.validate({ ...tanzanian, 'Tax PIN': 'A012345678Z' }).map((p) => p.problem)).toEqual(['TIN (9 digits)']);
    expect(ugandaEngine.validate({ ...ugandan, 'Tax PIN': '123456789' }).map((p) => p.problem)).toEqual(['TIN (not valid)']);
  });

  it('takes Tanzanian mobile money numbers as 255…', () => {
    expect([tanzaniaPhone('0754123456'), tanzaniaPhone('+255 654 123 456'), tanzaniaPhone('754123456'), tanzaniaPhone('0712')]).toEqual([
      '255754123456', '255654123456', '255754123456', '',
    ]);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
