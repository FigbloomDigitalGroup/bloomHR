import { describe, expect, it } from 'vitest';
import { addDaysToKey, caseDeadlines, coverState, daysBetween, daysOffWork, estimateCompensation, nextDeadline } from './workInjury';
import { WORK_INJURY_RULES, rulesFor } from './workInjuryRules';

const kenya = rulesFor('Kenya', '2026-10-20');

const base = {
  country: 'Kenya',
  occurred_at: new Date(2026, 9, 20, 10, 0).toISOString(),
  employer_notified_on: '2026-10-20',
  is_fatal: false,
  authority_notified_on: null,
  claim_lodged_on: null,
};

describe('dates', () => {
  it('adds and counts whole days, across months and leap years', () => {
    expect(addDaysToKey('2026-10-27', 7)).toBe('2026-11-03');
    expect(addDaysToKey('2028-02-25', 7)).toBe('2028-03-03');
    expect(daysBetween('2026-10-22', '2026-10-27')).toBe(5);
    expect(daysBetween('2026-10-27', '2026-10-22')).toBe(-5);
  });
  it('days off work: to the return day, or today while still off', () => {
    expect(daysOffWork('2026-10-01', '2026-10-11', '2026-10-20')).toBe(10);
    expect(daysOffWork('2026-10-01', null, '2026-10-20')).toBe(19);
    expect(daysOffWork(null, null, '2026-10-20')).toBeNull();
  });
});

describe('rules are dated data', () => {
  it('every country has a cited rule set; unknown countries fall back to Kenya', () => {
    for (const r of WORK_INJURY_RULES) {
      expect(r.deadlines.length).toBeGreaterThan(0);
      r.deadlines.forEach((d) => expect(d.citation).toBeTruthy());
    }
    expect(rulesFor('Tanzania', '2026-10-20').authority).toBe('WCF');
    expect(rulesFor('Rwanda', '2026-10-20').country).toBe('Kenya');
    expect(rulesFor('kenya ', '2026-10-20').country).toBe('Kenya');
  });
});

describe('caseDeadlines', () => {
  it('Kenya: report to DOSH within 7 days of the employer hearing of it', () => {
    const now = new Date(2026, 9, 22, 9, 0);
    const [dosh, claim] = caseDeadlines({ ...base, employer_notified_on: '2026-10-20' }, now, kenya);
    expect(dosh.rule.code).toBe('ke_dosh_7d');
    expect(dosh.dueDay).toBe('2026-10-27');
    expect(dosh.left).toBe(5);
    expect(dosh.state).toBe('due');
    expect(dosh.message).toBe('Report to DOSH by 27 Oct — 5 days left');
    expect(claim.dueDay).toBe('2027-10-20');
  });

  it('counts from the day the employer was told, not the accident', () => {
    const [dosh] = caseDeadlines({ ...base, employer_notified_on: '2026-10-23' }, new Date(2026, 9, 23), kenya);
    expect(dosh.dueDay).toBe('2026-10-30');
  });

  it('soon, the last day, overdue and done', () => {
    expect(caseDeadlines(base, new Date(2026, 9, 25), kenya)[0].state).toBe('soon');
    expect(caseDeadlines(base, new Date(2026, 9, 27), kenya)[0].message).toContain('today is the last day');
    const late = caseDeadlines(base, new Date(2026, 9, 29), kenya)[0];
    expect(late.state).toBe('overdue');
    expect(late.message).toBe('Report to DOSH by 27 Oct — 2 days overdue');
    const done = caseDeadlines({ ...base, authority_notified_on: '2026-10-24' }, new Date(2026, 9, 29), kenya);
    expect(done[0].state).toBe('done');
    expect(done[0].message).toBe('Report to DOSH: done on 24 Oct');
    expect(nextDeadline(done)?.rule.code).toBe('ke_claim_12m');
  });

  it('a fatal accident: 24 hours from the accident, in hours', () => {
    const list = caseDeadlines({ ...base, is_fatal: true }, new Date(2026, 9, 20, 16, 0), kenya);
    expect(list[0].rule.code).toBe('ke_fatal_24h');
    expect(list[0].unit).toBe('hours');
    expect(list[0].left).toBe(18);
    expect(list[0].message).toBe('Report to DOSH by 21 Oct, 10:00 — 18 hours left');
    expect(caseDeadlines(base, new Date(2026, 9, 20), kenya).some((d) => d.rule.code === 'ke_fatal_24h')).toBe(false);
  });

  it('Tanzania reports to the WCF', () => {
    const [first] = caseDeadlines({ ...base, country: 'Tanzania' }, new Date(2026, 9, 22));
    expect(first.message).toBe('Report to WCF by 27 Oct — 5 days left');
  });
});

describe('estimateCompensation (Kenya)', () => {
  const rule = kenya.compensation;

  it('temporary incapacity: earnings x 12 / 365 a day for the days off', () => {
    const e = estimateCompensation({ monthlyEarnings: 36500, daysOff: 30, incapacityPercent: null, isFatal: false }, rule);
    expect(e.lines).toHaveLength(1);
    expect(e.lines[0].amount).toBe(36000); // 1,200 a day x 30
    expect(e.total).toBe(36000);
  });

  it('temporary payments stop at 12 months', () => {
    const e = estimateCompensation({ monthlyEarnings: 36500, daysOff: 500, incapacityPercent: null, isFatal: false }, rule);
    expect(e.lines[0].amount).toBe(1200 * 365);
    expect(e.lines[0].working).toContain('capped at 12 months');
  });

  it('permanent incapacity: 96 months x the %', () => {
    const e = estimateCompensation({ monthlyEarnings: 50000, daysOff: 0, incapacityPercent: 25, isFatal: false }, rule);
    expect(e.lines.map((l) => l.code)).toEqual(['permanent']);
    expect(e.total).toBe(1200000); // 50,000 x 96 x 25%
  });

  it('death: 96 months, instead of permanent incapacity; medical costs added', () => {
    const e = estimateCompensation({ monthlyEarnings: 40000, daysOff: 0, incapacityPercent: 100, isFatal: true, medicalCosts: 15000 }, rule);
    expect(e.lines.map((l) => l.code)).toEqual(['death', 'medical']);
    expect(e.total).toBe(40000 * 96 + 15000);
  });

  it('asks for what it needs; no estimate where the formula is not confirmed', () => {
    expect(estimateCompensation({ monthlyEarnings: 0, daysOff: 5, incapacityPercent: 0, isFatal: false }, rule).missing).toMatch(/monthly earnings/);
    expect(estimateCompensation({ monthlyEarnings: 1000, daysOff: 0, incapacityPercent: 0, isFatal: false }, rule).missing).toMatch(/days off/);
    expect(estimateCompensation({ monthlyEarnings: 1000, daysOff: 5, incapacityPercent: 0, isFatal: false }, rulesFor('Uganda', '2026-10-20').compensation).missing).toMatch(/don.t estimate/);
  });
});

describe('coverState', () => {
  const cover = { insurer_name: 'Jubilee', policy_number: 'WIBA-1', cover_start: '2026-01-01', cover_expiry: '2026-12-31', dosh_registration_no: null, notes: null };
  it('missing, expired, expiring within 30 days, ok', () => {
    expect(coverState(null, '2026-10-20').state).toBe('missing');
    expect(coverState({ ...cover, policy_number: null }, '2026-10-20').state).toBe('missing');
    expect(coverState(cover, '2027-01-01').state).toBe('expired');
    expect(coverState(cover, '2026-12-10').state).toBe('expiring');
    expect(coverState(cover, '2026-10-20').state).toBe('ok');
  });
});
