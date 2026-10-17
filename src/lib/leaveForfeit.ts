import { toCsv } from './payrollExports';
import type { ForfeitRow } from './leaveYearDb';

// The "Forfeited & paid out" report (FIG-877): leave days lost at the yearly reset (over the carry-forward cap) or at
// the carried days' deadline, and days over the cap paid out instead. Pure: the database call is in leaveYearDb.

/** Why the days went, in words */
export const forfeitWhy = (row: Pick<ForfeitRow, 'kind' | 'reason'>) =>
  row.kind === 'pay_out'
    ? 'Paid out: over the carry-forward cap at the yearly reset'
    : row.reason === 'carry_expired'
      ? 'Lost: carried-over days not used by their deadline'
      : 'Lost: over the carry-forward cap at the yearly reset';

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Per employee and leave type: days lost and days paid out */
export interface ForfeitSummary {
  employee_number: string;
  employee_name: string;
  leave_type: string;
  lost: number;
  paid_out: number;
}

export function summariseForfeits(rows: ForfeitRow[]): { byEmployee: ForfeitSummary[]; lost: number; paidOut: number } {
  const by = new Map<string, ForfeitSummary>();
  for (const r of rows) {
    const key = `${r.employee_number}::${r.leave_type}`;
    const s = by.get(key) ?? { employee_number: r.employee_number, employee_name: r.employee_name, leave_type: r.leave_type, lost: 0, paid_out: 0 };
    if (r.kind === 'pay_out') s.paid_out = round2(s.paid_out + num(r.days));
    else s.lost = round2(s.lost + num(r.days));
    by.set(key, s);
  }
  const byEmployee = [...by.values()].sort((a, b) => a.employee_name.localeCompare(b.employee_name) || a.leave_type.localeCompare(b.leave_type));
  return {
    byEmployee,
    lost: round2(byEmployee.reduce((t, s) => t + s.lost, 0)),
    paidOut: round2(byEmployee.reduce((t, s) => t + s.paid_out, 0)),
  };
}

export const FORFEIT_CSV_HEADERS = [
  'Employee Number', 'Employee', 'Leave Type', 'Leave Year', 'Date', 'Days', 'What happened', 'Payout status', 'Amount paid', 'Pay period', 'Details',
] as const;

export function forfeitCsv(rows: ForfeitRow[]): string {
  return toCsv(FORFEIT_CSV_HEADERS, rows.map((r) => [
    r.employee_number,
    r.employee_name,
    r.leave_type,
    String(r.year),
    String(r.on_date ?? '').slice(0, 10),
    String(num(r.days)),
    forfeitWhy(r),
    r.kind === 'pay_out' ? (r.status === 'paid' ? 'Paid' : 'Waiting for payroll') : '',
    r.kind === 'pay_out' && r.amount != null ? String(num(r.amount)) : '',
    r.kind === 'pay_out' ? r.pay_period ?? '' : '',
    r.note ?? '',
  ]));
}
