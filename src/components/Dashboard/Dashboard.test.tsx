import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, { data?: unknown[]; count?: number; error?: unknown }>,
  events: [] as { id?: string; title: string; date: string; description?: string | null }[],
  people: [] as { name: string; birthday: string | null; email: string | null }[],
  modules: ['settings', 'employees'] as string[],
  navigate: vi.fn(),
}));

vi.mock('../../lib/supabase', () => {
  const builder = (table: string) => {
    const result = () => {
      const t = state.tables[table] ?? {};
      return { data: t.error ? null : t.data ?? [], count: t.count ?? (t.data ?? []).length, error: t.error ?? null };
    };
    const b: Row = {};
    for (const m of ['select', 'order', 'limit', 'range', 'eq', 'ilike', 'in', 'gte', 'lte']) b[m] = () => b;
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return b;
  };
  return { supabase: { from: (table: string) => builder(table), rpc: () => Promise.resolve({ data: null, error: null }) } };
});
vi.mock('../../lib/upcomingApi', () => ({
  loadCompanyEvents: () => Promise.resolve(state.events),
  loadBirthdayPeople: () => Promise.resolve(state.people),
}));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (m: string) => state.modules.includes(m),
    hasAllPermissions: (ms: string[]) => ms.every((m) => state.modules.includes(m)),
  }),
}));
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => state.navigate,
}));
const attendance = vi.hoisted(() => ({
  loadAttendanceAccess: vi.fn(),
  loadAttendanceDays: vi.fn(),
  directory: [] as unknown[],
}));
vi.mock('../../lib/attendanceApi', () => ({
  loadAttendanceAccess: attendance.loadAttendanceAccess,
  loadAttendanceDays: attendance.loadAttendanceDays,
}));
vi.mock('../../lib/employeeDirectory', () => ({ loadEmployeeDirectory: () => Promise.resolve(attendance.directory) }));
vi.mock('./GetStarted', () => ({ default: () => null, SHOW_SETUP_GUIDE: 'show-setup-guide' }));
vi.mock('./GroupOverview', () => ({ default: () => null }));
vi.mock('../Celebrations/BirthdayWishes', () => ({ TodaysBirthdayWishes: () => null }));

import DashboardMain from './Dashboard';
import { addDays, nairobiToday } from '../../lib/attendance';

const open = () =>
  render(
    <MemoryRouter>
      <DashboardMain selectedTown="ADMIN_ALL" onTownChange={() => {}} selectedRegion="" onRegionChange={() => {}} />
    </MemoryRouter>
  );

const updatesCard = async () => {
  const heading = await screen.findByText('Company Updates');
  return heading.closest('.flex.flex-col') as HTMLElement;
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 19, 10, 0)); // Monday 19 October 2026
  state.tables = {
    employees: { data: [], count: 12 },
    leave_application: { data: [], count: 3 },
    kenya_branches: { count: 2 },
    branches: { data: [] },
    holidays: { data: [] },
  };
  state.events = [];
  state.people = [];
  state.modules = ['settings', 'employees'];
  state.navigate.mockReset();
  // nobody sees attendance unless a test says so
  attendance.loadAttendanceAccess.mockReset().mockResolvedValue({ seesAll: false, manages: false, schedules: false, employeeNumber: null, team: [] });
  attendance.loadAttendanceDays.mockReset().mockResolvedValue([]);
  attendance.directory = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Dashboard: Company Updates (the next 7 days)', () => {
  it('shows a public holiday tomorrow, with its day and "Tomorrow"', async () => {
    state.tables.holidays = { data: [{ name: 'Mashujaa Day', date: '2025-10-20', recurring: true, country: 'Kenya' }] };
    open();
    const card = await updatesCard();
    expect(await within(card).findByText('Mashujaa Day')).toBeTruthy();
    expect(within(card).getByText('Public holiday')).toBeTruthy();
    expect(within(card).getByText('Tue 20 Oct')).toBeTruthy();
    expect(within(card).getByText('Tomorrow')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'View calendar →' }));
    expect(state.navigate).toHaveBeenCalledWith('/calendar');
  });

  it('shows company events and birthdays (name only), and tags holidays by country for a multi-country company', async () => {
    state.events = [{ id: 'e1', title: 'Staff party', date: '2026-10-22', description: null }];
    state.people = [{ name: 'Jane Wanjiku', birthday: '10-19', email: null }];
    state.tables.branches = { data: [{ id: 'b1', country: 'Kenya', active: true }, { id: 'b2', country: 'Tanzania', active: true }] };
    state.tables.holidays = {
      data: [
        { name: 'Mashujaa Day', date: '2026-10-20', recurring: false, country: 'Kenya' },
        { name: 'Test Day', date: '2026-10-21', recurring: false, country: 'Tanzania' },
      ],
    };
    open();
    const card = await updatesCard();
    expect(await within(card).findByText('Staff party')).toBeTruthy();
    expect(within(card).getByText('Company event')).toBeTruthy();
    expect(within(card).getByText('Jane Wanjiku')).toBeTruthy();
    expect(within(card).getByText('Birthday')).toBeTruthy();
    expect(within(card).getByText('Today')).toBeTruthy();
    expect(within(card).getByText('Mashujaa Day (Kenya)')).toBeTruthy();
    expect(within(card).getByText('Test Day (Tanzania)')).toBeTruthy();
    expect(within(card).queryByText(/1990|years/)).toBeNull();
  });

  it('leaves out anything 8 days away', async () => {
    state.events = [
      { id: 'e1', title: 'Board meeting', date: '2026-10-25' },
      { id: 'e2', title: 'Far away retreat', date: '2026-10-27' },
    ];
    open();
    const card = await updatesCard();
    expect(await within(card).findByText('Board meeting')).toBeTruthy();
    expect(within(card).queryByText('Far away retreat')).toBeNull();
  });

  it('says so only when there is truly nothing this week', async () => {
    state.events = [{ id: 'e2', title: 'Far away retreat', date: '2026-10-27' }];
    open();
    const card = await updatesCard();
    expect(await within(card).findByText('Nothing on the calendar this week')).toBeTruthy();
    expect(within(card).queryByText('Far away retreat')).toBeNull();
  });
});

describe('Dashboard: Active Branches', () => {
  const branchRows = [
    ...['Head office', 'Kisumu', 'Mombasa', 'Nairobi', 'Nakuru'].map((n, i) => ({ id: `b${i}`, name: n, country: 'Kenya', active: true })),
    { id: 'b9', name: 'Closed', country: 'Kenya', active: false },
  ];

  it("counts the company's active branches (5 active + 1 inactive = 5) and opens Settings, Branches", async () => {
    state.tables.branches = { data: branchRows };
    open();
    const card = await screen.findByRole('button', { name: /Active Branches: 5/ });
    fireEvent.click(card);
    expect(state.navigate).toHaveBeenCalledWith('/settings/branches');
  });

  it('falls back to the old count only when branches cannot be read, and is not a link without the right', async () => {
    state.tables.branches = { error: { message: 'permission denied' } };
    state.modules = [];
    open();
    const label = await screen.findByText('Active Branches');
    expect(label.parentElement?.textContent).toContain('2');
    expect(screen.queryByRole('button', { name: /Active Branches/ })).toBeNull();
  });
});

describe('Dashboard: Setup guide link', () => {
  it('brings the setup checklist back for whoever sets up the company', async () => {
    state.modules = ['settings', 'invite-people'];
    const asked = vi.fn();
    window.addEventListener('show-setup-guide', asked);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Setup guide' }));
    expect(asked).toHaveBeenCalledTimes(1);
    window.removeEventListener('show-setup-guide', asked);
  });

  it('is not offered to someone who cannot set up the company', async () => {
    state.modules = ['employees'];
    open();
    await screen.findByText('Company Updates');
    expect(screen.queryByRole('button', { name: 'Setup guide' })).toBeNull();
  });
});

describe('Dashboard: at a glance', () => {
  const staff = [
    { Town: 'Nairobi', Status: 'Active', 'Start Date': '2020-01-01' },
    { Town: 'Nairobi', Status: 'Active', 'Start Date': '2026-10-05' },
    { Town: 'Kisumu', Status: 'Active', 'Start Date': '2024-02-01' },
    { Town: 'Mombasa', Status: 'Terminated', 'Start Date': '2019-03-01', 'Termination Date': '2026-10-02' },
  ];
  const leave = [
    { 'Employee Number': 'E1', status: 'Approved', 'Start Date': '2026-10-15', 'End Date': '2026-10-20', 'Leave Type': 'Annual' },
    { 'Employee Number': 'E2', status: 'Pending', 'Start Date': '2026-10-25', 'End Date': '2026-10-26', 'Leave Type': 'Annual' },
    { 'Employee Number': 'E3', status: 'Pending', 'Start Date': '2026-11-02', 'End Date': '2026-11-03', 'Leave Type': 'Sick' },
    { 'Employee Number': 'E4', status: 'Rejected', 'Start Date': '2026-09-01', 'End Date': '2026-09-02', 'Leave Type': 'Annual' },
  ];

  const tile = async (label: string) => (await screen.findByText(label)).closest('.rounded-card') as HTMLElement;

  it('shows who is on leave today, what waits for approval, and this month’s joiners and leavers', async () => {
    state.tables.employees = { data: staff, count: 4 };
    state.tables.leave_application = { data: leave, count: 4 };
    open();
    const onLeave = await tile('On leave today');
    expect(await within(onLeave).findByText('1')).toBeTruthy();
    const requests = await tile('Leave Requests');
    expect(await within(requests).findByText('2 waiting for approval')).toBeTruthy();
    const people = await tile('Total Employees');
    expect(await within(people).findByText('1 joined · 1 left in Oct')).toBeTruthy();
    expect(within(people).getByRole('img', { name: /On staff over the last 12 months: .* 3 in Oct 2026/ })).toBeTruthy();
  });

  it('opens Leave from the leave tiles only for whoever can open it', async () => {
    state.tables.leave_application = { data: leave, count: 4 };
    state.modules = ['leaves'];
    open();
    fireEvent.click(await screen.findByRole('button', { name: /On leave today: 1/ }));
    expect(state.navigate).toHaveBeenCalledWith('/leaves');
    cleanup();
    state.modules = [];
    open();
    await screen.findByText('On leave today');
    expect(screen.queryByRole('button', { name: /On leave today/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Leave Requests/ })).toBeNull();
  });

  it('shows a dash, not a made-up zero, when leave cannot be read', async () => {
    state.tables.leave_application = { error: { message: 'permission denied' } };
    open();
    const onLeave = await tile('On leave today');
    expect(await within(onLeave).findByText('—')).toBeTruthy();
  });
});

describe('Dashboard: Analytics', () => {
  // the charts size themselves to their card; jsdom has no ResizeObserver
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const openAnalytics = async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Analytics' }));
    return screen.findByTestId('dashboard-analytics');
  };

  it('draws headcount by town, leave by status, and the monthly charts with a table twin', async () => {
    state.tables.employees = {
      data: [
        { Town: 'Nairobi', Status: 'Active', 'Start Date': '2026-10-01' },
        { Town: 'Nairobi', Status: 'Active', 'Start Date': '2024-01-01' },
        { Town: 'Kisumu', Status: 'Active', 'Start Date': '2024-01-01' },
        { Town: 'Mombasa', Status: 'Resigned', 'Start Date': '2024-01-01', 'Termination Date': '2026-06-30' },
      ],
      count: 4,
    };
    state.tables.leave_application = { data: [{ status: 'Approved' }, { status: 'approved' }, { status: null }], count: 3 };
    const analytics = await openAnalytics();
    const towns = await within(analytics).findByRole('list', { name: 'Current staff by town' });
    expect(within(towns).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Nairobi2 people', 'Kisumu1 person']);
    const status = within(analytics).getByRole('list', { name: 'Leave requests by status' });
    expect(within(status).getByText('Approved').closest('li')?.textContent).toContain('67%');
    expect(within(status).getByText('Pending').closest('li')?.textContent).toContain('33%');
    expect(within(analytics).getByText('3 requests in all')).toBeTruthy();
    const trend = within(analytics).getByRole('table', { name: 'People on staff at the end of each month' });
    expect(within(trend).getByRole('row', { name: /Oct 2026/ }).textContent).toBe('Oct 20263');
    const flows = within(analytics).getByRole('table', { name: 'People who joined and left each month' });
    expect(within(flows).getByRole('row', { name: /Jun 2026/ }).textContent).toBe('Jun 202601');
  });

  it('says so when there is nothing to chart', async () => {
    const analytics = await openAnalytics();
    expect(await within(analytics).findByText('No leave data')).toBeTruthy();
    expect(within(analytics).getAllByText('No employee data')).toHaveLength(2);
    expect(within(analytics).getByText('Nobody joined or left this year')).toBeTruthy();
  });
});

describe('Dashboard: attendance (FIG-1203)', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const HR = { seesAll: true, manages: true, schedules: true, employeeNumber: 'E-HR', team: [] as string[] };
  const MANAGER = { seesAll: false, manages: false, schedules: false, employeeNumber: 'E-LEAD', team: ['E1'] };
  const day = (employeeNumber: string, d: string, fields: Record<string, unknown> = {}) => ({
    employeeNumber, day: d, status: null, clockIn: null, clockOut: null, hours: null, lateMinutes: null, source: null, note: null, counted: true, ...fields,
  });
  const today = () => nairobiToday();
  const someDays = () => {
    const t = today();
    const y = addDays(t, -1);
    return [
      day('E1', t, { status: 'present', clockIn: `${t}T05:00:00Z` }),
      day('E2', t, { status: 'late', clockIn: `${t}T06:00:00Z`, lateMinutes: 30 }),
      day('E3', t, { status: null }),
      day('E4', t, { status: 'leave' }),
      day('E1', y, { status: 'present', clockIn: `${y}T05:00:00Z` }),
      day('E2', y, { status: 'absent' }),
    ];
  };
  const card = () => screen.findByTestId('attendance-today-card');

  it('shows HR today’s attendance on Overview, linking to the Attendance page', async () => {
    attendance.loadAttendanceAccess.mockResolvedValue(HR);
    attendance.loadAttendanceDays.mockResolvedValue(someDays());
    open();
    const c = await card();
    expect(within(c).getByText('Attendance today')).toBeTruthy();
    await within(c).findByText('Average arrival 8:30 am');
    const figure = (label: string) => (within(c).getByText(label).closest('.rounded-card') as HTMLElement).textContent;
    expect(figure('In')).toContain('2');
    expect(figure('Late')).toContain('1');
    expect(figure('Not in yet')).toContain('1');
    expect(figure('On leave')).toContain('1');
    const range = attendance.loadAttendanceDays.mock.calls[0] as [string, string];
    expect(range[1]).toBe(today());
    fireEvent.click(within(c).getByRole('button', { name: 'Open attendance →' }));
    expect(state.navigate).toHaveBeenCalledWith('/attendance');
  });

  it('shows the Attendance section on Analytics', async () => {
    attendance.loadAttendanceAccess.mockResolvedValue(HR);
    attendance.loadAttendanceDays.mockResolvedValue(someDays());
    attendance.directory = [{ employeeNumber: 'E2', fullName: 'Baraka Juma', department: 'Ops' }];
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Analytics' }));
    const section = await screen.findByTestId('attendance-analytics');
    expect(await within(section).findByText('Attendance rate, last 30 days')).toBeTruthy();
    expect(within(section).getByText('50%')).toBeTruthy();
    expect(within(section).getByText('Punctuality')).toBeTruthy();
    expect(within(section).getByText('Average arrival')).toBeTruthy();
    expect(within(section).getByRole('list', { name: 'Late arrivals by weekday' })).toBeTruthy();
    const top = within(section).getByRole('list', { name: 'Most late arrivals this month' });
    expect(within(top).getByText('Baraka Juma')).toBeTruthy();
    expect(within(section).getByRole('list', { name: 'Attendance rate by department' })).toBeTruthy();
    expect(screen.queryByTestId('attendance-today-card')).toBeNull();
  });

  it('labels a manager’s figures as their team’s', async () => {
    state.modules = ['team-work'];
    attendance.loadAttendanceAccess.mockResolvedValue(MANAGER);
    attendance.loadAttendanceDays.mockResolvedValue(someDays());
    open();
    const c = await card();
    expect(await within(c).findByText('Your team: attendance today')).toBeTruthy();
  });

  it('is hidden from someone who cannot open Attendance, without asking for it', async () => {
    state.modules = ['settings'];
    open();
    await screen.findByText('Company Updates');
    expect(screen.queryByTestId('attendance-today-card')).toBeNull();
    expect(attendance.loadAttendanceAccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }));
    expect(screen.queryByTestId('attendance-analytics')).toBeNull();
  });

  it('is hidden when the database says they see nobody’s attendance', async () => {
    open();
    await screen.findByText('Company Updates');
    await waitFor(() => expect(attendance.loadAttendanceAccess).toHaveBeenCalled());
    expect(screen.queryByTestId('attendance-today-card')).toBeNull();
    expect(attendance.loadAttendanceDays).not.toHaveBeenCalled();
  });

  it('says how to start before anyone has clocked in', async () => {
    attendance.loadAttendanceAccess.mockResolvedValue(HR);
    attendance.loadAttendanceDays.mockResolvedValue([day('E1', today(), { status: null })]);
    open();
    const c = await card();
    expect(await within(c).findByText('No attendance yet')).toBeTruthy();
    fireEvent.click(within(c).getByRole('button', { name: 'Set up attendance' }));
    expect(state.navigate).toHaveBeenCalledWith('/attendance');
  });
});
