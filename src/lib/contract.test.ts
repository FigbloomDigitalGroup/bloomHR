import { describe, expect, it } from 'vitest';
import { parseDay, summarizeContract } from './contract';

const today = new Date(2026, 9, 6); // 6 Oct 2026

describe('parseDay', () => {
  it('reads the calendar day from the text, ignoring any time and zone', () => {
    const d = parseDay('2026-12-31T23:30:00+03:00')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 11, 31]);
  });

  it('is null for blanks and rubbish', () => {
    expect(parseDay('')).toBeNull();
    expect(parseDay(null)).toBeNull();
    expect(parseDay('soon')).toBeNull();
  });
});

describe('summarizeContract', () => {
  it('counts the days to the end of a running contract', () => {
    const s = summarizeContract({ 'Contract Start Date': '2026-01-01', 'Contract End Date': '2027-01-01' }, today);
    expect(s.state).toBe('active');
    expect(s.daysLeft).toBe(87);
    expect(s.headline).toMatch(/^Ends in 87 days/);
  });

  it('warns when the end is within 60 days', () => {
    const s = summarizeContract({ 'Contract Start Date': '2026-01-01', 'Contract End Date': '2026-10-20' }, today);
    expect(s.state).toBe('ending-soon');
    expect(s.daysLeft).toBe(14);
  });

  it('says so on the last day, and the day after it has ended', () => {
    expect(summarizeContract({ 'Contract End Date': '2026-10-06' }, today).headline).toBe('Ends today');
    const s = summarizeContract({ 'Contract End Date': '2026-10-05' }, today);
    expect(s.state).toBe('expired');
    expect(s.daysLeft).toBe(-1);
    expect(s.headline).toMatch(/^Ended on/);
  });

  it('uses the singular for one day', () => {
    expect(summarizeContract({ 'Contract End Date': '2026-10-07' }, today).headline).toMatch(/^Ends in 1 day /);
  });

  it('has no end for a permanent employee', () => {
    expect(summarizeContract({ 'Employee Type': 'Permanent', 'Start Date': '2020-03-01' }, today).state).toBe('no-end');
  });

  it('knows a contract that has not started yet', () => {
    const s = summarizeContract({ 'Contract Start Date': '2026-11-01', 'Contract End Date': '2027-11-01' }, today);
    expect(s.state).toBe('not-started');
    expect(s.headline).toMatch(/^Starts on/);
  });
});
