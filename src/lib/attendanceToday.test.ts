import { describe, expect, it } from 'vitest';
import type { AttendanceDay } from './attendance';
import { countByFilter, matchesFilter, nextSort, sortToday, todayCsv, todayStatusLabel, type TodayRow } from './attendanceToday';

const TODAY = '2026-10-23';
const day = (employeeNumber: string, fields: Partial<AttendanceDay> = {}): AttendanceDay => ({
  employeeNumber, day: TODAY, status: null, clockIn: null, clockOut: null, hours: null, lateMinutes: null, source: null, note: null, ...fields,
});
const row = (name: string, d: AttendanceDay): TodayRow => ({ name, day: d });
// 1 pm in Nairobi
const NOW = new Date('2026-10-23T10:00:00Z');

const ROWS = [
  row('Cate', day('E3', { status: null })),
  row('Amina', day('E1', { status: 'late', clockIn: '2026-10-23T05:40:00Z', lateMinutes: 10 })),
  row('Baraka', day('E2', { status: 'present', clockIn: '2026-10-23T04:55:00Z', clockOut: '2026-10-23T09:00:00Z', hours: 4.08 })),
  row('Dan', day('E4', { status: 'leave' })),
  row('Eve', day('E5', { status: 'late', clockIn: '2026-10-23T06:30:00Z', lateMinutes: 60 })),
];
const names = (rows: TodayRow[]) => rows.map((r) => r.name);

describe('the Today view', () => {
  it('labels each status', () => {
    expect(todayStatusLabel(day('E1', { status: 'present' }), TODAY)).toBe('On time');
    expect(todayStatusLabel(day('E1', { status: 'late', lateMinutes: 12 }), TODAY)).toBe('Late · 12 min');
    expect(todayStatusLabel(day('E1'), TODAY)).toBe('Not in yet');
    expect(todayStatusLabel(day('E1', { day: '2026-10-24' }), TODAY)).toBe('Not yet');
    expect(todayStatusLabel(day('E1', { status: 'off' }), TODAY)).toBe('Off');
    expect(todayStatusLabel(day('E1', { status: 'holiday' }), TODAY)).toBe('Holiday');
    expect(todayStatusLabel(day('E1', { status: 'leave' }), TODAY)).toBe('On leave');
    expect(todayStatusLabel(day('E1', { status: 'absent', day: '2026-10-22' }), TODAY)).toBe('Absent');
    expect(todayStatusLabel(day('E1', { counted: false, clockIn: '2026-10-23T05:00:00Z' }), TODAY)).toBe('Not counted');
  });

  it('sorts by arrival, earliest first, with people not in yet at the end either way', () => {
    expect(names(sortToday(ROWS, 'arrival', 'asc', TODAY, NOW))).toEqual(['Baraka', 'Amina', 'Eve', 'Cate', 'Dan']);
    expect(names(sortToday(ROWS, 'arrival', 'desc', TODAY, NOW))).toEqual(['Eve', 'Amina', 'Baraka', 'Cate', 'Dan']);
  });

  it('sorts by name, status, minutes late and hours', () => {
    expect(names(sortToday(ROWS, 'name', 'desc', TODAY, NOW))).toEqual(['Eve', 'Dan', 'Cate', 'Baraka', 'Amina']);
    expect(names(sortToday(ROWS, 'status', 'asc', TODAY, NOW))).toEqual(['Baraka', 'Amina', 'Eve', 'Cate', 'Dan']);
    expect(names(sortToday(ROWS, 'late', 'desc', TODAY, NOW))).toEqual(['Eve', 'Amina', 'Baraka', 'Cate', 'Dan']);
    // hours at 1 pm: Eve in since 9:30 (3h 30m so far), Baraka's 4.08, Amina in since 8:40 (4h 20m so far)
    expect(names(sortToday(ROWS, 'hours', 'asc', TODAY, NOW))).toEqual(['Eve', 'Baraka', 'Amina', 'Cate', 'Dan']);
  });

  it('reverses on a second click of the same header, and starts a new one from the first way round', () => {
    expect(nextSort({ key: 'arrival', dir: 'asc' }, 'arrival')).toEqual({ key: 'arrival', dir: 'desc' });
    expect(nextSort({ key: 'arrival', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
  });

  it('counts and filters: in, late, not in yet, on leave, off or holiday', () => {
    const days = [...ROWS.map((r) => r.day), day('E6', { status: 'off' }), day('E7', { status: 'holiday' }), day('E8', { counted: false })];
    expect(countByFilter(days, TODAY)).toEqual({ in: 3, late: 2, not_in: 1, absent: 0, leave: 1, off: 2 });
    expect(matchesFilter(day('E1', { status: 'present' }), 'in', TODAY)).toBe(true);
    expect(matchesFilter(day('E1', { status: 'present' }), 'late', TODAY)).toBe(false);
    expect(matchesFilter(day('E1', { counted: false }), 'not_in', TODAY)).toBe(false);
  });

  it('exports the day in the order shown', () => {
    const sorted = sortToday(ROWS, 'arrival', 'asc', TODAY, NOW).slice(0, 2);
    const people = new Map([['E2', { name: 'Baraka', department: 'Ops', branch: 'HQ' }]]);
    const csv = todayCsv(sorted, people, TODAY, new Map([['E2', 'Scanner broken']]), NOW);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe('Employee number,Name,Department,Branch,Date,Status,In,Out,Hours,Minutes late,Via,Reason');
    expect(lines[1]).toBe('E2,Baraka,Ops,HQ,2026-10-23,On time,07:55,12:00,4.08,,,Scanner broken');
    expect(lines[2]).toMatch(/^E1,Amina,,,2026-10-23,Late · 10 min,08:40,,4\.33,10,,$/);
  });
});
