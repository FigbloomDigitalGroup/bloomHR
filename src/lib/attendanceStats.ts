import { WEEK_DAYS, addDays, clockLabel, type AttendanceDay } from './attendance';
import { arrivalMinutes, countByFilter } from './attendanceToday';

// The dashboard's attendance figures (FIG-1203), from attendance_days over a range. Only working days count in a rate:
// present, late or absent. A day off, a public holiday, leave and a day before attendance counts ("Not counted") are
// left out of every rate. No database calls here.

type Day = Pick<AttendanceDay, 'employeeNumber' | 'day' | 'status' | 'counted' | 'clockIn' | 'lateMinutes'>;

/** A working day: present, late or absent, and counted. */
export const isWorkingDay = (d: Pick<AttendanceDay, 'status' | 'counted'>) =>
  d.counted !== false && (d.status === 'present' || d.status === 'late' || d.status === 'absent');

/** A day the person came in (on time or late), and counted. */
export const cameIn = (d: Pick<AttendanceDay, 'status' | 'counted'>) =>
  d.counted !== false && (d.status === 'present' || d.status === 'late');

/** A whole percentage, or null with nothing to divide by. */
export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

export interface Rate {
  attended: number;
  working: number;
  /** whole percent; null with no working days */
  rate: number | null;
}

/** Attended working days out of all working days. */
export function attendanceRate(days: Pick<AttendanceDay, 'status' | 'counted'>[]): Rate {
  let attended = 0;
  let working = 0;
  for (const d of days) {
    if (!isWorkingDay(d)) continue;
    working += 1;
    if (cameIn(d)) attended += 1;
  }
  return { attended, working, rate: percent(attended, working) };
}

export interface DayRate extends Rate {
  day: string;
}

/** The rate on each date that had any working days, in date order (days off for everyone are left out). */
export function rateByDay(days: Day[]): DayRate[] {
  const by = new Map<string, Day[]>();
  for (const d of days) {
    const list = by.get(d.day) ?? [];
    list.push(d);
    by.set(d.day, list);
  }
  return [...by.entries()]
    .map(([day, list]) => ({ day, ...attendanceRate(list) }))
    .filter((r) => r.working > 0)
    .sort((a, b) => a.day.localeCompare(b.day));
}

export interface Punctuality {
  onTime: number;
  arrivals: number;
  /** whole percent on time; null with no arrivals */
  share: number | null;
}

/** On-time arrivals out of all arrivals (present or late, counted). */
export function punctuality(days: Pick<AttendanceDay, 'status' | 'counted'>[]): Punctuality {
  let onTime = 0;
  let arrivals = 0;
  for (const d of days) {
    if (!cameIn(d)) continue;
    arrivals += 1;
    if (d.status === 'present') onTime += 1;
  }
  return { onTime, arrivals, share: percent(onTime, arrivals) };
}

/** The average clock-in time of those who came in, as minutes after midnight (Nairobi), or null. */
export function averageArrival(days: Pick<AttendanceDay, 'status' | 'counted' | 'clockIn'>[]): number | null {
  const mins = days.filter(cameIn).map((d) => arrivalMinutes(d.clockIn)).filter((m): m is number => m !== null);
  return mins.length ? Math.round(mins.reduce((t, m) => t + m, 0) / mins.length) : null;
}

/** Minutes after midnight as a clock time: 487 -> "8:07 am". */
export const minutesLabel = (m: number) => clockLabel(`${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

/** The average arrival on each date anyone came in, in date order. */
export function arrivalByDay(days: Day[]): { day: string; minutes: number }[] {
  const by = new Map<string, Day[]>();
  for (const d of days) {
    if (!cameIn(d)) continue;
    const list = by.get(d.day) ?? [];
    list.push(d);
    by.set(d.day, list);
  }
  return [...by.entries()]
    .map(([day, list]) => ({ day, minutes: averageArrival(list) }))
    .filter((r): r is { day: string; minutes: number } => r.minutes !== null)
    .sort((a, b) => a.day.localeCompare(b.day));
}

const isoWeekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

/** Late arrivals on each weekday, Monday first; Saturday and Sunday only when someone was late on one. */
export function lateByWeekday(days: Pick<AttendanceDay, 'day' | 'status' | 'counted'>[]): { name: string; value: number }[] {
  const counts = new Array(8).fill(0) as number[];
  for (const d of days) if (d.counted !== false && d.status === 'late') counts[isoWeekday(d.day)] += 1;
  return WEEK_DAYS.filter((w) => w.iso <= 5 || counts[w.iso] > 0).map((w) => ({ name: w.short, value: counts[w.iso] }));
}

export interface LatePerson {
  employeeNumber: string;
  count: number;
  minutes: number;
}

/** The people late most often (then by the most minutes late), up to `limit`. */
export function topLate(days: Pick<AttendanceDay, 'employeeNumber' | 'status' | 'counted' | 'lateMinutes'>[], limit = 5): LatePerson[] {
  const by = new Map<string, LatePerson>();
  for (const d of days) {
    if (d.counted === false || d.status !== 'late') continue;
    const p = by.get(d.employeeNumber) ?? { employeeNumber: d.employeeNumber, count: 0, minutes: 0 };
    p.count += 1;
    p.minutes += d.lateMinutes ?? 0;
    by.set(d.employeeNumber, p);
  }
  return [...by.values()]
    .sort((a, b) => b.count - a.count || b.minutes - a.minutes || a.employeeNumber.localeCompare(b.employeeNumber))
    .slice(0, limit);
}

/** The attendance rate of each department (people without one under "No department"), the highest first. */
export function rateByDepartment(
  days: Pick<AttendanceDay, 'employeeNumber' | 'status' | 'counted'>[],
  departmentOf: (employeeNumber: string) => string | null | undefined
): ({ name: string } & Rate)[] {
  const by = new Map<string, Pick<AttendanceDay, 'status' | 'counted'>[]>();
  for (const d of days) {
    if (!isWorkingDay(d)) continue;
    const name = departmentOf(d.employeeNumber) || 'No department';
    const list = by.get(name) ?? [];
    list.push(d);
    by.set(name, list);
  }
  return [...by.entries()]
    .map(([name, list]) => ({ name, ...attendanceRate(list) }))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------
// the dashboard's windows
// ---------------------------------------------------------------------------------------------
/** The range the dashboard reads in one call: the first of last month, or 30 days back if earlier, up to today. */
export function dashboardRange(today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const lastMonth = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
  const back30 = addDays(today, -30);
  return { from: back30 < lastMonth ? back30 : lastMonth, to: today };
}

/** "2026-10" for a date's month, and the month before it. */
export const monthOf = (date: string) => date.slice(0, 7);
export const previousMonth = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

export interface TodaySnapshot {
  in: number;
  late: number;
  notIn: number;
  leave: number;
  /** average arrival of those in, minutes after midnight */
  averageArrival: number | null;
}

/** Today's figures for the dashboard card. */
export function todaySnapshot(days: Day[], today: string): TodaySnapshot {
  const todays = days.filter((d) => d.day === today);
  const c = countByFilter(todays, today);
  return { in: c.in, late: c.late, notIn: c.not_in, leave: c.leave, averageArrival: averageArrival(todays) };
}

export interface AttendanceAnalytics {
  /** the 30 days before today (today is left out: it isn't over) */
  rate: Rate;
  daily: DayRate[];
  punctualityThisMonth: Punctuality;
  punctualityLastMonth: Punctuality;
  arrivalTrend: { day: string; minutes: number }[];
  averageArrival: number | null;
  lateByWeekday: { name: string; value: number }[];
  topLate: LatePerson[];
  byDepartment: ({ name: string } & Rate)[];
}

/** Everything the dashboard's Attendance section shows, from one read of attendance_days. */
export function attendanceAnalytics(
  days: Day[],
  today: string,
  departmentOf: (employeeNumber: string) => string | null | undefined
): AttendanceAnalytics {
  const from = addDays(today, -30);
  const last30 = days.filter((d) => d.day >= from && d.day < today);
  // arrivals can include today's: whoever came in today has arrived
  const arrivals30 = days.filter((d) => d.day >= from && d.day <= today);
  const thisMonth = monthOf(today);
  const lastMonth = previousMonth(today);
  return {
    rate: attendanceRate(last30),
    daily: rateByDay(last30),
    punctualityThisMonth: punctuality(days.filter((d) => monthOf(d.day) === thisMonth && d.day <= today)),
    punctualityLastMonth: punctuality(days.filter((d) => monthOf(d.day) === lastMonth)),
    arrivalTrend: arrivalByDay(arrivals30),
    averageArrival: averageArrival(arrivals30),
    lateByWeekday: lateByWeekday(arrivals30),
    topLate: topLate(days.filter((d) => monthOf(d.day) === thisMonth && d.day <= today)),
    byDepartment: rateByDepartment(last30, departmentOf),
  };
}

/** Has anyone ever clocked in over the range (a scanner or the app)? Before then the dashboard shows how to start. */
export const hasAnyClockIn = (days: Pick<AttendanceDay, 'clockIn'>[]) => days.some((d) => !!d.clockIn);
