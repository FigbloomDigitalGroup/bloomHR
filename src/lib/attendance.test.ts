import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_CSV_HEADERS,
  addDays,
  attendanceCsv,
  clockLabel,
  correctionProblem,
  dayLabel,
  daysInRange,
  formatHours,
  formatTime,
  hoursBetween,
  lateLabel,
  nairobiParts,
  nairobiToIso,
  nairobiToday,
  scheduleLine,
  statusLabel,
  summarise,
  weekOf,
  workDaysLabel,
  workDaysMismatches,
  workWeekIsoDays,
  type AttendanceDay,
} from './attendance';

const day = (fields: Partial<AttendanceDay> & Pick<AttendanceDay, 'employeeNumber' | 'day'>): AttendanceDay => ({
  status: null, clockIn: null, clockOut: null, hours: null, lateMinutes: null, source: null, note: null, ...fields,
});

describe('times in Nairobi', () => {
  it('reads a moment as the Nairobi date and time', () => {
    expect(nairobiParts('2026-10-19T05:30:00Z')).toEqual({ date: '2026-10-19', time: '08:30' });
    // 22:30 UTC is already the next morning in Nairobi
    expect(nairobiParts('2026-10-13T22:30:00Z')).toEqual({ date: '2026-10-14', time: '01:30' });
    expect(nairobiToday(new Date('2026-10-21T21:30:00Z'))).toBe('2026-10-22');
  });

  it('turns a Nairobi date and time into the moment', () => {
    expect(nairobiToIso('2026-10-19', '08:30')).toBe('2026-10-19T05:30:00.000Z');
  });

  it('shows clock times the way people say them', () => {
    expect(clockLabel('08:00')).toBe('8:00 am');
    expect(clockLabel('12:00')).toBe('12:00 pm');
    expect(clockLabel('13:05')).toBe('1:05 pm');
    expect(clockLabel('00:15')).toBe('12:15 am');
    expect(formatTime('2026-10-19T05:31:00Z')).toBe('8:31 am');
    expect(formatTime(null)).toBe('—');
    expect(scheduleLine({ startTime: '08:00', lateAfter: '08:30' })).toBe('Expected 8:00 am · late after 8:30 am');
  });

  it('counts hours (so far, while still clocked in)', () => {
    expect(hoursBetween('2026-10-19T05:00:00Z', '2026-10-19T13:30:00Z')).toBe(8.5);
    expect(hoursBetween('2026-10-19T05:00:00Z', null, new Date('2026-10-19T06:15:00Z'))).toBe(1.25);
    expect(hoursBetween(null, null)).toBeNull();
    expect(formatHours(8.5)).toBe('8h 30m');
    expect(formatHours(0.75)).toBe('45m');
    expect(formatHours(null)).toBe('—');
    expect(lateLabel(25)).toBe('25 min late');
    expect(lateLabel(65)).toBe('1h 05m late');
    expect(lateLabel(0)).toBe('');
  });
});

describe('days and weeks', () => {
  it('finds the Monday to Sunday week of a date', () => {
    expect(weekOf('2026-10-22')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(weekOf('2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(weekOf('2026-10-19')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  });

  it('adds days and counts a range', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(daysInRange('2026-10-19', '2026-10-25')).toBe(7);
    expect(daysInRange('2026-10-25', '2026-10-19')).toBe(0);
    expect(dayLabel('2026-10-19')).toBe('Mon 19 Oct');
  });

  it('names the working days', () => {
    expect(workDaysLabel([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(workDaysLabel([6, 1, 2, 3, 4, 5])).toBe('Mon–Sat');
    expect(workDaysLabel([1, 3, 5])).toBe('Mon, Wed, Fri');
    expect(workDaysLabel([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
    expect(workDaysLabel([])).toBe('No days');
  });

  it('labels a status, and a day not known yet', () => {
    expect(statusLabel('leave')).toBe('On leave');
    expect(statusLabel(null)).toBe('Not yet');
  });
});

describe('summarise', () => {
  it('counts present (late included), late, absent and leave per person, with hours', () => {
    const got = summarise([
      day({ employeeNumber: 'A', day: '2026-10-19', status: 'present', hours: 8 }),
      day({ employeeNumber: 'A', day: '2026-10-20', status: 'late', hours: 7.5, lateMinutes: 31 }),
      day({ employeeNumber: 'A', day: '2026-10-21', status: 'holiday' }),
      day({ employeeNumber: 'A', day: '2026-10-22', status: null }),
      day({ employeeNumber: 'B', day: '2026-10-19', status: 'absent' }),
      day({ employeeNumber: 'B', day: '2026-10-20', status: 'leave' }),
      day({ employeeNumber: 'B', day: '2026-10-24', status: 'off' }),
    ]);
    expect(got).toEqual([
      { employeeNumber: 'A', present: 2, late: 1, absent: 0, leave: 0, workingDays: 2, hours: 15.5, lateMinutes: 31 },
      { employeeNumber: 'B', present: 0, late: 0, absent: 1, leave: 1, workingDays: 1, hours: 0, lateMinutes: 0 },
    ]);
  });
});

describe('attendanceCsv', () => {
  it('one line per person per day, times in Nairobi, with the person’s name, department and branch', () => {
    const csv = attendanceCsv(
      [
        day({ employeeNumber: 'A', day: '2026-10-20', status: 'late', clockIn: '2026-10-20T05:31:00Z', clockOut: '2026-10-20T14:01:00Z', hours: 8.5, lateMinutes: 31, note: 'Traffic, "jam"' }),
        day({ employeeNumber: 'A', day: '2026-10-22', status: null }),
      ],
      new Map([['A', { name: 'Mo Me', department: 'Sales', branch: 'Nairobi HQ' }]])
    );
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(ATTENDANCE_CSV_HEADERS.join(','));
    expect(lines[1]).toBe('A,Mo Me,Sales,Nairobi HQ,2026-10-20,Late,08:31,17:01,8.50,31,"Traffic, ""jam"""');
    expect(lines[2]).toBe('A,Mo Me,Sales,Nairobi HQ,2026-10-22,Not yet,,,,,');
  });
});

describe('correctionProblem', () => {
  it('needs a clock-in, a clock-out after it (or none) and a note', () => {
    expect(correctionProblem('', '', 'x')).toBe('Enter the clock-in time');
    expect(correctionProblem('09:00', '08:00', 'x')).toMatch(/after the clock-in/);
    expect(correctionProblem('09:00', '09:00', 'x')).toMatch(/after the clock-in/);
    expect(correctionProblem('09:00', '', '  ')).toMatch(/Add a note/);
    expect(correctionProblem('09:00', '17:00', 'Forgot')).toBeNull();
    expect(correctionProblem('09:00', '', 'Still here')).toBeNull();
  });
});

describe('working days: attendance against leave and payroll', () => {
  const MON_FRI = [1, 1, 1, 1, 1, 0, 0];

  it('reads a work week as days, half days included', () => {
    expect(workWeekIsoDays(MON_FRI)).toEqual([1, 2, 3, 4, 5]);
    expect(workWeekIsoDays([1, 1, 1, 1, 1, 0.5, 0])).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('says nothing when they match', () => {
    expect(workDaysMismatches({ companyDays: [5, 4, 3, 2, 1], branches: [], companyWeek: MON_FRI, departments: [{ name: 'Ops', workWeek: null }] })).toEqual([]);
  });

  it('names the company schedule, a branch and a department that differ', () => {
    expect(workDaysMismatches({
      companyDays: [1, 2, 3, 4, 5, 6],
      branches: [{ name: 'Dar', workDays: [1, 2, 3, 4, 5] }, { name: 'Kampala', workDays: [1, 2, 3, 4, 5, 6] }],
      companyWeek: MON_FRI,
      departments: [{ name: 'Farm', workWeek: [1, 1, 1, 1, 1, 0.5, 0] }, { name: 'Office', workWeek: MON_FRI }],
    })).toEqual([
      "The company's attendance schedule works Mon–Sat, but leave and payroll count Mon–Fri.",
      "Kampala's attendance schedule works Mon–Sat, but leave and payroll count Mon–Fri.",
      'Office works Mon–Fri for leave and payroll, but attendance expects Mon–Sat unless their branch has its own schedule.',
    ]);
  });
});
