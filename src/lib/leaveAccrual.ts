/** Days earned so far in a year for a yearly allowance that builds up month by month (same rule as the database). */
export function earnedToDate(yearlyDays: number, month: number): number {
  const months = Math.min(Math.max(Math.trunc(month) || 1, 1), 12);
  return Math.round(((Number(yearlyDays) || 0) * months) / 12 * 100) / 100;
}

export type AccrualMethod = 'annual' | 'monthly_cumulative' | 'monthly_non_cumulative' | 'none';

/** Methods whose balance is for the whole year, and so can carry days forward and send year-end reminders. */
export const isYearlyMethod = (method: string | undefined): boolean => method === 'annual' || method === 'monthly_cumulative';
