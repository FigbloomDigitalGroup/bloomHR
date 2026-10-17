import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { OvertimeEntry, OvertimePerson } from '../../lib/overtimeApi';
import type { OvertimeMonthRow } from '../../lib/overtimePay';
import { DEFAULT_OVERTIME_SETTINGS } from '../../lib/overtimePay';
import { today, weekStart } from '../../lib/casualPay';

const api = vi.hoisted(() => ({
  people: [] as OvertimePerson[],
  entries: [] as OvertimeEntry[],
  waiting: [] as OvertimeEntry[],
  month: [] as OvertimeMonthRow[],
  setOvertimeHours: vi.fn(),
  approveOvertime: vi.fn(),
  rejectOvertime: vi.fn(),
  setOvertimeRate: vi.fn(),
  requestOvertime: vi.fn(),
  withdrawOvertime: vi.fn(),
  mine: [] as OvertimeEntry[],
}));
const perms = vi.hoisted(() => ({ modules: ['payroll'] as string[] }));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (m: string) => perms.modules.includes(m),
    hasAnyPermission: (ms: string[]) => ms.some((m) => perms.modules.includes(m)),
  }),
}));
vi.mock('../../lib/overtimeApi', () => ({
  loadOvertimePeople: () => Promise.resolve(api.people),
  loadWaitingOvertime: () => Promise.resolve(api.waiting),
  loadOvertime: () => Promise.resolve(api.entries),
  loadOvertimeMonth: () => Promise.resolve({ rows: new Map(api.month.map((r) => [r.employee_number, r])), settings: DEFAULT_OVERTIME_SETTINGS }),
  loadPayBasis: () => Promise.resolve(new Map([['E1', { basic: 40000, ownRate: null }], ['E2', { basic: 30000, ownRate: 300 }]])),
  loadOvertimeSettings: () => Promise.resolve(DEFAULT_OVERTIME_SETTINGS),
  saveOvertimeSettings: vi.fn(),
  loadDepartmentsAndGroups: () => Promise.resolve({ departments: [], jobGroups: [] }),
  setOvertimeHours: api.setOvertimeHours,
  approveOvertime: api.approveOvertime,
  rejectOvertime: api.rejectOvertime,
  setOvertimeRate: api.setOvertimeRate,
  uploadOvertime: vi.fn(),
  myEmployeeNumber: () => Promise.resolve('E1'),
  loadMyOvertime: () => Promise.resolve(api.mine),
  requestOvertime: api.requestOvertime,
  withdrawOvertime: api.withdrawOvertime,
}));

import OvertimePage from './OvertimePage';
import MyOvertime from '../staff portal/MyOvertime';

const monday = weekStart(today());
const entry = (id: string, emp: string, day: string, patch: Partial<OvertimeEntry> = {}): OvertimeEntry => ({
  id, employee_number: emp, work_date: day, hours: 2, day_type: 'normal', note: null, status: 'approved', source: 'supervisor',
  rejection_reason: null, decided_at: null, ...patch,
});

beforeEach(() => {
  perms.modules = ['payroll'];
  api.people = [
    { employee_number: 'E1', name: 'Wanjiru One', department: 'Farm', job_group: null, excluded_reason: null },
    { employee_number: 'E2', name: 'Otieno Two', department: 'Office', job_group: null, excluded_reason: null },
  ];
  api.entries = [entry('o1', 'E1', monday)];
  api.waiting = [entry('w1', 'E2', '2026-09-16', { status: 'submitted', source: 'self', hours: 3, note: 'Harvest' })];
  api.month = [{ employee_number: 'E1', normal_hours: 6, rest_hours: 4, holiday_hours: 0, over_cap_hours: 0, entries: [] }];
  api.mine = [
    entry('m1', 'E1', '2026-09-16', { status: 'submitted', source: 'self' }),
    entry('m2', 'E1', '2026-09-17', { status: 'rejected', source: 'self', rejection_reason: 'Only 2 hours', day_type: 'rest' }),
  ];
  for (const fn of [api.setOvertimeHours, api.approveOvertime, api.rejectOvertime, api.setOvertimeRate, api.requestOvertime, api.withdrawOvertime]) {
    fn.mockReset();
    fn.mockResolvedValue(undefined);
  }
});

afterEach(cleanup);

describe('Overtime page', () => {
  it('records hours in the week grid (Enter saves; an existing day is changed)', async () => {
    render(<OvertimePage />);
    const cell = (await screen.findAllByLabelText(/^Wanjiru One, /))[0] as HTMLInputElement;
    await waitFor(() => expect(cell.value).toBe('2'));
    fireEvent.change(cell, { target: { value: '3.5' } });
    fireEvent.keyDown(cell, { key: 'Enter' });
    fireEvent.blur(cell);
    await waitFor(() => expect(api.setOvertimeHours).toHaveBeenCalledWith('E1', monday, 3.5, expect.objectContaining({ id: 'o1' })));
    const other = screen.getAllByLabelText(/^Otieno Two, /)[0];
    fireEvent.change(other, { target: { value: '30' } });
    fireEvent.blur(other);
    expect(api.setOvertimeHours).toHaveBeenCalledTimes(1);
  });

  it('approves and rejects (with a reason) what employees asked for', async () => {
    render(<OvertimePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Waiting for approval (1)' }));
    expect(await screen.findByText('Harvest')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Otieno Two, 2026-09-16' }));
    await waitFor(() => expect(api.approveOvertime).toHaveBeenCalledWith(['w1']));
    fireEvent.click(screen.getByRole('button', { name: 'Reject Otieno Two, 2026-09-16' }));
    const dialog = screen.getByRole('dialog');
    const button = within(dialog).getByRole('button', { name: 'Not approved' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Not agreed beforehand' } });
    fireEvent.click(button);
    await waitFor(() => expect(api.rejectOvertime).toHaveBeenCalledWith('w1', 'Not agreed beforehand'));
  });

  it("payroll sees the month's hours by kind of day and what they pay", async () => {
    render(<OvertimePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Month totals' }));
    // 40,000 / 225 = 177.78 an hour: 6 x 1.5 + 4 x 2
    expect(await screen.findByText('KSh 3,022.26', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('KSh 177.78')).toBeTruthy();
    fireEvent.click(screen.getByTitle("Set this employee's own hourly rate"));
    fireEvent.change(screen.getByLabelText('Own hourly rate for E1'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setOvertimeRate).toHaveBeenCalledWith('E1', 250));
  });

  it('a supervisor (no payroll module) records and approves but sees no amounts, settings or upload', async () => {
    perms.modules = [];
    render(<OvertimePage />);
    await screen.findAllByLabelText(/^Wanjiru One, /);
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload overtime' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Month totals' }));
    await screen.findByText(/Approved hours this month/);
    expect(screen.queryByText(/KSh/)).toBeNull();
  });

  it('payroll changes the settings from the page', async () => {
    render(<OvertimePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(((await screen.findByLabelText('Working day multiplier')) as HTMLInputElement).value).toBe('1.5');
    expect((screen.getByLabelText('Rest day multiplier') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Hours basic salary pays for, a month') as HTMLInputElement).value).toBe('225');
  });
});

describe('My overtime (staff portal)', () => {
  it('lists my overtime and asks for more', async () => {
    render(<MyOvertime />);
    expect(await screen.findByText('Waiting for approval')).toBeTruthy();
    expect(screen.getByText('Why: Only 2 hours')).toBeTruthy();
    expect(screen.getByText('Rest day')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('e.g. 2.5'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. harvest, stock take'), { target: { value: 'Stock take' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask for approval' }));
    await waitFor(() => expect(api.requestOvertime).toHaveBeenCalledWith(today(), 2.5, 'Stock take'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw' })[0]);
    await waitFor(() => expect(api.withdrawOvertime).toHaveBeenCalledWith('m1'));
  });
});
