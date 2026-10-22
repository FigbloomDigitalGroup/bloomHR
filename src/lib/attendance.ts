import { toCsv } from './payrollExports';

// Clock in / clock out and the days HR sees (migration 20261023300000): labels, times in Nairobi, the week, the
// per-person summary, the CSV and the checks on a correction. No database calls here (attendanceApi.ts).

/** How a day is classed (attendance_days); null: today (until it is over) or a future day with no clock-in yet. */
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave' | 'holiday' | 'off';

export interface AttendanceDay {
  employeeNumber: string;
  /** YYYY-MM-DD */
  day: string;
  status: AttendanceStatus | null;
  clockIn: string | null;
  clockOut: string | null;
  hours: number | null;
  lateMinutes: number | null;
  source: string | null;
  note: string | null;
}

/** The signed-in employee's day, for the portal card (attendance_today). */
export interface AttendanceToday {
  date: string;
  status: AttendanceStatus | null;
  clockIn: string | null;
  clockOut: string | null;
  lateMinutes: number | null;
  workingDay: boolean;
  /** "HH:MM" */
  startTime: string;
  endTime: string;
  lateAfter: string;
  graceMinutes: number;
}

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  leave: 'On leave',
  holiday: 'Holiday',
  off: 'Day off',
};

export const STATUS_TONE: Record<AttendanceStatus, 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'neutral'> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  leave: 'info',
  holiday: 'purple',
  off: 'neutral',
};

/** The label of a day's status; a day not over yet with no clock-in is "Not yet". */
export const statusLabel = (s: AttendanceStatus | null) => (s ? STATUS_LABEL[s] : 'Not yet');

/** Every time in the app is a Nairobi time (Tanzania and Uganda are on the same clock, with no summer time). */
export const ATTENDANCE_TZ = 'Africa/Nairobi';
const NAIROBI_OFFSET = '+03:00';

const pad = (n: number) => String(n).padStart(2, '0');

/** The Nairobi date and 24-hour time of a moment: { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function nairobiParts(at: string | Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ATTENDANCE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(typeof at === 'string' ? new Date(at) : at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** Today's date in Nairobi. */
export const nairobiToday = (now: Date = new Date()) => nairobiParts(now).date;

/** A Nairobi date and "HH:MM" as the moment it is (ISO, UTC). */
export const nairobiToIso = (date: string, time: string) => new Date(`${date}T${time}:00${NAIROBI_OFFSET}`).toISOString();

/** "08:30" -> "8:30 am", "13:05" -> "1:05 pm", "00:15" -> "12:15 am". */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`;
}

/** A moment as a Nairobi clock time ("8:05 am"), or a dash. */
export const formatTime = (at: string | null | undefined) => (at ? clockLabel(nairobiParts(at).time) : '—');

/** Hours as "8h 30m" (or "45m"), or a dash. */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '—';
  const minutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : `${h}h ${pad(m)}m`;
}

/** Hours from a clock-in to a clock-out (or to now, while still clocked in). */
export function hoursBetween(from: string | null, to: string | null, now: Date = new Date()): number | null {
  if (!from) return null;
  const end = to ? new Date(to).getTime() : now.getTime();
  return Math.max(0, (end - new Date(from).getTime()) / 3_600_000);
}

/** Minutes late as "25 min late" or "1h 05m late". */
export const lateLabel = (minutes: number | null | undefined) =>
  minutes ? `${minutes < 60 ? `${minutes} min` : formatHours(minutes / 60)} late` : '';

/** The portal card's line: "Expected 8:00 am · late after 8:30 am". */
export const scheduleLine = (t: Pick<AttendanceToday, 'startTime' | 'lateAfter'>) =>
  `Expected ${clockLabel(t.startTime)} · late after ${clockLabel(t.lateAfter)}`;

// ---------------------------------------------------------------------------------------------
// days and weeks
// ---------------------------------------------------------------------------------------------
const asUtc = (date: string) => new Date(`${date}T00:00:00Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (date: string, n: number) => {
  const d = asUtc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
};

/** The Monday to Sunday week a date is in. */
export function weekOf(date: string): { from: string; to: string } {
  const isoDow = asUtc(date).getUTCDay() || 7;
  const from = addDays(date, 1 - isoDow);
  return { from, to: addDays(from, 6) };
}

/** Days from one date to another, both included (0 when the range is backwards). */
export const daysInRange = (from: string, to: string) =>
  Math.max(0, Math.round((asUtc(to).getTime() - asUtc(from).getTime()) / 86_400_000) + 1);

/** "Mon 19 Oct" */
export const dayLabel = (date: string) =>
  asUtc(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export const WEEK_DAYS = [
  { iso: 1, short: 'Mon' },
  { iso: 2, short: 'Tue' },
  { iso: 3, short: 'Wed' },
  { iso: 4, short: 'Thu' },
  { iso: 5, short: 'Fri' },
  { iso: 6, short: 'Sat' },
  { iso: 7, short: 'Sun' },
] as const;

/** [1,2,3,4,5] -> "Mon–Fri"; [1,3,5] -> "Mon, Wed, Fri". */
export function workDaysLabel(days: number[]): string {
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (sorted.length === 0) return 'No days';
  if (sorted.length === 7) return 'Every day';
  const name = (d: number) => WEEK_DAYS[d - 1].short;
  const runs = sorted.length > 2 && sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  return runs ? `${name(sorted[0])}–${name(sorted[sorted.length - 1])}` : sorted.map(name).join(', ');
}

// ---------------------------------------------------------------------------------------------
// attendance schedules against the leave and payroll work week (FIG-888)
// ---------------------------------------------------------------------------------------------
/** The days (1 = Monday) a leave and payroll work week (7 numbers, Monday first) works at all, half days included. */
export const workWeekIsoDays = (week: readonly number[]) => week.flatMap((d, i) => (Number(d) > 0 ? [i + 1] : []));

const sameDays = (a: readonly number[], b: readonly number[]) => {
  const x = [...new Set(a)].sort((m, n) => m - n);
  const y = [...new Set(b)].sort((m, n) => m - n);
  return x.length === y.length && x.every((d, i) => d === y[i]);
};

export interface WorkDaysCheck {
  /** the company's attendance schedule (or the built-in one) and each branch's own */
  companyDays: number[];
  branches: { name: string; workDays: number[] }[];
  /** the company's leave and payroll work week, and departments with their own */
  companyWeek: readonly number[];
  departments: { name: string; workWeek: readonly number[] | null | undefined }[];
}

/**
 * Where attendance and leave/payroll disagree about which days are worked, as sentences for HR: someone could be
 * marked absent on a day leave and payroll treat as a day off, or the other way round.
 */
export function workDaysMismatches({ companyDays, branches, companyWeek, departments }: WorkDaysCheck): string[] {
  const week = workWeekIsoDays(companyWeek);
  const out: string[] = [];
  if (!sameDays(companyDays, week)) {
    out.push(`The company's attendance schedule works ${workDaysLabel(companyDays)}, but leave and payroll count ${workDaysLabel(week)}.`);
  }
  for (const b of branches) {
    if (!sameDays(b.workDays, week)) {
      out.push(`${b.name}'s attendance schedule works ${workDaysLabel(b.workDays)}, but leave and payroll count ${workDaysLabel(week)}.`);
    }
  }
  for (const d of departments) {
    if (!d.workWeek) continue;
    const days = workWeekIsoDays(d.workWeek);
    if (!sameDays(days, companyDays)) {
      out.push(`${d.name} works ${workDaysLabel(days)} for leave and payroll, but attendance expects ${workDaysLabel(companyDays)} unless their branch has its own schedule.`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// the summary per person
// ---------------------------------------------------------------------------------------------
export interface AttendanceSummary {
  employeeNumber: string;
  /** days they came in (on time or late) */
  present: number;
  late: number;
  absent: number;
  leave: number;
  /** working days so far: present + absent (leave and holidays don't count) */
  workingDays: number;
  hours: number;
  lateMinutes: number;
}

export function summarise(days: AttendanceDay[]): AttendanceSummary[] {
  const by = new Map<string, AttendanceSummary>();
  for (const d of days) {
    let s = by.get(d.employeeNumber);
    if (!s) {
      s = { employeeNumber: d.employeeNumber, present: 0, late: 0, absent: 0, leave: 0, workingDays: 0, hours: 0, lateMinutes: 0 };
      by.set(d.employeeNumber, s);
    }
    if (d.status === 'present' || d.status === 'late') {
      s.present += 1;
      s.workingDays += 1;
    }
    if (d.status === 'late') {
      s.late += 1;
      s.lateMinutes += d.lateMinutes ?? 0;
    }
    if (d.status === 'absent') {
      s.absent += 1;
      s.workingDays += 1;
    }
    if (d.status === 'leave') s.leave += 1;
    s.hours += d.hours ?? 0;
  }
  return [...by.values()];
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------
export const ATTENDANCE_CSV_HEADERS = [
  'Employee number', 'Name', 'Department', 'Branch', 'Date', 'Status', 'Clock in', 'Clock out', 'Hours', 'Minutes late', 'Note',
] as const;

export interface CsvPerson {
  name: string;
  department: string;
  branch: string;
}

export function attendanceCsv(days: AttendanceDay[], people: Map<string, CsvPerson>): string {
  const rows = days.map((d) => {
    const p = people.get(d.employeeNumber);
    return [
      d.employeeNumber,
      p?.name ?? '',
      p?.department ?? '',
      p?.branch ?? '',
      d.day,
      statusLabel(d.status),
      d.clockIn ? nairobiParts(d.clockIn).time : '',
      d.clockOut ? nairobiParts(d.clockOut).time : '',
      d.hours === null ? '' : d.hours.toFixed(2),
      d.lateMinutes ? String(d.lateMinutes) : '',
      d.note ?? '',
    ];
  });
  return toCsv(ATTENDANCE_CSV_HEADERS, rows);
}

// ---------------------------------------------------------------------------------------------
// correcting a day
// ---------------------------------------------------------------------------------------------
/** What is wrong with a correction (clock-in and clock-out on the day, "HH:MM"), or null when it can be saved. */
export function correctionProblem(inTime: string, outTime: string, note: string): string | null {
  if (!inTime) return 'Enter the clock-in time';
  if (outTime && outTime <= inTime) return 'The clock-out time must be after the clock-in time';
  if (!note.trim()) return 'Add a note saying why the day is being corrected';
  if (note.trim().length > 500) return 'Keep the note to 500 characters';
  return null;
}
