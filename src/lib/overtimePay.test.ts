import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OVERTIME_SETTINGS, capEntries, hoursByType, overtimeForPayslip, overtimeFromSheet, overtimeHourlyRate,
  overtimeLineLabel, overtimeLineWorking, overtimeLinesText, overtimePayFor, payslipOvertimeLines, payslipOvertimePay,
  settingsFromRow, settingsProblems, type OvertimeMonthRow,
} from './overtimePay';

const row = (patch: Partial<OvertimeMonthRow> = {}): OvertimeMonthRow => ({
  employee_number: 'E1', normal_hours: '6', rest_hours: '4', holiday_hours: '0', over_cap_hours: '0', entries: [], ...patch,
});

describe('the hourly rate', () => {
  it('is basic / the monthly hours (225 by default), to the cent', () => {
    expect(overtimeHourlyRate(40000, 225)).toBe(177.78);
    expect(overtimeHourlyRate(45000, 225)).toBe(200);
    expect(overtimeHourlyRate(40000, 200)).toBe(200);
  });

  it("the employee's own rate wins when set", () => {
    expect(overtimeHourlyRate(40000, 225, 250.456)).toBe(250.46);
    expect(overtimeHourlyRate(40000, 225, '300')).toBe(300);
    expect(overtimeHourlyRate(40000, 225, null)).toBe(177.78);
    expect(overtimeHourlyRate(40000, 225, 0)).toBe(177.78);
  });

  it('never goes below 0, and falls back to 225 hours when the setting is missing', () => {
    expect(overtimeHourlyRate(-5, 225)).toBe(0);
    expect(overtimeHourlyRate(45000, 0)).toBe(200);
  });
});

describe('the payslip lines', () => {
  it('hours x rate x the multiplier, one line per kind of day, rounded to the cent', () => {
    const pay = overtimePayFor(row({ holiday_hours: '2.5' }), 40000, null, DEFAULT_OVERTIME_SETTINGS);
    expect(pay.hourlyRate).toBe(177.78);
    expect(pay.items).toEqual([
      { name: 'Overtime (normal days)', day_type: 'normal', hours: 6, hourly_rate: 177.78, multiplier: 1.5, amount: 1600.02 },
      { name: 'Overtime (rest days)', day_type: 'rest', hours: 4, hourly_rate: 177.78, multiplier: 2, amount: 1422.24 },
      { name: 'Overtime (public holidays)', day_type: 'holiday', hours: 2.5, hourly_rate: 177.78, multiplier: 2, amount: 888.9 },
    ]);
    expect(pay.total).toBe(3911.16);
    expect(pay.hours).toBe(12.5);
  });

  it("uses the company's multipliers", () => {
    const pay = overtimePayFor(row(), 45000, null, { ...DEFAULT_OVERTIME_SETTINGS, normalMultiplier: 1.25, restMultiplier: 1.75 });
    expect(pay.items.map((i) => i.amount)).toEqual([1500, 1400]);
  });

  it('no row, or overtime off: nothing', () => {
    expect(overtimePayFor(undefined, 40000, null, DEFAULT_OVERTIME_SETTINGS).items).toEqual([]);
    expect(overtimePayFor(row(), 40000, null, { ...DEFAULT_OVERTIME_SETTINGS, enabled: false }).total).toBe(0);
  });

  it('labels and working', () => {
    const [line] = overtimePayFor(row(), 40000, null, DEFAULT_OVERTIME_SETTINGS).items;
    expect(overtimeLineLabel(line)).toBe('Overtime (normal days): 6 h');
    expect(overtimeLineWorking(line)).toBe('6 h × KSh 177.78 × 1.5');
  });
});

describe('the monthly cap', () => {
  const entries = [
    { work_date: '2026-09-08', hours: 3, day_type: 'holiday' as const },
    { work_date: '2026-09-05', hours: 4, day_type: 'rest' as const },
    { work_date: '2026-09-10', hours: 5.5, day_type: 'normal' as const },
  ];

  it('pays the first hours of the month, in date order, up to the cap', () => {
    const { entries: paid, overCap } = capEntries(entries, 10);
    expect(paid.map((e) => [e.work_date, e.paid_hours])).toEqual([['2026-09-05', 4], ['2026-09-08', 3], ['2026-09-10', 3]]);
    expect(overCap).toBe(2.5);
    expect(hoursByType(paid)).toEqual({ normal: 3, rest: 4, holiday: 3 });
  });

  it('no cap pays everything', () => {
    expect(capEntries(entries, null).overCap).toBe(0);
    expect(hoursByType(capEntries(entries, null).entries)).toEqual({ normal: 5.5, rest: 4, holiday: 3 });
  });
});

describe('a payslip: entries, or the old field', () => {
  const settings = DEFAULT_OVERTIME_SETTINGS;
  const employee = { 'Employee Number': 'E1', overtime: '10', 'Overtime Rate': null };

  it('a month with approved entries uses them (the old field is ignored), with an average rate for older screens', () => {
    const ot = overtimeForPayslip({ rows: new Map([['E1', row()]]), settings }, employee, 40000);
    expect(ot).toMatchObject({ source: 'entries', hours: 10, pay: 3022.26, rate: 302.23 });
    expect(ot.items).toHaveLength(2);
    // someone without entries that month gets none
    expect(overtimeForPayslip({ rows: new Map([['E1', row()]]), settings }, { 'Employee Number': 'E2', overtime: '5' }, 40000).pay).toBe(0);
  });

  it('a month with no entries in the company falls back to employees.overtime x "Overtime Rate"', () => {
    expect(overtimeForPayslip({ rows: new Map(), settings }, { ...employee, 'Overtime Rate': 200 }, 40000))
      .toMatchObject({ source: 'employee record', hours: 10, rate: 200, pay: 2000, items: [] });
    expect(overtimeForPayslip(undefined, employee, 40000).pay).toBe(0);
  });

  it('overtime off pays nothing, not even the old field', () => {
    expect(overtimeForPayslip({ rows: new Map(), settings: { ...settings, enabled: false } }, { ...employee, 'Overtime Rate': 200 }, 40000).pay).toBe(0);
  });
});

describe('saved payslips', () => {
  const saved = {
    overtime_items: [
      { name: 'Overtime (normal days)', day_type: 'normal', hours: 6, hourly_rate: 177.78, multiplier: 1.5, amount: 1600.02 },
      { name: 'Overtime (rest days)', day_type: 'rest', hours: 4, hourly_rate: 177.78, multiplier: 2, amount: 1422.24 },
    ],
    overtime_hours: 10,
    overtime_rate: 302.23,
  };

  it('reads the lines and their total', () => {
    expect(payslipOvertimeLines(saved)).toHaveLength(2);
    expect(payslipOvertimePay(saved)).toBe(3022.26);
    expect(overtimeLinesText(saved)).toBe('Overtime (normal days): 6 h 1600.02; Overtime (rest days): 4 h 1422.24');
  });

  it('older payslips: hours x rate', () => {
    expect(payslipOvertimeLines({})).toEqual([]);
    expect(payslipOvertimePay({ overtime_hours: 5, overtime_rate: 300 })).toBe(1500);
    expect(payslipOvertimePay({ overtime_pay: 99 })).toBe(99);
  });
});

describe('settings', () => {
  it('defaults when the company has none; stored values otherwise', () => {
    expect(settingsFromRow(null)).toEqual(DEFAULT_OVERTIME_SETTINGS);
    expect(settingsFromRow({ overtime_enabled: false, overtime_normal_multiplier: '1.25', overtime_monthly_cap: '60', overtime_excluded_departments: ['d1'] }))
      .toMatchObject({ enabled: false, normalMultiplier: 1.25, restMultiplier: 2, monthlyCap: 60, excludedDepartments: ['d1'] });
  });

  it('checks the numbers', () => {
    expect(settingsProblems(DEFAULT_OVERTIME_SETTINGS)).toEqual([]);
    expect(settingsProblems({ ...DEFAULT_OVERTIME_SETTINGS, normalMultiplier: 0.5, monthlyHours: 0, monthlyCap: -1 })).toHaveLength(3);
  });
});

describe('a spreadsheet', () => {
  it('keeps good rows and says what is wrong with the rest', () => {
    const { entries, problems } = overtimeFromSheet(
      [
        { 'Employee Number': 'e1', Date: '2026-09-07', Hours: '2.5', Note: 'Harvest' },
        { 'Employee Number': 'NOPE', Date: '2026-09-07', Hours: 2 },
        { 'Employee Number': 'E1', Date: '07/09/2026', Hours: 2 },
        { 'Employee Number': 'E1', Date: '2026-09-08', Hours: 30 },
        { 'Employee Number': '', Date: '', Hours: '' },
      ],
      [{ employee_number: 'E1' }],
    );
    expect(entries).toEqual([{ employee_number: 'E1', work_date: '2026-09-07', hours: 2.5, note: 'Harvest' }]);
    expect(problems.map((p) => p.row)).toEqual([3, 4, 5]);
  });
});
