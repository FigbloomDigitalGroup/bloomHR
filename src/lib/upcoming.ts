// What is coming up for one employee: company events, public holidays, their own leave and the tasks due to them.
// Used by the calendar's "Coming up" list and by the leave form's planning hints. No network here (see
// upcomingApi.ts). Every date is a calendar day in the viewer's time zone: "2026-10-20" is read as 20 October, never
// as midnight UTC (which would be the 19th west of Greenwich).

import { toDay } from './celebrations';

export type UpcomingKind = 'event' | 'holiday' | 'birthday' | 'leave' | 'task';

export interface EventRow {
  id?: string;
  title: string;
  date: string;
  description?: string | null;
}

export interface HolidayRow {
  name: string;
  date: string;
  recurring?: boolean | null;
}

export interface LeaveRow {
  type: string;
  start: string | null;
  end: string | null;
  status: string | null;
}

export interface TaskRow {
  id: string;
  key?: string | null;
  title: string;
  description?: string | null;
  status: string;
  due_date: string | null;
  assignee_number?: string | null;
  is_group?: boolean | null;
}

export interface CalendarEntry {
  kind: UpcomingKind;
  /** unique within a list */
  key: string;
  title: string;
  /** the day it falls on (a leave: the first day; a task: the day it is due) */
  date: Date;
  /** a leave: its last day */
  endDate?: Date;
  /** days from today to `date` (negative = in the past) */
  daysAway: number;
  detail?: string | null;
  /** tasks: its id, to open it */
  taskId?: string;
  /** tasks: its key ("OPS-12") */
  taskKey?: string | null;
  /** tasks due before today */
  overdue?: boolean;
  /** leave: still waiting for a decision */
  pending?: boolean;
}

const DAY = 24 * 60 * 60 * 1000;
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const daysBetween = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
/** "yyyy-MM-dd" of a local day */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Mon 20 Oct" */
export const shortDay = (d: Date) => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

/** "Today", "Tomorrow", "in 12 days", "Yesterday", "3 days ago" */
export function inDaysLabel(daysAway: number): string {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  if (daysAway === -1) return 'Yesterday';
  return daysAway > 0 ? `in ${daysAway} days` : `${-daysAway} days ago`;
}

/** This month/day in a given year (29 February is the 28th in other years). */
const onYear = (year: number, month: number, day: number) => {
  const isLeap = new Date(year, 1, 29).getMonth() === 1;
  return new Date(year, month, month === 1 && day === 29 && !isLeap ? 28 : day);
};

/**
 * Every day a holiday falls on between `from` and `to` (both included): a recurring holiday once a year by its month
 * and day, across the year end; a one-off holiday on its exact date only.
 */
export function holidayDates(holidays: HolidayRow[], from: Date, to: Date): { name: string; date: Date }[] {
  const start = startOfDay(from);
  const end = startOfDay(to);
  const out: { name: string; date: Date }[] = [];
  for (const h of holidays) {
    const day = toDay(h.date);
    if (!day || !h.name) continue;
    if (h.recurring) {
      for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
        const d = onYear(y, day.getMonth(), day.getDate());
        if (d >= start && d <= end) out.push({ name: h.name, date: d });
      }
    } else if (day >= start && day <= end) {
      out.push({ name: h.name, date: day });
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime() || a.name.localeCompare(b.name));
}

/** The company events between `from` and `to` (both included). */
export function eventsBetween(events: EventRow[], from: Date, to: Date): (EventRow & { day: Date })[] {
  const start = startOfDay(from);
  const end = startOfDay(to);
  return events
    .map((e) => ({ ...e, day: toDay(e.date) }))
    .filter((e): e is EventRow & { day: Date } => !!e.day && e.day >= start && e.day <= end)
    .sort((a, b) => a.day.getTime() - b.day.getTime() || a.title.localeCompare(b.title));
}

/** Tasks assigned to this employee that still need doing and have a due date (not done, not cancelled, not a group). */
export function myOpenTasks(tasks: TaskRow[], employeeNumber: string | null | undefined): (TaskRow & { due: Date })[] {
  return tasks
    .filter((t) => !employeeNumber || t.assignee_number === employeeNumber)
    .filter((t) => !t.is_group && t.status !== 'done' && t.status !== 'cancelled')
    .map((t) => ({ ...t, due: toDay(t.due_date) }))
    .filter((t): t is TaskRow & { due: Date } => !!t.due)
    .sort((a, b) => a.due.getTime() - b.due.getTime() || a.title.localeCompare(b.title));
}

/** The employee's approved and pending leave, as days. */
export function myLeaveRanges(leave: LeaveRow[]): { type: string; start: Date; end: Date; pending: boolean }[] {
  const out: { type: string; start: Date; end: Date; pending: boolean }[] = [];
  for (const l of leave) {
    const status = (l.status || '').trim().toLowerCase();
    if (status !== 'approved' && status !== 'pending') continue;
    const start = toDay(l.start);
    const end = toDay(l.end) || start;
    if (!start || !end || end < start) continue;
    out.push({ type: (l.type || 'Leave').trim() || 'Leave', start, end, pending: status === 'pending' });
  }
  return out;
}

export interface ComingUpInput {
  events?: EventRow[];
  holidays?: HolidayRow[];
  leave?: LeaveRow[];
  tasks?: TaskRow[];
  /** whose tasks (others are left out); empty = every task given */
  employeeNumber?: string | null;
}

const KIND_ORDER: Record<UpcomingKind, number> = { holiday: 0, event: 1, leave: 2, task: 3, birthday: 4 };

/**
 * Everything from today to `withinDays` days ahead, soonest first, with overdue tasks at the very top. A leave already
 * under way is listed (as from today) until its last day.
 */
export function comingUp(input: ComingUpInput, today: Date, withinDays: number): CalendarEntry[] {
  const from = startOfDay(today);
  const to = addDays(from, withinDays);
  const items: CalendarEntry[] = [];

  for (const e of eventsBetween(input.events ?? [], from, to)) {
    items.push({ kind: 'event', key: `e-${e.id ?? e.title}-${dayKey(e.day)}`, title: e.title, date: e.day, daysAway: daysBetween(from, e.day), detail: e.description || null });
  }
  for (const h of holidayDates(input.holidays ?? [], from, to)) {
    items.push({ kind: 'holiday', key: `h-${h.name}-${dayKey(h.date)}`, title: h.name, date: h.date, daysAway: daysBetween(from, h.date) });
  }
  for (const l of myLeaveRanges(input.leave ?? [])) {
    if (l.end < from || l.start > to) continue;
    items.push({
      kind: 'leave',
      key: `l-${l.type}-${dayKey(l.start)}`,
      title: `My ${l.type}${l.pending ? ' (pending)' : ''}`,
      date: l.start,
      endDate: l.end,
      daysAway: daysBetween(from, l.start),
      pending: l.pending,
    });
  }
  for (const t of myOpenTasks(input.tasks ?? [], input.employeeNumber)) {
    if (t.due > to) continue;
    items.push({
      kind: 'task',
      key: `t-${t.id}`,
      title: t.title,
      date: t.due,
      daysAway: daysBetween(from, t.due),
      detail: t.description || null,
      taskId: t.id,
      taskKey: t.key ?? null,
      overdue: t.due < from,
    });
  }

  // a leave already started sorts as today
  const sortDay = (i: CalendarEntry) => (i.kind === 'leave' ? Math.max(0, i.daysAway) : i.daysAway);
  return items.sort((a, b) => {
    if (!!a.overdue !== !!b.overdue) return a.overdue ? -1 : 1;
    return sortDay(a) - sortDay(b) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title);
  });
}

export type Relation = 'during' | 'before' | 'after';

export interface LeaveHint {
  kind: 'holiday' | 'event';
  title: string;
  date: Date;
  relation: Relation;
  detail?: string | null;
  /** the hint in words */
  text: string;
}

/**
 * The holidays and company events that fall in a leave, or on the day just before it starts or just after it ends,
 * in words. Only to inform: nothing here stops an application.
 */
export function leaveHints(
  start: string | null | undefined,
  end: string | null | undefined,
  events: EventRow[],
  holidays: HolidayRow[]
): LeaveHint[] {
  const s = toDay(start);
  const e = toDay(end) || s;
  if (!s || !e || e < s) return [];
  const before = addDays(s, -1);
  const after = addDays(e, 1);
  const relation = (d: Date): Relation => (d < s ? 'before' : d > e ? 'after' : 'during');
  const hints: LeaveHint[] = [];
  for (const h of holidayDates(holidays, before, after)) {
    const r = relation(h.date);
    const text =
      r === 'during'
        ? `${h.name} (${shortDay(h.date)}) is a public holiday, not counted`
        : `${h.name} (${shortDay(h.date)}) is a public holiday the day ${r === 'before' ? 'before your leave starts' : 'after your leave ends'}`;
    hints.push({ kind: 'holiday', title: h.name, date: h.date, relation: r, text });
  }
  for (const ev of eventsBetween(events, before, after)) {
    const r = relation(ev.day);
    const text =
      r === 'during'
        ? `${ev.title} on ${shortDay(ev.day)} during your leave`
        : `${ev.title} on ${shortDay(ev.day)}, the day ${r === 'before' ? 'before your leave starts' : 'after your leave ends'}`;
    hints.push({ kind: 'event', title: ev.title, date: ev.day, relation: r, detail: ev.description || null, text });
  }
  return hints.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.kind === b.kind ? 0 : a.kind === 'holiday' ? -1 : 1));
}

/** The employee's open tasks due on a day of the leave (first to last day). */
export function tasksDuringLeave(
  start: string | null | undefined,
  end: string | null | undefined,
  tasks: TaskRow[],
  employeeNumber?: string | null
): (TaskRow & { due: Date })[] {
  const s = toDay(start);
  const e = toDay(end) || s;
  if (!s || !e || e < s) return [];
  return myOpenTasks(tasks, employeeNumber).filter((t) => t.due >= s && t.due <= e);
}

/** The next `count` public holidays from today (within a year). */
export function nextHolidays(holidays: HolidayRow[], today: Date, count: number): { name: string; date: Date; daysAway: number }[] {
  const from = startOfDay(today);
  return holidayDates(holidays, from, addDays(from, 366))
    .slice(0, count)
    .map((h) => ({ ...h, daysAway: daysBetween(from, h.date) }));
}
