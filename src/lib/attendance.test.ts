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
  DEFAULT_ODD_HOURS_UNTIL,
  dayHours,
  dayHoursLabel,
  dayStatusLabel,
  missingClockOutLabel,
  openDaysByPerson,
  totalHoursLabel,
  flaggedByPerson,
  oddHoursProblem,
  oddHoursSummary,
  scanLine,
  statusKeyLabel,
  verifyMethod,
  scanRole,
  scanSource,
  clockOutLabel,
  clockedInVia,
  isLastScan,
  parseNetworks,
  placeMapUrl,
  placeText,
  type AttendanceDay,
  type DayScan,
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
    expect(lines[1]).toBe('A,Mo Me,Sales,Nairobi HQ,2026-10-20,Late,08:31,17:01,8.50,31,"Traffic, ""jam""",,');
    expect(lines[2]).toBe('A,Mo Me,Sales,Nairobi HQ,2026-10-22,Not yet,,,,,,,');
  });

  it('says how each clock-in was made, and where (FIG-1200)', () => {
    const csv = attendanceCsv(
      [
        day({ employeeNumber: 'A', day: '2026-10-19', status: 'present', clockIn: '2026-10-19T05:00:00Z', source: 'app', place: 'office', placeDetail: 'Near Nairobi (120 m)' }),
        day({ employeeNumber: 'A', day: '2026-10-20', status: 'present', clockIn: '2026-10-20T05:00:00Z', source: 'app', place: 'field', placeLocation: { latitude: 0.5143, longitude: 35.2698 } }),
        day({ employeeNumber: 'A', day: '2026-10-21', status: 'present', clockIn: '2026-10-21T05:00:00Z', source: 'scanner' }),
      ],
      new Map()
    );
    const lines = csv.trim().split('\r\n');
    expect(lines[1].endsWith(',App · office,Near Nairobi (120 m)')).toBe(true);
    expect(lines[2].endsWith(',App · field,"0.51430, 35.26980"')).toBe(true);
    expect(lines[3].endsWith(',Scanner,')).toBe(true);
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

describe('days without a clock-out, and days that don’t count', () => {
  const TODAY = '2026-10-22';
  // 5:00 pm in Nairobi
  const NOW = new Date('2026-10-22T14:00:00Z');

  it('today, still in: the time so far; a past day: no clock-out; otherwise the hours', () => {
    const inToday = day({ employeeNumber: 'A', day: TODAY, clockIn: '2026-10-22T11:40:00Z' }); // 2:40 pm
    expect(dayHours(inToday, TODAY, NOW)).toEqual({ hours: 2 + 20 / 60, open: 'so_far' });
    expect(dayHoursLabel(inToday, TODAY, NOW)).toBe('2h 20m so far');
    const forgot = day({ employeeNumber: 'A', day: '2026-10-21', clockIn: '2026-10-21T05:00:00Z' });
    expect(dayHours(forgot, TODAY, NOW)).toEqual({ hours: null, open: 'missing' });
    expect(dayHoursLabel(forgot, TODAY, NOW)).toBe('No clock-out');
    const done = day({ employeeNumber: 'A', day: '2026-10-20', clockIn: '2026-10-20T05:00:00Z', clockOut: '2026-10-20T14:00:00Z', hours: 9 });
    expect(dayHoursLabel(done, TODAY, NOW)).toBe('9h 00m');
    expect(dayHoursLabel(day({ employeeNumber: 'A', day: '2026-10-19' }), TODAY, NOW)).toBe('—');
  });

  it('sums each person’s time so far today and counts their past days without a clock-out', () => {
    const open = openDaysByPerson([
      day({ employeeNumber: 'A', day: TODAY, clockIn: '2026-10-22T12:00:00Z' }),
      day({ employeeNumber: 'A', day: '2026-10-21', clockIn: '2026-10-21T05:00:00Z', clockOut: '2026-10-21T14:00:00Z', hours: 9 }),
      day({ employeeNumber: 'B', day: '2026-10-20', clockIn: '2026-10-20T05:00:00Z' }),
      day({ employeeNumber: 'B', day: '2026-10-21', clockIn: '2026-10-21T05:00:00Z' }),
      day({ employeeNumber: 'C', day: '2026-10-21', clockIn: '2026-10-21T05:00:00Z', clockOut: '2026-10-21T06:00:00Z', hours: 1 }),
    ], TODAY, NOW);
    expect([...open]).toEqual([
      ['A', { soFar: 2, inNow: true, missing: 0 }],
      ['B', { soFar: 0, inNow: false, missing: 2 }],
    ]);
    expect(totalHoursLabel(9, open.get('A'))).toBe('11h 00m so far');
    expect(totalHoursLabel(0, open.get('B'))).toBe('0m');
    expect(totalHoursLabel(1, undefined)).toBe('1h 00m');
    expect(missingClockOutLabel(1)).toBe('1 day without a clock-out');
    expect(missingClockOutLabel(2)).toBe('2 days without a clock-out');
  });

  it('a day before attendance counts says so', () => {
    expect(dayStatusLabel({ status: null, counted: false })).toBe('Not counted');
    expect(dayStatusLabel({ status: null, counted: true })).toBe('Not yet');
    expect(dayStatusLabel({ status: 'late' })).toBe('Late');
  });
});

describe('odd-hours flags and the scans of a day (20261023800000)', () => {
  it('counts each person’s flagged days', () => {
    const got = flaggedByPerson([
      day({ employeeNumber: 'A', day: '2026-10-19', flag: 'Clocked in at 12:01 am, before 5:00 am' }),
      day({ employeeNumber: 'A', day: '2026-10-20', flag: null }),
      day({ employeeNumber: 'A', day: '2026-10-21', flag: 'Clocked in at 4:59 am, before 5:00 am' }),
      day({ employeeNumber: 'B', day: '2026-10-19' }),
    ]);
    expect([...got]).toEqual([['A', 2]]);
  });

  it('labels each scan: time, where from, and what it was', () => {
    const scan = (fields: Partial<DayScan>): DayScan => ({ at: '2026-10-19T04:55:00Z', via: 'scanner', scannerName: 'Front Door', kind: 'between', reason: null, ...fields });
    expect(scanLine(scan({ kind: 'clock_in' }))).toBe('7:55 am · Front Door · clock-in');
    expect(scanLine(scan({ at: '2026-10-19T09:30:00Z' }))).toBe('12:30 pm · Front Door');
    expect(scanLine(scan({ at: '2026-10-19T14:04:00Z', kind: 'clock_out' }))).toBe('5:04 pm · Front Door · clock-out');
    expect(scanLine(scan({ at: '2026-10-19T05:02:00Z', via: 'app', scannerName: null, kind: 'clock_in' }))).toBe('8:02 am · App · clock-in');
    expect(scanLine(scan({ via: 'hr', scannerName: null, kind: 'clock_out' }))).toBe('7:55 am · HR correction · clock-out');
    expect(scanLine(scan({ kind: 'held', reason: 'clock_ahead' }))).toBe("7:55 am · Front Door · not counted (the scanner's clock was ahead)");
    expect(scanLine(scan({ kind: 'held', reason: 'hr_corrected' }))).toBe('7:55 am · Front Door · not counted (HR corrected this day)');
    expect(scanLine(scan({ kind: 'held', reason: 'something_new' }))).toBe('7:55 am · Front Door · not counted (something new)');
    expect(scanLine(scan({ kind: 'waiting' }))).toBe('7:55 am · Front Door · not counted yet');
    expect(scanSource({ via: 'scanner', scannerName: null })).toBe('Scanner');
    expect(scanRole({ kind: 'between', reason: null })).toBe('');
    // just after midnight
    expect(scanLine(scan({ at: '2026-10-18T21:01:00Z', kind: 'clock_in' }))).toBe('12:01 am · Front Door · clock-in');
  });

  it('names how a scanner verified a punch (ZKTeco verify codes)', () => {
    expect(verifyMethod(1)).toBe('fingerprint');
    expect(verifyMethod(0)).toBe('PIN');
    expect(verifyMethod(3)).toBe('PIN');
    expect(verifyMethod(2)).toBe('card');
    expect(verifyMethod(4)).toBe('card');
    expect(verifyMethod(15)).toBe('face');
    expect(verifyMethod(25)).toBe('palm');
    for (const c of [5, 9, 14, 16, 21, 201]) expect(verifyMethod(c)).toBe('other');
    expect(verifyMethod(null)).toBeNull();
    expect(verifyMethod(undefined)).toBeNull();
  });

  it('names the key pressed on the scanner (ZKTeco status)', () => {
    expect([0, 1, 2, 3, 4, 5].map(statusKeyLabel)).toEqual([
      'In key', 'Out key', 'Break out key', 'Break in key', 'Overtime in key', 'Overtime out key',
    ]);
    expect(statusKeyLabel(9)).toBe('Key 9');
    expect(statusKeyLabel(null)).toBeNull();
  });

  it('adds the verify method to a scanner punch, and the key when the scanner uses its keys', () => {
    const scan = (fields: Partial<DayScan>): DayScan => ({ at: '2026-10-19T05:03:00Z', via: 'scanner', scannerName: 'Front Door', kind: 'clock_in', reason: null, ...fields });
    expect(scanLine(scan({ verify: 4, status: 1, punchMode: 'first_last' }))).toBe('8:03 am · Front Door · card · clock-in');
    expect(scanLine(scan({ verify: 15, status: 0, punchMode: 'device_keys' }))).toBe('8:03 am · Front Door · face · In key · clock-in');
    expect(scanLine(scan({ verify: 1, status: 2, punchMode: 'device_keys', kind: 'held', reason: 'break' })))
      .toBe('8:03 am · Front Door · fingerprint · Break out key · not counted (break)');
    expect(scanLine(scan({ verify: 1, punchMode: 'out_only', kind: 'held', reason: 'no_clock_in' })))
      .toBe('8:03 am · Front Door · fingerprint · not counted (no clock-in before it yet)');
    expect(scanLine(scan({ kind: 'held', reason: 'overtime', verify: 25 }))).toBe('8:03 am · Front Door · palm · not counted (overtime)');
    // the app's and HR's times have no verify method
    expect(scanLine(scan({ via: 'app', scannerName: null, verify: 1 }))).toBe('8:03 am · App · clock-in');
  });

  it('checks and explains the odd-hours setting', () => {
    expect(DEFAULT_ODD_HOURS_UNTIL).toBe('05:00');
    expect(oddHoursProblem('05:00')).toBeNull();
    expect(oddHoursProblem('00:00')).toBeNull();
    expect(oddHoursProblem('12:00')).toBeNull();
    expect(oddHoursProblem('12:01')).toMatch(/00:00 to 12:00/);
    expect(oddHoursProblem('')).toBe('Enter a time');
    expect(oddHoursSummary('05:00')).toBe('Clock-ins after midnight and before 5:00 am are flagged.');
    expect(oddHoursSummary('00:00')).toBe("Odd-hours clock-ins aren't flagged.");
  });
});

describe('a scanner’s last scan before the end of the day (FIG-1200)', () => {
  const TODAY = '2026-10-22';
  const IN = '2026-10-22T05:00:00Z'; // 8:00 am
  const LAST = '2026-10-22T11:48:00Z'; // 2:48 pm
  const BEFORE_END = new Date('2026-10-22T13:00:00Z'); // 4:00 pm
  const AFTER_END = new Date('2026-10-22T14:30:00Z'); // 5:30 pm
  const scanned = (fields: Partial<AttendanceDay> = {}) =>
    day({ employeeNumber: 'A', day: TODAY, clockIn: IN, clockOut: LAST, hours: 6.8, source: 'scanner', clockOutVia: 'scanner', endTime: '17:00', ...fields });

  it('today before the end time: "Last scan", hours so far', () => {
    expect(isLastScan(scanned(), TODAY, BEFORE_END)).toBe(true);
    expect(clockOutLabel(scanned(), TODAY, BEFORE_END)).toBe('Last scan 2:48 pm');
    expect(dayHours(scanned(), TODAY, BEFORE_END)).toEqual({ hours: 8, open: 'so_far' });
    expect(dayHoursLabel(scanned(), TODAY, BEFORE_END)).toBe('8h 00m so far');
  });

  it('once the end time has passed: the clock-out, its hours', () => {
    expect(isLastScan(scanned(), TODAY, AFTER_END)).toBe(false);
    expect(clockOutLabel(scanned(), TODAY, AFTER_END)).toBe('2:48 pm');
    expect(dayHoursLabel(scanned(), TODAY, AFTER_END)).toBe('6h 48m');
  });

  it('an app clock-out or HR’s correction is a clock-out straight away; a past day always is', () => {
    expect(clockOutLabel(scanned({ clockOutVia: 'app' }), TODAY, BEFORE_END)).toBe('2:48 pm');
    expect(clockOutLabel(scanned({ clockOutVia: 'hr', source: 'hr' }), TODAY, BEFORE_END)).toBe('2:48 pm');
    expect(isLastScan(scanned({ day: '2026-10-21', clockIn: '2026-10-21T05:00:00Z', clockOut: '2026-10-21T11:48:00Z' }), TODAY, BEFORE_END)).toBe(false);
    // no end time known: as before
    expect(isLastScan(scanned({ endTime: null }), TODAY, BEFORE_END)).toBe(false);
  });

  it('the summary counts the time so far once, not the last scan’s hours on top', () => {
    const open = openDaysByPerson([scanned()], TODAY, BEFORE_END);
    expect(open.get('A')?.inNow).toBe(true);
    expect(open.get('A')?.soFar).toBeCloseTo(8 - 6.8);
    // the summary already has the recorded 6.8 hours: 6.8 + 1.2 = 8h so far
    expect(totalHoursLabel(6.8, open.get('A'))).toBe('8h 00m so far');
  });
});

describe('where a clock-in was made (FIG-1200)', () => {
  it('labels: Scanner, HR correction, App, App · office/remote/field', () => {
    expect(clockedInVia({ source: 'scanner' })).toBe('Scanner');
    expect(clockedInVia({ source: 'hr' })).toBe('HR correction');
    expect(clockedInVia({ source: 'app', place: null })).toBe('App');
    expect(clockedInVia({ source: 'app', place: 'remote' })).toBe('App · remote');
    expect(clockedInVia({ source: null })).toBe('');
  });

  it('the place: its detail, a field location (with a map link), or nothing', () => {
    expect(placeText({ place: 'field', placeDetail: 'No location' })).toBe('No location');
    expect(placeText({ place: 'field', placeLocation: { latitude: 0.5143, longitude: 35.2698 } })).toBe('0.51430, 35.26980');
    expect(placeMapUrl({ place: 'field', placeLocation: { latitude: 0.5143, longitude: 35.2698 } })).toBe('https://www.google.com/maps?q=0.5143,35.2698');
    expect(placeMapUrl({ place: 'office' })).toBeNull();
  });

  it('the scan list tags the app clock-in with its place', () => {
    const s: DayScan = { at: '2026-10-19T05:02:00Z', via: 'app', scannerName: null, kind: 'clock_in', reason: null };
    expect(scanLine(s, 'office')).toBe('8:02 am · App · office · clock-in');
    expect(scanLine({ ...s, kind: 'clock_out' }, 'office')).toBe('8:02 am · App · clock-out');
  });

  it('office networks typed one per line or comma separated', () => {
    expect(parseNetworks(' 41.90.12.7\n102.68.0.0/24, 41.90.12.7 \n\n')).toEqual(['41.90.12.7', '102.68.0.0/24']);
  });
});
