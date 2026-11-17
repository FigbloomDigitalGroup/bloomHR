// How a leave application's dates read on the staff portal's "My Leave Applications" cards.

const parse = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

// built from the parts so it reads "Mon 26 Oct 2026" (en-GB puts a comma after the weekday)
const day = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', opts)
    .formatToParts(d)
    .filter((p) => p.type !== 'literal')
    .map((p) => p.value)
    .join(' ');

/**
 * "Mon 26 Oct 2026" for one day; "Mon 26 – Fri 30 Oct 2026" within a month; "Wed 28 Oct – Tue 3 Nov 2026" across months;
 * "Wed 30 Dec 2026 – Fri 1 Jan 2027" across years. Unreadable dates fall back to whatever was given.
 */
export function leaveDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = parse(start);
  const e = parse(end) ?? s;
  if (!s || !e) return [start, end].filter(Boolean).join(' – ');
  const full: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
  if (s.toDateString() === e.toDateString()) return day(s, full);
  if (s.getFullYear() !== e.getFullYear()) return `${day(s, full)} – ${day(e, full)}`;
  if (s.getMonth() !== e.getMonth()) {
    return `${day(s, { weekday: 'short', day: 'numeric', month: 'short' })} – ${day(e, full)}`;
  }
  return `${day(s, { weekday: 'short', day: 'numeric' })} – ${day(e, full)}`;
}

/** "1 day", "2.5 days" */
export const leaveDaysLabel = (days: number | string | null | undefined) => {
  if (days === null || days === undefined || days === '') return '';
  const n = Number(days);
  if (!Number.isFinite(n)) return '';
  return `${n} day${n === 1 ? '' : 's'}`;
};

/** "23 Oct" this year, "23 Oct 2025" otherwise */
export function shortSubmitted(d: Date, now: Date = new Date()): string {
  if (Number.isNaN(d.getTime())) return '';
  return d.getFullYear() === now.getFullYear()
    ? day(d, { day: 'numeric', month: 'short' })
    : day(d, { day: 'numeric', month: 'short', year: 'numeric' });
}
