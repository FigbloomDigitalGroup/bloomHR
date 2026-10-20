import { toDay } from './celebrations';
import { isCurrentEmployee, monthOf } from './reports/groupReports';

// The dashboard's at-a-glance figures, worked out from rows the dashboard already reads: everyone's status, start and
// termination dates (employees) and every leave request's status and dates (leave_application). Nothing is estimated:
// someone with no readable start date is counted from the start, and someone who has left without a termination date
// is left out of the trend altogether.

/* eslint-disable @typescript-eslint/no-explicit-any -- the untyped rows the dashboard reads */
type Row = Record<string, any>;

const text = (v: unknown) => (v == null ? '' : String(v).trim());

/** The last `count` months up to and including today's, oldest first: ["2025-11", ..., "2026-10"]. */
export function lastMonths(today: Date, count = 12): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10" -> "Oct", or "Oct 2026" with the year. */
export function monthLabel(month: string, withYear = false): string {
  const [y, m] = month.split('-').map(Number);
  const name = MONTH_NAMES[(m || 1) - 1] ?? month;
  return withYear ? `${name} ${y}` : name;
}

export interface MonthPoint {
  month: string;
  label: string;
  /** people on staff at the end of the month */
  headcount: number;
  joiners: number;
  leavers: number;
}

/**
 * Month by month for the last `count` months: how many were on staff at each month's end, and how many joined (start
 * date) and left (termination date) in it.
 */
export function staffByMonth(employees: Row[], today: Date, count = 12): MonthPoint[] {
  const months = lastMonths(today, count);
  const people = employees
    .map((e) => ({ current: isCurrentEmployee(e), start: monthOf(e['Start Date']), end: monthOf(e['Termination Date']) }))
    // someone who has left but has no termination date: when they left is unknown, so they are not counted
    .filter((p) => p.current || p.end);
  return months.map((month) => ({
    month,
    label: monthLabel(month),
    headcount: people.filter((p) => (!p.start || p.start <= month) && (p.current || p.end > month)).length,
    joiners: people.filter((p) => p.start === month).length,
    leavers: employees.filter((e) => monthOf(e['Termination Date']) === month).length,
  }));
}

/** How many different people are on approved leave today (start to end date, inclusive). */
export function onLeaveToday(leaves: Row[], today: Date): number {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const people = new Set<string>();
  leaves.forEach((l, i) => {
    if (text(l.status).toLowerCase() !== 'approved') return;
    const start = toDay(text(l['Start Date']));
    const end = toDay(text(l['End Date'])) ?? start;
    if (!start || !end) return;
    if (start.getTime() <= day && day <= end.getTime()) people.add(text(l['Employee Number']) || `row-${i}`);
  });
  return people.size;
}

/** How many leave requests are waiting for a decision. */
export const pendingLeave = (leaves: Row[]): number =>
  leaves.filter((l) => {
    const s = text(l.status).toLowerCase();
    return s === '' || s === 'pending';
  }).length;

/** Leave requests by status ("Approved", "Pending", ...), the biggest first; a missing status counts as Pending. */
export function leaveByStatus(leaves: Row[]): { name: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const l of leaves) {
    const s = text(l.status);
    const name = s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : 'Pending';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

/** Current staff per town (or "Unassigned"), the biggest first. */
export function headcountByTown(employees: Row[]): { name: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const e of employees) {
    if (!isCurrentEmployee(e)) continue;
    const town = text(e.Town) || 'Unassigned';
    counts.set(town, (counts.get(town) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

/** The first `keep` rows, and the rest added up as one "Other" row (never more rows than fit a chart). */
export function foldIntoOther(rows: { name: string; value: number }[], keep = 7): { name: string; value: number }[] {
  if (rows.length <= keep + 1) return rows;
  const rest = rows.slice(keep).reduce((t, r) => t + r.value, 0);
  return [...rows.slice(0, keep), { name: `Other (${rows.length - keep})`, value: rest }];
}

/** The change from `previous` to `now` as a whole percentage, or null when there is nothing to compare with. */
export function percentChange(now: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((now - previous) / previous) * 100);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
