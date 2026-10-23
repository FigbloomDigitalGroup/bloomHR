import { describe, expect, it } from 'vitest';
import type { AttendanceDay } from './attendance';
import {
  arrivalByDay,
  attendanceAnalytics,
  attendanceRate,
  averageArrival,
  dashboardRange,
  hasAnyClockIn,
  lateByWeekday,
  minutesLabel,
  previousMonth,
  punctuality,
  rateByDay,
  rateByDepartment,
  todaySnapshot,
  topLate,
} from './attendanceStats';

const day = (employeeNumber: string, d: string, fields: Partial<AttendanceDay> = {}): AttendanceDay => ({
  employeeNumber, day: d, status: null, clockIn: null, clockOut: null, hours: null, lateMinutes: null, source: null, note: null, ...fields,
});
// Nairobi is UTC+3: 05:05Z is 8:05 am
const at = (d: string, utc: string) => `${d}T${utc}:00Z`;

describe('attendance rate', () => {
  it('counts working days only: off, holiday, leave and not-counted days are left out', () => {
    const r = attendanceRate([
      day('E1', '2026-10-19', { status: 'present' }),
      day('E1', '2026-10-20', { status: 'late' }),
      day('E1', '2026-10-21', { status: 'absent' }),
      day('E1', '2026-10-22', { status: 'leave' }),
      day('E1', '2026-10-23', { status: 'holiday' }),
      day('E1', '2026-10-24', { status: 'off' }),
      day('E1', '2026-10-16', { status: null, counted: false, clockIn: at('2026-10-16', '05:00') }),
      day('E1', '2026-10-15', { status: 'absent', counted: false }),
      day('E1', '2026-10-26', { status: null }),
    ]);
    expect(r).toEqual({ attended: 2, working: 3, rate: 67 });
  });

  it('has no rate without working days', () => {
    expect(attendanceRate([day('E1', '2026-10-24', { status: 'off' })]).rate).toBeNull();
  });

  it('gives each date with working days its own rate, in date order', () => {
    const r = rateByDay([
      day('E2', '2026-10-20', { status: 'absent' }),
      day('E1', '2026-10-20', { status: 'present' }),
      day('E1', '2026-10-19', { status: 'late' }),
      day('E1', '2026-10-18', { status: 'off' }),
    ]);
    expect(r.map((x) => [x.day, x.rate])).toEqual([['2026-10-19', 100], ['2026-10-20', 50]]);
  });
});

describe('punctuality', () => {
  it('is on-time arrivals out of all arrivals', () => {
    expect(punctuality([
      day('E1', '2026-10-19', { status: 'present' }),
      day('E1', '2026-10-20', { status: 'present' }),
      day('E1', '2026-10-21', { status: 'late' }),
      day('E1', '2026-10-22', { status: 'absent' }),
      day('E1', '2026-10-16', { status: 'late', counted: false }),
    ])).toEqual({ onTime: 2, arrivals: 3, share: 67 });
    expect(punctuality([]).share).toBeNull();
  });
});

describe('average arrival', () => {
  it('averages the clock-in times of those who came in (Nairobi time)', () => {
    const days = [
      day('E1', '2026-10-19', { status: 'present', clockIn: at('2026-10-19', '05:00') }), // 8:00
      day('E2', '2026-10-19', { status: 'late', clockIn: at('2026-10-19', '06:10') }), // 9:10
      day('E3', '2026-10-19', { status: 'leave', clockIn: at('2026-10-19', '09:00') }), // not counted: on leave
    ];
    expect(averageArrival(days)).toBe(8 * 60 + 35);
    expect(minutesLabel(8 * 60 + 35)).toBe('8:35 am');
    expect(averageArrival([])).toBeNull();
  });

  it('trends by day', () => {
    expect(arrivalByDay([
      day('E1', '2026-10-20', { status: 'present', clockIn: at('2026-10-20', '05:00') }),
      day('E1', '2026-10-19', { status: 'present', clockIn: at('2026-10-19', '04:30') }),
      day('E2', '2026-10-19', { status: 'present', clockIn: at('2026-10-19', '05:30') }),
    ])).toEqual([{ day: '2026-10-19', minutes: 480 }, { day: '2026-10-20', minutes: 480 }]);
  });
});

describe('late arrivals', () => {
  it('counts them by weekday, Monday first, with the weekend only when someone was late on it', () => {
    const days = [
      day('E1', '2026-10-19', { status: 'late' }), // Mon
      day('E2', '2026-10-19', { status: 'late' }), // Mon
      day('E1', '2026-10-23', { status: 'late' }), // Fri
      day('E1', '2026-10-22', { status: 'present' }),
      day('E1', '2026-10-16', { status: 'late', counted: false }),
    ];
    expect(lateByWeekday(days)).toEqual([
      { name: 'Mon', value: 2 }, { name: 'Tue', value: 0 }, { name: 'Wed', value: 0 }, { name: 'Thu', value: 0 }, { name: 'Fri', value: 1 },
    ]);
    expect(lateByWeekday([day('E1', '2026-10-24', { status: 'late' })]).map((r) => r.name)).toContain('Sat');
  });

  it('lists the five people late most often, then by minutes', () => {
    const days = [
      ...['E1', 'E1', 'E2', 'E2', 'E3', 'E4', 'E5', 'E6'].map((e, i) => day(e, `2026-10-${String(10 + i).padStart(2, '0')}`, { status: 'late', lateMinutes: e === 'E2' ? 30 : 5 })),
      day('E7', '2026-10-19', { status: 'present' }),
    ];
    const top = topLate(days);
    expect(top).toHaveLength(5);
    expect(top[0]).toEqual({ employeeNumber: 'E2', count: 2, minutes: 60 });
    expect(top[1]).toEqual({ employeeNumber: 'E1', count: 2, minutes: 10 });
    expect(top.map((p) => p.employeeNumber)).not.toContain('E7');
  });
});

describe('by department', () => {
  it('gives each department its rate, the highest first, with people without one together', () => {
    const dept: Record<string, string> = { E1: 'Sales', E2: 'Sales', E3: 'Ops' };
    const r = rateByDepartment([
      day('E1', '2026-10-19', { status: 'present' }),
      day('E2', '2026-10-19', { status: 'absent' }),
      day('E3', '2026-10-19', { status: 'late' }),
      day('E3', '2026-10-20', { status: 'leave' }),
      day('E9', '2026-10-19', { status: 'absent' }),
    ], (e) => dept[e]);
    expect(r.map((x) => [x.name, x.rate])).toEqual([['Ops', 100], ['Sales', 50], ['No department', 0]]);
  });
});

describe('the dashboard', () => {
  it('reads from the first of last month, or 30 days back if earlier', () => {
    expect(dashboardRange('2026-10-23')).toEqual({ from: '2026-09-01', to: '2026-10-23' });
    expect(dashboardRange('2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-03-31' });
    expect(dashboardRange('2026-03-02')).toEqual({ from: '2026-01-31', to: '2026-03-02' });
    expect(dashboardRange('2026-01-15')).toEqual({ from: '2025-12-01', to: '2026-01-15' });
    expect(previousMonth('2026-01-15')).toBe('2025-12');
  });

  it("sums up today: in, late, not in yet, on leave and the average arrival", () => {
    const today = '2026-10-23';
    const s = todaySnapshot([
      day('E1', today, { status: 'present', clockIn: at(today, '05:00') }),
      day('E2', today, { status: 'late', clockIn: at(today, '06:00'), lateMinutes: 30 }),
      day('E3', today, { status: null }),
      day('E4', today, { status: 'leave' }),
      day('E5', today, { status: 'off' }),
      day('E1', '2026-10-22', { status: 'absent' }),
    ], today);
    expect(s).toEqual({ in: 2, late: 1, notIn: 1, leave: 1, averageArrival: 8 * 60 + 30 });
  });

  it('leaves today out of the 30-day rate, and splits punctuality by month', () => {
    const today = '2026-10-02';
    const a = attendanceAnalytics([
      day('E1', '2026-09-30', { status: 'late', clockIn: at('2026-09-30', '06:00'), lateMinutes: 10 }),
      day('E1', '2026-10-01', { status: 'present', clockIn: at('2026-10-01', '05:00') }),
      day('E1', today, { status: 'present', clockIn: at(today, '05:00') }),
      day('E2', today, { status: null }),
      day('E2', '2026-10-01', { status: 'absent' }),
    ], today, () => 'Sales');
    expect(a.rate).toEqual({ attended: 2, working: 3, rate: 67 });
    expect(a.punctualityThisMonth).toEqual({ onTime: 2, arrivals: 2, share: 100 });
    expect(a.punctualityLastMonth).toEqual({ onTime: 0, arrivals: 1, share: 0 });
    expect(a.topLate).toEqual([]);
    expect(a.byDepartment).toEqual([{ name: 'Sales', attended: 2, working: 3, rate: 67 }]);
    expect(hasAnyClockIn([day('E1', today)])).toBe(false);
  });
});
