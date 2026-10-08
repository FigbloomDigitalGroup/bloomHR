// Upcoming birthdays, company events and public holidays, for the staff portal's "Celebrations & events" card.
// Dates are compared as calendar days in the viewer's time zone (a "YYYY-MM-DD" string is read as that day, not
// as midnight UTC, which would be the day before west of Greenwich).

export interface UpcomingItem {
  kind: 'birthday' | 'event' | 'holiday';
  title: string;
  /** the day it falls on (this year's birthday, the event's date, the holiday's next date) */
  date: Date;
  /** 0 = today */
  daysAway: number;
  detail?: string | null;
  /** birthdays: the person's work email (to send them a wish) */
  email?: string | null;
}

const DAY = 24 * 60 * 60 * 1000;

/** "2026-10-08", "2026-10-08T00:00:00Z" or anything Date understands, as a local calendar day; null if unreadable. */
export function toDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);

/** The next time this month/day comes round, today included (29 February is the 28th in other years). */
export function nextAnniversary(month: number, day: number, today: Date): Date {
  const on = (year: number) => {
    const isLeap = new Date(year, 1, 29).getMonth() === 1;
    return new Date(year, month, month === 1 && day === 29 && !isLeap ? 28 : day);
  };
  const thisYear = on(today.getFullYear());
  return thisYear >= startOfDay(today) ? thisYear : on(today.getFullYear() + 1);
}

export function upcomingBirthdays(
  people: { name: string; dateOfBirth: string | null | undefined; email?: string | null }[],
  today: Date,
  withinDays: number
): UpcomingItem[] {
  const items: UpcomingItem[] = [];
  for (const p of people) {
    const born = toDay(p.dateOfBirth);
    if (!born || !p.name.trim()) continue;
    const date = nextAnniversary(born.getMonth(), born.getDate(), today);
    const daysAway = daysBetween(today, date);
    if (daysAway <= withinDays) items.push({ kind: 'birthday', title: p.name.trim(), date, daysAway, email: p.email });
  }
  return items.sort((a, b) => a.daysAway - b.daysAway || a.title.localeCompare(b.title));
}

export function upcomingEventsAndHolidays(
  events: { title: string; date: string; description?: string | null }[],
  holidays: { name: string; date: string; recurring?: boolean | null }[],
  today: Date,
  withinDays: number
): UpcomingItem[] {
  const items: UpcomingItem[] = [];
  for (const e of events) {
    const date = toDay(e.date);
    if (!date) continue;
    items.push({ kind: 'event', title: e.title, date, daysAway: daysBetween(today, date), detail: e.description });
  }
  for (const h of holidays) {
    const day = toDay(h.date);
    if (!day) continue;
    const date = h.recurring ? nextAnniversary(day.getMonth(), day.getDate(), today) : day;
    items.push({ kind: 'holiday', title: h.name, date, daysAway: daysBetween(today, date) });
  }
  return items
    .filter((i) => i.daysAway >= 0 && i.daysAway <= withinDays)
    .sort((a, b) => a.daysAway - b.daysAway || a.title.localeCompare(b.title));
}

/** "Today", "Tomorrow", "Sat, 11 Oct" */
export function whenLabel(item: UpcomingItem): string {
  if (item.daysAway === 0) return 'Today';
  if (item.daysAway === 1) return 'Tomorrow';
  return item.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
