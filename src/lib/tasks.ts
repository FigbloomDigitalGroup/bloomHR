// Tasks like Linear (FIG-886, migration 20261019200000): the shapes the screens use and the pure helpers behind the
// board and list (sorting, grouping, filters, keys, drag-and-drop positions, @mentions). No network here: see
// tasksApi.ts.

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export const STATUSES: { value: TaskStatus; label: string; dot: string }[] = [
  { value: 'backlog', label: 'Backlog', dot: 'bg-gray-300' },
  { value: 'todo', label: 'To do', dot: 'bg-gray-500' },
  { value: 'in_progress', label: 'In progress', dot: 'bg-amber-500' },
  { value: 'in_review', label: 'In review', dot: 'bg-status-purple' },
  { value: 'done', label: 'Done', dot: 'bg-status-success' },
  { value: 'cancelled', label: 'Cancelled', dot: 'bg-status-danger' },
];

export const PRIORITIES: { value: TaskPriority; label: string; rank: number; tone: string }[] = [
  { value: 'urgent', label: 'Urgent', rank: 0, tone: 'text-status-danger' },
  { value: 'high', label: 'High', rank: 1, tone: 'text-orange-text-alt' },
  { value: 'medium', label: 'Medium', rank: 2, tone: 'text-amber-600' },
  { value: 'low', label: 'Low', rank: 3, tone: 'text-status-info' },
  { value: 'none', label: 'No priority', rank: 4, tone: 'text-muted-foreground' },
];

export const LABEL_COLORS: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700',
  red: 'bg-red-100 text-red-700',
  orange: 'bg-orange-100 text-orange-700',
  amber: 'bg-amber-100 text-amber-800',
  green: 'bg-green-100 text-green-700',
  teal: 'bg-teal-100 text-teal-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  pink: 'bg-pink-100 text-pink-700',
};

export const statusLabel = (s: string) => STATUSES.find((x) => x.value === s)?.label ?? s;
export const priorityLabel = (p: string) => PRIORITIES.find((x) => x.value === p)?.label ?? p;
export const priorityRank = (p: string) => PRIORITIES.find((x) => x.value === p)?.rank ?? 9;
export const isClosed = (s: TaskStatus) => s === 'done' || s === 'cancelled';

export interface TaskProject {
  id: string;
  key: string;
  name: string;
  description: string | null;
  department_id: string | null;
  lead_number: string | null;
  archived: boolean;
  created_by: string | null;
}

export interface TaskLabel {
  id: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  project_id: string;
  number: number;
  key: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_number: string | null;
  created_by: string | null;
  creator_number: string | null;
  due_date: string | null;
  parent_id: string | null;
  is_group: boolean;
  sort_order: number;
  completed_at: string | null;
  template_id: string | null;
  created_at: string;
  updated_at: string;
  /** label ids (from task_label_links) */
  labels: string[];
}

export interface TaskComment {
  id: string;
  task_id: string;
  body: string;
  mentions: string[];
  author_id: string | null;
  author_number: string | null;
  author_name: string | null;
  created_at: string;
  edited_at: string | null;
}

export interface TaskActivity {
  id: number;
  task_id: string;
  actor_id: string | null;
  actor_name: string | null;
  field: string;
  before_value: string | null;
  after_value: string | null;
  created_at: string;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  path: string;
  file_name: string;
  size_bytes: number | null;
  content_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface TaskTemplate {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  schedule: 'daily' | 'weekly' | 'monthly';
  weekday: number;
  month_day: number;
  due_in_days: number;
  target_kind: 'department' | 'job_title' | 'people';
  department_id: string | null;
  job_title: string | null;
  people: string[];
  active: boolean;
  last_period: string | null;
}

/** Who is looking: their login, their employee number (if any), whether they manage projects and whether they oversee them. */
export interface TaskViewer {
  userId: string;
  employeeNumber: string | null;
  /** holds "Manage projects" (task-projects): projects, members, labels, recurring tasks, tasks for a department */
  manages: boolean;
  /** ADMIN or HR: reads every task in the company for oversight; changing one still needs canEditTask */
  oversees?: boolean;
}

// ---------------------------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------------------------

/** "OPS-12" */
export const formatTaskKey = (projectKey: string, n: number) => `${projectKey.toUpperCase()}-${n}`;

/** A project key from its name: the initials of up to three words, or the first three letters ("Operations" -> "OPE"). */
export function suggestProjectKey(name: string, taken: string[] = []): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  let base = words.length >= 2 ? words.slice(0, 3).map((w) => w[0]).join('') : (words[0] || 'TSK').slice(0, 3);
  if (!/^[A-Z]/.test(base)) base = `T${base}`;
  if (base.length < 2) base = `${base}X`;
  base = base.slice(0, 6);
  const used = new Set(taken.map((k) => k.toUpperCase()));
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base.slice(0, 6 - String(i).length)}${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}

export const validProjectKey = (key: string) => /^[A-Z][A-Z0-9]{1,5}$/.test(key);

// ---------------------------------------------------------------------------------------------
// sorting and grouping
// ---------------------------------------------------------------------------------------------

export type TaskSort = 'manual' | 'priority' | 'due' | 'created' | 'updated';

const byManual = (a: Task, b: Task) => a.sort_order - b.sort_order || a.number - b.number;
const byDue = (a: Task, b: Task) => {
  if (a.due_date === b.due_date) return byManual(a, b);
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date < b.due_date ? -1 : 1;
};

export function sortTasks(tasks: Task[], sort: TaskSort = 'manual'): Task[] {
  const list = [...tasks];
  switch (sort) {
    case 'priority':
      return list.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || byManual(a, b));
    case 'due':
      return list.sort(byDue);
    case 'created':
      return list.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    case 'updated':
      return list.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
    default:
      return list.sort(byManual);
  }
}

/** Tasks in each status column, sorted. Every status is present (an empty list when none). */
export function groupByStatus(tasks: Task[], sort: TaskSort = 'manual'): Record<TaskStatus, Task[]> {
  const out = Object.fromEntries(STATUSES.map((s) => [s.value, [] as Task[]])) as Record<TaskStatus, Task[]>;
  for (const t of tasks) (out[t.status] ?? out.todo).push(t);
  for (const s of STATUSES) out[s.value] = sortTasks(out[s.value], sort);
  return out;
}

/**
 * The sort order for a task dropped between two others (either may be missing: the top or bottom of a column, or
 * an empty column).
 */
export function sortOrderBetween(before: number | null | undefined, after: number | null | undefined): number {
  const hasBefore = typeof before === 'number' && Number.isFinite(before);
  const hasAfter = typeof after === 'number' && Number.isFinite(after);
  if (hasBefore && hasAfter) return (before + after) / 2;
  if (hasBefore) return before + 1024;
  if (hasAfter) return after - 1024;
  return Date.now() / 1000;
}

/**
 * Where a dragged task lands: the new status and sort order when dropped in `status`'s column before the task
 * `beforeId` (or at the end when null). The column's tasks are given sorted, and may include the dragged one.
 */
export function dropPosition(column: Task[], draggedId: string, beforeId: string | null): number {
  const rest = column.filter((t) => t.id !== draggedId);
  const at = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1;
  if (at < 0) return sortOrderBetween(rest[rest.length - 1]?.sort_order, null);
  return sortOrderBetween(rest[at - 1]?.sort_order, rest[at].sort_order);
}

/** A group task's progress from its sub-tasks: done of all that are not cancelled. */
export function subtaskProgress(parentId: string, tasks: Task[]): { done: number; total: number } {
  const kids = tasks.filter((t) => t.parent_id === parentId && t.status !== 'cancelled');
  return { done: kids.filter((t) => t.status === 'done').length, total: kids.length };
}

// ---------------------------------------------------------------------------------------------
// filters
// ---------------------------------------------------------------------------------------------

export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'none';

export interface TaskFilters {
  search: string;
  assignee: string; // '' any, 'none' unassigned, or an employee number
  priority: TaskPriority | '';
  label: string; // '' any, or a label id
  due: DueFilter;
  project: string; // '' any, or a project id
  showClosed: boolean;
}

export const EMPTY_FILTERS: TaskFilters = {
  search: '', assignee: '', priority: '', label: '', due: 'any', project: '', showClosed: true,
};

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function isOverdue(t: Pick<Task, 'due_date' | 'status'>, today: Date = new Date()): boolean {
  return !!t.due_date && !isClosed(t.status) && t.due_date < isoDay(today);
}

export function matchesDue(t: Pick<Task, 'due_date' | 'status'>, due: DueFilter, today: Date = new Date()): boolean {
  const day = isoDay(today);
  switch (due) {
    case 'overdue':
      return isOverdue(t, today);
    case 'today':
      return t.due_date === day;
    case 'week': {
      const end = new Date(today);
      end.setDate(end.getDate() + 7);
      return !!t.due_date && t.due_date >= day && t.due_date <= isoDay(end);
    }
    case 'none':
      return !t.due_date;
    default:
      return true;
  }
}

export function filterTasks(tasks: Task[], f: TaskFilters, nameOf: (n: string | null) => string = () => '', today = new Date()): Task[] {
  const q = f.search.trim().toLowerCase();
  return tasks.filter((t) => {
    if (f.project && t.project_id !== f.project) return false;
    if (f.assignee === 'none' ? !!t.assignee_number : f.assignee && t.assignee_number !== f.assignee) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.label && !t.labels.includes(f.label)) return false;
    if (!matchesDue(t, f.due, today)) return false;
    if (!f.showClosed && isClosed(t.status)) return false;
    if (q) {
      const hay = `${t.key} ${t.title} ${t.description ?? ''} ${nameOf(t.assignee_number)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export const activeFilterCount = (f: TaskFilters) =>
  [f.search.trim(), f.assignee, f.priority, f.label, f.due !== 'any' ? f.due : '', f.project, f.showClosed ? '' : 'x'].filter(Boolean).length;

// ---------------------------------------------------------------------------------------------
// who may do what (the database decides; this only hides buttons that would fail)
// ---------------------------------------------------------------------------------------------

// no role-wide power: running tasks (viewer.manages) is about projects, labels and templates, not other people's tasks,
// and oversight (viewer.oversees) is read-only
export function canEditTask(t: Task, viewer: TaskViewer, project?: TaskProject | null): boolean {
  if (t.created_by && t.created_by === viewer.userId) return true;
  if (viewer.employeeNumber && t.assignee_number === viewer.employeeNumber) return true;
  if (project && (project.created_by === viewer.userId || (!!viewer.employeeNumber && project.lead_number === viewer.employeeNumber))) return true;
  return false;
}

export function canDeleteTask(t: Task, viewer: TaskViewer, project?: TaskProject | null): boolean {
  if (t.created_by && t.created_by === viewer.userId) return true;
  return !!project && (project.created_by === viewer.userId || (!!viewer.employeeNumber && project.lead_number === viewer.employeeNumber));
}

// ---------------------------------------------------------------------------------------------
// @mentions
// ---------------------------------------------------------------------------------------------

/** The word being typed after an "@" at the caret, or null ("Please @am" -> "am"). */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
  if (!m) return null;
  return { query: m[2], start: caret - m[2].length - 1 };
}

/** Replaces the "@query" at `start` with "@Full Name " and returns the new text and caret. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const insert = `@${name} `;
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}

/** The people picked while typing whose "@Name" is still in the text (one may have been deleted again). */
export function mentionsInText(text: string, picked: { number: string; name: string }[]): string[] {
  return [...new Set(picked.filter((p) => text.includes(`@${p.name}`)).map((p) => p.number))];
}

// ---------------------------------------------------------------------------------------------
// activity
// ---------------------------------------------------------------------------------------------

export function describeActivity(a: TaskActivity, nameOf: (n: string | null) => string): string {
  const who = a.actor_name || 'Someone';
  switch (a.field) {
    case 'created':
      return `${who} created the task`;
    case 'title':
      return `${who} renamed it to "${a.after_value ?? ''}"`;
    case 'description':
      return `${who} changed the description`;
    case 'status':
      return `${who} changed status from ${statusLabel(a.before_value ?? '')} to ${statusLabel(a.after_value ?? '')}`;
    case 'priority':
      return `${who} set priority to ${priorityLabel(a.after_value ?? 'none')}`;
    case 'assignee':
      return a.after_value ? `${who} assigned it to ${nameOf(a.after_value)}` : `${who} removed the assignee`;
    case 'due_date':
      return a.after_value ? `${who} set the due date to ${a.after_value}` : `${who} removed the due date`;
    case 'project':
      return `${who} moved it from ${a.before_value ?? ''} to ${a.after_value ?? ''}`;
    case 'parent':
      return a.after_value ? `${who} made it a sub-task of ${a.after_value}` : `${who} made it a top-level task`;
    case 'labels':
      return a.after_value ? `${who} added label ${a.after_value}` : `${who} removed label ${a.before_value ?? ''}`;
    case 'attachment':
      return a.after_value ? `${who} attached ${a.after_value}` : `${who} removed ${a.before_value ?? 'a file'}`;
    default:
      return `${who} changed ${a.field}`;
  }
}

export const SCHEDULE_LABELS: Record<TaskTemplate['schedule'], string> = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' };
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function describeSchedule(t: Pick<TaskTemplate, 'schedule' | 'weekday' | 'month_day'>): string {
  if (t.schedule === 'weekly') return `Every ${WEEKDAYS[(t.weekday || 1) - 1]}`;
  if (t.schedule === 'monthly') return t.month_day >= 28 ? `Monthly, day ${t.month_day} (or the last day)` : `Monthly, day ${t.month_day}`;
  return 'Every day';
}

export const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export function formatDue(due: string | null): string {
  if (!due) return '';
  const d = new Date(`${due}T00:00:00`);
  return Number.isNaN(d.getTime()) ? due : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
