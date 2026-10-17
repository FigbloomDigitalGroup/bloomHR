import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Task, TaskLabel, TaskProject, TaskViewer } from '../../lib/tasks';

const api = vi.hoisted(() => ({
  loadComments: vi.fn(),
  loadActivity: vi.fn(),
  loadAttachments: vi.fn(),
  addComment: vi.fn(),
  deleteComment: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  setTaskLabels: vi.fn(),
  uploadAttachment: vi.fn(),
  removeAttachment: vi.fn(),
  attachmentUrl: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/tasksApi', () => api);
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: vi.fn().mockResolvedValue(true) }));
// the picker reads the company directory (react-query); a plain stand-in here
vi.mock('../UI/EmployeePicker', () => ({
  default: ({ label, value, disabled }: { label?: string; value: string | null; disabled?: boolean }) => (
    <div data-testid="employee-picker">{label}: {value ?? 'none'}{disabled ? ' (locked)' : ''}</div>
  ),
}));

import TaskBoard from './TaskBoard';
import TaskList from './TaskList';
import TaskDetail from './TaskDetail';

const task = (over: Partial<Task>): Task => ({
  id: over.id ?? 't1', project_id: 'p1', number: 1, key: 'OPS-1', title: 'A task', description: null, status: 'todo', priority: 'none',
  assignee_number: null, created_by: 'u-hr', creator_number: 'E-HR', due_date: null, parent_id: null, is_group: false, sort_order: 1,
  completed_at: null, template_id: null, created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z', labels: [], ...over,
});
const PROJECT: TaskProject = { id: 'p1', key: 'OPS', name: 'Operations', description: null, department_id: null, lead_number: 'E-LEAD', archived: false, created_by: 'u-hr' };
const LABEL: TaskLabel = { id: 'l1', name: 'Audit', color: 'red' };
const names: Record<string, string> = { 'E-MO': 'Mo Member', 'E-HR': 'Hana HR', 'E-RITA': 'Rita Sales' };
const nameOf = (n: string | null) => (n ? names[n] ?? n : 'Unassigned');

const TASKS = [
  task({ id: 'a', key: 'OPS-1', title: 'Count the safe', status: 'todo', sort_order: 10, assignee_number: 'E-MO', labels: ['l1'], priority: 'urgent' }),
  task({ id: 'b', key: 'OPS-2', title: 'Call the bank', status: 'todo', sort_order: 20 }),
  task({ id: 'c', key: 'OPS-3', title: 'Monthly report', status: 'in_progress', sort_order: 5, is_group: true }),
  task({ id: 'c1', key: 'OPS-4', title: 'Monthly report', status: 'done', parent_id: 'c', assignee_number: 'E-RITA' }),
  task({ id: 'c2', key: 'OPS-5', title: 'Monthly report', status: 'todo', parent_id: 'c', assignee_number: 'E-MO' }),
  task({ id: 'd', key: 'OPS-6', title: 'Someone else’s', status: 'in_review', created_by: 'u-other' }),
];

const viewProps = (over: Partial<Parameters<typeof TaskBoard>[0]> = {}) => ({
  tasks: TASKS,
  allTasks: TASKS,
  projects: { p1: PROJECT },
  labels: { l1: LABEL },
  nameOf,
  canEdit: (t: Task) => t.id !== 'd',
  onOpen: vi.fn(),
  onMove: vi.fn(),
  ...over,
});

// a DataTransfer that keeps what was set (jsdom has none)
const transfer = () => {
  const store: Record<string, string> = {};
  return { setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k] ?? '', effectAllowed: '', dropEffect: '' };
};

afterEach(() => cleanup());

describe('TaskBoard', () => {
  it('shows a column per status with counts, labels, assignee and sub-task progress', () => {
    render(<TaskBoard {...viewProps()} />);
    const todo = screen.getByTestId('column-todo');
    expect(within(todo).getByText('To do')).toBeTruthy();
    expect(within(todo).getByText('3')).toBeTruthy(); // OPS-1, OPS-2, OPS-5
    const card = screen.getByTestId('task-card-OPS-1');
    expect(within(card).getByText('Audit')).toBeTruthy();
    expect(within(card).getByTitle('Mo Member')).toBeTruthy();
    expect(within(screen.getByTestId('task-card-OPS-3')).getByText('1/2')).toBeTruthy();
  });

  it('opens a task when its card is clicked', () => {
    const props = viewProps();
    render(<TaskBoard {...props} />);
    fireEvent.click(screen.getByText('Call the bank'));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('drags a card to another column (at the end) and between cards', () => {
    const props = viewProps();
    render(<TaskBoard {...props} />);
    const dt = transfer();
    fireEvent.dragStart(screen.getByTestId('task-card-OPS-2'), { dataTransfer: dt });
    fireEvent.dragOver(screen.getByTestId('column-done'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('column-done'), { dataTransfer: dt });
    // done has OPS-4 (sort 1): OPS-2 goes after it
    expect(props.onMove).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), 'done', 1 + 1024);

    const dt2 = transfer();
    fireEvent.dragStart(screen.getByTestId('task-card-OPS-2'), { dataTransfer: dt2 });
    fireEvent.drop(screen.getByTestId('task-card-OPS-1'), { dataTransfer: dt2 });
    // before OPS-1 (sort 10) in To do, OPS-5 (sort 1) above it: halfway
    expect(props.onMove).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), 'todo', 5.5);
  });

  it('cards the viewer cannot change are not draggable', () => {
    render(<TaskBoard {...viewProps()} />);
    expect(screen.getByTestId('task-card-OPS-6').getAttribute('draggable')).toBe('false');
    expect(screen.getByTestId('task-card-OPS-1').getAttribute('draggable')).toBe('true');
  });
});

describe('TaskList', () => {
  it('groups by status, folds a group, and changes status in place', () => {
    const props = viewProps();
    render(<TaskList {...props} />);
    expect(screen.getByRole('button', { name: /To do 3/ })).toBeTruthy();
    expect(screen.getByTestId('task-row-OPS-1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /To do 3/ }));
    expect(screen.queryByTestId('task-row-OPS-1')).toBeNull();
    fireEvent.change(screen.getByLabelText('Status of OPS-3'), { target: { value: 'in_review' } });
    // to the end of In review (OPS-6, sort 1)
    expect(props.onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }), 'in_review', 1 + 1024);
    // someone else's task: no status menu
    expect(screen.queryByLabelText('Status of OPS-6')).toBeNull();
  });

  it('shows nothing when there are no tasks', () => {
    const { container } = render(<TaskList {...viewProps({ tasks: [] })} />);
    expect(container.textContent).toBe('');
  });
});

describe('TaskDetail', () => {
  const viewer: TaskViewer = { userId: 'u-mo', employeeNumber: 'E-MO', manages: false };
  const detail = (t: Task, over: Partial<Parameters<typeof TaskDetail>[0]> = {}) => {
    const props = {
      task: t, allTasks: TASKS, projects: [PROJECT], labels: [LABEL], viewer, nameOf,
      people: [{ number: 'E-RITA', name: 'Rita Sales' }, { number: 'E-HR', name: 'Hana HR' }],
      onClose: vi.fn(), onChanged: vi.fn(), onDeleted: vi.fn(), onOpen: vi.fn(), onCreateSubtask: vi.fn().mockResolvedValue(undefined),
      ...over,
    };
    render(<TaskDetail {...props} />);
    return props;
  };

  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset();
    api.loadComments.mockResolvedValue([
      { id: 'cm1', task_id: 'a', body: 'Started counting', mentions: [], author_id: 'u-hr', author_number: 'E-HR', author_name: 'Hana HR', created_at: '2026-10-02T09:00:00Z', edited_at: null },
    ]);
    api.loadActivity.mockResolvedValue([
      { id: 1, task_id: 'a', actor_id: 'u-hr', actor_name: 'Hana HR', field: 'created', before_value: null, after_value: 'OPS-1', created_at: '2026-10-01T08:00:00Z' },
      { id: 2, task_id: 'a', actor_id: 'u-hr', actor_name: 'Hana HR', field: 'assignee', before_value: null, after_value: 'E-MO', created_at: '2026-10-01T08:01:00Z' },
    ]);
    api.loadAttachments.mockResolvedValue([
      { id: 'f1', task_id: 'a', path: 'x/a/1.pdf', file_name: 'count.pdf', size_bytes: 10, content_type: 'application/pdf', uploaded_by: 'u-hr', created_at: '2026-10-01T08:00:00Z' },
    ]);
    api.addComment.mockResolvedValue(undefined);
    api.updateTask.mockImplementation(async (id: string, change: Partial<Task>) => ({ ...TASKS.find((t) => t.id === id)!, ...change }));
  });

  it('shows the fields, comments, files and (on its tab) the activity', async () => {
    detail(TASKS[0]);
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Count the safe');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('todo');
    expect(screen.getByTestId('employee-picker').textContent).toBe('Assignee: E-MO');
    expect(await screen.findByText('Started counting')).toBeTruthy();
    expect(screen.getByText('count.pdf')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByTestId('task-activity').textContent).toContain('Hana HR assigned it to Mo Member');
  });

  it('the assignee changes the status; the change is saved', async () => {
    const props = detail(TASKS[0]);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } });
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('a', { status: 'done' }));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' })));
  });

  it('a task the viewer cannot change is read-only and cannot be deleted', async () => {
    detail(TASKS[5]);
    await screen.findByText('Started counting');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Title') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByLabelText('Delete task')).toBeNull();
  });

  it('comments with an @mention picked from the list', async () => {
    detail(TASKS[0]);
    await screen.findByText('Started counting');
    const box = screen.getByLabelText('Comment') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Please check @ri', selectionStart: 16 } });
    const option = await screen.findByRole('option', { name: /Rita Sales/ });
    fireEvent.mouseDown(option);
    expect(box.value).toBe('Please check @Rita Sales ');
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(api.addComment).toHaveBeenCalledWith('a', 'Please check @Rita Sales', ['E-RITA'], viewer));
  });

  it('lists sub-tasks with progress, opens one, and adds one', async () => {
    const props = detail(TASKS[2]);
    expect(screen.getByText('1/2 done')).toBeTruthy();
    expect(screen.getByText(/Given to 2 people/)).toBeTruthy();
    fireEvent.click(screen.getByText('OPS-4'));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    fireEvent.change(screen.getByLabelText('New sub-task'), { target: { value: 'Collect forms' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(props.onCreateSubtask).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }), 'Collect forms'));
  });

  it('the creator deletes a task', async () => {
    const props = detail(TASKS[1], { viewer: { userId: 'u-hr', employeeNumber: 'E-HR', manages: false } });
    api.deleteTask.mockResolvedValue(undefined);
    fireEvent.click(screen.getByLabelText('Delete task'));
    await waitFor(() => expect(props.onDeleted).toHaveBeenCalledWith('b'));
  });
});
