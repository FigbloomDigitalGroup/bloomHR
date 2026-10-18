// The staff portal home: "My tasks" (what is assigned to me and still needs doing, overdue first), "This week" (the
// next 7 days: today plus 6) and the quick links. Pure helpers, no network; the screen is StaffHome.tsx.

import { isHiddenModule } from './hiddenModules';
import { isClosed, priorityRank, type Task, type TaskStatus } from './tasks';
import type { StatusTone } from '../components/UI/StatusPill';
import { addDays, daysBetween, shortDay, startOfDay } from './upcoming';
import { toDay } from './celebrations';

/** "This week" is today and the 6 days after it. */
export const WEEK_DAYS = 6;

/** The items from today to `days` days ahead (both included); nothing in the past. */
export function withinDays<T extends { daysAway: number }>(items: T[], days: number): T[] {
  return items.filter((i) => i.daysAway >= 0 && i.daysAway <= days);
}

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';
const BUCKET_RANK: Record<DueBucket, number> = { overdue: 0, today: 1, week: 2, later: 3, none: 4 };

export function dueBucket(due: string | null | undefined, today: Date = new Date()): DueBucket {
  const day = toDay(due);
  if (!day) return 'none';
  const away = daysBetween(today, day);
  if (away < 0) return 'overdue';
  if (away === 0) return 'today';
  return away <= WEEK_DAYS ? 'week' : 'later';
}

/** "Overdue by 3 days", "Due today", "Due tomorrow", "Due Mon 20 Oct", "No due date" */
export function dueLabel(due: string | null | undefined, today: Date = new Date()): string {
  const day = toDay(due);
  if (!day) return 'No due date';
  const away = daysBetween(today, day);
  if (away < 0) return `Overdue by ${-away} day${away === -1 ? '' : 's'}`;
  if (away === 0) return 'Due today';
  if (away === 1) return 'Due tomorrow';
  return `Due ${shortDay(day)}`;
}

type MyTask = Pick<Task, 'id' | 'status' | 'due_date' | 'priority' | 'number' | 'assignee_number' | 'is_group'>;

/**
 * The tasks assigned to this employee that still need doing (not done, not cancelled, not a group task), overdue
 * first, then due today, this week, later and with no due date; soonest due, then highest priority, within each.
 */
export function orderMyTasks<T extends MyTask>(tasks: T[], employeeNumber: string | null | undefined, today: Date = new Date()): T[] {
  if (!employeeNumber) return [];
  return tasks
    .filter((t) => t.assignee_number === employeeNumber && !t.is_group && !isClosed(t.status))
    .map((t) => ({ t, bucket: dueBucket(t.due_date, today) }))
    .sort((a, b) =>
      BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] ||
      (a.t.due_date ?? '').localeCompare(b.t.due_date ?? '') ||
      priorityRank(a.t.priority) - priorityRank(b.t.priority) ||
      a.t.number - b.t.number
    )
    .map((x) => x.t);
}

/** How many open tasks, how many overdue and how many due this week (today included, overdue not). */
export function taskCounts(tasks: Pick<Task, 'due_date'>[], today: Date = new Date()) {
  let overdue = 0;
  let thisWeek = 0;
  for (const t of tasks) {
    const b = dueBucket(t.due_date, today);
    if (b === 'overdue') overdue += 1;
    if (b === 'today' || b === 'week') thisWeek += 1;
  }
  return { open: tasks.length, overdue, thisWeek };
}

/** "3 open · 1 overdue" */
export function countsLine(c: { open: number; overdue: number }): string {
  return c.overdue ? `${c.open} open · ${c.overdue} overdue` : `${c.open} open`;
}

export const STATUS_TONES: Record<TaskStatus, StatusTone> = {
  backlog: 'neutral',
  todo: 'info',
  in_progress: 'warning',
  in_review: 'purple',
  done: 'success',
  cancelled: 'danger',
};

/** The last day of "this week" (today plus 6). */
export const weekEnd = (today: Date = new Date()) => addDays(startOfDay(today), WEEK_DAYS);

export type QuickLinkIcon = 'leave' | 'payslips' | 'tasks' | 'calendar' | 'chat' | 'profile' | 'advance' | 'loans' | 'work';

export interface QuickLink {
  /** the staff portal section it opens (setActiveTab) */
  tab: string;
  label: string;
  icon: QuickLinkIcon;
  /** the module it belongs to: the link is left out while that module is switched off (hiddenModules.ts) */
  module?: string;
}

/**
 * The home's quick links. Salary advance and Loans belong to the salary-advance and loans modules (the ids the admin
 * sidebar uses), and are left out when the module is switched off.
 */
export const QUICK_LINKS: QuickLink[] = [
  { tab: 'leave', label: 'Apply for leave', icon: 'leave' },
  { tab: 'payslips', label: 'Payslips', icon: 'payslips' },
  { tab: 'tasks', label: 'My tasks', icon: 'tasks' },
  { tab: 'company-calendar', label: 'Calendar', icon: 'calendar' },
  { tab: 'chat', label: 'Chat', icon: 'chat' },
  { tab: 'details', label: 'Profile', icon: 'profile' },
  { tab: 'salary-advance', label: 'Salary advance', icon: 'advance', module: 'salaryadmin' },
  { tab: 'loan', label: 'Loans', icon: 'loans', module: 'loans' },
];

/** Shown first for someone paid by work or given contract jobs (FIG-812). */
export const MY_WORK_LINK: QuickLink = { tab: 'my-work', label: 'My work', icon: 'work' };

export function quickLinks(hidden: (moduleId?: string | null) => boolean = isHiddenModule): QuickLink[] {
  return QUICK_LINKS.filter((l) => !l.module || !hidden(l.module));
}
