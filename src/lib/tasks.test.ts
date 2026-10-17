import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS, activeFilterCount, canDeleteTask, canEditTask, describeActivity, describeSchedule, dropPosition, filterTasks,
  formatTaskKey, groupByStatus, insertMention, isOverdue, matchesDue, mentionQuery, mentionsInText, sortOrderBetween, sortTasks,
  subtaskProgress, suggestProjectKey, validProjectKey, type Task, type TaskProject,
} from './tasks';

const task = (over: Partial<Task>): Task => ({
  id: over.id ?? 't', project_id: 'p1', number: 1, key: 'OPS-1', title: 'A task', description: null, status: 'todo', priority: 'none',
  assignee_number: null, created_by: 'u-creator', creator_number: null, due_date: null, parent_id: null, is_group: false, sort_order: 1,
  completed_at: null, template_id: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', labels: [], ...over,
});
const today = new Date(2026, 9, 17); // 17 Oct 2026

describe('keys', () => {
  it('formats a task key', () => {
    expect(formatTaskKey('ops', 12)).toBe('OPS-12');
  });
  it('suggests a project key from the name, avoiding ones in use', () => {
    expect(suggestProjectKey('Operations')).toBe('OPE');
    expect(suggestProjectKey('Human Resources Team')).toBe('HRT');
    expect(suggestProjectKey('Credit & Collections')).toBe('CC');
    expect(suggestProjectKey('Operations', ['OPE'])).toBe('OPE2');
    expect(suggestProjectKey('2026 plan')).toBe('T2P');
    expect(suggestProjectKey('')).toBe('TSK');
    expect(validProjectKey(suggestProjectKey('a'))).toBe(true);
  });
  it('validates keys the way the database does', () => {
    expect(validProjectKey('OPS')).toBe(true);
    expect(validProjectKey('O')).toBe(false);
    expect(validProjectKey('1OPS')).toBe(false);
    expect(validProjectKey('TOOLONG')).toBe(false);
    expect(validProjectKey('ops')).toBe(false);
  });
});

describe('sorting and grouping', () => {
  const list = [
    task({ id: 'a', sort_order: 3, priority: 'low', due_date: '2026-10-20', created_at: '2026-10-03' }),
    task({ id: 'b', sort_order: 1, priority: 'urgent', due_date: null, created_at: '2026-10-01' }),
    task({ id: 'c', sort_order: 2, priority: 'high', due_date: '2026-10-18', created_at: '2026-10-02', status: 'done' }),
  ];
  it('sorts by manual order, priority, due date and newest', () => {
    expect(sortTasks(list).map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(sortTasks(list, 'priority').map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(sortTasks(list, 'due').map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(sortTasks(list, 'created').map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });
  it('groups by status with every column present', () => {
    const g = groupByStatus(list);
    expect(Object.keys(g)).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']);
    expect(g.todo.map((t) => t.id)).toEqual(['b', 'a']);
    expect(g.done.map((t) => t.id)).toEqual(['c']);
    expect(g.backlog).toEqual([]);
  });
  it('places a dropped task between its neighbours', () => {
    expect(sortOrderBetween(1, 3)).toBe(2);
    expect(sortOrderBetween(5, null)).toBe(5 + 1024);
    expect(sortOrderBetween(null, 5)).toBe(5 - 1024);
    expect(sortOrderBetween(null, null)).toBeGreaterThan(0);
    const col = sortTasks([task({ id: 'x', sort_order: 10 }), task({ id: 'y', sort_order: 20 }), task({ id: 'z', sort_order: 30 })]);
    expect(dropPosition(col, 'z', 'y')).toBe(15); // z moves between x and y
    expect(dropPosition(col, 'x', null)).toBe(30 + 1024); // x to the end
    expect(dropPosition(col, 'new', 'x')).toBe(10 - 1024); // a card from another column to the top
    expect(dropPosition([], 'new', null)).toBeGreaterThan(0);
  });
  it('counts a group task’s sub-tasks done (cancelled ones do not count)', () => {
    const all = [task({ id: 'g', is_group: true }), task({ id: '1', parent_id: 'g', status: 'done' }), task({ id: '2', parent_id: 'g' }), task({ id: '3', parent_id: 'g', status: 'cancelled' })];
    expect(subtaskProgress('g', all)).toEqual({ done: 1, total: 2 });
  });
});

describe('filters', () => {
  const list = [
    task({ id: 'a', key: 'OPS-1', title: 'Count the safe', assignee_number: 'E1', priority: 'high', labels: ['L1'], due_date: '2026-10-10' }),
    task({ id: 'b', key: 'OPS-2', title: 'Call client', assignee_number: null, due_date: '2026-10-17' }),
    task({ id: 'c', key: 'FIN-1', title: 'Close books', project_id: 'p2', assignee_number: 'E2', status: 'done', due_date: '2026-10-01' }),
  ];
  const names = (n: string | null) => ({ E1: 'Amina Wanjiru', E2: 'Brian Otieno' })[n ?? ''] ?? '';
  const ids = (f: Partial<typeof EMPTY_FILTERS>) => filterTasks(list, { ...EMPTY_FILTERS, ...f }, names, today).map((t) => t.id);

  it('by search (key, title, assignee name), assignee, priority, label, project and closed', () => {
    expect(ids({})).toEqual(['a', 'b', 'c']);
    expect(ids({ search: 'ops-2' })).toEqual(['b']);
    expect(ids({ search: 'amina' })).toEqual(['a']);
    expect(ids({ assignee: 'E2' })).toEqual(['c']);
    expect(ids({ assignee: 'none' })).toEqual(['b']);
    expect(ids({ priority: 'high' })).toEqual(['a']);
    expect(ids({ label: 'L1' })).toEqual(['a']);
    expect(ids({ project: 'p2' })).toEqual(['c']);
    expect(ids({ showClosed: false })).toEqual(['a', 'b']);
  });
  it('by due date: overdue ignores done tasks', () => {
    expect(ids({ due: 'overdue' })).toEqual(['a']);
    expect(ids({ due: 'today' })).toEqual(['b']);
    expect(ids({ due: 'week' })).toEqual(['b']);
    expect(matchesDue(task({ due_date: null }), 'none', today)).toBe(true);
    expect(isOverdue(task({ due_date: '2026-10-16', status: 'cancelled' }), today)).toBe(false);
  });
  it('counts active filters', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, search: 'x', due: 'overdue', showClosed: false })).toBe(3);
  });
});

describe('who may edit (mirrors the database)', () => {
  const project: TaskProject = { id: 'p1', key: 'OPS', name: 'Ops', description: null, department_id: null, lead_number: 'LEAD', archived: false, created_by: 'u-hr' };
  const t = task({ assignee_number: 'E1', created_by: 'u-creator' });
  it('assignee, creator and lead; running tasks is not enough', () => {
    expect(canEditTask(t, { userId: 'u-x', employeeNumber: 'E1', manages: false }, project)).toBe(true);
    expect(canEditTask(t, { userId: 'u-creator', employeeNumber: null, manages: false }, project)).toBe(true);
    expect(canEditTask(t, { userId: 'u-x', employeeNumber: 'LEAD', manages: false }, project)).toBe(true);
    expect(canEditTask(t, { userId: 'u-x', employeeNumber: 'E9', manages: true }, project)).toBe(false);
    expect(canEditTask(t, { userId: 'u-x', employeeNumber: 'E9', manages: false }, project)).toBe(false);
  });
  it('the assignee cannot delete', () => {
    expect(canDeleteTask(t, { userId: 'u-x', employeeNumber: 'E1', manages: false }, project)).toBe(false);
    expect(canDeleteTask(t, { userId: 'u-creator', employeeNumber: null, manages: false }, project)).toBe(true);
    expect(canDeleteTask(t, { userId: 'u-x', employeeNumber: 'E9', manages: true }, project)).toBe(false);
  });
});

describe('@mentions', () => {
  it('finds the word being typed after @', () => {
    expect(mentionQuery('Please @am', 10)).toEqual({ query: 'am', start: 7 });
    expect(mentionQuery('@', 1)).toEqual({ query: '', start: 0 });
    expect(mentionQuery('email@example', 13)).toBeNull();
    expect(mentionQuery('Please @amina wanjiru', 21)).toBeNull();
  });
  it('inserts the name and keeps only mentions still in the text', () => {
    expect(insertMention('Please @am thanks', 7, 10, 'Amina Wanjiru')).toEqual({ text: 'Please @Amina Wanjiru  thanks', caret: 22 });
    const picked = [{ number: 'E1', name: 'Amina Wanjiru' }, { number: 'E2', name: 'Brian Otieno' }, { number: 'E1', name: 'Amina Wanjiru' }];
    expect(mentionsInText('Hi @Amina Wanjiru', picked)).toEqual(['E1']);
  });
});

describe('words', () => {
  it('describes activity and schedules', () => {
    const a = { id: 1, task_id: 't', actor_id: null, actor_name: 'Hana', created_at: '', field: 'status', before_value: 'todo', after_value: 'in_progress' };
    expect(describeActivity(a, () => '')).toBe('Hana changed status from To do to In progress');
    expect(describeActivity({ ...a, field: 'assignee', after_value: 'E1' }, () => 'Amina')).toBe('Hana assigned it to Amina');
    expect(describeActivity({ ...a, field: 'labels', before_value: 'Audit', after_value: null }, () => '')).toBe('Hana removed label Audit');
    expect(describeSchedule({ schedule: 'weekly', weekday: 5, month_day: 1 })).toBe('Every Friday');
    expect(describeSchedule({ schedule: 'monthly', weekday: 1, month_day: 31 })).toBe('Monthly, day 31 (or the last day)');
    expect(describeSchedule({ schedule: 'daily', weekday: 1, month_day: 1 })).toBe('Every day');
  });
});
