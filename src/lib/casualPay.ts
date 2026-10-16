import { BANK_HEADERS, MPESA_HEADERS, type ExportFile, mpesaPhone } from './payrollExports';
import { paymentKind } from './paymentMethods';

// Casual workers paid by the day (supabase/migrations/20261017900000_casual_workers.sql): the sums, the week grid,
// the spreadsheet rows and the payout files. The database works out and checks the same; this is for the screens.

export type DayPortion = 'full' | 'half' | 'absent';

export interface CasualWorker {
  id: string;
  employee_number: string;
  first_name: string | null;
  last_name: string | null;
  id_number: string | null;
  phone: string | null;
  daily_rate: number | string;
  start_date: string | null;
  finished_on: string | null;
  department_id: string | null;
  department: string | null;
  supervisor_email: string | null;
  payment_method: string | null;
  bank: string | null;
  bank_branch: string | null;
  bank_code: string | null;
  branch_code: string | null;
  account_name: string | null;
  account_number: string | null;
}

export interface CasualDay {
  id: string;
  employee_number: string;
  work_date: string;
  portion: DayPortion;
  daily_rate: number | string;
  amount: number | string;
  status: 'submitted' | 'approved';
  pay_run_id: string | null;
  paid_at: string | null;
}

export interface CasualPayRun {
  id: string;
  period_start: string;
  period_end: string;
  status: 'draft' | 'approved' | 'paid';
  notes: string | null;
  total: number | string;
  created_at: string;
  approved_at: string | null;
  paid_on: string | null;
}

export interface CasualPayLine {
  id: string;
  run_id: string;
  employee_number: string;
  worker_name: string;
  full_days: number;
  half_days: number;
  daily_rate: number | string | null;
  days_amount: number | string;
  additions: number | string;
  deductions: number | string;
  adjustment_note: string | null;
  net_pay: number | string;
  payment_method: string | null;
  phone: string | null;
  bank: string | null;
  bank_branch: string | null;
  bank_code: string | null;
  branch_code: string | null;
  account_name: string | null;
  account_number: string | null;
  payroll_number: string | null;
}

export interface LimitAlert {
  employee_number: string;
  worker_name: string;
  days_in_a_row: number;
  since: string;
  last_worked: string;
  day_limit: number;
  level: 'over' | 'near';
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const round2 = (n: number) => Math.round(n * 100) / 100;

export const casualName = (c: Pick<CasualWorker, 'first_name' | 'last_name' | 'employee_number'>) =>
  [c.first_name, c.last_name].map(text).filter(Boolean).join(' ') || c.employee_number;

/** An employee record (any shape) that is a casual worker: kept off the monthly payroll. */
export const isCasual = (e: Record<string, unknown> | null | undefined) => text(e?.['worker_kind']) === 'casual';

// ---------------------------------------------------------------------------------------------
// days and money
// ---------------------------------------------------------------------------------------------
/** What one day pays: the daily rate, half of it (to the cent), or nothing. */
export const dayAmount = (portion: DayPortion, rate: number | string) =>
  portion === 'full' ? round2(num(rate)) : portion === 'half' ? round2(num(rate) / 2) : 0;

export interface DayTotals {
  full: number;
  half: number;
  absent: number;
  amount: number;
}

/** Full days, half days, absences and what they pay (each day at the rate it was recorded at). */
export function dayTotals(days: Pick<CasualDay, 'portion' | 'daily_rate'>[]): DayTotals {
  const t: DayTotals = { full: 0, half: 0, absent: 0, amount: 0 };
  for (const d of days) {
    t[d.portion] += 1;
    t.amount = round2(t.amount + dayAmount(d.portion, d.daily_rate));
  }
  return t;
}

/** A pay line's take-home: days, plus additions, less deductions; never below nothing. */
export const lineNet = (l: Pick<CasualPayLine, 'days_amount' | 'additions' | 'deductions'>) =>
  Math.max(0, round2(num(l.days_amount) + num(l.additions) - num(l.deductions)));

export const runTotal = (lines: Pick<CasualPayLine, 'days_amount' | 'additions' | 'deductions'>[]) =>
  round2(lines.reduce((sum, l) => sum + lineNet(l), 0));

export const formatKsh = (n: number | string) =>
  `KSh ${num(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------------------------
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const today = () => iso(new Date());

/** The Monday of the week a day is in. */
export const weekStart = (s: string) => {
  const d = parse(s);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return iso(d);
};

/** The seven days of the week starting on `monday`. */
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

export const shortDay = (s: string) => parse(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const longDate = (s: string | null | undefined) =>
  s ? parse(s.slice(0, 10)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export const periodLabel = (start: string, end: string) => (start === end ? longDate(start) : `${longDate(start)} to ${longDate(end)}`);

/** Whether a casual worked for the company on a day: started by then and not finished before it. */
export const onBooks = (c: Pick<CasualWorker, 'start_date' | 'finished_on'>, day: string) =>
  (!c.start_date || c.start_date.slice(0, 10) <= day) && (!c.finished_on || c.finished_on.slice(0, 10) >= day);

/** Where a casual stands against the company's limit of days in a row (Employment Act s.37). */
export const limitStatus = (daysInARow: number, limit: number): 'over' | 'near' | 'ok' =>
  daysInARow > limit ? 'over' : daysInARow > limit - 5 ? 'near' : 'ok';

// ---------------------------------------------------------------------------------------------
// spreadsheets
// ---------------------------------------------------------------------------------------------
export const CASUAL_SHEET_HEADERS = [
  'First Name', 'Last Name', 'ID Number', 'Phone', 'Daily Rate', 'Start Date', 'Supervisor Email',
  'Payment Method', 'Bank', 'Bank Branch', 'Account Name', 'Account Number',
] as const;

const pick = (row: Record<string, unknown>, ...names: string[]) => {
  const keys = Object.keys(row);
  for (const name of names) {
    const key = keys.find((k) => k.trim().toLowerCase() === name.toLowerCase());
    if (key && text(row[key])) return text(row[key]);
  }
  return '';
};

/** Rows of a casuals sheet as register_casuals takes them (empty rows dropped). */
export function casualRowsFromSheet(rows: Record<string, unknown>[]) {
  return rows
    .map((r) => ({
      first_name: pick(r, 'First Name', 'First name'),
      last_name: pick(r, 'Last Name', 'Surname'),
      id_number: pick(r, 'ID Number', 'ID'),
      phone: pick(r, 'Phone', 'Phone Number', 'M-Pesa Number', 'Mobile Number'),
      daily_rate: pick(r, 'Daily Rate', 'Rate'),
      start_date: pick(r, 'Start Date'),
      supervisor_email: pick(r, 'Supervisor Email', 'Supervisor'),
      payment_method: pick(r, 'Payment Method') || (pick(r, 'Account Number') ? 'Bank Transfer' : 'M-Pesa'),
      bank: pick(r, 'Bank'),
      bank_branch: pick(r, 'Bank Branch', 'Branch'),
      account_name: pick(r, 'Account Name'),
      account_number: pick(r, 'Account Number'),
    }))
    .filter((r) => r.first_name || r.last_name || r.phone || r.daily_rate);
}

export const DAYS_SHEET_HEADERS = ['Employee Number', 'Date', 'Day'] as const;

/** "full", "half" or "absent" from how a sheet might say it (F, 1, Full day, H, 0.5, A, 0...). */
export const portionFrom = (value: unknown): DayPortion | null => {
  const v = text(value).toLowerCase().replace(/\s+/g, ' ');
  if (['f', 'full', 'full day', '1', 'present', 'p', 'yes'].includes(v)) return 'full';
  if (['h', 'half', 'half day', '0.5', '½'].includes(v)) return 'half';
  if (['a', 'absent', '0', 'no', 'off'].includes(v)) return 'absent';
  return null;
};

export interface SheetDay {
  employee_number: string;
  work_date: string;
  portion: DayPortion;
}

/** A days sheet (Employee Number, Date, Day) checked against the casuals: the days, and each row's problem. */
export function daysFromSheet(rows: Record<string, unknown>[], casuals: Pick<CasualWorker, 'employee_number' | 'id_number'>[]) {
  const byNumber = new Map(casuals.map((c) => [c.employee_number.toLowerCase(), c.employee_number]));
  const byId = new Map(casuals.filter((c) => c.id_number).map((c) => [text(c.id_number), c.employee_number]));
  const days: SheetDay[] = [];
  const problems: { row: number; problem: string }[] = [];
  rows.forEach((r, i) => {
    const who = pick(r, 'Employee Number', 'Employee No', 'Number');
    const id = pick(r, 'ID Number', 'ID');
    const number = byNumber.get(who.toLowerCase()) ?? byId.get(id);
    const date = pick(r, 'Date', 'Work Date');
    const portion = portionFrom(pick(r, 'Day', 'Portion', 'Attendance'));
    if (!who && !id && !date) return;
    if (!number) problems.push({ row: i + 2, problem: `No casual worker ${who || id || '(blank)'}` });
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push({ row: i + 2, problem: `The date "${date}" should look like 2026-10-16` });
    else if (!portion) problems.push({ row: i + 2, problem: 'Say Full, Half or Absent' });
    else days.push({ employee_number: number, work_date: date, portion });
  });
  return { days, problems };
}

// ---------------------------------------------------------------------------------------------
// payout files (the same columns as the monthly payroll's: lib/payrollExports)
// ---------------------------------------------------------------------------------------------
const money = (n: number) => n.toFixed(2);
export const runReference = (run: Pick<CasualPayRun, 'period_start' | 'period_end'>) =>
  run.period_start === run.period_end ? `Casual pay ${run.period_start}` : `Casual pay ${run.period_start} to ${run.period_end}`;

const linesPaidBy = (lines: CasualPayLine[], kind: 'mobile' | 'bank') =>
  lines.filter((l) => paymentKind(l.payment_method) === kind && lineNet(l) > 0);

export function casualMpesaFile(lines: CasualPayLine[], run: Pick<CasualPayRun, 'period_start' | 'period_end'>): ExportFile {
  const ls = linesPaidBy(lines, 'mobile');
  return {
    headers: MPESA_HEADERS,
    rows: ls.map((l) => [mpesaPhone(l.phone), l.worker_name, money(lineNet(l)), runReference(run), text(l.payroll_number)]),
    problems: ls
      .filter((l) => !mpesaPhone(l.phone))
      .map((l) => ({ name: l.worker_name, employeeNumber: l.employee_number, missing: ['M-Pesa number'] })),
  };
}

export function casualBankFile(lines: CasualPayLine[], run: Pick<CasualPayRun, 'period_start' | 'period_end'>): ExportFile {
  const ls = linesPaidBy(lines, 'bank');
  return {
    headers: BANK_HEADERS,
    rows: ls.map((l) => [
      text(l.payroll_number), l.worker_name, text(l.bank), text(l.bank_code), text(l.bank_branch), text(l.branch_code),
      text(l.account_name) || l.worker_name, text(l.account_number), money(lineNet(l)), runReference(run),
    ]),
    problems: ls
      .map((l) => ({
        name: l.worker_name,
        employeeNumber: l.employee_number,
        missing: [
          ...(text(l.bank) ? [] : ['Bank']),
          ...(text(l.account_number) ? [] : ['Account number']),
        ],
      }))
      .filter((p) => p.missing.length > 0),
  };
}
