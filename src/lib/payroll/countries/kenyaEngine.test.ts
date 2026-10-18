import { describe, expect, it } from 'vitest';
import { applyPayslipOverride, statutoryContextFor } from '../../payslipOverrides';
import { KENYA_FIXTURES, KENYA_RATES, baseContext } from './kenyaFixtures';
import golden from './kenyaGolden.json';
import { engineFor, kenyaEngine, supportedCountries, tanzaniaEngine, tidyCountry, ugandaEngine, waitingLabel } from '.';

// FIG-905 stage 2: Kenya's calculation moved behind the country engine without a single number changing.
// kenyaGolden.json was written by lib/payslipCalc before the move, for every fixture in kenyaFixtures.ts.

const strip = (r: Record<string, unknown>) => {
  const { country: _country, currency: _currency, ...rest } = r;
  return JSON.parse(JSON.stringify(rest));
};

describe('Kenya engine: identical numbers before and after (regression)', () => {
  it('covers the whole fixture set', () => {
    expect(Object.keys(golden).sort()).toEqual(KENYA_FIXTURES.map((f) => f.name).sort());
    expect(KENYA_FIXTURES.length).toBeGreaterThanOrEqual(20);
  });

  for (const f of KENYA_FIXTURES) {
    it(f.name, () => {
      const ctx = baseContext(f.ctx);
      const result = kenyaEngine.calculate({ employee: f.employee, ctx });
      let record = result.record;
      if (f.override) {
        record = applyPayslipOverride(record, f.override, statutoryContextFor(f.employee, ctx.rates, ctx.overrideStatutoryChecks, ctx.deductionCap !== false));
      }
      expect(strip(record)).toEqual((golden as Record<string, unknown>)[f.name]);
      expect(result.record.country).toBe('Kenya');
      expect(result.record.currency).toBe('KES');
    });
  }
});

describe('Kenya engine interface', () => {
  const salaried = KENYA_FIXTURES[0];
  it('labels earnings, statutory deductions and employer costs, with taxable pay, tax and net', () => {
    const r = kenyaEngine.calculate({ employee: salaried.employee, ctx: baseContext() });
    expect(r.country).toBe('Kenya');
    expect(r.currency).toBe('KES');
    expect(r.statutoryDeductions.map((l) => l.label)).toEqual(['PAYE', 'NSSF', 'SHIF', 'Housing levy']);
    expect(r.employerCosts.map((l) => l.label)).toEqual(['NSSF (employer)', 'Housing levy (employer)', 'NITA levy']);
    expect(r.employerCosts[0].amount).toBe(r.record.nssf_deduction);
    expect(r.tax).toBe(r.record.paye_tax);
    expect(r.netPay).toBe(r.record.net_pay);
    expect(r.grossPay).toBe(97000);
    expect(r.earnings.find((l) => l.label === 'House allowance')?.amount).toBe(10000);
  });

  it('a contractor shows withholding tax, not PAYE', () => {
    const f = KENYA_FIXTURES.find((x) => x.name === 'contractor on a salary with WHT')!;
    const r = kenyaEngine.calculate({ employee: f.employee, ctx: baseContext() });
    expect(r.statutoryDeductions).toEqual([{ label: 'Withholding tax', amount: 3600 }]);
    expect(r.tax).toBe(3600);
  });

  it("lists Kenya's returns: P10, SHA, NSSF, housing levy, NITA and the WHT return", () => {
    expect(kenyaEngine.returns().map((r) => r.key)).toEqual(['p10', 'sha', 'nssf', 'ahl', 'nita', 'wht']);
    expect(kenyaEngine.returns().find((r) => r.key === 'wht')?.optional).toBe(true);
  });

  it('the housing levy schedule has both shares', () => {
    const ahl = kenyaEngine.returns().find((r) => r.key === 'ahl')!;
    const f = ahl.build([{ employee_id: 'E1', gross_pay: 50000, housing_levy: 750 }], [{ 'Employee Number': 'E1', 'First Name': 'A', 'Last Name': 'B' }], { payPeriod: '2026-10', rates: KENYA_RATES });
    expect(f.rows).toEqual([['E1', 'A B', '', '', '50000.00', '750.00', '750.00', '1500.00']]);
  });

  it('validates the KRA PIN, NSSF and SHA numbers and payment details, as warnings', () => {
    const problems = kenyaEngine.validate({ 'Employee Number': 'E9', 'First Name': 'Zed', payment_method: 'bank' });
    expect(problems.map((p) => p.problem)).toEqual(expect.arrayContaining(['KRA PIN', 'NSSF number', 'SHA number', 'Bank', 'Account number']));
    expect(problems.every((p) => !p.blocking && p.employeeNumber === 'E9' && p.name === 'Zed')).toBe(true);
    // a contractor files no NSSF or SHA
    const c = kenyaEngine.validate({ 'Employee Number': 'C1', worker_kind: 'contractor', payment_method: 'cash' });
    expect(c.map((p) => p.problem)).toEqual(['KRA PIN']);
  });
});

describe('the registry', () => {
  it('has Kenya, Tanzania and Uganda, and nothing for countries without rules yet', () => {
    expect(engineFor('Kenya')).toBe(kenyaEngine);
    expect(engineFor(' kenya ')).toBe(kenyaEngine);
    expect(engineFor('Tanzania')).toBe(tanzaniaEngine);
    expect(engineFor('Uganda')).toBe(ugandaEngine);
    expect(engineFor('Rwanda')).toBeNull();
    expect(engineFor('')).toBeNull();
    expect(supportedCountries()).toEqual(['Kenya', 'Tanzania', 'Uganda']);
  });

  it('says who is waiting for which rules', () => {
    expect(waitingLabel('tanzania')).toBe('Waiting for Tanzania payroll rules');
    expect(tidyCountry(' UGANDA ')).toBe('Uganda');
    expect(tidyCountry('Burundi')).toBe('Burundi');
  });
});
