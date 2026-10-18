import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Task, TaskProject } from '../../lib/tasks';

const api = vi.hoisted(() => ({
  loadTaskViewer: vi.fn(),
  loadProjects: vi.fn(),
  loadProjectMembers: vi.fn(),
  loadTasks: vi.fn(),
  loadLabels: vi.fn(),
  updateTask: vi.fn(),
  createTask: vi.fn(),
  createGroupTask: vi.fn(),
  loadComments: vi.fn(),
  loadActivity: vi.fn(),
  loadAttachments: vi.fn(),
  taskConcernsMe: vi.fn(),
}));
// the signed-in person's modules (usePermissions); "Manage projects" is task-projects
const perms = vi.hoisted(() => ({ modules: [] as string[] }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    permissions: perms.modules,
    hasPermission: (m: string) => perms.modules.includes(m),
    loading: false,
    userRole: 'STAFF',
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/tasksApi', () => api);
vi.mock('../../hooks/useEmployeeDirectory', () => ({
  useEmployeeDirectory: () => ({
    employees: [
      { employeeNumber: 'E-MO', fullName: 'Mo Member', jobTitle: 'Loan Officer', status: 'Active', departmentId: null },
      { employeeNumber: 'E-RITA', fullName: 'Rita Sales', jobTitle: 'Sales Rep', status: 'Active', departmentId: 'd-sales' },
    ],
    loading: false,
    error: null,
  }),
}));
vi.mock('../UI/EmployeePicker', () => ({ default: () => <div data-testid="employee-picker" /> }));
vi.mock('../UI/DepartmentPicker', () => ({ default: () => <div data-testid="department-picker" /> }));
vi.mock('../UI/FigbloomLoader', () => ({ default: () => <div>Loading</div> }));

import TaskWorkspace from './TaskWorkspace';

const task = (over: Partial<Task>): Task => ({
  id: over.id ?? 't', project_id: 'p1', number: 1, key: 'OPS-1', title: 'A task', description: null, status: 'todo', priority: 'none',
  assignee_number: null, created_by: 'u-hr', creator_number: null, due_date: null, parent_id: null, is_group: false, sort_order: 1,
  completed_at: null, template_id: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', labels: [], ...over,
});
const OPS: TaskProject = { id: 'p1', key: 'OPS', name: 'Operations', description: null, department_id: null, lead_number: null, archived: false, created_by: 'u-hr' };
const SALES: TaskProject = { id: 'p2', key: 'SAL', name: 'Sales', description: null, department_id: 'd-sales', lead_number: null, archived: false, created_by: 'u-hr' };

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  perms.modules = ['dashboard', 'task-manager'];
  api.loadTaskViewer.mockResolvedValue({ userId: 'u-mo', employeeNumber: 'E-MO' });
  api.loadProjects.mockResolvedValue([OPS, SALES]);
  api.loadProjectMembers.mockResolvedValue({ p1: ['E-MO'] });
  api.loadTasks.mockResolvedValue([
    task({ id: 'a', key: 'OPS-1', title: 'Mine to do', assignee_number: 'E-MO' }),
    task({ id: 'b', key: 'OPS-2', title: 'Rita’s task', assignee_number: 'E-RITA' }),
    task({ id: 'c', key: 'SAL-1', title: 'Sales task I was given', project_id: 'p2', assignee_number: 'E-MO', status: 'in_progress' }),
  ]);
  api.loadLabels.mockResolvedValue([]);
  api.loadComments.mockResolvedValue([]);
  api.loadActivity.mockResolvedValue([]);
  api.loadAttachments.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe('TaskWorkspace (staff)', () => {
  it('starts on My tasks, switches to a project, and lists them', async () => {
    render(<TaskWorkspace mode="staff" />);
    expect(await screen.findByText('Mine to do')).toBeTruthy();
    expect(screen.getByText('Sales task I was given')).toBeTruthy();
    expect(screen.queryByText('Rita’s task')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Operations/ }));
    expect(screen.getByText('Rita’s task')).toBeTruthy();
    expect(screen.queryByText('Sales task I was given')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /List/ }));
    expect(screen.getByTestId('task-list')).toBeTruthy();
  });

  it('"C" opens a new task, offering only the projects the person is in', async () => {
    render(<TaskWorkspace mode="staff" />);
    await screen.findByText('Mine to do');
    fireEvent.keyDown(window, { key: 'c' });
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    const options = within(dialog).getByLabelText('Project').querySelectorAll('option');
    expect([...options].map((o) => o.textContent)).toEqual(['Operations (OPS)']); // a member of OPS, not of Sales
  });

  it('a supervisor’s team view shows only the team’s tasks', async () => {
    render(<TaskWorkspace mode="staff" teamNumbers={['E-RITA']} />);
    expect(await screen.findByText('Rita’s task')).toBeTruthy();
    expect(screen.queryByText('Mine to do')).toBeNull();
    expect(screen.queryByRole('button', { name: /New task/ })).toBeNull();
  });
});

describe('TaskWorkspace (staff with "Manage projects")', () => {
  it('staff without it see no project-management controls', async () => {
    render(<TaskWorkspace mode="staff" />);
    await screen.findByText('Mine to do');
    expect(screen.queryByRole('button', { name: /New project/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Labels/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Recurring/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit Operations/ })).toBeNull();
    expect(screen.getByRole('button', { name: /New task/ })).toBeTruthy();
  });

  it('staff with it get New project, Labels, Recurring, project settings and every project', async () => {
    perms.modules = ['dashboard', 'task-manager', 'task-projects'];
    api.loadProjects.mockResolvedValue([OPS, SALES, { ...OPS, id: 'p3', key: 'FIN', name: 'Finance', department_id: null }]);
    render(<TaskWorkspace mode="staff" />);
    await screen.findByText('Mine to do');
    expect(screen.getByRole('button', { name: /New project/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Labels/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Recurring/ })).toBeTruthy();
    // every project, including one they are not in, with its settings
    expect(screen.getByRole('button', { name: /^FIN Finance/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit Finance' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /New project/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('they may add a task to any project, for a department, a job title or several people', async () => {
    perms.modules = ['task-projects'];
    render(<TaskWorkspace mode="staff" />);
    await screen.findByText('Mine to do');
    fireEvent.keyDown(window, { key: 'c' });
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    const options = within(dialog).getByLabelText('Project').querySelectorAll('option');
    expect([...options].map((o) => o.textContent)).toEqual(['Operations (OPS)', 'Sales (SAL)']);
    expect(within(dialog).getByLabelText(/A department/)).toBeTruthy();
    expect(within(dialog).getByLabelText(/A job title/)).toBeTruthy();
    expect(within(dialog).getByLabelText(/Several people/)).toBeTruthy();
  });

  it('a supervisor’s team view stays without them', async () => {
    perms.modules = ['task-projects'];
    render(<TaskWorkspace mode="staff" teamNumbers={['E-RITA']} />);
    await screen.findByText('Rita’s task');
    expect(screen.queryByRole('button', { name: /New project/ })).toBeNull();
  });
});

describe('TaskWorkspace (admin)', () => {
  it('a role without "Manage projects" (unticked by the company) gets no project-management controls', async () => {
    perms.modules = ['task-manager'];
    api.loadTaskViewer.mockResolvedValue({ userId: 'u-mgr', employeeNumber: 'E-MGR', oversees: false });
    render(<TaskWorkspace mode="admin" />);
    await screen.findByText(/You see tasks you're involved in/);
    expect(screen.queryByRole('button', { name: /New project/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Recurring/ })).toBeNull();
  });

  it('says who sees what, and a manager outside a project is told they only see the tasks they are involved in', async () => {
    perms.modules = ['task-manager', 'task-projects'];
    api.loadTaskViewer.mockResolvedValue({ userId: 'u-mgr', employeeNumber: 'E-MGR', oversees: false });
    render(<TaskWorkspace mode="admin" />);
    expect(await screen.findByText(/You see tasks you're involved in/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /All tasks/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Everything I can see/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^OPS Operations/ }));
    expect(screen.getByText(/You are not in this project/)).toBeTruthy();
    expect(screen.getByText(/Add yourself as a member/)).toBeTruthy();
  });
});

describe('TaskWorkspace (HR and admins oversee)', () => {
  beforeEach(() => {
    perms.modules = ['task-manager', 'task-projects'];
    api.loadTaskViewer.mockResolvedValue({ userId: 'u-adm', employeeNumber: 'E-ADM', oversees: true });
    api.taskConcernsMe.mockResolvedValue(false);
  });

  it('says they see every task, read-only unless involved, and offers All company tasks', async () => {
    render(<TaskWorkspace mode="admin" />);
    expect(await screen.findByText(/As HR\/admin you can see every task in the company \(read-only unless you're involved\)/)).toBeTruthy();
    expect(screen.queryByText(/You see tasks you're involved in/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Everything I can see/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /All company tasks/ }));
    expect(screen.getByRole('heading', { name: 'All company tasks' })).toBeTruthy();
    expect(screen.getByText('Mine to do')).toBeTruthy();
    expect(screen.getByText('Rita’s task')).toBeTruthy();
    expect(screen.getByText('Sales task I was given')).toBeTruthy();
    // no "you are not in this project" note: they see all of it
    fireEvent.click(screen.getByRole('button', { name: /^OPS Operations/ }));
    expect(screen.queryByText(/You are not in this project/)).toBeNull();
  });

  it('a task they are not involved in opens read-only', async () => {
    render(<TaskWorkspace mode="admin" />);
    await screen.findByText(/As HR\/admin/);
    fireEvent.click(screen.getByRole('button', { name: /All company tasks/ }));
    fireEvent.click(screen.getByText('Rita’s task'));
    expect(await screen.findByText(/You can see this task as HR\/admin. It's read-only/)).toBeTruthy();
    expect(api.taskConcernsMe).toHaveBeenCalledWith('b');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByLabelText('Comment')).toBeNull();
    expect(screen.queryByText('Attach a file')).toBeNull();
  });
});
