import { describe, expect, it } from 'vitest';
import { missingRates, statutoryFor, taxByBands } from './statutoryCalc';

// The rates seeded in statutory_rates for October 2026
const rates = {
  paye_bands: [{ upto: 24000, rate: 0.1 }, { upto: 32333, rate: 0.25 }, { upto: 500000, rate: 0.3 }, { upto: 800000, rate: 0.325 }, { upto: null, rate: 0.35 }],
  personal_relief: 2400, insurance_relief_rate: 0.15, insurance_relief_cap: 5000, pension_deduction_cap: 30000,
  prmf_deduction_cap: 15000, mortgage_interest_cap: 30000, non_cash_benefit_exempt_limit: 5000, meals_exempt_limit: 5000,
  pwd_exempt_income: 150000, shif_deductible: 1, ahl_deductible: 1, shif_rate: 0.0275, shif_minimum: 300, ahl_rate: 0.015,
  nssf_rate: 0.06, nssf_lower_limit: 9000, nssf_upper_limit: 108000,
};

describe('matches finance’s September 2026 PAYE file', () => {
  // cash pay, SHIF, AHL and PAYE as filed (NSSF differs by a cent in finance's spreadsheet rounding)
  it.each([
    ['Ian Duncan', 65870.76, 1811.45, 988.06, 10119.05],
    ['Mark Mutesa', 29712.15, 817.08, 445.68, 666.67],
    ['Ruth Kibet', 32607.15, 896.7, 489.11, 1316.24],
    ['Fidel Masitsa', 34540.46, 949.86, 518.11, 1750.03],
    ['Morris Maina', 43986.38, 1209.63, 659.8, 4226.7],
    ['Victor Ogola', 25348.17, 697.07, 380.22, 0],
  ])('%s', (_name, cash, shif, ahl, paye) => {
    const r = statutoryFor({ cashPay: cash }, rates);
    expect(r.shif).toBeCloseTo(shif, 1);
    expect(r.ahl).toBeCloseTo(ahl, 1);
    expect(r.paye).toBeCloseTo(paye, 1);
    expect(r.personalRelief).toBe(2400);
  });
});

describe('statutoryFor', () => {
  it('NSSF stops at the upper earnings limit', () => {
    expect(statutoryFor({ cashPay: 200000 }, rates).nssf).toBe(6480);
    expect(statutoryFor({ cashPay: 50000 }, rates).nssf).toBe(3000);
  });

  it('SHIF is never below its minimum', () => {
    expect(statutoryFor({ cashPay: 8000 }, rates).shif).toBe(300);
    expect(statutoryFor({ cashPay: 0 }, rates).shif).toBe(0);
  });

  it('takes pension, PRMF and mortgage interest off taxable pay, each up to its cap', () => {
    const base = statutoryFor({ cashPay: 200000 }, rates);
    const r = statutoryFor({ cashPay: 200000, pension: 40000, prmf: 5000, mortgageInterest: 20000 }, rates);
    expect([r.pension, r.prmf, r.mortgageInterest]).toEqual([30000, 5000, 20000]);
    expect(r.taxablePay).toBeCloseTo(base.taxablePay - 55000, 2);
    expect(r.paye).toBeLessThan(base.paye);
  });

  it('gives insurance relief of 15% of premiums, up to its cap', () => {
    expect(statutoryFor({ cashPay: 100000, insurancePremium: 10000 }, rates).insuranceRelief).toBe(1500);
    expect(statutoryFor({ cashPay: 100000, insurancePremium: 50000 }, rates).insuranceRelief).toBe(5000);
    const base = statutoryFor({ cashPay: 100000 }, rates).paye;
    expect(statutoryFor({ cashPay: 100000, insurancePremium: 10000 }, rates).paye).toBeCloseTo(base - 1500, 2);
  });

  it('taxes non-cash benefits above their exempt limits, and car, housing and other benefits in full', () => {
    expect(statutoryFor({ cashPay: 100000, benefits: { nonCash: 4000, meals: 6000 } }, rates).taxableBenefits).toBe(1000);
    expect(statutoryFor({ cashPay: 100000, benefits: { nonCash: 6000, car: 5000, housing: 10000 } }, rates).taxableBenefits).toBe(21000);
  });

  it('exempts a person with a disability’s income up to the limit', () => {
    expect(statutoryFor({ cashPay: 120000, isPwd: true }, rates).paye).toBe(0);
    const r = statutoryFor({ cashPay: 250000, isPwd: true }, rates);
    expect(r.pwdExemption).toBe(150000);
    expect(r.paye).toBeGreaterThan(0);
  });

  it('leaves out what does not apply, and SHIF and AHL are not deducted in months they were not deductible', () => {
    const r = statutoryFor({ cashPay: 50000, apply: { shif: false, paye: false } }, rates);
    expect([r.shif, r.paye]).toEqual([0, 0]);
    const before = statutoryFor({ cashPay: 50000 }, { ...rates, shif_deductible: 0, ahl_deductible: 0 });
    expect(before.taxablePay).toBeCloseTo(50000 - 3000, 2);
  });

  it('uses the bands in force', () => {
    expect(taxByBands(24000, rates.paye_bands)).toBe(2400);
    expect(taxByBands(32333, rates.paye_bands)).toBe(4483.25);
    expect(taxByBands(1000000, rates.paye_bands)).toBeCloseTo(2400 + 2083.25 + 140300.1 + 97500 + 70000, 2);
  });

  it('names rates a month is missing', () => {
    expect(missingRates(rates)).toEqual([]);
    expect(missingRates({ ...rates, nssf_rate: null, paye_bands: undefined })).toEqual(['paye_bands', 'nssf_rate']);
  });
});
