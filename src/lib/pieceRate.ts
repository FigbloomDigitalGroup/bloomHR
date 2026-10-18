// Piece rate and contract jobs (FIG-812; migrations 20261014100000 and 20261019800000): the sums, the rate in force
// on a day, and the spreadsheet rows, for the screens. The database works out and checks the same.
//
// How this sits next to casual workers (20261017900000): a casual is paid their own daily rate for days present, in
// casual pay runs outside the payroll. A piece-rate worker is an employee or contractor paid for what they produce
// (kg, crates, pieces, rows) at the company's rate for that kind of work, or a set amount per contract job, and stays
// on the monthly payroll for the month's deductions. Someone is one or the other, never both.

export type WorkStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type WorkSource = 'payroll' | 'upload' | 'supervisor' | 'self';
export type WorkerKind = 'employee' | 'contractor' | 'casual';
export type PayBasis = 'salary' | 'work';
export type PayFrequency = 'daily' | 'weekly' | 'monthly' | 'per_job';
export type WhtCategory = 'contractual' | 'professional';
export type JobStatus = 'open' | 'completed' | 'approved' | 'cancelled';

export interface WorkType {
  id: string;
  name: string;
  unit: string;
  rate: number | string;
  active: boolean;
  effective_from: string | null;
  effective_to: string | null;
}

export interface WorkRate {
  id: string;
  work_type_id: string;
  rate: number | string;
  effective_from: string;
}

export interface WorkEntry {
  id: string;
  employee_number: string;
  work_date: string;
  work_type_id: string;
  quantity: number | string;
  rate: number | string;
  amount: number | string;
  status: WorkStatus;
  source: WorkSource;
  notes: string | null;
  rejection_reason: string | null;
  entered_by: string | null;
  paid_out_at: string | null;
}

export interface WorkPerson {
  employee_number: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  department: string | null;
  worker_kind: WorkerKind;
  pay_basis: PayBasis;
  pay_frequency: PayFrequency;
  wht_category: WhtCategory | null;
  supervisor: string | null;
  status: string | null;
  is_team: boolean;
}

export interface ContractJob {
  id: string;
  employee_number: string;
  title: string;
  description: string | null;
  amount: number | string;
  start_date: string | null;
  due_date: string | null;
  status: JobStatus;
  completed_at: string | null;
  completion_notes: string | null;
  sent_back_reason: string | null;
  approved_at: string | null;
  paid_out_at: string | null;
  created_at: string;
}

export interface WorkTotal {
  employee_number: string;
  worker_name: string;
  worker_kind: WorkerKind | null;
  pay_frequency: PayFrequency | null;
  lines: { work_type: string; unit: string; quantity: number; amount: number }[];
  approved_amount: number | string;
  waiting_amount: number | string;
  approved_entries: number;
  waiting_entries: number;
  jobs_approved_amount: number | string;
}

export interface ImportRow {
  row: number;
  ok: boolean;
  error: string | null;
  employee_number: string | null;
  worker_name: string | null;
  work_date: string | null;
  work_type: string | null;
  unit: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
}

export interface WorkImport {
  id: string;
  file_name: string | null;
  row_count: number;
  imported_count: number;
  problem_count: number;
  problems: { row: number; error: string }[];
  created_at: string;
}

export interface WorkSettings {
  supervisor_work_needs_approval: boolean;
  payout_reserve_rate: number;
}

export const DEFAULT_WORK_SETTINGS: WorkSettings = { supervisor_work_needs_approval: true, payout_reserve_rate: 0.1 };

export const UNIT_SUGGESTIONS = ['kg', 'crate', 'piece', 'row', 'bag', 'tree', 'bunch', 'day', 'hour'];

export const KIND_LABEL: Record<WorkerKind, string> = { employee: 'Employee', contractor: 'Contractor', casual: 'Casual' };
export const BASIS_LABEL: Record<PayBasis, string> = { salary: 'Salary', work: 'By work' };
export const FREQUENCY_LABEL: Record<PayFrequency, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', per_job: 'Per job' };
export const WHT_LABEL: Record<WhtCategory, string> = { contractual: 'Contractual (3%)', professional: 'Professional (5%)' };
export const STATUS_LABEL: Record<WorkStatus, string> = { draft: 'Draft', submitted: 'Waiting', approved: 'Approved', rejected: 'Rejected' };
export const JOB_STATUS_LABEL: Record<JobStatus, string> = { open: 'Open', completed: 'Completed', approved: 'Approved', cancelled: 'Cancelled' };
export const SOURCE_LABEL: Record<WorkSource, string> = { payroll: 'Payroll', upload: 'Upload', supervisor: 'Supervisor', self: 'Worker' };

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const personName = (p: Pick<WorkPerson, 'first_name' | 'last_name' | 'employee_number'>) =>
  [p.first_name, p.last_name].map(text).filter(Boolean).join(' ') || p.employee_number;

// ---------------------------------------------------------------------------------------------
// amounts
// ---------------------------------------------------------------------------------------------
/** A typed quantity: a number more than 0 (commas allowed), else null. Blank is null too. */
export function parseQuantity(value: unknown): number | null {
  const s = text(value).replace(/,/g, '');
  if (!s || !/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n < 1e9 ? Math.round(n * 1000) / 1000 : null;
}

/** What a quantity pays at a rate, to the cent (as the database's generated amount). */
export const entryAmount = (quantity: number | string | null, rate: number | string) =>
  quantity === null || quantity === '' ? 0 : round2(num(quantity) * num(rate));

/** A rate's first day for display: '-infinity' (from the start) has none. */
export const rateStarts = (from: string) => (from.startsWith('-') || from < '1900' ? null : from.slice(0, 10));

/**
 * The rate for a kind of work on a day, as work_rate_on(): the latest that started on or before the day; before the
 * first, the first; with no history, the type's own rate.
 */
export function rateOn(rates: WorkRate[], type: Pick<WorkType, 'id' | 'rate'>, day: string): number {
  const mine = rates
    .filter((r) => r.work_type_id === type.id)
    .map((r) => ({ from: rateStarts(r.effective_from) ?? '0000-00-00', rate: num(r.rate) }))
    .sort((a, b) => a.from.localeCompare(b.from));
  if (!mine.length) return num(type.rate);
  const started = mine.filter((r) => r.from <= day);
  return (started.length ? started[started.length - 1] : mine[0]).rate;
}

/** Whether a kind of work can be recorded on a day (active and within its dates). */
export const typeOpenOn = (t: Pick<WorkType, 'active' | 'effective_from' | 'effective_to'>, day: string) =>
  t.active && (!t.effective_from || t.effective_from <= day) && (!t.effective_to || t.effective_to >= day);

/** Total quantity and amount of some entries, counting only those that count (not drafts or rejected). */
export function entryTotals(entries: Pick<WorkEntry, 'quantity' | 'amount' | 'status'>[], statuses: WorkStatus[] = ['approved']) {
  let quantity = 0;
  let amount = 0;
  for (const e of entries) {
    if (!statuses.includes(e.status)) continue;
    quantity += num(e.quantity);
    amount = round2(amount + num(e.amount));
  }
  return { quantity: Math.round(quantity * 1000) / 1000, amount };
}

export const formatQty = (n: number | string) => num(n).toLocaleString('en-KE', { maximumFractionDigits: 3 });

/** The first and last day of the month a day is in. */
export function monthOf(day: string) {
  const [y, m] = day.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}

// ---------------------------------------------------------------------------------------------
// the spreadsheet
// ---------------------------------------------------------------------------------------------
export const WORK_SHEET_HEADERS = ['Employee Number', 'Date', 'Kind of Work', 'Quantity', 'Notes'] as const;

const pick = (row: Record<string, unknown>, ...names: string[]) => {
  const keys = Object.keys(row);
  for (const name of names) {
    const key = keys.find((k) => k.trim().toLowerCase().replace(/[\s_.]+/g, ' ') === name);
    if (key !== undefined && text(row[key])) return row[key];
  }
  return '';
};

/**
 * A sheet date as YYYY-MM-DD: ISO dates as they are, day-first dates (16/10/2026, 16-10-26) as used in Kenya, and
 * Excel day numbers (46311). Anything else comes back as typed, for the database to refuse with a clear reason.
 */
export function sheetDate(value: unknown): string {
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = text(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return s;
}

export interface SheetWorkRow {
  employee_number: string;
  work_date: string;
  work_type: string;
  quantity: string;
  notes: string;
  /** the row in the sheet (2 = the first row after the header) */
  sheet_row: number;
}

/** A work sheet's rows as check_work_import takes them; empty rows dropped, each row's place in the sheet kept. */
export function workRowsFromSheet(rows: Record<string, unknown>[]): SheetWorkRow[] {
  const out: SheetWorkRow[] = [];
  rows.forEach((r, i) => {
    const row: SheetWorkRow = {
      employee_number: text(pick(r, 'employee number', 'employee no', 'emp no', 'staff number', 'number', 'worker')),
      work_date: sheetDate(pick(r, 'date', 'work date', 'day')),
      work_type: text(pick(r, 'kind of work', 'work type', 'type of work', 'work', 'task', 'activity')),
      quantity: text(pick(r, 'quantity', 'qty', 'units', 'amount of work', 'output')),
      notes: text(pick(r, 'notes', 'note', 'comment', 'comments')),
      sheet_row: i + 2,
    };
    if (row.employee_number || row.work_type || row.quantity) out.push(row);
  });
  return out;
}

/** The template's example rows: a few real workers and kinds of work, so payroll sees the shape. */
export function templateRows(people: Pick<WorkPerson, 'employee_number' | 'pay_basis'>[], types: Pick<WorkType, 'name' | 'active'>[], day: string): string[][] {
  const workers = people.filter((p) => p.pay_basis === 'work').slice(0, 3);
  const kinds = types.filter((t) => t.active);
  if (!workers.length || !kinds.length) return [['EMP-0001', day, 'Tea picked', '42.5', '']];
  return workers.map((w, i) => [w.employee_number, day, kinds[i % kinds.length].name, '10', '']);
}
