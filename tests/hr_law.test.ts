// @vitest-environment node
//
// The cited HR law the AI assistants are given (hr_law.js): every entry has a source and a date, and a question gets
// the entries for its topics in the right countries.
import { describe, expect, it } from 'vitest';
import { HR_LAW, HR_LAW_RULES, countriesIn, hrLawPrompt, lawCountry, selectHrLaw, topicsIn } from '../hr_law.js';

describe('the knowledge itself', () => {
  it('cites a source and a checked date for every rule, in a known country', () => {
    for (const e of HR_LAW) {
      expect(['Kenya', 'Tanzania', 'Uganda', 'General']).toContain(e.country);
      expect(e.rule.length).toBeGreaterThan(20);
      expect(e.source).toMatch(/Act|Convention|Rules|Order|Declaration/);
      expect(e.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('covers the essentials in each country', () => {
    const has = (country: string, topic: string) => HR_LAW.some((e) => e.country === country && e.topic === topic);
    for (const topic of ['contracts', 'probation', 'annual_leave', 'maternity', 'paternity', 'sick_leave', 'notice', 'termination', 'redundancy', 'severance', 'deductions', 'pension', 'paye', 'minimum_wage']) {
      expect(has('Kenya', topic), `Kenya ${topic}`).toBe(true);
      expect(has('Tanzania', topic), `Tanzania ${topic}`).toBe(true);
      expect(has('Uganda', topic), `Uganda ${topic}`).toBe(true);
    }
    for (const topic of ['casuals', 'health_insurance', 'housing_levy', 'work_injury', 'safety', 'unions']) expect(has('Kenya', topic), topic).toBe(true);
    expect(has('Tanzania', 'skills_levy')).toBe(true);
    expect(has('Uganda', 'local_service_tax')).toBe(true);
  });

  it('labels the General entries as good practice, not a country law', () => {
    for (const e of HR_LAW.filter((x) => x.country === 'General')) expect(e.rule).toMatch(/good practice/i);
  });

  it('does not hard-code the rates that change: those point to the statutory rates', () => {
    for (const e of HR_LAW.filter((x) => ['pension', 'health_insurance', 'housing_levy', 'paye', 'skills_levy', 'local_service_tax'].includes(x.topic))) {
      expect(e.rule, `${e.country} ${e.topic}`).toMatch(/statutory rates/);
      expect(e.rule, `${e.country} ${e.topic}`).not.toMatch(/\d+(\.\d+)?\s?%/);
    }
  });
});

describe('choosing the entries for a question', () => {
  it('finds topics and countries in the words used', () => {
    expect(topicsIn('Can we fire someone on probation?')).toEqual(expect.arrayContaining(['probation', 'termination']));
    expect(topicsIn('Who has a birthday this week?')).toEqual([]);
    expect(countriesIn('Our Kampala office')).toEqual(['Uganda']);
    expect(countriesIn('staff in Dar es Salaam and Nairobi')).toEqual(['Kenya', 'Tanzania']);
    expect(countriesIn('we are opening in Rwanda')).toEqual(['General']);
    expect(lawCountry('tanzania')).toBe('Tanzania');
    expect(lawCountry('Ethiopia')).toBe('General');
    expect(lawCountry('')).toBeNull();
  });

  it('gives nothing for a question that is not about the law', () => {
    expect(selectHrLaw({ text: 'Who has a birthday this week?', countries: ['Kenya'] }).entries).toEqual([]);
  });

  it('uses the country named in the question over the company countries', () => {
    const picked = selectHrLaw({ text: 'How long is maternity leave in Tanzania?', countries: ['Kenya'] });
    expect(picked.countries).toEqual(['Tanzania']);
    expect(picked.entries.every((e) => e.country === 'Tanzania')).toBe(true);
    expect(picked.entries.some((e) => e.source.includes('s.33'))).toBe(true);
  });

  it("uses the company's countries, else Kenya", () => {
    const both = selectHrLaw({ text: 'What notice must we give?', countries: ['Kenya', 'Uganda'] });
    expect(both.entries.map((e) => e.country)).toEqual(expect.arrayContaining(['Kenya', 'Uganda']));
    expect(both.entries.some((e) => e.country === 'Tanzania')).toBe(false);
    expect(selectHrLaw({ text: 'What notice must we give?' }).countries).toEqual(['Kenya']);
  });

  it('gives General good practice for a country without its own entries', () => {
    const picked = selectHrLaw({ text: 'maternity leave', countries: ['Rwanda'] });
    expect(picked.countries).toEqual(['General']);
    expect(picked.entries.map((e) => e.topic)).toEqual(expect.arrayContaining(['core', 'maternity']));
  });

  it('keeps the prompt bounded', () => {
    const picked = selectHrLaw({ text: 'leave, notice, termination, redundancy, deductions, NSSF, PAYE, probation, contract, sick, maternity', countries: ['Kenya', 'Tanzania', 'Uganda'] });
    expect(picked.entries.length).toBeLessThanOrEqual(16);
  });
});

describe('the prompt', () => {
  it('always carries the rules for answering, and says when nothing was found', () => {
    expect(hrLawPrompt([])).toContain(HR_LAW_RULES);
    expect(hrLawPrompt([])).toContain('none found');
  });

  it('lists each rule with its country, date and source, and the rates given', () => {
    const { entries } = selectHrLaw({ text: 'paternity leave', countries: ['Kenya'] });
    const text = hrLawPrompt(entries, [{ country: 'Kenya', code: 'shif_rate', text: '0.0275', effective_from: '2024-10-01', source: 'SHI Act' }]);
    expect(text).toContain('[Kenya; paternity; checked');
    expect(text).toContain('Source: Employment Act 2007, s.29(8)');
    expect(text).toContain('Kenya shif_rate: 0.0275 (from 2024-10-01; SHI Act)');
  });
});
