import type { School } from './platformSchools';

// The console's charts, worked out in the browser from the lists it already has (no extra calls). Pure functions,
// so each count is tested on its own (consoleAnalytics.test.ts); the charts only draw what these return.

const DAY = 24 * 60 * 60 * 1000;

export interface Bar {
  /** what the bar is, in words (charts never rely on colour alone) */
  label: string;
  value: number;
  /** a stable key */
  key: string;
}

const time = (iso: string | null | undefined) => {
  if (!iso) return NaN;
  return new Date(iso).getTime();
};

/** Monday 00:00 (local time) of the week `at` falls in. */
export function weekStart(at: Date): Date {
  const d = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const offset = (d.getDay() + 6) % 7; // Monday 0 ... Sunday 6
  d.setDate(d.getDate() - offset);
  return d;
}

const weekLabel = (d: Date) => d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * How many dates fall in each of the last `weeks` weeks (Monday to Sunday), oldest first, the current week last,
 * weeks with none included. Dates outside the window, missing or unreadable are left out.
 */
export function newPerWeek(dates: (string | null | undefined)[], weeks = 12, now = new Date()): Bar[] {
  const n = Math.max(1, Math.floor(weeks));
  const current = weekStart(now);
  const starts = Array.from({ length: n }, (_, i) => {
    const d = new Date(current);
    d.setDate(d.getDate() - (n - 1 - i) * 7);
    return d;
  });
  const counts = new Array(n).fill(0);
  for (const iso of dates) {
    const t = time(iso);
    if (Number.isNaN(t)) continue;
    const start = weekStart(new Date(t)).getTime();
    const i = starts.findIndex((s) => s.getTime() === start);
    if (i >= 0) counts[i] += 1;
  }
  return starts.map((s, i) => ({ key: isoDay(s), label: `Week of ${weekLabel(s)}`, value: counts[i] }));
}

/** How many items have each value of `key`, the most common first (ties by label). `labels` names the values. */
export function countBy<T>(list: T[], key: (item: T) => string, labels: (value: string) => string = (v) => v): Bar[] {
  const counts = new Map<string, number>();
  for (const item of list) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ key: value, label: labels(value), value: count }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export type ActivityBucket = 'week' | 'month' | 'older' | 'never';

export const ACTIVITY_LABELS: Record<ActivityBucket, string> = {
  week: 'Signed in within 7 days',
  month: 'Within 30 days',
  older: 'More than 30 days ago',
  never: 'Never signed in',
};

/** The last sign-in of each item, bucketed: within 7 days, within 30, longer ago, never. Always all four, in order. */
export function activityBuckets(lastActive: (string | null | undefined)[], now = new Date()): Bar[] {
  const counts: Record<ActivityBucket, number> = { week: 0, month: 0, older: 0, never: 0 };
  for (const iso of lastActive) {
    const t = time(iso);
    if (Number.isNaN(t)) counts.never += 1;
    else if (now.getTime() - t <= 7 * DAY) counts.week += 1;
    else if (now.getTime() - t <= 30 * DAY) counts.month += 1;
    else counts.older += 1;
  }
  return (Object.keys(ACTIVITY_LABELS) as ActivityBucket[]).map((b) => ({ key: b, label: ACTIVITY_LABELS[b], value: counts[b] }));
}

/** Whether a date is within the last `days` days. */
export const activeWithin = (iso: string | null | undefined, days: number, now = new Date()) => {
  const t = time(iso);
  return !Number.isNaN(t) && now.getTime() - t <= days * DAY;
};

/** The `n` schools with the most students (ties by name), schools with none left out. */
export function topSchoolsByStudents(list: School[], n = 5): School[] {
  return list
    .filter((s) => Number(s.students) > 0)
    .sort((a, b) => Number(b.students) - Number(a.students) || a.name.localeCompare(b.name))
    .slice(0, n);
}

export type AttentionReason = 'no_admin' | 'never_active' | 'setup_stalled' | 'overdue';

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  no_admin: 'No admin',
  never_active: 'Nobody has ever signed in',
  setup_stalled: 'Setup stalled',
  overdue: 'Overdue',
};

/**
 * The schools that need someone to look at them, and why: no admin; nobody ever signed in; setup stalled or overdue
 * (Schools' own statuses setup_stalled and overdue). Suspended schools are left out. Most reasons first, then by name.
 */
export function schoolsNeedingAttention(list: School[]): { school: School; reasons: AttentionReason[] }[] {
  return list
    .filter((s) => s.status !== 'suspended')
    .map((school) => {
      const reasons: AttentionReason[] = [];
      if (!school.admin_email) reasons.push('no_admin');
      if (!school.last_activity_at) reasons.push('never_active');
      if (school.status === 'setup_stalled') reasons.push('setup_stalled');
      if (school.status === 'overdue') reasons.push('overdue');
      return { school, reasons };
    })
    .filter((x) => x.reasons.length > 0)
    .sort((a, b) => b.reasons.length - a.reasons.length || a.school.name.localeCompare(b.school.name));
}
