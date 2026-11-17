import { type ReportFilters, type Row, employedIn, matchesFilters, monthBounds, monthOf, monthsBetween, pct } from './reportKit';

// The people reports: leave management and terminations. Pure functions over the rows the pages read, so the numbers
// can be tested without a database.

/** "2026-11-14" from a date or a stored date / timestamp text ('' when there is none) */
export const day = (v: unknown): string => {
  if (v instanceof Date) return `${monthOf(v)}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v ?? '').trim().slice(0, 10);
};

/** "2026-11-14" + n days */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const out = new Date(Date.UTC(y, m - 1, d + n));
  return out.toISOString().slice(0, 10);
}

/** The first day of `from` to the last day of `to`. */
export const periodBounds = (from: string, to: string): [string, string] => [monthBounds(from)[0], monthBounds(to)[1]];

/** Whether start..end overlaps first..last (all "YYYY-MM-DD"; a missing end is a one-day span). */
export function overlaps(start: string, end: string, first: string, last: string): boolean {
  const s = day(start);
  if (!s) return false;
  const e = day(end) || s;
  return s <= last && e >= first;
}

// ---------------------------------------------------------------------------------------------
// leave

export type LeaveStatus = 'approved' | 'pending' | 'rejected' | 'cancelled' | 'other';

/** A leave request's status whatever its casing ('Approved', 'APPROVED ', 'approved' -> 'approved'). */
export function leaveStatus(status: unknown): LeaveStatus {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'approved') return 'approved';
  if (s === 'pending' || s === '') return 'pending';
  if (s === 'rejected' || s === 'declined') return 'rejected';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  return 'other';
}

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  approved: 'Approved',
  pending: 'Pending',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  other: 'Other',
};

/** The working days a request is for (its `days`; 0 when missing). */
export const leaveDays = (app: Row): number => Math.max(0, Number(app.days) || 0);

/** The days taken: approved requests' days. */
export const daysTaken = (apps: Row[]): number => apps.reduce((n, a) => n + (leaveStatus(a.status) === 'approved' ? leaveDays(a) : 0), 0);

/** Requests whose dates overlap first..last, for people matching the filters. */
export function leaveInRange(apps: Row[], first: string, last: string, people: Map<string, Row>, filters: ReportFilters = {}): Row[] {
  return apps.filter((a) => overlaps(a['Start Date'], a['End Date'], first, last) && leaveMatches(a, people, filters));
}

/** Whether a request's person matches the filters (the request's own name counts for the search). */
export function leaveMatches(app: Row, people: Map<string, Row>, filters: ReportFilters): boolean {
  const person = people.get(String(app['Employee Number'] ?? ''));
  if (!filters.branchId && !filters.departmentId && !filters.search?.trim()) return true;
  if (!person) {
    // someone no longer readable: only a search on the request's own name or number can match them
    if (filters.branchId || filters.departmentId) return false;
    const q = filters.search!.trim().toLowerCase();
    return `${app.name ?? ''} ${app['Employee Number'] ?? ''}`.toLowerCase().includes(q);
  }
  if (!matchesFilters(person, { ...filters, search: undefined })) return false;
  const q = filters.search?.trim().toLowerCase();
  if (!q) return true;
  return matchesFilters(person, { search: q }) || String(app.name ?? '').toLowerCase().includes(q);
}

export interface LeaveSummary {
  requests: number;
  approvedDays: number;
  pending: number;
  onLeaveToday: number;
}

/** The cards: requests in the period, approved days, pending requests; people on approved leave today (any period). */
export function leaveSummary(inPeriod: Row[], current: Row[], today: string): LeaveSummary {
  return {
    requests: inPeriod.length,
    approvedDays: daysTaken(inPeriod),
    pending: inPeriod.filter((a) => leaveStatus(a.status) === 'pending').length,
    onLeaveToday: new Set(onLeaveBetween(current, today, today).map((a) => String(a['Employee Number']))).size,
  };
}

/** Approved requests overlapping first..last, soonest first. */
export function onLeaveBetween(apps: Row[], first: string, last: string): Row[] {
  return apps
    .filter((a) => leaveStatus(a.status) === 'approved' && overlaps(a['Start Date'], a['End Date'], first, last))
    .sort((a, b) => day(a['Start Date']).localeCompare(day(b['Start Date'])));
}

export interface LeaveTypeLine {
  type: string;
  requests: number;
  approved: number;
  pending: number;
  rejected: number;
  daysTaken: number;
}

/** Requests per leave type, the most requested first. */
export function leaveByType(apps: Row[]): LeaveTypeLine[] {
  const lines = new Map<string, LeaveTypeLine>();
  for (const a of apps) {
    const type = String(a['Leave Type'] ?? '').trim() || 'Not given';
    const line = lines.get(type) ?? { type, requests: 0, approved: 0, pending: 0, rejected: 0, daysTaken: 0 };
    const s = leaveStatus(a.status);
    line.requests += 1;
    if (s === 'approved') {
      line.approved += 1;
      line.daysTaken += leaveDays(a);
    } else if (s === 'pending') line.pending += 1;
    else if (s === 'rejected') line.rejected += 1;
    lines.set(type, line);
  }
  return [...lines.values()].sort((a, b) => b.requests - a.requests || a.type.localeCompare(b.type));
}

export interface LeaveDepartmentLine {
  department: string;
  people: number;
  daysTaken: number;
}

/** Approved leave per department: how many people took leave and the days they took, the most days first. */
export function leaveByDepartment(apps: Row[], people: Map<string, Row>, departmentNames: Map<string, string>): LeaveDepartmentLine[] {
  const lines = new Map<string, { people: Set<string>; days: number }>();
  for (const a of apps) {
    if (leaveStatus(a.status) !== 'approved') continue;
    const number = String(a['Employee Number'] ?? '');
    const department = departmentName(people.get(number), departmentNames);
    const line = lines.get(department) ?? { people: new Set<string>(), days: 0 };
    line.people.add(number);
    line.days += leaveDays(a);
    lines.set(department, line);
  }
  return [...lines.entries()]
    .map(([department, l]) => ({ department, people: l.people.size, daysTaken: l.days }))
    .sort((a, b) => b.daysTaken - a.daysTaken || a.department.localeCompare(b.department));
}

/** A person's department name ('No department' when none or unknown). */
export const departmentName = (person: Row | undefined, names: Map<string, string>): string =>
  (person?.department_id && names.get(String(person.department_id))) || 'No department';

export interface BalanceLine {
  employeeNumber: string;
  accrued: number;
  used: number;
  carried: number;
  remaining: number;
}

/** The annual leave type: a leave type named "Annual…" (a deductible one first). */
export function annualLeaveType(types: Row[]): Row | undefined {
  const annual = types.filter((t) => /^annual/i.test(String(t.name ?? '').trim()));
  return annual.find((t) => t.is_deductible) ?? annual[0];
}

/**
 * Annual leave balances for a year, one line per person: the yearly row (month 0) where there is one, otherwise the
 * latest month's. Only people matching the filters; by employee number.
 */
export function annualBalances(balances: Row[], typeId: string | undefined, year: number, people: Map<string, Row>, filters: ReportFilters = {}): BalanceLine[] {
  if (!typeId) return [];
  const best = new Map<string, Row>();
  for (const b of balances) {
    if (String(b.leave_type_id) !== String(typeId) || Number(b.year) !== year) continue;
    const number = String(b.employee_number ?? '');
    const have = best.get(number);
    const month = Number(b.month) || 0;
    const haveMonth = have ? Number(have.month) || 0 : -1;
    // month 0 is the year's own row and wins; otherwise the latest month
    if (!have || month === 0 || (haveMonth !== 0 && month > haveMonth)) best.set(number, b);
  }
  return [...best.entries()]
    .filter(([number]) => leaveMatches({ 'Employee Number': number }, people, filters))
    .map(([employeeNumber, b]) => {
      const accrued = Number(b.accrued_days) || 0;
      const used = Number(b.used_days) || 0;
      const carried = Number(b.carried_over_days) || 0;
      const remaining = b.remaining_days === null || b.remaining_days === undefined ? accrued + carried - used : Number(b.remaining_days) || 0;
      return { employeeNumber, accrued, used, carried, remaining };
    })
    .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber, undefined, { numeric: true }));
}

// ---------------------------------------------------------------------------------------------
// terminations

export type ExitKind = 'resignation' | 'termination';
export type ExitStatus = 'requested' | 'approved' | 'clearance' | 'completed' | 'declined' | 'cancelled';

export const REASON_LABEL: Record<string, string> = {
  resignation: 'Resigned',
  misconduct: 'Misconduct',
  poor_performance: 'Poor performance',
  redundancy: 'Redundancy',
  contract_end: 'Contract ended',
  medical: 'Medical grounds',
  mutual_agreement: 'Mutual agreement',
  other: 'Other',
};

export const reasonLabel = (category: string | null | undefined) => REASON_LABEL[String(category ?? '')] ?? 'Not given';

export const EXIT_STATUS_LABEL: Record<ExitStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  clearance: 'Clearance',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export interface ExitRecord {
  id: string;
  employeeNumber: string;
  kind: ExitKind;
  reasonCategory: string | null;
  reason: string;
  noticeGivenOn: string;
  noticeDays: number | null;
  lastWorkingDay: string;
  status: ExitStatus;
  /** from the older terminations table (hr_terminations) */
  older: boolean;
  clearanceDone: number;
  clearanceTotal: number;
  duesNet: number | null;
  duesStatus: string | null;
}

const exitStatus = (s: unknown): ExitStatus => {
  const v = String(s ?? '').trim().toLowerCase();
  return (Object.keys(EXIT_STATUS_LABEL) as ExitStatus[]).includes(v as ExitStatus) ? (v as ExitStatus) : 'requested';
};

/** The exits with their clearance progress and final dues. */
export function exitRecords(exits: Row[], clearance: Row[], dues: Row[]): ExitRecord[] {
  const items = new Map<string, { done: number; total: number }>();
  for (const c of clearance) {
    const k = String(c.exit_id);
    const it = items.get(k) ?? { done: 0, total: 0 };
    it.total += 1;
    if (c.done) it.done += 1;
    items.set(k, it);
  }
  const duesBy = new Map(dues.map((d) => [String(d.exit_id), d]));
  return exits.map((x) => {
    const id = String(x.id);
    const it = items.get(id);
    const d = duesBy.get(id);
    const kind: ExitKind = x.kind === 'resignation' ? 'resignation' : 'termination';
    return {
      id,
      employeeNumber: String(x.employee_number ?? ''),
      kind,
      reasonCategory: x.reason_category ?? (kind === 'resignation' ? 'resignation' : null),
      reason: String(x.reason ?? '').trim(),
      noticeGivenOn: day(x.notice_given_on),
      noticeDays: x.notice_days === null || x.notice_days === undefined ? null : Number(x.notice_days),
      lastWorkingDay: day(x.last_working_day),
      status: exitStatus(x.status),
      older: false,
      clearanceDone: it?.done ?? 0,
      clearanceTotal: it?.total ?? 0,
      duesNet: d ? Number(d.net) || 0 : null,
      duesStatus: d ? String(d.status ?? '') : null,
    };
  });
}

const OLDER_TYPES: Record<string, { kind: ExitKind; reasonCategory: string }> = {
  voluntary: { kind: 'resignation', reasonCategory: 'resignation' },
  dismissal: { kind: 'termination', reasonCategory: 'misconduct' },
  'contract end': { kind: 'termination', reasonCategory: 'contract_end' },
  redundancy: { kind: 'termination', reasonCategory: 'redundancy' },
};

/** An older terminations row (hr_terminations) as a completed exit. Skips people who also have a newer exit. */
export function olderExitRecords(rows: Row[], newer: ExitRecord[]): ExitRecord[] {
  const has = new Set(newer.filter((e) => isExit(e)).map((e) => e.employeeNumber));
  return rows
    .filter((r) => r['Employee Number'] && !has.has(String(r['Employee Number'])) && !r.is_archived)
    .map((r) => {
      const type = OLDER_TYPES[String(r.termination_type ?? '').trim().toLowerCase()] ?? { kind: 'termination' as ExitKind, reasonCategory: 'other' };
      const clearanceDone = String(r.clearance_status ?? '').trim().toLowerCase() === 'completed' ? 1 : 0;
      return {
        id: `older-${r.id}`,
        employeeNumber: String(r['Employee Number']),
        kind: type.kind,
        reasonCategory: type.reasonCategory,
        reason: String(r.termination_reason ?? '').trim(),
        noticeGivenOn: '',
        noticeDays: null,
        lastWorkingDay: day(r.termination_date),
        status: 'completed' as ExitStatus,
        older: true,
        clearanceDone,
        clearanceTotal: 1,
        duesNet: null,
        duesStatus: r.final_payroll_status ? String(r.final_payroll_status) : null,
      };
    });
}

/** Declined and cancelled exits did not happen. */
export const isExit = (e: Pick<ExitRecord, 'status'>) => e.status !== 'declined' && e.status !== 'cancelled';

/** Still being worked on: requested, approved or in clearance. */
export const isOpenExit = (e: Pick<ExitRecord, 'status'>) => e.status === 'requested' || e.status === 'approved' || e.status === 'clearance';

/** Exits (any status) whose last working day falls in from..to (months), for people matching the filters. */
export function exitsInPeriod(exits: ExitRecord[], from: string, to: string, people: Map<string, Row>, filters: ReportFilters = {}): ExitRecord[] {
  const [first, last] = periodBounds(from, to);
  return exits
    .filter((e) => e.lastWorkingDay >= first && e.lastWorkingDay <= last)
    .filter((e) => !(filters.branchId || filters.departmentId || filters.search?.trim()) || matchesFilters(people.get(e.employeeNumber), filters))
    .sort((a, b) => b.lastWorkingDay.localeCompare(a.lastWorkingDay));
}

export interface ExitMonthLine {
  month: string;
  resignations: number;
  terminations: number;
  total: number;
}

/** Real exits per month of the period (every month listed, oldest first). */
export function exitsByMonth(exits: ExitRecord[], from: string, to: string): ExitMonthLine[] {
  return monthsBetween(from, to).map((month) => {
    const these = exits.filter((e) => isExit(e) && e.lastWorkingDay.slice(0, 7) === month);
    const resignations = these.filter((e) => e.kind === 'resignation').length;
    return { month, resignations, terminations: these.length - resignations, total: these.length };
  });
}

export interface ExitReasonLine {
  category: string;
  label: string;
  count: number;
  share: number | null;
}

/** Real exits per reason category, the most common first, with each one's share. */
export function exitsByReason(exits: ExitRecord[]): ExitReasonLine[] {
  const real = exits.filter(isExit);
  const counts = new Map<string, number>();
  for (const e of real) {
    const k = e.reasonCategory ?? '';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, label: reasonLabel(category), count, share: pct(count, real.length) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const isCasual = (e: Row) => String(e.worker_kind ?? '').trim() === 'casual';

/** Staff (not casual) employed at the start (first month) and at the end (last month) of the period, averaged. */
export function averageHeadcount(employees: Row[], from: string, to: string, filters: ReportFilters = {}): { start: number; end: number; average: number } {
  const staff = employees.filter((e) => !isCasual(e) && matchesFilters(e, { branchId: filters.branchId, departmentId: filters.departmentId }));
  const start = staff.filter((e) => employedIn(e, from)).length;
  const end = staff.filter((e) => employedIn(e, to)).length;
  return { start, end, average: (start + end) / 2 };
}

/** Exits for every 100 people on average, to one decimal (null with no headcount). */
export const turnoverRate = (exits: number, averageHeadcount: number): number | null =>
  averageHeadcount > 0 ? Math.round((exits / averageHeadcount) * 1000) / 10 : null;

export interface ExitSummary {
  exits: number;
  resignations: number;
  terminations: number;
  open: number;
  turnover: number | null;
}

/**
 * The cards: real exits in the period, by kind; the turnover rate; and exits still open among `all` (whatever their
 * last working day, since an open exit's last day is often still to come).
 */
export function exitSummary(inPeriod: ExitRecord[], all: ExitRecord[], headcount: { average: number }): ExitSummary {
  const real = inPeriod.filter(isExit);
  const resignations = real.filter((e) => e.kind === 'resignation').length;
  return {
    exits: real.length,
    resignations,
    terminations: real.length - resignations,
    open: all.filter(isOpenExit).length,
    turnover: turnoverRate(real.length, headcount.average),
  };
}
