import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const state = vi.hoisted(() => ({
  employeeNumber: 'E1' as string | null,
  tasks: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  holidays: [] as Record<string, unknown>[],
  leave: [] as Record<string, unknown>[],
  people: [] as { name: string; birthday: string | null; email: string | null }[],
  hidden: new Set<string>(),
  updateTask: vi.fn(),
  startDirectMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u-me', email: 'me@farm.co.ke' } } } }) } },
}));
vi.mock('../../lib/tasksApi', () => ({
  loadMyOpenTasks: () => Promise.resolve(state.tasks),
  loadProjects: () => Promise.resolve([{ id: 'p1', key: 'OPS', name: 'Operations' }]),
  updateTask: (...a: unknown[]) => state.updateTask(...a),
}));
vi.mock('../../lib/upcomingApi', () => ({
  currentEmployeeNumber: () => Promise.resolve(state.employeeNumber),
  loadCompanyEvents: () => Promise.resolve(state.events),
  loadHolidays: () => Promise.resolve(state.holidays),
  loadMyLeave: () => Promise.resolve(state.leave),
  loadBirthdayPeople: () => Promise.resolve(state.people),
}));
vi.mock('../../lib/hiddenModules', () => ({ isHiddenModule: (m?: string | null) => !!m && state.hidden.has(m) }));
vi.mock('./CompleteProfileCard', () => ({ default: () => null }));
vi.mock('../chat/services/chatServices', () => ({
  chatService: {
    startDirectMessage: (...a: unknown[]) => state.startDirectMessage(...a),
    sendMessage: (...a: unknown[]) => state.sendMessage(...a),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import StaffHome from './StaffHome';

/** "yyyy-MM-dd" n days from today */
const inDays = (n: number, year?: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${year ?? d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** A birthday as colleagues get it: 'MM-DD', never the year. */
const monthDay = (n: number) => inDays(n).slice(5);

let n = 0;
const task = (title: string, due: string | null, extra: Record<string, unknown> = {}) => {
  n += 1;
  return {
    id: `t${n}`, project_id: 'p1', number: n, key: `OPS-${n}`, title, description: null, status: 'todo', priority: 'none',
    assignee_number: 'E1', due_date: due, is_group: false, sort_order: n, labels: [], ...extra,
  };
};

const renderHome = (props: Partial<Parameters<typeof StaffHome>[0]> = {}) => {
  const setActiveTab = vi.fn();
  render(<StaffHome setActiveTab={setActiveTab} userName="Michael Kiruti" {...props} />);
  return { setActiveTab };
};

const myTasks = () => screen.getByRole('heading', { name: 'My tasks' }).closest('section') as HTMLElement;
const thisWeek = () => screen.getByRole('heading', { name: 'This week' }).closest('section') as HTMLElement;

beforeEach(() => {
  state.employeeNumber = 'E1';
  state.tasks = [];
  state.events = [];
  state.holidays = [];
  state.leave = [];
  state.people = [];
  state.hidden = new Set();
  state.updateTask.mockReset();
});
afterEach(cleanup);

describe('StaffHome', () => {
  it('greets by first name without the old filler text', async () => {
    renderHome();
    expect(screen.getByText('Michael')).toBeTruthy();
    expect(screen.getByText("Here's your week.")).toBeTruthy();
    expect(screen.queryByText(/System Active/i)).toBeNull();
    expect(screen.queryByText(/ready for deployment/)).toBeNull();
    await screen.findByText('Nothing assigned to you right now');
  });

  it('lists my open tasks overdue first, with counts, project and due labels', async () => {
    state.tasks = [
      task('No date', null),
      task('Later', inDays(20)),
      task('Today', inDays(0), { status: 'in_progress' }),
      task('Late', inDays(-3)),
    ];
    renderHome();
    const section = within(await waitFor(() => {
      expect(screen.getByText('Late')).toBeTruthy();
      return myTasks();
    }));
    const titles = section.getAllByRole('button').map((b) => b.textContent ?? '').filter((t) => /Late|Today|Later|No date/.test(t));
    expect(titles[0]).toContain('Late');
    expect(titles[1]).toContain('Today');
    expect(titles[2]).toContain('Later');
    expect(titles[3]).toContain('No date');
    expect(section.getByText('Overdue by 3 days')).toBeTruthy();
    expect(section.getByText('Due today')).toBeTruthy();
    expect(section.getByText('In progress')).toBeTruthy();
    expect(section.getByText('4 open · 1 overdue')).toBeTruthy();
    expect(section.getAllByText(/· Operations/).length).toBe(4);
  });

  it('shows a friendly empty state when nothing is assigned', async () => {
    state.employeeNumber = null;
    renderHome();
    expect(await screen.findByText('Nothing assigned to you right now')).toBeTruthy();
  });

  it('opens the task in Tasks when tapped, and See all opens the Tasks list', async () => {
    state.tasks = [task('Fix the pump', inDays(1))];
    const onOpenTask = vi.fn();
    const { setActiveTab } = renderHome({ onOpenTask });
    fireEvent.click(await screen.findByText('Fix the pump'));
    expect(onOpenTask).toHaveBeenCalledWith(state.tasks[0].id);
    fireEvent.click(screen.getByRole('button', { name: 'See all my tasks →' }));
    expect(setActiveTab).toHaveBeenCalledWith('tasks');
  });

  it('falls back to the Tasks section when there is no way to open one task', async () => {
    state.tasks = [task('Fix the pump', inDays(1))];
    const { setActiveTab } = renderHome();
    fireEvent.click(await screen.findByText('Fix the pump'));
    expect(setActiveTab).toHaveBeenCalledWith('tasks');
  });

  it('marks a task done from the home', async () => {
    state.tasks = [task('Fix the pump', inDays(1))];
    state.updateTask.mockResolvedValue({});
    renderHome();
    const key = state.tasks[0].key as string;
    fireEvent.click(await screen.findByRole('button', { name: `Mark ${key} done` }));
    await waitFor(() => expect(state.updateTask).toHaveBeenCalledWith(state.tasks[0].id, { status: 'done' }));
    expect(await screen.findByText('Nothing assigned to you right now')).toBeTruthy();
  });

  it('shows only the next 7 days on the calendar, with birthdays by name only', async () => {
    state.events = [
      { id: 'e1', title: 'Staff meeting', date: inDays(0), description: 'Board room' },
      { id: 'e2', title: 'Last day of the week', date: inDays(6), description: null },
      { id: 'e3', title: 'Next week', date: inDays(7), description: null },
      { id: 'e4', title: 'Too far', date: inDays(8), description: null },
    ];
    state.holidays = [{ name: 'Mashujaa Day', date: inDays(1), recurring: false }];
    state.people = [
      { name: 'Amina Hassan', birthday: monthDay(2), email: 'amina@farm.co.ke' },
      { name: 'Far Away', birthday: monthDay(8), email: 'far@farm.co.ke' },
    ];
    state.leave = [{ type: 'Annual Leave', start: inDays(3), end: inDays(5), status: 'approved' }];
    renderHome();
    const week = within(await waitFor(() => {
      expect(screen.getByText('Staff meeting')).toBeTruthy();
      return thisWeek();
    }));
    expect(week.getByText('Last day of the week')).toBeTruthy();
    expect(week.queryByText('Next week')).toBeNull();
    expect(week.queryByText('Too far')).toBeNull();
    expect(week.getByText('Mashujaa Day')).toBeTruthy();
    expect(week.getByText('Tomorrow')).toBeTruthy();
    expect(week.getByText('Today')).toBeTruthy();
    expect(week.getByText('Amina Hassan')).toBeTruthy();
    expect(week.queryByText('Far Away')).toBeNull();
    expect(week.queryByText(/1990|years/)).toBeNull();
    expect(week.getByText('My Annual Leave')).toBeTruthy();
  });

  it('says when the calendar is empty this week, counts tasks due and links to the calendar', async () => {
    state.events = [{ id: 'e4', title: 'Too far', date: inDays(8), description: null }];
    state.tasks = [task('Due soon', inDays(2)), task('Due later', inDays(10))];
    const { setActiveTab } = renderHome();
    expect(await screen.findByText('Nothing on the calendar this week')).toBeTruthy();
    expect(await screen.findByText('1 of your tasks is due this week')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View calendar →' }));
    expect(setActiveTab).toHaveBeenCalledWith('company-calendar');
  });

  it("prompts a wish for a colleague's birthday today and sends it in Chat", async () => {
    state.people = [{ name: 'Amina Hassan', birthday: monthDay(0), email: 'amina@farm.co.ke' }];
    state.startDirectMessage.mockResolvedValue('dm-1');
    state.sendMessage.mockResolvedValue({ id: 'm1' });
    renderHome();
    expect(await screen.findByText(/birthday today/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send wishes' }));
    fireEvent.click(screen.getByRole('button', { name: /Send$/ }));
    await waitFor(() => expect(state.sendMessage).toHaveBeenCalledWith('dm-1', 'u-me', expect.stringContaining('Happy birthday, Amina!')));
  });

  it('shows the quick links at the bottom and opens their sections', async () => {
    const { setActiveTab } = renderHome();
    const nav = within(screen.getByRole('navigation', { name: 'Quick links' }));
    for (const label of ['Apply for leave', 'Payslips', 'My tasks', 'Calendar', 'Chat', 'Profile', 'Salary advance', 'Loans']) {
      expect(nav.getByRole('button', { name: label })).toBeTruthy();
    }
    fireEvent.click(nav.getByRole('button', { name: 'Apply for leave' }));
    expect(setActiveTab).toHaveBeenCalledWith('leave');
    fireEvent.click(nav.getByRole('button', { name: 'Loans' }));
    expect(setActiveTab).toHaveBeenCalledWith('loan');
    await screen.findByText('Nothing assigned to you right now');
  });

  it('hides Salary advance and Loans while their modules are switched off', async () => {
    state.hidden = new Set(['salaryadmin', 'loans']);
    renderHome();
    const nav = within(screen.getByRole('navigation', { name: 'Quick links' }));
    expect(nav.queryByRole('button', { name: 'Salary advance' })).toBeNull();
    expect(nav.queryByRole('button', { name: 'Loans' })).toBeNull();
    expect(nav.getByRole('button', { name: 'Payslips' })).toBeTruthy();
    await screen.findByText('Nothing assigned to you right now');
  });

  it('shows a My work link only to someone paid by work or given jobs', async () => {
    const { setActiveTab } = renderHome({ showMyWork: true });
    const nav = within(screen.getByRole('navigation', { name: 'Quick links' }));
    fireEvent.click(nav.getByRole('button', { name: 'My work' }));
    expect(setActiveTab).toHaveBeenCalledWith('my-work');
    await screen.findByText('Nothing assigned to you right now');
    cleanup();
    renderHome();
    expect(within(screen.getByRole('navigation', { name: 'Quick links' })).queryByRole('button', { name: 'My work' })).toBeNull();
    await screen.findByText('Nothing assigned to you right now');
  });
});
