import { leaveDailyRate, type LeaveItem, type LeaveRateBasis } from './leavePay';

/**
 * Unexcused absence on the payslip (FIG-881). Pure: the database call is in leaveDisciplineApi.
 *
 * The database (absence_pay_deductions) gives each employee's days of unexcused absence in the month (recorded, not
 * excused; nothing when the company has turned the deduction off). They come off gross pay like unpaid leave, at the
 * same day's pay (company_payroll_settings.leave_daily_rate_basis), before tax. The line is added to the leave lines
 * (salary_history.leave_items, kind 'absence') and its amount to the leave deduction, so the payslip, PDF, register
 * and exports all show "Unexcused absence: 2 days". Leave and absence together never come to more than the basic.
 */

/** One employee's unexcused absence in a month (a row of absence_pay_deductions) */
export interface AbsencePayRow {
  employee_number: string;
  absence_days: number | string;
  /** their working days that month (for the 'working_days' day's pay) */
  month_working_days: number | string;
  absences: { id: string; start_date: string; end_date: string; days_in_month: number }[];
}

export const ABSENCE_LINE_NAME = 'Unexcused absence';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The month's leave lines (from leavePayFor) with the unexcused absence line added, and the new total. No row (or no
 * days), nothing added.
 */
export function withAbsencePay(
  leave: { items: LeaveItem[]; total: number; dailyRate: number },
  row: AbsencePayRow | undefined,
  basic: number,
  basis: LeaveRateBasis,
) {
  const days = round2(num(row?.absence_days));
  if (!row || days <= 0) return leave;
  const dailyRate = leaveDailyRate(basic, basis, num(row.month_working_days));
  const left = Math.max(0, round2(Math.max(0, num(basic)) - leave.total));
  const item: LeaveItem = {
    name: ABSENCE_LINE_NAME,
    kind: 'absence',
    leave_type: '',
    days,
    daily_rate: dailyRate,
    amount: Math.min(left, round2(days * dailyRate)),
    applications: (row.absences ?? []).map((a) => ({ id: a.id, start_date: a.start_date, end_date: a.end_date, days: num(a.days_in_month) })),
  };
  return { items: [...leave.items, item], total: round2(leave.total + item.amount), dailyRate: leave.dailyRate || dailyRate };
}
