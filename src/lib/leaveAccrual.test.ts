import { describe, expect, it } from 'vitest';
import { earnedToDate, employeeJoined, isYearlyMethod, serviceMonths, yearAllowance } from './leaveAccrual';

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

describe('counting from when someone joined', () => {
  it('uses the start date, else the contract start date, and only YYYY-MM-DD dates', () => {
    expect(employeeJoined({ 'Start Date': '2020-02-01', 'Contract Start Date': '2026-09-01' })?.toISOString().slice(0, 10)).toBe('2020-02-01');
    expect(employeeJoined({ 'Start Date': '', 'Contract Start Date': '2026-07-20' })?.toISOString().slice(0, 10)).toBe('2026-07-20');
    expect(employeeJoined({ 'Start Date': '5th Oct 2026' })).toBeNull();
  });

  it('counts the months of the year they were here, the month they joined in full', () => {
    const oct = employeeJoined({ 'Start Date': '2026-10-05' });
    expect(serviceMonths(oct, 2026, 12)).toBe(3);
    expect(serviceMonths(oct, 2026, 9)).toBe(0);
    expect(serviceMonths(oct, 2027, 4)).toBe(4);
    expect(serviceMonths(oct, 2025, 12)).toBe(0);
    expect(serviceMonths(null, 2026, 10)).toBe(10);
  });

  it('gives a joiner their part of the year, as the database does', () => {
    const oct = employeeJoined({ 'Start Date': '2026-10-05' });
    expect(yearAllowance(21, oct, 2026, 12)).toBe(5.25);
    expect(yearAllowance(14, employeeJoined({ 'Contract Start Date': '2026-07-20' }), 2026, 12)).toBe(7);
    expect(yearAllowance(21, null, 2026, 12)).toBe(21);
  });
});
