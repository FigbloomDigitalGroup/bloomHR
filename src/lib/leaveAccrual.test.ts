import { describe, expect, it } from 'vitest';
import { earnedToDate, isYearlyMethod } from './leaveAccrual';

describe('earnedToDate', () => {
  it('24 days a year is 2 a month', () => {
    expect(earnedToDate(24, 1)).toBe(2);
    expect(earnedToDate(24, 6)).toBe(12);
    expect(earnedToDate(24, 12)).toBe(24);
  });

  it('rounds to two decimals and keeps the month within the year', () => {
    expect(earnedToDate(21, 1)).toBe(1.75);
    expect(earnedToDate(10, 1)).toBe(0.83);
    expect(earnedToDate(24, 0)).toBe(2);
    expect(earnedToDate(24, 99)).toBe(24);
  });

  it('is 0 for no allowance', () => {
    expect(earnedToDate(0, 5)).toBe(0);
    expect(earnedToDate(Number.NaN, 5)).toBe(0);
  });
});

describe('isYearlyMethod', () => {
  it('is for the whole-year methods only', () => {
    expect(isYearlyMethod('annual')).toBe(true);
    expect(isYearlyMethod('monthly_cumulative')).toBe(true);
    expect(isYearlyMethod('monthly_non_cumulative')).toBe(false);
    expect(isYearlyMethod('none')).toBe(false);
    expect(isYearlyMethod(undefined)).toBe(false);
  });
});
