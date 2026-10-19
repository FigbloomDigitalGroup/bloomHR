// The admin dashboard's "Company Updates": the company's next 7 days (today plus 6), built from the same helpers as
// the staff home's "This week" (upcoming.ts, celebrations.ts, staffHome.ts), so admin and staff always agree. Pure, no
// network; the screen is components/Dashboard/Dashboard.tsx.

import { comingUp, holidaysForCountry, withCountryTags, type EventRow, type HolidayRow } from './upcoming';
import type { UpcomingItem } from './celebrations';
import { WEEK_DAYS, withinDays } from './staffHome';

export interface AdminWeekItem {
  kind: 'holiday' | 'event' | 'birthday';
  key: string;
  title: string;
  date: Date;
  /** 0 = today */
  daysAway: number;
  detail?: string | null;
}

const KIND_ORDER: Record<AdminWeekItem['kind'], number> = { holiday: 0, event: 1, birthday: 2 };

/**
 * The holidays an admin sees: a company with branches in more than one country sees every country's, each tagged with
 * its country ("Karume Day (Tanzania)"); a one-country company sees its country's (and the company-wide ones); with no
 * branches known, all of them as they are.
 */
export function holidaysForCompany<T extends HolidayRow>(holidays: T[], branchCountries: string[]): T[] {
  const countries = Array.from(new Set(branchCountries.map((c) => (c || '').trim()).filter(Boolean).map((c) => c.toLowerCase())));
  if (countries.length > 1) return withCountryTags(holidays);
  if (countries.length === 1) return holidaysForCountry(holidays, countries[0]);
  return holidays;
}

/**
 * Public holidays, company events and birthdays (name only, as staff see them) from today to 6 days ahead, soonest
 * first; on the same day holidays, then events, then birthdays.
 */
export function adminWeekItems(
  input: { events: EventRow[]; holidays: HolidayRow[]; birthdays: UpcomingItem[] },
  today: Date = new Date()
): AdminWeekItem[] {
  const out: AdminWeekItem[] = [];
  for (const e of comingUp({ events: input.events, holidays: input.holidays }, today, WEEK_DAYS)) {
    if (e.kind !== 'event' && e.kind !== 'holiday') continue;
    out.push({ kind: e.kind, key: e.key, title: e.title, date: e.date, daysAway: e.daysAway, detail: e.detail });
  }
  for (const b of withinDays(input.birthdays, WEEK_DAYS)) {
    if (b.kind !== 'birthday') continue;
    out.push({ kind: 'birthday', key: `b-${b.title}-${b.date.getTime()}`, title: b.title, date: b.date, daysAway: b.daysAway });
  }
  return withinDays(out, WEEK_DAYS).sort(
    (a, b) => a.daysAway - b.daysAway || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title)
  );
}
