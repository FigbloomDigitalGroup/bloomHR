import { describe, expect, it } from 'vitest';
import { TAX_DISCLAIMER, TAX_RULES, explainRule, findTaxRule, treatmentLabel } from './kenyaTaxTreatment';

const idFor = (name: string, kind: 'deduction' | 'earning' | 'benefit' = 'deduction') => findTaxRule(name, kind)?.id ?? null;

describe('findTaxRule', () => {
  it('matches common deduction names, ignoring case and punctuation', () => {
    expect(idFor('SACCO')).toBe('sacco');
    expect(idFor('Stima Sacco shares')).toBe('sacco');
    expect(idFor('HELB')).toBe('helb');
    expect(idFor('Union dues')).toBe('union_dues');
    expect(idFor('Staff welfare')).toBe('welfare');
    expect(idFor('Salary advance')).toBe('salary_advance');
    expect(idFor('Life insurance')).toBe('insurance');
    expect(idFor('Post-Retirement Medical Fund')).toBe('post_retirement_medical');
    expect(idFor('Pension (AVC)')).toBe('pension');
    expect(idFor('NSSF tier II')).toBe('nssf');
    expect(idFor('Housing Levy')).toBe('housing_levy');
    expect(idFor('SHIF')).toBe('shif');
  });

  it('puts the more specific rule first', () => {
    expect(idFor('SACCO loan')).toBe('loan_repayment');
    expect(idFor('Housing loan')).toBe('mortgage_interest');
    expect(idFor('Affordable housing levy', 'earning')).toBe('housing_levy');
  });

  it('respects the kind of item', () => {
    expect(idFor('Car benefit', 'benefit')).toBe('car_benefit');
    expect(idFor('House allowance', 'earning')).toBe('housing_benefit');
    expect(idFor('Sales commission', 'earning')).toBe('bonus_commission');
    expect(idFor('Performance bonus', 'earning')).toBe('bonus_commission');
    expect(idFor('Per diem', 'earning')).toBe('per_diem');
    expect(idFor('Medical cover', 'benefit')).toBe('employer_medical');
    expect(idFor('Medical cover', 'deduction')).toBe('insurance');
    expect(idFor('Bonus', 'deduction')).toBeNull();
  });

  it('returns null when nothing matches, or for too little text', () => {
    expect(idFor('Gym membership')).toBeNull();
    expect(idFor('')).toBeNull();
    expect(idFor('x')).toBeNull();
  });
});

describe('the rules', () => {
  const rule = (id: string) => TAX_RULES.find((r) => r.id === id)!;

  it('treat the key items as the law does', () => {
    expect(rule('sacco').treatment).toBe('not_taxable');
    expect(rule('loan_repayment').treatment).toBe('not_taxable');
    expect(rule('helb').treatment).toBe('not_taxable');
    expect(rule('pension').treatment).toBe('reduces_taxable_pay');
    expect(rule('insurance').treatment).toBe('relief');
    expect(rule('bonus_commission').treatment).toBe('taxable');
    expect(rule('per_diem').treatment).toBe('depends');
    expect(rule('employer_medical').treatment).toBe('depends');
  });

  it('every rule has an explanation, a legal basis and a treatment label', () => {
    for (const r of TAX_RULES) {
      expect(r.explanation.length).toBeGreaterThan(20);
      expect(r.legalBasis).toBeTruthy();
      expect(r.keywords.length).toBeGreaterThan(0);
      expect(treatmentLabel(r.treatment, 'deduction')).toBeTruthy();
    }
    expect(TAX_DISCLAIMER).toBe('A guide, not tax advice. Confirm with your tax adviser or KRA.');
  });

  it('fills in caps from the statutory rates, and says so when they are not loaded', () => {
    expect(explainRule(rule('pension'), { pension_deduction_cap: 30000 })).toContain('up to KSh 30,000 a month');
    expect(explainRule(rule('pension'))).toContain('the monthly limit in the statutory rates');
    const insurance = explainRule(rule('insurance'), { insurance_relief_rate: 0.15, insurance_relief_cap: 5000 });
    expect(insurance).toContain('15%');
    expect(insurance).toContain('KSh 5,000');
  });

  it('labels a non-taxed earning "Not taxable" and a deduction "Not tax-deductible"', () => {
    expect(treatmentLabel('not_taxable', 'deduction')).toBe('Not tax-deductible');
    expect(treatmentLabel('not_taxable', 'earning')).toBe('Not taxable');
  });
});
