import { describe, expect, it } from 'vitest';
import { CONTRIBUTION_KINDS, EMPTY_FORM, KIND_EFFECT, KIND_LABELS, canStop, formProblems, monthsText, periodOf, statusTone, taxNoteFor } from './contributions';

const form = (over: Partial<typeof EMPTY_FORM>) => ({ ...EMPTY_FORM, kind: 'sacco' as const, amount: '2000', start_period: '2026-10', ...over });

describe('contribution requests (FIG-898)', () => {
  it('every kind has a label and says how it reaches pay', () => {
    for (const k of CONTRIBUTION_KINDS) {
      expect(KIND_LABELS[k]).toBeTruthy();
      expect(KIND_EFFECT[k]).toBeTruthy();
    }
    expect(KIND_EFFECT.insurance_premium).toMatch(/Not taken from your pay/);
    expect(KIND_EFFECT.pension_avc).toMatch(/before PAYE/);
  });

  it('checks a request before it is sent', () => {
    expect(formProblems(form({}), '2026-10')).toEqual([]);
    expect(formProblems(form({ kind: '' }), '2026-10')).toEqual(['Choose what kind of contribution it is.']);
    expect(formProblems(form({ amount: '0' }), '2026-10')).toEqual(['Enter the amount a month (above 0).']);
    expect(formProblems(form({ amount: '1,500' }), '2026-10')).toEqual([]);
    expect(formProblems(form({ start_period: '2026-09' }), '2026-10')).toEqual(['It can’t start in a month that has passed.']);
    expect(formProblems(form({ start_period: '' }), '2026-10')).toEqual(['Choose the month it starts.']);
    expect(formProblems(form({ end_period: '2026-09' }), '2026-10')).toEqual(['The last month can’t be before the first.']);
    expect(formProblems(form({ kind: 'other' }), '2026-10')).toEqual(['Say who it is paid to.']);
    expect(formProblems(form({ kind: 'other', provider: 'Church' }), '2026-10')).toEqual([]);
  });

  it('describes the months', () => {
    expect(monthsText('2026-10', null)).toBe('From October 2026');
    expect(monthsText('2026-10', '2026-10')).toBe('October 2026 only');
    expect(monthsText('2026-10', '2027-03')).toBe('October 2026 to March 2027');
    expect(periodOf(new Date(2026, 0, 15))).toBe('2026-01');
  });

  it('a waiting or running one can be stopped; one past its last month cannot', () => {
    expect(canStop({ status: 'pending', end_period: null, next_payroll_period: '2026-11' })).toBe(true);
    expect(canStop({ status: 'active', end_period: null, next_payroll_period: '2026-11' })).toBe(true);
    expect(canStop({ status: 'active', end_period: '2026-10', next_payroll_period: '2026-11' })).toBe(false);
    expect(canStop({ status: 'declined', end_period: null, next_payroll_period: '2026-11' })).toBe(false);
    expect(statusTone('active')).toBe('success');
    expect(statusTone('pending')).toBe('warning');
  });

  it('explains the tax treatment from the cited rules, with the cap from the rates', () => {
    expect(taxNoteFor('pension_avc', { pension_deduction_cap: 30000 })).toContain('up to KSh 30,000 a month');
    expect(taxNoteFor('insurance_premium', { insurance_relief_rate: 0.15, insurance_relief_cap: 5000 })).toContain('15% of the premium');
    expect(taxNoteFor('sacco')).toMatch(/after tax/);
    expect(taxNoteFor('other')).toBe('');
  });
});
