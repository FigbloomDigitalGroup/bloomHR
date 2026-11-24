import type { HrState } from './platformSchoolHr';

// Customers asking for Figbloom HR from Figbloom Fleet, Property and Schools ("Request Figbloom HR" on the product's HR & Payroll
// card). The product records when (hr_requested_at in the console summaries it serves); the console shows it next to
// HR & Payroll "Off" so staff can switch it on with the usual Enable. Older product versions don't send it: no request.

interface Requestable {
  hr_requested_at?: string | null;
  hr?: { state: HrState } | null;
}

/** Asked for, and not switched on yet (Enabling or On means staff already acted on it). */
export function hrRequestPending(row: Requestable): boolean {
  if (!row.hr_requested_at || Number.isNaN(Date.parse(row.hr_requested_at))) return false;
  return row.hr?.state !== 'on' && row.hr?.state !== 'enabling';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "today", "yesterday", "3 days ago", else "12 Nov" (with the year when not this year). */
export function requestedWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return at.toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** The full date and time, for a tooltip. */
export const requestedAt = (iso: string) =>
  new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The menu badge's words for "need a decision": "2 waiting for approval, 1 asking for HR & Payroll". */
export function attentionLabel(waiting: number, hrRequests: number): string {
  const parts = [];
  if (waiting) parts.push(`${waiting} waiting for approval`);
  if (hrRequests) parts.push(`${hrRequests} asking for HR & Payroll`);
  return parts.join(', ');
}
