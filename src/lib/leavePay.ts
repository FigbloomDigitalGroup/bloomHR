/**
 * Half-pay and unpaid leave on the payslip (FIG-880). Pure: the database calls are in leavePayDb.
 *
 * The database (leave_pay_deductions) gives each employee's unpaid days and half-pay days in the month from approved
 * leave. Payroll takes them off gross pay, so PAYE, NSSF, SHIF and the housing levy are worked out on what is left:
 *
 *   a day's pay      basic / 30 ('basic_30', the default), or basic / the employee's working days that month
 *                    ('working_days': their work week less holidays), rounded to the cent
 *   unpaid leave     days x a day's pay
 *   half pay         days x a day's pay x 0.5
 *
 * Each leave type is its own payslip line ("Unpaid Leave: 2 days", "Sick Leave at half pay: 3 days"). Together they
 * never come to more than the basic salary.
 */

export type LeaveRateBasis = 'basic_30' | 'working_days';

export const LEAVE_RATE_BASES: { value: LeaveRateBasis; label: string; hint: string }[] = [
  { value: 'basic_30', label: 'Basic salary ÷ 30', hint: 'Every month counts as 30 days, whatever its length.' },
  {
    value: 'working_days',
    label: "Basic salary ÷ the month's working days",
    hint: "The employee's working days that month, from their work week, less public holidays.",
  },
];

/** One application behind the month's deduction (from leave_pay_deductions) */
export interface LeavePayApplication {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  /** its days in this month */
  days_in_month: number;
  unpaid_days: number;
  half_pay_days: number;
}

/** One employee's unpaid and half-pay days in a month (a row of leave_pay_deductions) */
export interface LeavePayRow {
  employee_number: string;
  unpaid_days: number;
  half_pay_days: number;
  /** their working days that month (for the 'working_days' basis) */
  month_working_days: number;
  applications: LeavePayApplication[];
}

/** One payslip line (salary_history.leave_items) */
export interface LeaveItem {
  /** e.g. "Unpaid Leave", "Sick Leave at half pay" (the payslip adds ": 3 days") */
  name: string;
  kind: 'unpaid' | 'half_pay';
  leave_type: string;
  days: number;
  daily_rate: number;
  /** what comes off gross pay (positive) */
  amount: number;
  applications: { id: string; start_date: string; end_date: string; days: number }[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A day's pay for leave deductions, to the cent. */
export const leaveDailyRate = (basic: number, basis: LeaveRateBasis, monthWorkingDays?: number) => {
  const b = Math.max(0, num(basic));
  const workingDays = num(monthWorkingDays);
  return round2(basis === 'working_days' && workingDays > 0 ? b / workingDays : b / 30);
};

const unpaidName = (type: string) => (/^\s*unpaid/i.test(type) ? type.trim() : `${type.trim() || 'Leave'} (unpaid)`);

/**
 * The leave lines on one employee's payslip for the month and their total. No row, no lines. The total is capped at
 * the basic salary (the last line is reduced to fit).
 */
export function leavePayFor(row: LeavePayRow | undefined, basic: number, basis: LeaveRateBasis) {
  if (!row) return { items: [] as LeaveItem[], total: 0, dailyRate: 0 };
  const dailyRate = leaveDailyRate(basic, basis, row.month_working_days);
  const byLine = new Map<string, LeaveItem>();
  for (const app of row.applications ?? []) {
    for (const kind of ['unpaid', 'half_pay'] as const) {
      const days = num(kind === 'unpaid' ? app.unpaid_days : app.half_pay_days);
      if (days <= 0) continue;
      const key = `${kind}:${app.leave_type}`;
      const item = byLine.get(key) ?? {
        name: kind === 'unpaid' ? unpaidName(app.leave_type) : `${app.leave_type.trim() || 'Leave'} at half pay`,
        kind,
        leave_type: app.leave_type,
        days: 0,
        daily_rate: dailyRate,
        amount: 0,
        applications: [],
      };
      item.days = round2(item.days + days);
      item.applications.push({ id: app.id, start_date: app.start_date, end_date: app.end_date, days });
      byLine.set(key, item);
    }
  }
  const items = [...byLine.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'unpaid' ? -1 : 1));
  let left = Math.max(0, num(basic));
  for (const item of items) {
    item.amount = Math.min(left, round2(item.days * dailyRate * (item.kind === 'half_pay' ? 0.5 : 1)));
    left = round2(left - item.amount);
  }
  return { items, total: round2(items.reduce((s, i) => s + i.amount, 0)), dailyRate };
}

/** The share of basic salary payroll treats as per diem (not taxed), as PayrollDashboard always has. */
export const PER_DIEM_SHARE = 0.33;

/**
 * The basic salary earned in a month once its leave deduction is taken off, and the per diem part of it: the per diem
 * is a share of the basic actually paid, so a month of unpaid leave leaves neither.
 */
export const basicAfterLeave = (basic: number, leaveDeduction: number) => {
  const earnedBasic = Math.max(0, num(basic) - Math.max(0, num(leaveDeduction)));
  return { earnedBasic, perDiem: earnedBasic * PER_DIEM_SHARE };
};

const dayText = (days: number) => `${+days.toFixed(2)} ${days === 1 ? 'day' : 'days'}`;

/** "Unpaid Leave: 2 days", "Sick Leave at half pay: 3 days" */
export const leaveLineLabel = (item: Pick<LeaveItem, 'name' | 'days'>) => `${item.name}: ${dayText(num(item.days))}`;

/** How the line was worked out: "2 × KSh 1,000.00", "3 × KSh 1,000.00 × ½" */
export const leaveLineWorking = (item: Pick<LeaveItem, 'kind' | 'days' | 'daily_rate'>) =>
  `${+num(item.days).toFixed(2)} × KSh ${num(item.daily_rate).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${item.kind === 'half_pay' ? ' × ½' : ''}`;

/** A saved payslip's leave lines (salary_history.leave_items); none for payslips saved before FIG-880. */
export const payslipLeaveLines = (payslip: { leave_items?: unknown }): LeaveItem[] =>
  Array.isArray(payslip.leave_items)
    ? (payslip.leave_items as Partial<LeaveItem>[])
        .map((i) => ({
          name: String(i.name ?? 'Leave'),
          kind: (i.kind === 'half_pay' ? 'half_pay' : 'unpaid') as LeaveItem['kind'],
          leave_type: String(i.leave_type ?? ''),
          days: num(i.days),
          daily_rate: num(i.daily_rate),
          amount: num(i.amount),
          applications: Array.isArray(i.applications) ? i.applications : [],
        }))
        .filter((i) => i.amount > 0)
    : [];

/** One text cell for exports: "Unpaid Leave: 2 days -2000; Sick Leave at half pay: 3 days -1500" */
export const leaveLinesText = (payslip: { leave_items?: unknown }) =>
  payslipLeaveLines(payslip).map((l) => `${leaveLineLabel(l)} -${l.amount}`).join('; ');

// ---------------------------------------------------------------------------------------------
// Leave paid out (FIG-877): days over a leave type's carry-forward cap that the company pays instead of losing. The
// database (leave_payouts_due) lists the payouts payroll can pay this month; each is a taxable earning on the payslip,
// "Leave paid out: 5 days", at the same daily rate as leave deductions. Approving the payroll month marks it paid.
// ---------------------------------------------------------------------------------------------

/** One payout payroll can pay this month (a row of leave_payouts_due) */
export interface LeavePayoutDue {
  id: string;
  employee_number: string;
  leave_type: string;
  days: number;
  year: number;
  pay_period: string;
  /** their working days that month (for the 'working_days' basis) */
  month_working_days: number;
}

/** A payslip earning line for a payout (salary_history.earning_items, with the payout it pays) */
export interface LeavePayoutItem {
  name: string;
  amount: number;
  taxable: boolean;
  pensionable: boolean;
  leave_payout_id: string;
}

/** "Leave paid out: 5 days" */
export const leavePayoutLabel = (days: number) => `Leave paid out: ${dayText(num(days))}`;

/**
 * The earning lines for one employee's payouts this month: days x a day's pay (the leave daily-rate basis), taxable
 * and pensionable like the salary it stands in for. None without payouts or a basic salary.
 */
export function leavePayoutItems(payouts: LeavePayoutDue[] | undefined, basic: number, basis: LeaveRateBasis): LeavePayoutItem[] {
  return (payouts ?? [])
    .map((p) => ({
      name: leavePayoutLabel(p.days),
      amount: round2(num(p.days) * leaveDailyRate(basic, basis, p.month_working_days)),
      taxable: true,
      pensionable: true,
      leave_payout_id: p.id,
    }))
    .filter((i) => i.amount > 0);
}
