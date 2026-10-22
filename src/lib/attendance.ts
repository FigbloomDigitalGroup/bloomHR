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
  /** a clock-in at odd hours, e.g. "Clocked in at 12:01 am, before 5:00 am" (migration 20261023800000) */
  flag?: string | null;
  /** false: a day before the company's "Count attendance from" (no status, not counted anywhere) */
  counted?: boolean;
  /** the person's schedule end time that day, "HH:MM" (migration 20261024100000) */
  endTime?: string | null;
  /** where the clock-out came from: a scanner punch, the app's Clock out or HR's correction */
  clockOutVia?: ClockOutVia | null;
  /** where an app clock-in was made (FIG-1200) */
  place?: ClockPlace | null;
  /** "Office network", "Near Nairobi (120 m)", "Remote day", "No location" */
  placeDetail?: string | null;
  /** the location the app sent with the clock-in */
  placeLocation?: { latitude: number; longitude: number } | null;
}

export type ClockOutVia = 'scanner' | 'app' | 'hr';
export type ClockPlace = 'office' | 'remote' | 'field';

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
  /** where the clock-out came from, the record's source and the clock-in's place (migration 20261024100000) */
  clockOutVia?: ClockOutVia | null;
  source?: string | null;
  place?: ClockPlace | null;
  placeDetail?: string | null;
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

/** A day's status as the day view shows it: "Not counted" before attendance counts, else its label ("Not yet"...). */
export const dayStatusLabel = (d: Pick<AttendanceDay, 'status' | 'counted'>) =>
  d.counted === false ? 'Not counted' : statusLabel(d.status);

/**
 * A day's hours as shown: the recorded hours; today with a clock-in and no clock-out yet, the time so far (now minus
 * the clock-in, `open: 'so_far'`); a past day with a clock-in and no clock-out, none (`open: 'missing'`). The database
 * keeps hours empty until there is a clock-out; this is for showing only.
 */
export function dayHours(
  d: Pick<AttendanceDay, 'day' | 'clockIn' | 'clockOut' | 'hours'> & Partial<Pick<AttendanceDay, 'clockOutVia' | 'endTime'>>,
  today: string,
  now: Date = new Date()
): { hours: number | null; open: 'so_far' | 'missing' | null } {
  // a scanner's last scan today before the end of the day isn't a clock-out yet: hours so far
  if (isLastScan(d, today, now)) return { hours: hoursBetween(d.clockIn, null, now), open: 'so_far' };
  if (d.clockIn && !d.clockOut) {
    if (d.day === today) return { hours: hoursBetween(d.clockIn, null, now), open: 'so_far' };
    if (d.day < today) return { hours: null, open: 'missing' };
  }
  return { hours: d.hours, open: null };
}

/**
 * Is the day's clock-out really a scanner's last scan so far? Today, before the person's schedule end time, the latest
 * scan from a scanner shows as "Last scan 2:48 pm", not a clock-out (they may well scan again). Once the end time has
 * passed, and on any past day, it is the clock-out; an app Clock out or HR's correction is a clock-out straight away.
 * Display only: leaving early isn't judged.
 */
export function isLastScan(
  d: Pick<AttendanceDay, 'day' | 'clockIn' | 'clockOut'> & Partial<Pick<AttendanceDay, 'clockOutVia' | 'endTime'>>,
  today: string,
  now: Date = new Date()
): boolean {
  if (!d.clockIn || !d.clockOut || d.clockOutVia !== 'scanner' || d.day !== today || !d.endTime) return false;
  return nairobiParts(now).time < d.endTime.slice(0, 5);
}

/** The clock-out as shown: "5:04 pm", or "Last scan 2:48 pm" (isLastScan), or a dash. */
export function clockOutLabel(
  d: Pick<AttendanceDay, 'day' | 'clockIn' | 'clockOut'> & Partial<Pick<AttendanceDay, 'clockOutVia' | 'endTime'>>,
  today: string,
  now: Date = new Date()
): string {
  return isLastScan(d, today, now) ? `Last scan ${formatTime(d.clockOut)}` : formatTime(d.clockOut);
}

/** "8h 30m", "2h 10m so far" (today, still in) or "No clock-out" (a past day). */
export function dayHoursLabel(
  d: Pick<AttendanceDay, 'day' | 'clockIn' | 'clockOut' | 'hours'> & Partial<Pick<AttendanceDay, 'clockOutVia' | 'endTime'>>,
  today: string,
  now: Date = new Date()
): string {
  const h = dayHours(d, today, now);
  if (h.open === 'so_far') return `${formatHours(h.hours)} so far`;
  if (h.open === 'missing') return 'No clock-out';
  return formatHours(h.hours);
}

export interface OpenDays {
  /** hours so far today (clocked in, not out yet) */
  soFar: number;
  inNow: boolean;
  /** past days with a clock-in and no clock-out */
  missing: number;
}

/** Per person: today's time so far while still clocked in, and past days without a clock-out (for HR to correct). */
export function openDaysByPerson(days: AttendanceDay[], today: string, now: Date = new Date()): Map<string, OpenDays> {
  const out = new Map<string, OpenDays>();
  for (const d of days) {
    const h = dayHours(d, today, now);
    if (!h.open) continue;
    const o = out.get(d.employeeNumber) ?? { soFar: 0, inNow: false, missing: 0 };
    if (h.open === 'so_far') {
      // a scanner's last scan so far: its recorded hours are already in the summary, so only the time since counts
      o.soFar += isLastScan(d, today, now) ? Math.max(0, (h.hours ?? 0) - (d.hours ?? 0)) : h.hours ?? 0;
      o.inNow = true;
    } else {
      o.missing += 1;
    }
    out.set(d.employeeNumber, o);
  }
  return out;
}

/** The summary's hours: "17h 30m", or "19h 40m so far" while someone is still in today. */
export const totalHoursLabel = (hours: number, open?: OpenDays) =>
  open?.inNow ? `${formatHours(hours + open.soFar)} so far` : formatHours(hours);

/** "1 day without a clock-out", "3 days without a clock-out". */
export const missingClockOutLabel = (n: number) => `${n} ${n === 1 ? 'day' : 'days'} without a clock-out`;

/** How many flagged (odd-hours) days each person has. */
export function flaggedByPerson(days: AttendanceDay[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of days) if (d.flag) out.set(d.employeeNumber, (out.get(d.employeeNumber) ?? 0) + 1);
  return out;
}

// ---------------------------------------------------------------------------------------------
// every scan of a day (attendance_day_scans, migration 20261023800000)
// ---------------------------------------------------------------------------------------------
export type ScanVia = 'scanner' | 'app' | 'hr';
/** the clock-in, the clock-out, a scan in between, one held back (not counted) or one not applied yet */
export type ScanKind = 'clock_in' | 'clock_out' | 'between' | 'held' | 'waiting';

export interface DayScan {
  /** ISO moment */
  at: string;
  via: ScanVia;
  scannerName: string | null;
  kind: ScanKind;
  /** why a scan was held back: 'clock_ahead', 'hr_corrected' */
  reason: string | null;
}

const KIND_LABEL: Record<ScanKind, string> = {
  clock_in: 'clock-in',
  clock_out: 'clock-out',
  between: '',
  held: 'not counted',
  waiting: 'not counted yet',
};

const REASON_LABEL: Record<string, string> = {
  clock_ahead: "the scanner's clock was ahead",
  hr_corrected: 'HR corrected this day',
};

/** Where a scan came from: the scanner's name, "App" ("App · office" with the clock-in's place) or "HR correction". */
export const scanSource = (s: Pick<DayScan, 'via' | 'scannerName'>, place?: ClockPlace | null) =>
  s.via === 'app' ? appLabel(place) : s.via === 'hr' ? 'HR correction' : s.scannerName || 'Scanner';

/** What a scan was: "clock-in", "clock-out", "" (in between) or "not counted (the scanner's clock was ahead)". */
export function scanRole(s: Pick<DayScan, 'kind' | 'reason'>): string {
  const label = KIND_LABEL[s.kind] ?? '';
  if (s.kind === 'held' && s.reason) return `${label} (${REASON_LABEL[s.reason] ?? s.reason.replace(/_/g, ' ')})`;
  return label;
}

/** One line of a day's scans: "7:55 am · Front Door · clock-in", "12:30 pm · Front Door", "8:02 am · App · clock-in". */
export const scanLine = (s: DayScan, place?: ClockPlace | null) =>
  [formatTime(s.at), scanSource(s, s.kind === 'clock_in' ? place : null), scanRole(s)].filter(Boolean).join(' · ');

// ---------------------------------------------------------------------------------------------
// where a clock-in was made (migration 20261024100000, FIG-1200)
// ---------------------------------------------------------------------------------------------
/** "App", "App · office", "App · remote", "App · field". */
export const appLabel = (place?: ClockPlace | null) => (place ? `App · ${place}` : 'App');

/** How a day's clock-in was made: "Scanner", "HR correction", "App · office" ...; '' with no record. */
export function clockedInVia(d: Pick<AttendanceDay, 'source'> & Partial<Pick<AttendanceDay, 'place'>>): string {
  if (d.source === 'scanner') return 'Scanner';
  if (d.source === 'hr') return 'HR correction';
  if (d.source === 'app') return appLabel(d.place);
  return '';
}

/** The place's detail: "Office network", "Near Nairobi (120 m)", "No location", or a field clock-in's coordinates. */
export function placeText(d: Partial<Pick<AttendanceDay, 'place' | 'placeDetail' | 'placeLocation'>>): string {
  if (d.placeDetail) return d.placeDetail;
  if (d.place === 'field' && d.placeLocation) return `${d.placeLocation.latitude.toFixed(5)}, ${d.placeLocation.longitude.toFixed(5)}`;
  return '';
}

/** A map link for a field clock-in's location, or null. */
export const placeMapUrl = (d: Partial<Pick<AttendanceDay, 'place' | 'placeLocation'>>) =>
  d.place === 'field' && d.placeLocation
    ? `https://www.google.com/maps?q=${d.placeLocation.latitude},${d.placeLocation.longitude}`
    : null;

export type ClockInPolicy = 'anywhere' | 'office' | 'scanner_only';
export type WorkArrangement = 'on_site' | 'hybrid' | 'remote' | 'field';

export const CLOCK_IN_POLICY_LABEL: Record<ClockInPolicy, string> = {
  anywhere: 'Anywhere',
  office: 'Only from an office',
  scanner_only: 'Scanner only',
};

export const WORK_ARRANGEMENT_LABEL: Record<WorkArrangement, string> = {
  on_site: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
  field: 'Field',
};

export const WORK_ARRANGEMENT_HINT: Record<WorkArrangement, string> = {
  on_site: "Follows the company's clock-in policy.",
  hybrid: "Clocks in from anywhere on their remote days; the company's policy on the others.",
  remote: 'Clocks in from anywhere, any day.',
  field: 'Clocks in from anywhere, any day; where they are is recorded.',
};

/** Office networks typed one per line (or comma or space separated): trimmed, blanks dropped, each once. */
export const parseNetworks = (text: string) => [...new Set(text.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];

// ---------------------------------------------------------------------------------------------
// odd-hours clock-ins (migration 20261023800000)
// ---------------------------------------------------------------------------------------------
/** The built-in "odd-hours clock-in before" time. */
export const DEFAULT_ODD_HOURS_UNTIL = '05:00';

/** What is wrong with an odd-hours time ("HH:MM"), or null: from 00:00 (never flag) to 12:00. */
export function oddHoursProblem(hhmm: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return 'Enter a time';
  if (hhmm > '12:00') return 'Choose a time from 00:00 to 12:00';
  return null;
}

/** The setting as a sentence: "Clock-ins after midnight and before 5:00 am are flagged." */
export function oddHoursSummary(hhmm: string): string {
  if (hhmm === '00:00') return "Odd-hours clock-ins aren't flagged.";
  return `Clock-ins after midnight and before ${clockLabel(hhmm)} are flagged.`;
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------
export const ATTENDANCE_CSV_HEADERS = [
  'Employee number', 'Name', 'Department', 'Branch', 'Date', 'Status', 'Clock in', 'Clock out', 'Hours', 'Minutes late', 'Note',
  'Clocked in via', 'Place',
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
      clockedInVia(d),
      placeText(d),
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
