// The staff portal's "My work" (FIG-812 stage 3; migration 20261020100000): a worker paid by work records their own
// work, sees their entries, marks their contract jobs done and sees what they have earned. These are the date limits,
// statuses and sums the screens use; the database checks the same (work_entry_self_window, my_work_earnings).
import { addDays } from './casualPay';
import { round2, type ContractJob, type WorkEntry, type WorkStatus } from './pieceRate';

export interface MyWorkProfile {
  employee_number: string | null;
  worker_kind?: string;
  pay_basis?: string;
  pay_frequency?: string;
  has_jobs?: boolean;
  qualifies: boolean;
  /** how many days back the worker may record their own work */
  past_days?: number;
  /** today in Nairobi (YYYY-MM-DD), as the database counts it */
  today?: string;
  /** pay periods (YYYY-MM) whose payroll is approved or paid: nothing in them can change */
  closed_months?: string[];
}

export const DEFAULT_PAST_DAYS = 7;

export interface MyEntry extends WorkEntry {
  reopened_at: string | null;
}

export interface MyJob extends ContractJob {
  completion_file?: string | null;
  completion_file_name?: string | null;
}

export interface MyEarnings {
  from: string;
  to: string;
  approved_work: number | string;
  waiting_work: number | string;
  approved_jobs: number | string;
  waiting_jobs: number | string;
  approved_entries: number;
  waiting_entries: number;
  approved_job_count: number;
  waiting_job_count: number;
  by_type: { work_type: string; unit: string; quantity: number | string; amount: number | string; waiting_quantity: number | string; waiting_amount: number | string }[];
  by_week: { from: string; to: string; work: number | string; jobs: number | string; waiting: number | string }[];
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------------------------
// which days a worker may record
// ---------------------------------------------------------------------------------------------
/** The first and last day a worker may record their own work: today back to the limit, never a future day. */
export function dayWindow(today: string, pastDays: number = DEFAULT_PAST_DAYS) {
  const days = Math.max(0, Math.floor(Number.isFinite(pastDays) ? pastDays : DEFAULT_PAST_DAYS));
  return { min: addDays(today, -days), max: today };
}

/** Why a day can't be recorded, or null when it can. */
export function dayProblem(day: string, today: string, pastDays: number = DEFAULT_PAST_DAYS, closedMonths: string[] = []): string | null {
  const { min, max } = dayWindow(today, pastDays);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'Pick a day';
  if (day > max) return "Work can't be recorded for a future day";
  if (day < min) return `You can record your own work for the last ${Math.max(0, Math.floor(pastDays))} days only; ask your supervisor to record older work`;
  if (closedMonths.includes(day.slice(0, 7))) return 'Payroll for that month is approved, so it is locked';
  return null;
}

// ---------------------------------------------------------------------------------------------
// an entry's state
// ---------------------------------------------------------------------------------------------
export type MyEntryState = 'draft' | 'waiting' | 'reopened' | 'approved' | 'rejected';

export const MY_STATE_LABEL: Record<MyEntryState, string> = {
  draft: 'Draft', waiting: 'Waiting', reopened: 'Reopened', approved: 'Approved', rejected: 'Rejected',
};
export const MY_STATE_TONE: Record<MyEntryState, 'neutral' | 'warning' | 'info' | 'success' | 'danger'> = {
  draft: 'neutral', waiting: 'warning', reopened: 'info', approved: 'success', rejected: 'danger',
};

export function entryState(e: Pick<MyEntry, 'status' | 'reopened_at'>): MyEntryState {
  const byStatus: Record<WorkStatus, MyEntryState> = { draft: 'draft', submitted: 'waiting', approved: 'approved', rejected: 'rejected' };
  if (e.status === 'submitted' && e.reopened_at) return 'reopened';
  return byStatus[e.status];
}

/** The month is locked (its payroll approved) or the entry has been paid out. */
export const entryLocked = (e: Pick<MyEntry, 'work_date' | 'paid_out_at'>, closedMonths: string[] = []) =>
  !!e.paid_out_at || closedMonths.includes(e.work_date.slice(0, 7));

/** A worker changes only their own drafts and rejected work, in an open month. */
export const canEditEntry = (e: Pick<MyEntry, 'work_date' | 'paid_out_at' | 'status' | 'source'>, closedMonths: string[] = []) =>
  e.source === 'self' && (e.status === 'draft' || e.status === 'rejected') && !entryLocked(e, closedMonths);

export interface EntryDay {
  day: string;
  entries: MyEntry[];
  /** what the day's approved work pays */
  approved: number;
  /** what is waiting for approval */
  waiting: number;
}

/** Entries grouped by day, newest day first. */
export function groupByDay(entries: MyEntry[]): EntryDay[] {
  const days = new Map<string, MyEntry[]>();
  for (const e of entries) days.set(e.work_date, [...(days.get(e.work_date) ?? []), e]);
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, list]) => ({
      day,
      entries: list,
      approved: round2(list.filter((e) => e.status === 'approved').reduce((s, e) => s + num(e.amount), 0)),
      waiting: round2(list.filter((e) => e.status === 'submitted').reduce((s, e) => s + num(e.amount), 0)),
    }));
}

// ---------------------------------------------------------------------------------------------
// months and weeks
// ---------------------------------------------------------------------------------------------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
export const monthLabel = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

/** This month and the ones before it, newest first, for the month picker. */
export function monthChoices(today: string, count = 12): { value: string; label: string }[] {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const value = `${y}-${String(m).padStart(2, '0')}-01`;
    out.push({ value, label: monthLabel(value) });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** The month's weeks, Monday to Sunday, cut to the month (as my_work_earnings counts them). */
export function weeksOfMonth(day: string): { from: string; to: string }[] {
  const first = monthStart(day);
  const [y, m] = first.split('-').map(Number);
  const last = `${first.slice(0, 8)}${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const weekday = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 0 = Monday
  const out: { from: string; to: string }[] = [];
  let monday = addDays(first, -weekday);
  while (monday <= last) {
    const sunday = addDays(monday, 6);
    out.push({ from: monday < first ? first : monday, to: sunday > last ? last : sunday });
    monday = addDays(monday, 7);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// earnings
// ---------------------------------------------------------------------------------------------
/** The month's gross from approved work and jobs, and what is still waiting, kept apart. Before deductions. */
export function earningsTotals(e: Pick<MyEarnings, 'approved_work' | 'approved_jobs' | 'waiting_work' | 'waiting_jobs'> | null) {
  if (!e) return { approved: 0, waiting: 0, work: 0, jobs: 0 };
  const work = round2(num(e.approved_work));
  const jobs = round2(num(e.approved_jobs));
  return { approved: round2(work + jobs), waiting: round2(num(e.waiting_work) + num(e.waiting_jobs)), work, jobs };
}

export const EARNINGS_NOTE = 'Before deductions. Payouts and the month-end payslip will show what you take home.';

/** A job's due date relative to today: overdue, due today, or neither. */
export function jobDue(job: Pick<MyJob, 'due_date' | 'status'>, today: string): 'overdue' | 'today' | null {
  if (!job.due_date || job.status !== 'open') return null;
  const due = job.due_date.slice(0, 10);
  if (due < today) return 'overdue';
  return due === today ? 'today' : null;
}
