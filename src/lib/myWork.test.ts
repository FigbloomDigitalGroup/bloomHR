import { describe, expect, it } from 'vitest';
import {
  canEditEntry, dayProblem, dayWindow, earningsTotals, entryLocked, entryState, groupByDay, jobDue, monthChoices, monthLabel,
  weeksOfMonth, type MyEntry,
} from './myWork';

const entry = (over: Partial<MyEntry>): MyEntry => ({
  id: 'e', employee_number: 'W1', work_date: '2026-10-18', work_type_id: 'tea', quantity: 10, rate: 12, amount: 120,
  status: 'draft', source: 'self', notes: null, rejection_reason: null, entered_by: 'u', paid_out_at: null, reopened_at: null, ...over,
});

describe('which days a worker may record', () => {
  it('today back to the limit, never a future day', () => {
    expect(dayWindow('2026-10-18', 7)).toEqual({ min: '2026-10-11', max: '2026-10-18' });
    expect(dayWindow('2026-03-02', 3)).toEqual({ min: '2026-02-27', max: '2026-03-02' });
    expect(dayWindow('2026-10-18', 0)).toEqual({ min: '2026-10-18', max: '2026-10-18' });
    expect(dayWindow('2026-10-18', Number.NaN).min).toBe('2026-10-11');
  });

  it('says why a day is refused', () => {
    expect(dayProblem('2026-10-18', '2026-10-18', 7)).toBeNull();
    expect(dayProblem('2026-10-11', '2026-10-18', 7)).toBeNull();
    expect(dayProblem('2026-10-19', '2026-10-18', 7)).toMatch(/future day/);
    expect(dayProblem('2026-10-10', '2026-10-18', 7)).toMatch(/last 7 days only/);
    expect(dayProblem('2026-09-30', '2026-10-02', 7, ['2026-09'])).toMatch(/locked/);
    expect(dayProblem('', '2026-10-18', 7)).toBe('Pick a day');
  });
});

describe("an entry's state", () => {
  it('draft, waiting, reopened, approved, rejected', () => {
    expect(entryState(entry({ status: 'draft' }))).toBe('draft');
    expect(entryState(entry({ status: 'submitted' }))).toBe('waiting');
    expect(entryState(entry({ status: 'submitted', reopened_at: '2026-10-18T08:00:00Z' }))).toBe('reopened');
    expect(entryState(entry({ status: 'approved' }))).toBe('approved');
    expect(entryState(entry({ status: 'rejected' }))).toBe('rejected');
  });

  it('only my own drafts and rejected work in an open month can be changed', () => {
    expect(canEditEntry(entry({ status: 'draft' }))).toBe(true);
    expect(canEditEntry(entry({ status: 'rejected' }))).toBe(true);
    expect(canEditEntry(entry({ status: 'submitted' }))).toBe(false);
    expect(canEditEntry(entry({ status: 'approved' }))).toBe(false);
    expect(canEditEntry(entry({ status: 'draft', source: 'supervisor' }))).toBe(false);
    expect(canEditEntry(entry({ status: 'draft' }), ['2026-10'])).toBe(false);
    expect(entryLocked(entry({ paid_out_at: '2026-10-18' }))).toBe(true);
  });

  it('groups by day, newest first, with approved and waiting kept apart', () => {
    const days = groupByDay([
      entry({ id: 'a', work_date: '2026-10-16', status: 'approved', amount: 120 }),
      entry({ id: 'b', work_date: '2026-10-18', status: 'submitted', amount: 35.5 }),
      entry({ id: 'c', work_date: '2026-10-16', status: 'approved', amount: '60.25' }),
      entry({ id: 'd', work_date: '2026-10-16', status: 'rejected', amount: 999 }),
      entry({ id: 'e', work_date: '2026-10-18', status: 'draft', amount: 10 }),
    ]);
    expect(days.map((d) => d.day)).toEqual(['2026-10-18', '2026-10-16']);
    expect(days[0]).toMatchObject({ approved: 0, waiting: 35.5 });
    expect(days[1]).toMatchObject({ approved: 180.25, waiting: 0 });
    expect(days[1].entries).toHaveLength(3);
  });
});

describe('months and weeks', () => {
  it('this month and the ones before it', () => {
    const m = monthChoices('2026-02-10', 3);
    expect(m).toEqual([
      { value: '2026-02-01', label: 'February 2026' },
      { value: '2026-01-01', label: 'January 2026' },
      { value: '2025-12-01', label: 'December 2025' },
    ]);
    expect(monthLabel('2026-10-05')).toBe('October 2026');
  });

  it('Monday-to-Sunday weeks cut to the month', () => {
    // October 2026 starts on a Thursday
    expect(weeksOfMonth('2026-10-18')).toEqual([
      { from: '2026-10-01', to: '2026-10-04' },
      { from: '2026-10-05', to: '2026-10-11' },
      { from: '2026-10-12', to: '2026-10-18' },
      { from: '2026-10-19', to: '2026-10-25' },
      { from: '2026-10-26', to: '2026-10-31' },
    ]);
    // February 2027 starts on a Monday and has exactly four weeks
    expect(weeksOfMonth('2027-02-01')).toHaveLength(4);
    expect(weeksOfMonth('2027-02-01').at(-1)).toEqual({ from: '2027-02-22', to: '2027-02-28' });
  });
});

describe('earnings', () => {
  it('approved gross is work plus jobs; waiting is kept apart', () => {
    expect(earningsTotals({ approved_work: '1200.10', approved_jobs: 15000, waiting_work: 300, waiting_jobs: '2500' })).toEqual({
      approved: 16200.1, waiting: 2800, work: 1200.1, jobs: 15000,
    });
    expect(earningsTotals({ approved_work: 0.1, approved_jobs: 0.2, waiting_work: 0, waiting_jobs: 0 }).approved).toBe(0.3);
    expect(earningsTotals(null)).toEqual({ approved: 0, waiting: 0, work: 0, jobs: 0 });
  });

  it('a job is overdue or due today only while open', () => {
    expect(jobDue({ due_date: '2026-10-17', status: 'open' }, '2026-10-18')).toBe('overdue');
    expect(jobDue({ due_date: '2026-10-18', status: 'open' }, '2026-10-18')).toBe('today');
    expect(jobDue({ due_date: '2026-10-17', status: 'completed' }, '2026-10-18')).toBeNull();
    expect(jobDue({ due_date: null, status: 'open' }, '2026-10-18')).toBeNull();
  });
});
