import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_LABELS, activeWithin, activityBuckets, countBy, newPerWeek, schoolsNeedingAttention, topSchoolsByStudents, weekStart,
} from './consoleAnalytics';
import type { School } from './platformSchools';

// Wednesday 12 November 2026, midday local time
const NOW = new Date(2026, 10, 12, 12, 0, 0);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const school = (name: string, extra: Partial<School> = {}): School => ({
  id: name, name, slug: name, status: 'active', status_reason: null, organization: null, created_at: daysAgo(100),
  admin_email: `${name}@school.ac.ke`, students: 0, teachers: 0, parents: 0, last_activity_at: daysAgo(1), ...extra,
});

describe('weekStart', () => {
  it('is the Monday of the week, at midnight', () => {
    expect(weekStart(NOW)).toEqual(new Date(2026, 10, 9));
    expect(weekStart(new Date(2026, 10, 9, 0, 0))).toEqual(new Date(2026, 10, 9));
    expect(weekStart(new Date(2026, 10, 15, 23, 59))).toEqual(new Date(2026, 10, 9)); // Sunday
  });
});

describe('newPerWeek', () => {
  it('counts per week for the last 12 weeks, oldest first, empty weeks included', () => {
    const bars = newPerWeek([daysAgo(0), daysAgo(1), daysAgo(7), daysAgo(77), daysAgo(84), null, 'not a date'], 12, NOW);
    expect(bars).toHaveLength(12);
    expect(bars[11]).toMatchObject({ key: '2026-11-09', value: 2 });
    expect(bars[10]).toMatchObject({ key: '2026-11-02', value: 1 });
    expect(bars[0]).toMatchObject({ key: '2026-08-24', value: 1 }); // 77 days ago; 84 is the week before the window
    expect(bars.reduce((n, b) => n + b.value, 0)).toBe(4);
    expect(bars[11].label).toMatch(/^Week of 9 Nov/);
  });

  it('gives empty weeks with no dates', () => {
    expect(newPerWeek([], 4, NOW).map((b) => b.value)).toEqual([0, 0, 0, 0]);
  });
});

describe('countBy', () => {
  it('counts each value, the most common first, with labels', () => {
    const list = [{ s: 'active' }, { s: 'trial' }, { s: 'active' }, { s: 'overdue' }];
    expect(countBy(list, (x) => x.s, (v) => v.toUpperCase())).toEqual([
      { key: 'active', label: 'ACTIVE', value: 2 },
      { key: 'overdue', label: 'OVERDUE', value: 1 },
      { key: 'trial', label: 'TRIAL', value: 1 },
    ]);
    expect(countBy([], (x: { s: string }) => x.s)).toEqual([]);
  });
});

describe('activityBuckets', () => {
  it('buckets the last sign-in: 7 days, 30 days, older, never; always all four', () => {
    const bars = activityBuckets([daysAgo(0), daysAgo(7), daysAgo(8), daysAgo(30), daysAgo(31), null, undefined], NOW);
    expect(bars.map((b) => [b.key, b.value])).toEqual([['week', 2], ['month', 2], ['older', 1], ['never', 2]]);
    expect(bars.map((b) => b.label)).toEqual(Object.values(ACTIVITY_LABELS));
    expect(activityBuckets([], NOW).map((b) => b.value)).toEqual([0, 0, 0, 0]);
  });

  it('activeWithin', () => {
    expect(activeWithin(daysAgo(6), 7, NOW)).toBe(true);
    expect(activeWithin(daysAgo(8), 7, NOW)).toBe(false);
    expect(activeWithin(null, 7, NOW)).toBe(false);
  });
});

describe('topSchoolsByStudents', () => {
  it('the five with the most students, ties by name, none with no students', () => {
    const list = [
      school('A', { students: 10 }), school('B', { students: 50 }), school('C', { students: 50 }), school('D', { students: 0 }),
      school('E', { students: 3 }), school('F', { students: 7 }), school('G', { students: 1 }),
    ];
    expect(topSchoolsByStudents(list).map((s) => s.name)).toEqual(['B', 'C', 'A', 'F', 'E']);
    expect(topSchoolsByStudents([school('D')])).toEqual([]);
  });
});

describe('schoolsNeedingAttention', () => {
  it('no admin, never active, setup stalled, overdue; most reasons first; suspended left out', () => {
    const list = [
      school('Fine'),
      school('No admin', { admin_email: null }),
      school('Ghost', { admin_email: null, last_activity_at: null }),
      school('Stalled', { status: 'setup_stalled' }),
      school('Late', { status: 'overdue', last_activity_at: null }),
      school('Paused', { status: 'suspended', admin_email: null, last_activity_at: null }),
    ];
    expect(schoolsNeedingAttention(list).map((x) => [x.school.name, x.reasons])).toEqual([
      ['Ghost', ['no_admin', 'never_active']],
      ['Late', ['never_active', 'overdue']],
      ['No admin', ['no_admin']],
      ['Stalled', ['setup_stalled']],
    ]);
  });
});
