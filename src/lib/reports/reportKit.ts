import { saveAs } from 'file-saver';
import { supabase } from '../supabase';
import { fetchAll } from '../fetchAll';
import { XLSX_TYPE, toXlsx } from '../xlsxExport';

// What every report in Reports shares: the months it can cover, reading the staff it is about, and the Excel download.

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the tables give them */
export type Row = Record<string, any>;

/** "2026-11" for a date (local time) */
export const monthOf = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** The first and last day of a month: "2026-11" -> ["2026-11-01", "2026-11-30"] */
export function monthBounds(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

/** "2026-11" -> "2026-10" (n months back; negative: forward) */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Every month from `from` to `to`, both included, oldest first (at most 36). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let m = from;
  while (m <= to && out.length < 36) {
    out.push(m);
    m = addMonths(m, -1);
  }
  return out;
}

/** "Sep 2026" */
export const shortMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** Someone's full name from an employee row. */
export const fullName = (e: Row | null | undefined) =>
  [e?.['First Name'], e?.['Middle Name'], e?.['Last Name']].filter((p) => p && String(p).trim()).join(' ') || e?.['Employee Number'] || '';

/** A count with its word: "1 day", "3 days" */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** n out of total as a whole percentage, or null with nothing to divide by */
export const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : null);

/** The columns a report needs about each person: who, where (branch, department), what (title, group, kind), since when. */
export const REPORT_EMPLOYEE_COLUMNS =
  '"Employee Number", "First Name", "Middle Name", "Last Name", "Branch", branch_id, department_id, "Job Level", "Job Title", "Job Group", ' +
  '"Employee Type", "Status", "Start Date", "Termination Date", worker_kind, onboarding_status';

/** The company's staff with the columns above (everyone, current and former; casual workers included). */
export const readReportEmployees = () =>
  fetchAll<Row>((from, to) => supabase.from('employees').select(REPORT_EMPLOYEE_COLUMNS).order('"Employee Number"').order('id').range(from, to));

/** Employee number -> row */
export const byNumber = (employees: Row[]) => new Map(employees.map((e) => [String(e['Employee Number']), e]));

/** Whether a person was on staff during a month: started by its end, not gone before its start. */
export function employedIn(e: Row, month: string): boolean {
  const [first, last] = monthBounds(month);
  const start = String(e['Start Date'] || '').slice(0, 10);
  const end = String(e['Termination Date'] || '').slice(0, 10);
  return (!start || start <= last) && (!end || end >= first);
}

export interface ReportFilters {
  branchId?: string;
  departmentId?: string;
  search?: string;
}

/** Whether a person matches the branch / department / search filters (search: name or employee number). */
export function matchesFilters(e: Row | undefined, f: ReportFilters): boolean {
  if (f.branchId && e?.branch_id !== f.branchId) return false;
  if (f.departmentId && e?.department_id !== f.departmentId) return false;
  const q = f.search?.trim().toLowerCase();
  if (q && !`${fullName(e)} ${e?.['Employee Number'] ?? ''}`.toLowerCase().includes(q)) return false;
  return true;
}

/** Downloads a table as an Excel file: "<name>.xlsx". Numbers stay numbers in the sheet only as text cells, as elsewhere. */
export function downloadXlsx(fileName: string, headers: readonly string[], rows: (string | number | null | undefined)[][], sheet = 'Report') {
  const bytes = toXlsx(headers, rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))), sheet);
  saveAs(new Blob([bytes], { type: XLSX_TYPE }), fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

/** Adds amounts per currency: { KES: 1200, UGX: 50000 } */
export function sumByCurrency<T>(items: T[], currency: (t: T) => string, amount: (t: T) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of items) {
    const c = currency(t) || 'KES';
    out[c] = Math.round(((out[c] ?? 0) + (Number(amount(t)) || 0)) * 100) / 100;
  }
  return out;
}
