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

// ---------------------------------------------------------------------------------------------
// the company's leave year (FIG-877): year N runs from the 1st of the start month in N for 12 months. Start month 1
// (January, the default) is the calendar year. The same rules as leave_year_of / leave_month_of in the database.
// ---------------------------------------------------------------------------------------------
const startMonthOf = (startMonth: number | undefined) => Math.min(Math.max(Math.trunc(Number(startMonth)) || 1, 1), 12);

/** The leave year a (UTC) date falls in: the year its leave year started. */
export function leaveYearOf(date: Date, startMonth = 1): number {
  const s = startMonthOf(startMonth);
  return date.getUTCFullYear() - (date.getUTCMonth() + 1 < s ? 1 : 0);
}

/** Month 1..12 of the leave year a (UTC) date falls in. */
export function leaveMonthOf(date: Date, startMonth = 1): number {
  return ((date.getUTCMonth() + 1 - startMonthOf(startMonth) + 12) % 12) + 1;
}

/** The first day of leave year `year` (UTC). */
export const leaveYearStart = (year: number, startMonth = 1) => new Date(Date.UTC(year, startMonthOf(startMonth) - 1, 1));

/** The last day of leave year `year` (UTC). */
export const leaveYearEnd = (year: number, startMonth = 1) => new Date(Date.UTC(year + 1, startMonthOf(startMonth) - 1, 0));

/** The first day carried-over days are lost: the leave year's start plus `months` (null when they never expire). */
export function carryExpiryDate(year: number, startMonth: number, months: number): Date | null {
  const m = Math.trunc(Number(months)) || 0;
  if (m <= 0) return null;
  return new Date(Date.UTC(year, startMonthOf(startMonth) - 1 + m, 1));
}

/** "July 2026 to June 2027", or just "2026" for a calendar leave year. */
export function leaveYearLabel(year: number, startMonth = 1): string {
  if (startMonthOf(startMonth) === 1) return String(year);
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${fmt(leaveYearStart(year, startMonth))} to ${fmt(leaveYearEnd(year, startMonth))}`;
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Months of leave year `year`, up to month `upto` of it, someone was employed: the month they joined counts in full
 * (leave_service_months).
 */
export function serviceMonths(joined: Date | null, year: number, upto: number, startMonth = 1): number {
  const until = Math.min(Math.max(Math.trunc(upto) || 0, 0), 12);
  if (!joined || joined < leaveYearStart(year, startMonth)) return until;
  if (joined >= leaveYearStart(year + 1, startMonth)) return 0;
  return Math.max(until - leaveMonthOf(joined, startMonth) + 1, 0);
}

/** The part of a yearly allowance someone has for leave year `year`, up to month `upto` (12 = all of it), from when they joined. */
export function yearAllowance(yearlyDays: number, joined: Date | null, year: number, upto: number, startMonth = 1): number {
  return Math.round(((Number(yearlyDays) || 0) * serviceMonths(joined, year, upto, startMonth)) / 12 * 100) / 100;
}

export type AccrualMethod = 'annual' | 'monthly_cumulative' | 'monthly_non_cumulative' | 'none';

/** Methods whose balance is for the whole year, and so can carry days forward and send year-end reminders. */
export const isYearlyMethod = (method: string | undefined): boolean => method === 'annual' || method === 'monthly_cumulative';

/** What happens to the days over the carry-forward cap at the yearly reset. */
export type OverCap = 'forfeit' | 'pay_out';
