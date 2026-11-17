import { describe, expect, it } from 'vitest';
import { leaveDateRange, leaveDaysLabel, shortSubmitted } from './leaveDisplay';

describe('leaveDateRange', () => {
  it('one day shows one date', () => {
    expect(leaveDateRange('2026-10-26', '2026-10-26')).toBe('Mon 26 Oct 2026');
    expect(leaveDateRange('2026-10-26', null)).toBe('Mon 26 Oct 2026');
  });

  it('a range in one month, across months and across years', () => {
    expect(leaveDateRange('2026-10-26', '2026-10-30')).toBe('Mon 26 – Fri 30 Oct 2026');
    expect(leaveDateRange('2026-10-28', '2026-11-03')).toBe('Wed 28 Oct – Tue 3 Nov 2026');
    expect(leaveDateRange('2026-12-30', '2027-01-01')).toBe('Wed 30 Dec 2026 – Fri 1 Jan 2027');
  });

  it('unreadable dates are shown as given', () => {
    expect(leaveDateRange('soon', 'later')).toBe('soon – later');
  });
});

describe('leaveDaysLabel and shortSubmitted', () => {
  it('days', () => {
    expect(leaveDaysLabel(1)).toBe('1 day');
    expect(leaveDaysLabel('2.5')).toBe('2.5 days');
    expect(leaveDaysLabel(null)).toBe('');
  });

  it('submitted: no year this year, the year otherwise', () => {
    const now = new Date('2026-10-23T09:00:00');
    expect(shortSubmitted(new Date('2026-10-23T08:00:00'), now)).toBe('23 Oct');
    expect(shortSubmitted(new Date('2025-12-01T08:00:00'), now)).toBe('1 Dec 2025');
  });
});
