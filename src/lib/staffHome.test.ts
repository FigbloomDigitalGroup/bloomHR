import { describe, expect, it } from 'vitest';
import { countsLine, dueBucket, dueLabel, orderMyTasks, QUICK_LINKS, quickLinks, taskCounts, withinDays } from './staffHome';

const today = new Date(2026, 9, 18); // Sun 18 Oct 2026
const day = (offset: number) => {
  const d = new Date(2026, 9, 18 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const task = (id: string, due: string | null, extra: Record<string, unknown> = {}) => ({
  id, status: 'todo' as const, due_date: due, priority: 'none' as const, number: Number(id.replace(/\D/g, '')) || 0,
  assignee_number: 'E1', is_group: false, ...extra,
});

describe('withinDays', () => {
  it('keeps today up to N days ahead and drops the past and beyond', () => {
    const items = [-1, 0, 6, 7, 8].map((daysAway) => ({ daysAway }));
    expect(withinDays(items, 6).map((i) => i.daysAway)).toEqual([0, 6]);
  });
});

describe('dueBucket and dueLabel', () => {
  it('sorts a due date into overdue, today, this week, later or none', () => {
    expect(dueBucket(day(-2), today)).toBe('overdue');
    expect(dueBucket(day(0), today)).toBe('today');
    expect(dueBucket(day(6), today)).toBe('week');
    expect(dueBucket(day(7), today)).toBe('later');
    expect(dueBucket(null, today)).toBe('none');
  });

  it('says how overdue or when due, in words', () => {
    expect(dueLabel(day(-1), today)).toBe('Overdue by 1 day');
    expect(dueLabel(day(-3), today)).toBe('Overdue by 3 days');
    expect(dueLabel(day(0), today)).toBe('Due today');
    expect(dueLabel(day(1), today)).toBe('Due tomorrow');
    expect(dueLabel(day(2), today)).toBe('Due Tue 20 Oct');
    expect(dueLabel(null, today)).toBe('No due date');
  });
});

describe('orderMyTasks', () => {
  it('lists my open tasks overdue first, then today, this week, later and no due date', () => {
    const tasks = [
      task('t1', null),
      task('t2', day(20)),
      task('t3', day(3)),
      task('t4', day(0)),
      task('t5', day(-5)),
      task('t6', day(-1)),
    ];
    expect(orderMyTasks(tasks, 'E1', today).map((t) => t.id)).toEqual(['t5', 't6', 't4', 't3', 't2', 't1']);
  });

  it("leaves out done, cancelled, group and other people's tasks", () => {
    const tasks = [
      task('t1', day(1)),
      task('t2', day(1), { status: 'done' }),
      task('t3', day(1), { status: 'cancelled' }),
      task('t4', day(1), { is_group: true }),
      task('t5', day(1), { assignee_number: 'E2' }),
    ];
    expect(orderMyTasks(tasks, 'E1', today).map((t) => t.id)).toEqual(['t1']);
    expect(orderMyTasks(tasks, null, today)).toEqual([]);
  });

  it('puts the higher priority first on the same day', () => {
    const tasks = [task('t1', day(2), { priority: 'low' }), task('t2', day(2), { priority: 'urgent' })];
    expect(orderMyTasks(tasks, 'E1', today).map((t) => t.id)).toEqual(['t2', 't1']);
  });
});

describe('taskCounts', () => {
  it('counts open, overdue and due this week', () => {
    const c = taskCounts([task('a', day(-1)), task('b', day(0)), task('c', day(6)), task('d', day(9)), task('e', null)], today);
    expect(c).toEqual({ open: 5, overdue: 1, thisWeek: 2 });
    expect(countsLine(c)).toBe('5 open · 1 overdue');
    expect(countsLine({ open: 2, overdue: 0 })).toBe('2 open');
  });
});

describe('quickLinks', () => {
  it('shows every link when no module is switched off', () => {
    expect(quickLinks(() => false)).toEqual(QUICK_LINKS);
  });

  it('leaves out Salary advance and Loans while their modules are switched off', () => {
    const tabs = quickLinks((m) => m === 'salaryadmin' || m === 'loans').map((l) => l.tab);
    expect(tabs).not.toContain('salary-advance');
    expect(tabs).not.toContain('loan');
    expect(tabs).toEqual(['leave', 'payslips', 'tasks', 'company-calendar', 'chat', 'details']);
  });
});
