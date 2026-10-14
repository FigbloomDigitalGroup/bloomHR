import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { earnedToDate } from './leaveAccrual';
import { toCsv } from './payrollExports';
import type { DeductionItem } from './voluntaryDeductions';

/**
 * The final dues statement for someone leaving (FIG-832): what they are owed for their last month, before tax and the
 * statutory deductions, which the payroll run works out when the statement is included in a month.
 *
 *   + basic pay for the days worked in the last month (days worked / days in the month)
 *   + annual leave earned and not taken x the daily rate (a leave overdraft is taken back instead)
 *   + pay in lieu of the notice not worked, when the exit says so
 *   - salary advances and loans still owed, and the voluntary deductions due for the month
 *
 * The daily rate is basic / 30, the usual rate for monthly-paid staff in Kenya.
 */

export const DAILY_RATE_DIVISOR = 30;

export type DuesLineKind = 'earning' | 'deduction';

export interface FinalDuesLine {
  code: string;
  label: string;
  detail?: string;
  kind: DuesLineKind;
  amount: number;
}

export interface FinalDuesInput {
  basicSalary: number;
  /** YYYY-MM-DD */
  lastWorkingDay: string;
  /** YYYY-MM-DD; only matters when they started in their last month */
  startDate?: string | null;
  /** YYYY-MM-DD: when notice was given, to work out the notice not worked */
  noticeGivenOn: string;
  noticeDays: number;
  noticePay: boolean;
  /** annual leave earned and not taken (negative when more was taken than earned) */
  leaveDays: number;
  advances: number;
  loans: number;
  voluntary: DeductionItem[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** A YYYY-MM-DD day as a UTC date (so no time zone moves it). */
function utcDay(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((value ?? '').trim());
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000);

export const daysInMonth = (day: Date) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();

/** The pay period ('YYYY-MM') of a day. */
export const periodOf = (day: string) => day.slice(0, 7);

export const money = (n: number) => n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Annual leave days earned and not taken by the last working day. A yearly allowance given at the start of the year
 * ('annual') is earned month by month for someone leaving; one already earned month by month ('monthly_cumulative')
 * is taken as it stands.
 */
export function leaveDaysOutstanding(balance: {
  accrued: number;
  carried: number;
  used: number;
  method: string | null | undefined;
  /** 1-12: the month of the last working day */
  month: number;
}): number {
  const earned = balance.method === 'annual' ? earnedToDate(num(balance.accrued), balance.month) : num(balance.accrued);
  return round2(earned + num(balance.carried) - num(balance.used));
}

export function finalDuesLines(input: FinalDuesInput): FinalDuesLine[] {
  const last = utcDay(input.lastWorkingDay);
  if (!last) throw new Error('The last working day is missing');
  const basic = num(input.basicSalary);
  const dailyRate = basic / DAILY_RATE_DIVISOR;
  const lines: FinalDuesLine[] = [];

  const monthDays = daysInMonth(last);
  const monthStart = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1));
  const start = utcDay(input.startDate);
  const from = start && start > monthStart ? start : monthStart;
  const worked = Math.max(0, daysBetween(from, last) + 1);
  lines.push({
    code: 'basic',
    label: 'Basic pay for the last month',
    detail: `${worked} of ${monthDays} days x ${money(basic)} / ${monthDays}`,
    kind: 'earning',
    amount: round2((basic * worked) / monthDays),
  });

  const leave = round2(num(input.leaveDays));
  if (leave !== 0) {
    lines.push({
      code: 'leave',
      label: leave > 0 ? 'Leave days not taken' : 'Leave taken beyond what was earned',
      detail: `${Math.abs(leave)} days x ${money(round2(dailyRate))} (basic / ${DAILY_RATE_DIVISOR})`,
      kind: leave > 0 ? 'earning' : 'deduction',
      amount: round2(Math.abs(leave) * dailyRate),
    });
  }

  if (input.noticePay) {
    const given = utcDay(input.noticeGivenOn) ?? last;
    const served = Math.max(0, daysBetween(given, last));
    const unserved = Math.max(0, num(input.noticeDays) - served);
    if (unserved > 0) {
      lines.push({
        code: 'notice',
        label: 'Pay in lieu of notice',
        detail: `${unserved} of ${num(input.noticeDays)} notice days not worked x ${money(round2(dailyRate))}`,
        kind: 'earning',
        amount: round2(unserved * dailyRate),
      });
    }
  }

  if (num(input.advances) > 0) {
    lines.push({ code: 'advance', label: 'Salary advances owed', kind: 'deduction', amount: round2(num(input.advances)) });
  }
  if (num(input.loans) > 0) {
    lines.push({ code: 'loan', label: 'Loans owed', kind: 'deduction', amount: round2(num(input.loans)) });
  }
  for (const d of input.voluntary) {
    if (num(d.amount) > 0) {
      lines.push({ code: 'voluntary', label: d.name, detail: `Due for ${periodOf(input.lastWorkingDay)}`, kind: 'deduction', amount: round2(num(d.amount)) });
    }
  }
  return lines;
}

export function duesTotals(lines: FinalDuesLine[]) {
  const earnings = round2(lines.filter((l) => l.kind === 'earning').reduce((s, l) => s + num(l.amount), 0));
  const deductions = round2(lines.filter((l) => l.kind === 'deduction').reduce((s, l) => s + num(l.amount), 0));
  return { earnings, deductions, net: round2(earnings - deductions) };
}

export interface StatementHeading {
  employeeName: string;
  employeeNumber: string;
  lastWorkingDay: string;
  kind: string;
  payrollPeriod?: string | null;
}

export const STATEMENT_HEADERS = ['Item', 'Detail', 'Earning', 'Deduction'] as const;

const statementRows = (lines: FinalDuesLine[]) => {
  const totals = duesTotals(lines);
  return [
    ...lines.map((l) => [l.label, l.detail ?? '', l.kind === 'earning' ? money(l.amount) : '', l.kind === 'deduction' ? money(l.amount) : '']),
    ['Total', '', money(totals.earnings), money(totals.deductions)],
    ['Net final dues (before tax and statutory deductions)', '', money(totals.net), ''],
  ];
};

export const statementCsv = (lines: FinalDuesLine[]) => toCsv(STATEMENT_HEADERS, statementRows(lines));

const fileName = (h: StatementHeading, ext: string) => `Final-dues-${h.employeeNumber || 'employee'}.${ext}`;

export function downloadStatementCsv(heading: StatementHeading, lines: FinalDuesLine[]) {
  const blob = new Blob([statementCsv(lines)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(heading, 'csv');
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadStatementPdf(heading: StatementHeading, lines: FinalDuesLine[]) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Final dues statement', 40, 40);
  doc.setFontSize(9);
  doc.text(`Employee: ${heading.employeeName || '-'}    Number: ${heading.employeeNumber || '-'}`, 40, 60);
  doc.text(
    `Exit: ${heading.kind}    Last working day: ${heading.lastWorkingDay}` + (heading.payrollPeriod ? `    Included in payroll: ${heading.payrollPeriod}` : ''),
    40,
    74
  );
  (doc as unknown as { autoTable: (o: Record<string, unknown>) => void }).autoTable({
    startY: 88,
    head: [STATEMENT_HEADERS as unknown as string[]],
    body: statementRows(lines),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [14, 79, 39] },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
  });
  doc.setFontSize(7);
  doc.text(
    `Daily rate = basic / ${DAILY_RATE_DIVISOR}. Tax and statutory deductions are worked out by the payroll run the statement is included in.`,
    40,
    doc.internal.pageSize.getHeight() - 30
  );
  doc.save(fileName(heading, 'pdf'));
}
