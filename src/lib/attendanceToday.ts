import { toCsv } from './payrollExports';
import {
  clockedInVia,
  dayHours,
  isLastScan,
  nairobiParts,
  type AttendanceDay,
  type CsvPerson,
} from './attendance';

// The Attendance page's "Today" view (FIG-1203): one day, one row per person, who arrived when. The status each row
// shows, the quick counts that double as filters, the sort orders and the CSV. No database calls here.

/** How one person's day reads in the Today view. */
export type TodayKind = 'on_time' | 'late' | 'not_in' | 'not_yet' | 'absent' | 'leave' | 'holiday' | 'off' | 'not_counted';

/**
 * The day's kind: "not in yet" is today, a working day with no clock-in yet; a later date with nothing yet is
 * "not yet"; a day before attendance counts is "not counted".
 */
export function todayKind(d: Pick<AttendanceDay, 'day' | 'status' | 'counted'>, today: string): TodayKind {
  if (d.counted === false) return 'not_counted';
  switch (d.status) {
    case 'present':
      return 'on_time';
    case 'late':
      return 'late';
    case 'absent':
      return 'absent';
    case 'leave':
      return 'leave';
    case 'holiday':
      return 'holiday';
    case 'off':
      return 'off';
    default:
      return d.day > today ? 'not_yet' : 'not_in';
  }
}

const KIND_LABEL: Record<TodayKind, string> = {
  on_time: 'On time',
  late: 'Late',
  not_in: 'Not in yet',
  not_yet: 'Not yet',
  absent: 'Absent',
  leave: 'On leave',
  holiday: 'Holiday',
  off: 'Off',
  not_counted: 'Not counted',
};

export const KIND_TONE: Record<TodayKind, 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'neutral'> = {
  on_time: 'success',
  late: 'warning',
  not_in: 'neutral',
  not_yet: 'neutral',
  absent: 'danger',
  leave: 'info',
  holiday: 'purple',
  off: 'neutral',
  not_counted: 'neutral',
};

/** "On time", "Late · 12 min", "Not in yet", "Absent", "On leave", "Holiday", "Off", "Not counted". */
export function todayStatusLabel(d: Pick<AttendanceDay, 'day' | 'status' | 'counted' | 'lateMinutes'>, today: string): string {
  const kind = todayKind(d, today);
  if (kind === 'late' && d.lateMinutes) return `Late · ${d.lateMinutes} min`;
  return KIND_LABEL[kind];
}

// ---------------------------------------------------------------------------------------------
// the quick counts, which double as filters
// ---------------------------------------------------------------------------------------------
export type TodayFilter = 'in' | 'late' | 'not_in' | 'absent' | 'leave' | 'off';

export const TODAY_FILTERS: { id: TodayFilter; label: string }[] = [
  { id: 'in', label: 'In' },
  { id: 'late', label: 'Late' },
  { id: 'not_in', label: 'Not in yet' },
  { id: 'absent', label: 'Absent' },
  { id: 'leave', label: 'On leave' },
  { id: 'off', label: 'Off or holiday' },
];

/** In: came in (on time or late). Late: the late ones. Off or holiday: a day off or a public holiday. */
export function matchesFilter(d: Pick<AttendanceDay, 'day' | 'status' | 'counted'>, filter: TodayFilter, today: string): boolean {
  const kind = todayKind(d, today);
  switch (filter) {
    case 'in':
      return kind === 'on_time' || kind === 'late';
    case 'late':
      return kind === 'late';
    case 'not_in':
      return kind === 'not_in';
    case 'absent':
      return kind === 'absent';
    case 'leave':
      return kind === 'leave';
    case 'off':
      return kind === 'off' || kind === 'holiday';
  }
}

export function countByFilter(days: Pick<AttendanceDay, 'day' | 'status' | 'counted'>[], today: string): Record<TodayFilter, number> {
  const out: Record<TodayFilter, number> = { in: 0, late: 0, not_in: 0, absent: 0, leave: 0, off: 0 };
  for (const d of days) for (const f of TODAY_FILTERS) if (matchesFilter(d, f.id, today)) out[f.id] += 1;
  return out;
}

// ---------------------------------------------------------------------------------------------
// sorting
// ---------------------------------------------------------------------------------------------
export type TodaySortKey = 'arrival' | 'name' | 'status' | 'late' | 'hours';
export type SortDir = 'asc' | 'desc';

export const SORT_LABEL: Record<TodaySortKey, string> = {
  arrival: 'Arrival time',
  name: 'Name',
  status: 'Status',
  late: 'Minutes late',
  hours: 'Hours',
};

export interface TodayRow {
  day: AttendanceDay;
  name: string;
}

/** Minutes after midnight (Nairobi) of a clock-in, or null. */
export const arrivalMinutes = (clockIn: string | null | undefined): number | null => {
  if (!clockIn) return null;
  const [h, m] = nairobiParts(clockIn).time.split(':').map(Number);
  return h * 60 + m;
};

const STATUS_ORDER: Record<TodayKind, number> = {
  on_time: 0,
  late: 1,
  not_in: 2,
  not_yet: 3,
  absent: 4,
  leave: 5,
  holiday: 6,
  off: 7,
  not_counted: 8,
};

/** What a row sorts by; null sorts last whichever way round (nobody in yet stays at the end). */
function sortValue(r: TodayRow, key: TodaySortKey, today: string, now: Date): number | string | null {
  switch (key) {
    case 'arrival':
      return r.day.clockIn ? new Date(r.day.clockIn).getTime() : null;
    case 'name':
      return r.name.toLowerCase();
    case 'status':
      return STATUS_ORDER[todayKind(r.day, today)];
    case 'late':
      return r.day.clockIn ? r.day.lateMinutes ?? 0 : null;
    case 'hours':
      return dayHours(r.day, today, now).hours;
  }
}

/**
 * The rows in the order asked for. Rows with nothing to sort by (no clock-in for arrival, minutes late or hours) go
 * to the end either way; ties go by name.
 */
export function sortToday(rows: TodayRow[], key: TodaySortKey, dir: SortDir, today: string, now: Date = new Date()): TodayRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byName = (a: TodayRow, b: TodayRow) => a.name.localeCompare(b.name) || a.day.employeeNumber.localeCompare(b.day.employeeNumber);
  return rows
    .map((r) => ({ r, v: sortValue(r, key, today, now) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return byName(a.r, b.r);
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const c = typeof a.v === 'string' ? a.v.localeCompare(b.v as string) : a.v - (b.v as number);
      return c !== 0 ? c * sign : byName(a.r, b.r);
    })
    .map((x) => x.r);
}

/** The next sort after a header is clicked: the same column reverses, another starts from its first way round. */
export function nextSort(current: { key: TodaySortKey; dir: SortDir }, key: TodaySortKey): { key: TodaySortKey; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------
export const TODAY_CSV_HEADERS = [
  'Employee number', 'Name', 'Department', 'Branch', 'Date', 'Status', 'In', 'Out', 'Hours', 'Minutes late', 'Via', 'Reason',
] as const;

/** The day as shown, in the order shown. */
export function todayCsv(
  rows: TodayRow[],
  people: Map<string, CsvPerson>,
  today: string,
  reasons: Map<string, string> = new Map(),
  now: Date = new Date()
): string {
  return toCsv(
    TODAY_CSV_HEADERS,
    rows.map(({ day: d, name }) => {
      const p = people.get(d.employeeNumber);
      const hours = dayHours(d, today, now).hours;
      const out = d.clockOut ? nairobiParts(d.clockOut).time : '';
      return [
        d.employeeNumber,
        name,
        p?.department ?? '',
        p?.branch ?? '',
        d.day,
        todayStatusLabel(d, today),
        d.clockIn ? nairobiParts(d.clockIn).time : '',
        out && isLastScan(d, today, now) ? `Last scan ${out}` : out,
        hours === null ? '' : hours.toFixed(2),
        d.lateMinutes ? String(d.lateMinutes) : '',
        clockedInVia(d),
        reasons.get(d.employeeNumber) ?? '',
      ];
    })
  );
}
