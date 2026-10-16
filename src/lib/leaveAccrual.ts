/** Days earned so far in a year for a yearly allowance that builds up month by month (same rule as the database). */
export function earnedToDate(yearlyDays: number, month: number): number {
  const months = Math.min(Math.max(Math.trunc(month) || 1, 1), 12);
  return Math.round(((Number(yearlyDays) || 0) * months) / 12 * 100) / 100;
}

/** A YYYY-MM-DD date (the start of the text), else null: the database only counts dates written that way. */
const isoDate = (value: unknown): Date | null => {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * When someone joined, as the database works it out (employee_joined): "Start Date", else "Contract Start Date", else
 * "Probation Start Date". A contract renewed mid-year doesn't restart anyone's leave.
 */
export function employeeJoined(employee: Record<string, unknown>): Date | null {
  return isoDate(employee['Start Date']) ?? isoDate(employee['Contract Start Date']) ?? isoDate(employee['Probation Start Date']);
}

/** Months of `year`, up to month `upto`, someone was employed: the month they joined counts in full (leave_service_months). */
export function serviceMonths(joined: Date | null, year: number, upto: number): number {
  const until = Math.min(Math.max(Math.trunc(upto) || 0, 0), 12);
  if (!joined || joined.getUTCFullYear() < year) return until;
  if (joined.getUTCFullYear() > year) return 0;
  return Math.max(until - (joined.getUTCMonth() + 1) + 1, 0);
}

/** The part of a yearly allowance someone has for `year`, up to month `upto` (12 = all of it), from when they joined. */
export function yearAllowance(yearlyDays: number, joined: Date | null, year: number, upto: number): number {
  return Math.round(((Number(yearlyDays) || 0) * serviceMonths(joined, year, upto)) / 12 * 100) / 100;
}

export type AccrualMethod = 'annual' | 'monthly_cumulative' | 'monthly_non_cumulative' | 'none';

/** Methods whose balance is for the whole year, and so can carry days forward and send year-end reminders. */
export const isYearlyMethod = (method: string | undefined): boolean => method === 'annual' || method === 'monthly_cumulative';
