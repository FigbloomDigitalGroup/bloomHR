import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AttendanceDay } from '../../lib/attendance';
import type { AttendanceAccess } from '../../lib/attendanceApi';
import type { DirectoryEmployee } from '../../lib/employeeDirectory';

const api = vi.hoisted(() => ({
  loadAttendanceAccess: vi.fn(),
  loadAttendanceDays: vi.fn(),
  setAttendanceDay: vi.fn(),
  removeAttendanceDay: vi.fn(),
  loadSchedules: vi.fn(),
  saveSchedule: vi.fn(),
  removeSchedule: vi.fn(),
  loadTrackingFrom: vi.fn(),
  saveTrackingFrom: vi.fn(),
}));
const downloadCsv = vi.hoisted(() => vi.fn());
const people = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/attendanceApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/attendanceApi')>()),
  ...api,
}));
vi.mock('../../lib/employeeDirectory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/employeeDirectory')>()),
  loadEmployeeDirectory: () => Promise.resolve(people.list),
}));
vi.mock('../../lib/branches', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/branches')>()),
  loadBranches: () => Promise.resolve([
    { id: 'b1', name: 'Nairobi HQ', country: 'Kenya', currency: 'KES', city: null, address: null, active: true, is_default: true },
    { id: 'b2', name: 'Dar es Salaam', country: 'Tanzania', currency: 'TZS', city: null, address: null, active: true, is_default: false },
  ]),
}));
vi.mock('../../lib/kpiApi', () => ({ downloadCsv }));

import AttendancePage from './AttendancePage';
import { nairobiToday, weekOf } from '../../lib/attendance';

const person = (n: string, fullName: string, department: string, branch: string): DirectoryEmployee => ({
  employeeNumber: n, firstName: fullName.split(' ')[0], middleName: '', lastName: '', fullName, jobTitle: '', branch, town: '',
  email: '', id: n, departmentId: null, department, reportsToId: null, photo: '', status: 'Active',
});
const day = (employeeNumber: string, d: string, fields: Partial<AttendanceDay> = {}): AttendanceDay => ({
  employeeNumber, day: d, status: null, clockIn: null, clockOut: null, hours: null, lateMinutes: null, source: null, note: null, ...fields,
});
const HR: AttendanceAccess = { seesAll: true, manages: true, schedules: true, employeeNumber: 'E-HR', team: [] };
const MANAGER: AttendanceAccess = { seesAll: false, manages: false, schedules: false, employeeNumber: 'E-LEAD', team: ['E1'] };
const DAYS = [
  day('E1', '2026-10-19', { status: 'present', clockIn: '2026-10-19T05:05:00Z', clockOut: '2026-10-19T14:05:00Z', hours: 9, lateMinutes: 0 }),
  day('E1', '2026-10-20', { status: 'late', clockIn: '2026-10-20T05:40:00Z', clockOut: '2026-10-20T14:10:00Z', hours: 8.5, lateMinutes: 40 }),
  day('E1', '2026-10-21', { status: 'absent' }),
  day('E2', '2026-10-19', { status: 'leave' }),
  day('E2', '2026-10-20', { status: 'absent' }),
  day('E2', '2026-10-21', { status: 'holiday' }),
];

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  people.list = [person('E1', 'Amina Otieno', 'Sales', 'Nairobi HQ'), person('E2', 'Baraka Juma', 'Ops', 'Dar es Salaam')];
  api.loadAttendanceAccess.mockResolvedValue(HR);
  api.loadTrackingFrom.mockResolvedValue('2026-10-22');
  api.saveTrackingFrom.mockResolvedValue(undefined);
  api.loadAttendanceDays.mockResolvedValue(DAYS);
  api.loadSchedules.mockResolvedValue([]);
  api.setAttendanceDay.mockResolvedValue(undefined);
  api.saveSchedule.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Attendance page', () => {
  it('loads this week and shows each person’s present, late, absent and leave days', async () => {
    render(<AttendancePage />);
    await screen.findByText('Amina Otieno');
    const week = weekOf(nairobiToday());
    expect(api.loadAttendanceDays).toHaveBeenCalledWith(week.from, week.to);
    // HR also sets up the door scanners
    expect(screen.getByRole('button', { name: 'Scanners' })).toBeTruthy();
    const amina = within(rowOf('Amina Otieno')).getAllByRole('cell').map((c) => c.textContent);
    expect(amina.slice(1, 7)).toEqual(['Sales', '2', '1', '1', '0', '17h 30m']);
    const baraka = within(rowOf('Baraka Juma')).getAllByRole('cell').map((c) => c.textContent);
    expect(baraka.slice(1, 6)).toEqual(['Ops', '0', '0', '1', '1']);
  });

  it('filters by branch and search', async () => {
    render(<AttendancePage />);
    await screen.findByText('Amina Otieno');
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'Dar es Salaam' } });
    expect(screen.queryByText('Amina Otieno')).toBeNull();
    expect(screen.getByText('Baraka Juma')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'amina' } });
    expect(screen.queryByText('Baraka Juma')).toBeNull();
  });

  it('refuses a backwards date range', async () => {
    render(<AttendancePage />);
    await screen.findByText('Amina Otieno');
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2020-01-01' } });
    expect(screen.getByRole('alert').textContent).toMatch(/end date must be on or after/);
  });

  it('shows one person’s days and HR corrects one, with a note', async () => {
    render(<AttendancePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open days for Amina Otieno' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('8:40 am')).toBeTruthy();
    expect(within(dialog).getByText('40 min')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Correct Wed 21 Oct' }));
    fireEvent.change(within(dialog).getByLabelText('Clock in'), { target: { value: '08:10' } });
    fireEvent.change(within(dialog).getByLabelText(/^Clock out/), { target: { value: '17:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Add a note/);
    expect(api.setAttendanceDay).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/^Note/), { target: { value: 'Forgot to clock in' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.setAttendanceDay).toHaveBeenCalledWith('E1', '2026-10-21', '2026-10-21T05:10:00.000Z', '2026-10-21T14:00:00.000Z', 'Forgot to clock in')
    );
    await waitFor(() => expect(api.loadAttendanceDays).toHaveBeenCalledTimes(2));
  });

  it('exports the days shown as CSV', async () => {
    render(<AttendancePage />);
    await screen.findByText('Amina Otieno');
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Sales' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [file, csv] = downloadCsv.mock.calls[0] as [string, string];
    expect(file).toMatch(/^Attendance-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv).toContain('E1,Amina Otieno,Sales,Nairobi HQ,2026-10-20,Late,08:40,17:10,8.50,40,');
    expect(csv).not.toContain('Baraka');
  });

  it('sets the company schedule and gives a branch its own', async () => {
    render(<AttendancePage />);
    await screen.findByText('Amina Otieno');
    fireEvent.click(screen.getByRole('button', { name: 'Work schedule' }));
    const company = await screen.findByLabelText('Company schedule');
    expect(within(company).getByText(/Not set yet/)).toBeTruthy();
    fireEvent.click(within(company).getByRole('button', { name: 'Sat' }));
    fireEvent.change(within(company).getByLabelText(/^Grace/), { target: { value: '15' } });
    fireEvent.click(within(company).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.saveSchedule).toHaveBeenCalledWith(null, null, { work_days: [1, 2, 3, 4, 5, 6], start_time: '08:00', end_time: '17:00', grace_minutes: 15 })
    );
    fireEvent.change(screen.getByLabelText('Give a branch its own schedule'), { target: { value: 'b2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.saveSchedule).toHaveBeenLastCalledWith(null, 'b2', { work_days: [1, 2, 3, 4, 5], start_time: '08:00', end_time: '17:00', grace_minutes: 30 })
    );
  });

  it('sets the day attendance counts from', async () => {
    render(<AttendancePage />);
    await screen.findByText('Amina Otieno');
    fireEvent.click(screen.getByRole('button', { name: 'Work schedule' }));
    const from = (await screen.findByLabelText('Count attendance from')) as HTMLInputElement;
    expect(from.value).toBe('2026-10-22');
    fireEvent.change(from, { target: { value: '2026-10-19' } });
    fireEvent.click(within(from.closest('div.grid') as HTMLElement).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveTrackingFrom).toHaveBeenCalledWith('2026-10-19'));
  });

  it('a manager sees their team, without corrections or schedules', async () => {
    api.loadAttendanceAccess.mockResolvedValue(MANAGER);
    api.loadAttendanceDays.mockResolvedValue(DAYS.filter((d) => d.employeeNumber === 'E1'));
    render(<AttendancePage />);
    await screen.findByText('Amina Otieno');
    expect(screen.getByText('Showing you and the people who report to you.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Work schedule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scanners' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open days for Amina Otieno' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: /^Correct/ })).toBeNull();
  });
});
