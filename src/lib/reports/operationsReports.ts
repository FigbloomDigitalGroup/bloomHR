import type { AttendanceDay } from '../attendance';
import { attendanceRate, punctuality, type Punctuality, type Rate } from '../attendanceStats';
import { currencyOf, money } from '../payroll/currency';
import { type Row, employedIn, monthBounds, sumByCurrency } from './reportKit';

// The SMS report and the branch performance report: the sums behind them, with no database calls, so they can be
// tested on their own. The pages read the rows, hold the filters and show what these return.

/* ------------------------------------------------------------------------------------------------------------------ */
/* SMS                                                                                                                 */
/* ------------------------------------------------------------------------------------------------------------------ */

/** What happened to a message: taken by the provider (sent / delivered), failed, or still waiting. */
export type SmsOutcome = 'delivered' | 'failed' | 'pending';

const FAILED = ['failed', 'failure', 'error', 'rejected', 'undelivered', 'expired', 'blocked', 'invalid'];
const PENDING = ['pending', 'queued', 'scheduled', 'processing', 'sending'];

/** A message's outcome from its status (the app writes "sent" or "failed"; the column defaults to "sent"). */
export function smsOutcome(log: Row): SmsOutcome {
  const status = String(log.status ?? '').trim().toLowerCase();
  if (FAILED.some((w) => status.includes(w))) return 'failed';
  if (PENDING.includes(status)) return 'pending';
  // no status but an error: it failed; no status and no error: the column's default, "sent"
  if (!status && String(log.error_message ?? '').trim()) return 'failed';
  return 'delivered';
}

export const isFailedSms = (log: Row) => smsOutcome(log) === 'failed';

/** "2026-11-03" for a message's time (local time, as the person reading the report sees it) */
export function smsDay(createdAt: unknown): string {
  const d = new Date(String(createdAt ?? ''));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A message type as a label: "birthday_wish" -> "Birthday wish"; none -> "General" */
export function smsTypeLabel(type: unknown): string {
  const t = String(type ?? '').trim().replace(/[_-]+/g, ' ');
  if (!t) return 'General';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** A status as a label: "sent" -> "Sent"; none -> "Sent" (the column's default) */
export function smsStatusLabel(status: unknown): string {
  const s = String(status ?? '').trim().toLowerCase() || 'sent';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The message cut to `max` characters, with an ellipsis when it was longer. */
export function shortMessage(text: unknown, max = 80): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The local start of `from` and the local start of the day after `to`, as ISO moments, for a created_at range. */
export function dayRange(from: string, to: string): [string, string] {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return [new Date(fy, fm - 1, fd).toISOString(), new Date(ty, tm - 1, td + 1).toISOString()];
}

export interface SmsFilters {
  /** a status label ("Sent", "Failed"...), or empty for all */
  status?: string;
  /** a type label ("General", "Birthday"...), or empty for all */
  type?: string;
}

export const filterSms = (logs: Row[], f: SmsFilters) =>
  logs.filter((l) => (!f.status || smsStatusLabel(l.status) === f.status) && (!f.type || smsTypeLabel(l.sms_type) === f.type));

/** The distinct status and type labels among the messages, for the filters (sorted). */
export function smsOptions(logs: Row[]): { statuses: string[]; types: string[] } {
  return {
    statuses: [...new Set(logs.map((l) => smsStatusLabel(l.status)))].sort(),
    types: [...new Set(logs.map((l) => smsTypeLabel(l.sms_type)))].sort(),
  };
}

const costOf = (l: Row) => (l.cost === null || l.cost === undefined || l.cost === '' ? null : Number(l.cost) || 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface SmsSummary {
  total: number;
  delivered: number;
  failed: number;
  pending: number;
  /** failed out of all, as a percentage with one decimal; null with no messages */
  failedShare: number | null;
  /** the summed cost; null when no message has one */
  cost: number | null;
}

export function smsSummary(logs: Row[]): SmsSummary {
  let delivered = 0;
  let failed = 0;
  let pending = 0;
  let cost: number | null = null;
  for (const l of logs) {
    const o = smsOutcome(l);
    if (o === 'delivered') delivered += 1;
    else if (o === 'failed') failed += 1;
    else pending += 1;
    const c = costOf(l);
    if (c !== null) cost = round2((cost ?? 0) + c);
  }
  const total = logs.length;
  return { total, delivered, failed, pending, failedShare: total ? Math.round((failed / total) * 1000) / 10 : null, cost };
}

export interface SmsDayRow {
  day: string;
  sent: number;
  failed: number;
}

/** Messages per day (every message counts as sent; the failed ones also as failed), oldest first. */
export function smsByDay(logs: Row[]): SmsDayRow[] {
  const by = new Map<string, SmsDayRow>();
  for (const l of logs) {
    const day = smsDay(l.created_at);
    if (!day) continue;
    const r = by.get(day) ?? { day, sent: 0, failed: 0 };
    r.sent += 1;
    if (isFailedSms(l)) r.failed += 1;
    by.set(day, r);
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export interface SmsTypeRow {
  type: string;
  count: number;
  failed: number;
  /** null when none of the type's messages has a cost */
  cost: number | null;
}

/** Messages per type, the most used first. */
export function smsByType(logs: Row[]): SmsTypeRow[] {
  const by = new Map<string, SmsTypeRow>();
  for (const l of logs) {
    const type = smsTypeLabel(l.sms_type);
    const r = by.get(type) ?? { type, count: 0, failed: 0, cost: null };
    r.count += 1;
    if (isFailedSms(l)) r.failed += 1;
    const c = costOf(l);
    if (c !== null) r.cost = round2((r.cost ?? 0) + c);
    by.set(type, r);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

const newestFirst = (a: Row, b: Row) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));

/** The failed messages, newest first. */
export const smsFailures = (logs: Row[]) => logs.filter(isFailedSms).sort(newestFirst);

/** The latest messages, newest first. */
export const smsRecent = (logs: Row[], limit = 50) => [...logs].sort(newestFirst).slice(0, limit);

export const SMS_SHEET_HEADERS = ['Sent at', 'Recipient', 'Type', 'Status', 'Message', 'Error', 'Sender ID', 'Message ID', 'Cost (KES)'] as const;

/** The messages as rows for the Excel download, newest first. */
export function smsSheet(logs: Row[]): (string | number | null)[][] {
  return [...logs].sort(newestFirst).map((l) => {
    const d = new Date(String(l.created_at ?? ''));
    return [
      Number.isNaN(d.getTime()) ? '' : `${smsDay(l.created_at)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      l.recipient_phone ?? '',
      smsTypeLabel(l.sms_type),
      smsStatusLabel(l.status),
      l.message ?? '',
      l.error_message ?? '',
      l.sender_id ?? '',
      l.message_id ?? '',
      costOf(l),
    ];
  });
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Branch performance                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------------ */

/** The key of the row for staff with no branch when the company has no default branch. */
export const NO_BRANCH = '';
export const NO_BRANCH_NAME = 'No branch';

export interface BranchLike {
  id: string;
  name: string;
  active?: boolean;
  is_default?: boolean;
}

/** The branch a person's numbers count under: their own; else the default branch; else "No branch" (NO_BRANCH). */
export function branchOf(employee: Row | undefined, branches: BranchLike[]): string {
  const own = employee?.branch_id;
  if (own && branches.some((b) => b.id === own)) return own;
  return branches.find((b) => b.is_default)?.id ?? NO_BRANCH;
}

/** Whether a YYYY-MM-DD date falls in a month ("2026-11"). */
const inMonth = (date: unknown, month: string) => String(date ?? '').slice(0, 7) === month;

const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * The leave days of an application that fall in a month: its `days` shared by the calendar days in the month out of
 * all its calendar days, rounded to the nearest half day. No end date: the start date; no `days`: its calendar days.
 */
export function leaveDaysInMonth(start: unknown, end: unknown, days: unknown, month: string): number {
  const s = String(start ?? '').slice(0, 10);
  let e = String(end ?? '').slice(0, 10);
  if (!isDate(s)) return 0;
  if (!isDate(e) || e < s) e = s;
  const [first, last] = monthBounds(month);
  const from = s > first ? s : first;
  const to = e < last ? e : last;
  if (from > to) return 0;
  const total = dayNumber(e) - dayNumber(s) + 1;
  const inside = dayNumber(to) - dayNumber(from) + 1;
  const n = days === null || days === undefined || days === '' ? total : Number(days) || 0;
  return Math.round(((n * inside) / total) * 2) / 2;
}

const isCasual = (e: Row | undefined) => String(e?.worker_kind ?? '').toLowerCase() === 'casual';

export interface BranchInput {
  month: string;
  branches: BranchLike[];
  /** every employee (current and former, casual workers included) */
  employees: Row[];
  /** employee_exits: employee_number, last_working_day, status */
  exits: Row[];
  /** the month's attendance days; null when they couldn't be read */
  attendance: Pick<AttendanceDay, 'employeeNumber' | 'status' | 'counted'>[] | null;
  /** leave_application: "Employee Number", "Start Date", "End Date", days, status */
  leaves: Row[];
  /** overtime_entries: employee_number, work_date, hours, status */
  overtime: Row[];
  /** salary_history for the month: employee_id, gross_pay, currency; null when they couldn't be read */
  payslips: Row[] | null;
}

export interface BranchRow {
  /** the branch id; NO_BRANCH for staff with no branch */
  id: string;
  name: string;
  headcount: number;
  casual: number;
  newHires: number;
  exits: number;
  /** null when attendance couldn't be read */
  attendance: Rate | null;
  punctuality: Punctuality | null;
  leaveDays: number;
  overtimeHours: number;
  /** gross pay per currency; null when payslips couldn't be read */
  payroll: Record<string, number> | null;
}

const emptyRow = (id: string, name: string, input: BranchInput): BranchRow => ({
  id,
  name,
  headcount: 0,
  casual: 0,
  newHires: 0,
  exits: 0,
  attendance: input.attendance ? { attended: 0, working: 0, rate: null } : null,
  punctuality: input.attendance ? { onTime: 0, arrivals: 0, share: null } : null,
  leaveDays: 0,
  overtimeHours: 0,
  payroll: input.payslips ? {} : null,
});

const EXCLUDED_EXITS = ['declined', 'cancelled'];

/**
 * A row per branch for a month: every active branch (with staff or not), an inactive branch only when something
 * counts under it, and "No branch" only when something lands there. In the branches' order.
 */
export function branchPerformance(input: BranchInput): BranchRow[] {
  const { month, branches, employees } = input;
  const people = new Map(employees.map((e) => [String(e['Employee Number']), e]));
  const where = (employeeNumber: unknown) => branchOf(people.get(String(employeeNumber ?? '')), branches);

  const rows = new Map<string, BranchRow>();
  const rowFor = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = emptyRow(id, branches.find((b) => b.id === id)?.name ?? NO_BRANCH_NAME, input);
      rows.set(id, r);
    }
    return r;
  };
  for (const b of branches) if (b.active !== false) rowFor(b.id);

  for (const e of employees) {
    const employed = employedIn(e, month);
    const hired = inMonth(e['Start Date'], month);
    if (!employed && !hired) continue;
    const r = rowFor(branchOf(e, branches));
    if (employed) {
      if (isCasual(e)) r.casual += 1;
      else r.headcount += 1;
    }
    if (hired) r.newHires += 1;
  }

  for (const x of input.exits) {
    if (EXCLUDED_EXITS.includes(String(x.status ?? '').toLowerCase())) continue;
    if (!inMonth(x.last_working_day, month)) continue;
    rowFor(where(x.employee_number)).exits += 1;
  }

  if (input.attendance) {
    const byBranch = new Map<string, Pick<AttendanceDay, 'status' | 'counted'>[]>();
    for (const d of input.attendance) {
      const id = where(d.employeeNumber);
      const list = byBranch.get(id) ?? [];
      list.push(d);
      byBranch.set(id, list);
    }
    for (const [id, days] of byBranch) {
      const r = rowFor(id);
      r.attendance = attendanceRate(days);
      r.punctuality = punctuality(days);
    }
  }

  for (const l of input.leaves) {
    if (String(l.status ?? '').trim().toLowerCase() !== 'approved') continue;
    const n = leaveDaysInMonth(l['Start Date'], l['End Date'], l.days, month);
    if (n > 0) rowFor(where(l['Employee Number'])).leaveDays += n;
  }

  for (const o of input.overtime) {
    if (String(o.status ?? '').toLowerCase() !== 'approved' || !inMonth(o.work_date, month)) continue;
    const r = rowFor(where(o.employee_number));
    r.overtimeHours = round2(r.overtimeHours + (Number(o.hours) || 0));
  }

  if (input.payslips) {
    const byBranch = new Map<string, Row[]>();
    for (const p of input.payslips) {
      const id = where(p.employee_id);
      byBranch.set(id, [...(byBranch.get(id) ?? []), p]);
    }
    for (const [id, slips] of byBranch) rowFor(id).payroll = sumByCurrency(slips, currencyOf, (p) => Number(p.gross_pay) || 0);
  }

  const order = (id: string) => {
    const i = branches.findIndex((b) => b.id === id);
    return i < 0 ? branches.length : i;
  };
  return [...rows.values()].sort((a, b) => order(a.id) - order(b.id));
}

/** Adds per-currency amounts: { KES: 1 } + { KES: 2, UGX: 5 } = { KES: 3, UGX: 5 } */
export function addCurrencies(items: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) for (const [c, n] of Object.entries(item)) out[c] = round2((out[c] ?? 0) + n);
  return out;
}

/** The totals row: counts added; attendance and punctuality worked out again from all the days (not averaged). */
export function branchTotals(rows: BranchRow[], attendanceRead = rows.some((r) => r.attendance), payrollRead = rows.some((r) => r.payroll)): BranchRow {
  const sum = (f: (r: BranchRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  const attended = sum((r) => r.attendance?.attended ?? 0);
  const working = sum((r) => r.attendance?.working ?? 0);
  const onTime = sum((r) => r.punctuality?.onTime ?? 0);
  const arrivals = sum((r) => r.punctuality?.arrivals ?? 0);
  const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
  return {
    id: 'total',
    name: 'Total',
    headcount: sum((r) => r.headcount),
    casual: sum((r) => r.casual),
    newHires: sum((r) => r.newHires),
    exits: sum((r) => r.exits),
    attendance: attendanceRead ? { attended, working, rate: share(attended, working) } : null,
    punctuality: attendanceRead ? { onTime, arrivals, share: share(onTime, arrivals) } : null,
    leaveDays: sum((r) => r.leaveDays),
    overtimeHours: round2(sum((r) => r.overtimeHours)),
    payroll: payrollRead ? addCurrencies(rows.map((r) => r.payroll ?? {})) : null,
  };
}

/** "KSh 1,000 · USh 50,000"; "—" when unknown, "—" too with nothing paid */
export function payrollLabel(payroll: Record<string, number> | null): string {
  if (!payroll) return '—';
  const parts = Object.entries(payroll).sort(([a], [b]) => a.localeCompare(b)).map(([c, n]) => money(n, c));
  return parts.length ? parts.join(' · ') : '—';
}

export const percentLabel = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`);

export const BRANCH_SHEET_HEADERS = [
  'Branch', 'Headcount', 'Casual workers', 'New hires', 'Exits', 'Attendance', 'Punctuality', 'Leave days', 'Overtime hours', 'Payroll cost',
] as const;

/** The table as rows for the Excel download, the totals row last. */
export function branchSheet(rows: BranchRow[], totals: BranchRow): (string | number)[][] {
  return [...rows, totals].map((r) => [
    r.name,
    r.headcount,
    r.casual,
    r.newHires,
    r.exits,
    percentLabel(r.attendance?.rate),
    percentLabel(r.punctuality?.share),
    r.leaveDays,
    r.overtimeHours,
    payrollLabel(r.payroll),
  ]);
}
