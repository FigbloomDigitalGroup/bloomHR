import { describe, expect, it } from 'vitest';
import {
  carryExpiryDate, employeeJoined, leaveMonthOf, leaveYearEnd, leaveYearLabel, leaveYearOf, leaveYearStart, serviceMonths, yearAllowance,
} from './leaveAccrual';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

describe('the leave year (FIG-877), as the database works it out', () => {
  it('January (the default) is the calendar year', () => {
    expect(leaveYearOf(d('2026-01-01'))).toBe(2026);
    expect(leaveYearOf(d('2026-12-31'))).toBe(2026);
    expect(leaveMonthOf(d('2026-06-30'))).toBe(6);
    expect(iso(leaveYearStart(2026))).toBe('2026-01-01');
    expect(iso(leaveYearEnd(2026))).toBe('2026-12-31');
    expect(leaveYearLabel(2026)).toBe('2026');
  });

  it('a July leave year runs from 1 July to 30 June', () => {
    expect(leaveYearOf(d('2026-06-30'), 7)).toBe(2025);
    expect(leaveYearOf(d('2026-07-01'), 7)).toBe(2026);
    expect(leaveYearOf(d('2027-03-01'), 7)).toBe(2026);
    expect(leaveMonthOf(d('2026-07-01'), 7)).toBe(1);
    expect(leaveMonthOf(d('2026-10-17'), 7)).toBe(4);
    expect(leaveMonthOf(d('2027-06-15'), 7)).toBe(12);
    expect(iso(leaveYearStart(2026, 7))).toBe('2026-07-01');
    expect(iso(leaveYearEnd(2026, 7))).toBe('2027-06-30');
    expect(leaveYearLabel(2026, 7)).toBe('Jul 2026 to Jun 2027');
  });

  it('carried days expire the given months after the leave year starts (never with 0)', () => {
    expect(iso(carryExpiryDate(2027, 1, 6))).toBe('2027-07-01'); // to be taken by 30 June
    expect(iso(carryExpiryDate(2026, 7, 6))).toBe('2027-01-01');
    expect(iso(carryExpiryDate(2026, 10, 12))).toBe('2027-10-01');
    expect(carryExpiryDate(2027, 1, 0)).toBeNull();
  });

  it('a joiner has the months of the leave year from the month they joined', () => {
    const sep = employeeJoined({ 'Start Date': '2026-09-15' });
    expect(serviceMonths(sep, 2026, 12, 7)).toBe(10); // September to June
    expect(serviceMonths(sep, 2026, 4, 7)).toBe(2); // by October
    expect(serviceMonths(sep, 2025, 12, 7)).toBe(0);
    expect(serviceMonths(sep, 2027, 3, 7)).toBe(3);
    expect(yearAllowance(24, sep, 2026, 12, 7)).toBe(20);
    expect(yearAllowance(24, sep, 2026, 4, 7)).toBe(4);
  });

  it('with January it is exactly the calendar rule', () => {
    const oct = employeeJoined({ 'Start Date': '2026-10-05' });
    for (const [year, upto] of [[2025, 12], [2026, 9], [2026, 12], [2027, 4]] as const) {
      expect(serviceMonths(oct, year, upto, 1)).toBe(serviceMonths(oct, year, upto));
    }
    expect(yearAllowance(21, oct, 2026, 12, 1)).toBe(5.25);
  });
});
