import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AttendanceDay } from '../../lib/attendance';
import type { AttendanceAccess } from '../../lib/attendanceApi';
import type { DirectoryEmployee } from '../../lib/employeeDirectory';

const api = vi.hoisted(() => ({
  loadAttendanceAccess: vi.fn(),
  loadAttendanceDays: vi.fn(),
  loadDayScans: vi.fn(),
  loadWebReasons: vi.fn(),
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
vi.mock('../../lib/kpiApi', () => ({ downloadCsv }));

import AttendancePage from './AttendancePage';
import { nairobiToday } from '../../lib/attendance';

const TODAY = nairobiToday();
const person = (n: string, fullName: string, department: string, branch: string): DirectoryEmployee => ({
  employeeNumber: n, firstName: fullName.split(' ')[0], middleName: '', lastName: '', fullName, jobTitle: '', branch, town: '',
  email: '', id: n, departmentId: null, department, reportsToId: null, photo: '', status: 'Active',
});
const day = (employeeNumber: string, fields: Partial<AttendanceDay> = {}): AttendanceDay => ({
  employeeNumber, day: TODAY, status: null, clockIn: null, clockOut: null, hours: null, lateMinutes: null, source: null, note: null, ...fields,
});
// Nairobi is UTC+3: 05:05Z is 8:05 am
const at = (utc: string) => `${TODAY}T${utc}:00Z`;
const HR: AttendanceAccess = { seesAll: true, manages: true, schedules: true, employeeNumber: 'E-HR', team: [] };

const DAYS = [
  day('E3', { status: null }),
  day('E1', { status: 'late', clockIn: at('05:40'), lateMinutes: 10, source: 'scanner' }),
  day('E2', { status: 'present', clockIn: at('04:55'), source: 'app', place: 'remote' }),
  day('E4', { status: 'leave' }),
];

const table = () => screen.findByRole('table', { name: /^Attendance on / });
/** The people in the table, top to bottom. */
const order = () => screen.getAllByRole('button', { name: /^(Show|Hide) scans for / }).map((b) => b.getAttribute('aria-label')!.replace(/^(Show|Hide) scans for /, ''));
const header = (name: string) => screen.getByRole('button', { name }).closest('th') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  people.list = [
    person('E1', 'Amina Otieno', 'Sales', 'Nairobi HQ'),
    person('E2', 'Baraka Juma', 'Ops', 'Dar es Salaam'),
    person('E3', 'Chausiku Mwangi', 'Sales', 'Nairobi HQ'),
    person('E4', 'Daudi Kip', 'Ops', 'Nairobi HQ'),
  ];
  api.loadAttendanceAccess.mockResolvedValue(HR);
  api.loadAttendanceDays.mockResolvedValue(DAYS);
  api.loadDayScans.mockResolvedValue([]);
  api.loadWebReasons.mockResolvedValue(new Map([['E2', 'Working from home today']]));
});
afterEach(cleanup);

describe('Attendance: the Today view (FIG-1203)', () => {
  it('opens on today, sorted by arrival with people not in yet at the end', async () => {
    render(<AttendancePage />);
    const t = await table();
    await within(t).findByText('Amina Otieno');
    expect(api.loadAttendanceDays).toHaveBeenCalledWith(TODAY, TODAY);
    expect(api.loadWebReasons).toHaveBeenCalledWith(TODAY);
    expect(order()).toEqual(['Baraka Juma', 'Amina Otieno', 'Chausiku Mwangi', 'Daudi Kip']);
    expect(header('In').getAttribute('aria-sort')).toBe('ascending');
    expect(header('Employee').getAttribute('aria-sort')).toBe('none');
    const amina = within(t).getByText('Amina Otieno').closest('tr') as HTMLElement;
    expect(within(amina).getByText('Late · 10 min')).toBeTruthy();
    expect(within(amina).getByText('8:40 am')).toBeTruthy();
    expect(within(amina).getByText('Scanner')).toBeTruthy();
    const baraka = within(t).getByText('Baraka Juma').closest('tr') as HTMLElement;
    expect(within(baraka).getByText('On time')).toBeTruthy();
    expect(within(baraka).getByText('App · remote')).toBeTruthy();
    expect(within(baraka).getByText('“Working from home today”')).toBeTruthy();
    expect(within(within(t).getByText('Chausiku Mwangi').closest('tr') as HTMLElement).getByText('Not in yet')).toBeTruthy();
    expect(within(within(t).getByText('Daudi Kip').closest('tr') as HTMLElement).getByText('On leave')).toBeTruthy();
  });

  it('sorts by a header, and the same header again reverses it', async () => {
    render(<AttendancePage />);
    await within(await table()).findByText('Amina Otieno');
    fireEvent.click(screen.getByRole('button', { name: 'Employee' }));
    expect(header('Employee').getAttribute('aria-sort')).toBe('ascending');
    expect(header('In').getAttribute('aria-sort')).toBe('none');
    expect(order()).toEqual(['Amina Otieno', 'Baraka Juma', 'Chausiku Mwangi', 'Daudi Kip']);
    fireEvent.click(screen.getByRole('button', { name: 'Employee' }));
    expect(header('Employee').getAttribute('aria-sort')).toBe('descending');
    expect(order()).toEqual(['Daudi Kip', 'Chausiku Mwangi', 'Baraka Juma', 'Amina Otieno']);
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'late:desc' } });
    expect(order().slice(0, 2)).toEqual(['Amina Otieno', 'Baraka Juma']);
  });

  it('filters with a quick count, and clears it on a second click', async () => {
    render(<AttendancePage />);
    await within(await table()).findByText('Amina Otieno');
    const counts = screen.getByRole('group', { name: /Quick counts/ });
    const late = within(counts).getByRole('button', { name: /^Late/ });
    expect(late.textContent).toBe('Late1');
    expect(within(counts).getByRole('button', { name: /^In/ }).textContent).toBe('In2');
    expect(within(counts).getByRole('button', { name: /^Not in yet/ }).textContent).toBe('Not in yet1');
    fireEvent.click(late);
    expect(late.getAttribute('aria-pressed')).toBe('true');
    expect(order()).toEqual(['Amina Otieno']);
    fireEvent.click(late);
    expect(late.getAttribute('aria-pressed')).toBe('false');
    expect(order()).toHaveLength(4);
  });

  it('opens a row to show that person’s scans for the day', async () => {
    api.loadDayScans.mockResolvedValue([{ at: at('05:40'), via: 'scanner', scannerName: 'Front Door', kind: 'clock_in', reason: null }]);
    render(<AttendancePage />);
    const t = await table();
    fireEvent.click(await within(t).findByRole('button', { name: 'Show scans for Amina Otieno' }));
    expect(api.loadDayScans).toHaveBeenCalledWith('E1', TODAY);
    const list = await within(t).findByRole('list', { name: /^Scans on / });
    expect(within(list).getByRole('listitem').textContent).toBe('8:40 am · Front Door · clock-in');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(t).getByRole('button', { name: 'Hide scans for Amina Otieno' }));
    expect(within(t).queryByRole('list')).toBeNull();
  });

  it('shows a scanner’s last scan before the end time as "Last scan", with hours so far', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    api.loadAttendanceDays.mockResolvedValue([
      day('E1', { status: 'present', clockIn: threeHoursAgo, clockOut: anHourAgo, hours: 2, lateMinutes: 0, source: 'scanner', clockOutVia: 'scanner', endTime: '23:59' }),
    ]);
    render(<AttendancePage />);
    const row = (await within(await table()).findByText('Amina Otieno')).closest('tr') as HTMLElement;
    expect(within(row).getByText(/^Last scan \d{1,2}:\d{2} [ap]m$/)).toBeTruthy();
    expect(within(row).getByText(/so far$/)).toBeTruthy();
  });

  it('loads another date from the picker, and exports the day in the order shown', async () => {
    render(<AttendancePage />);
    await within(await table()).findByText('Amina Otieno');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const [file, csv] = downloadCsv.mock.calls[0] as [string, string];
    expect(file).toBe(`Attendance-${TODAY}.csv`);
    const lines = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(',')[1]);
    expect(lines).toEqual(['Baraka Juma', 'Amina Otieno', 'Chausiku Mwangi', 'Daudi Kip']);
    expect(csv).toContain('Working from home today');

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-19' } });
    await waitFor(() => expect(api.loadAttendanceDays).toHaveBeenCalledWith('2026-10-19', '2026-10-19'));
    expect(screen.getByRole('button', { name: 'Back to today' })).toBeTruthy();
  });

  it('keeps the range summary one click away', async () => {
    render(<AttendancePage />);
    await within(await table()).findByText('Amina Otieno');
    fireEvent.click(screen.getByRole('button', { name: 'Date range' }));
    expect(await screen.findByRole('button', { name: 'Open days for Amina Otieno' })).toBeTruthy();
  });
});
