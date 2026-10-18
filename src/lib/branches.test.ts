import { describe, expect, it } from 'vitest';
import { branchOf, currencyFor, headcountByBranch, paidWithKenyaRules, paidWithKenyaRulesByCountry, type Branch } from './branches';
import { holidaysForCountry, withCountryTags } from './upcoming';

const b = (id: string, name: string, country: string, is_default = false): Branch =>
  ({ id, name, country, currency: currencyFor(country), city: null, address: null, active: true, is_default });
const branches = [b('hq', 'Nairobi HQ', 'Kenya', true), b('dar', 'Dar es Salaam', 'Tanzania'), b('kla', 'Kampala', 'Uganda')];

describe('branches', () => {
  it('fills the currency from the country', () => {
    expect([currencyFor('Kenya'), currencyFor(' tanzania'), currencyFor('Uganda'), currencyFor('Rwanda'), currencyFor(null)])
      .toEqual(['KES', 'TZS', 'UGX', 'RWF', 'KES']);
  });

  it("finds an employee's branch by id, else by name, else the default", () => {
    expect(branchOf('kla', branches)?.name).toBe('Kampala');
    expect(branchOf({ branchName: ' dar es salaam ' }, branches)?.id).toBe('dar');
    expect(branchOf({ branchId: null, branchName: '' }, branches)?.id).toBe('hq');
    expect(branchOf(null, [])).toBeUndefined();
  });

  it('counts people per branch', () => {
    const n = headcountByBranch([{ branch: 'Kampala' }, { branch: '' }, { branch: 'kampala' }], branches);
    expect(Object.fromEntries(n)).toEqual({ kla: 2, hq: 1 });
  });

  it('flags staff outside Kenya as paid with Kenya rules for now', () => {
    expect(paidWithKenyaRules('Kenya')).toBe(false);
    expect(paidWithKenyaRules('Tanzania')).toBe(true);
    const byCountry = paidWithKenyaRulesByCountry(
      [
        { 'Employee Number': 'E1', branch_id: 'dar' },
        { 'Employee Number': 'E2', Branch: 'Kampala' },
        { 'Employee Number': 'E3' },
        { 'Employee Number': 'E4', branch_id: 'dar' },
      ],
      branches
    );
    expect(Object.fromEntries(byCountry)).toEqual({ Tanzania: ['E1', 'E4'], Uganda: ['E2'] });
  });
});

describe('holidays by country', () => {
  const holidays = [
    { name: 'Company day', date: '2026-12-10' },
    { name: 'Jamhuri Day', date: '2026-12-12', country: 'Kenya' },
    { name: 'Independence Day', date: '2026-12-09', country: 'Tanzania' },
  ];

  it("shows staff their own country's holidays and the company-wide ones", () => {
    expect(holidaysForCountry(holidays, 'tanzania').map((h) => h.name)).toEqual(['Company day', 'Independence Day']);
    expect(holidaysForCountry(holidays, null)).toHaveLength(3);
  });

  it('tags each holiday with its country when there are several countries', () => {
    expect(withCountryTags(holidays).map((h) => h.name)).toEqual(['Company day', 'Jamhuri Day (Kenya)', 'Independence Day (Tanzania)']);
    expect(withCountryTags(holidays.slice(0, 2)).map((h) => h.name)).toEqual(['Company day', 'Jamhuri Day']);
  });
});
