/**
 * The month a payslip is for, from its pay period ("2026-10" -> "October 2026"). The pay period is the month worked
 * and paid, the same month the run, the "Payslip ready" notice and the payslip email name.
 */
export function payPeriodLabel(period: string | null | undefined, fallback = 'N/A'): string {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(period ?? '').trim());
  if (!m) return fallback;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return fallback;
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
