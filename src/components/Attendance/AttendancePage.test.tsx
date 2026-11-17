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
  loadDayScans: vi.fn(),
  loadOddHoursUntil: vi.fn(),
  saveOddHoursUntil: vi.fn(),
  loadClockInSettings: vi.fn(),
  saveClockInSettings: vi.fn(),
  loadScannerAddresses: vi.fn(),
  loadBranchLocations: vi.fn(),
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
vi.mock('../../lib/branches', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/branches')>()),
  loadBranches: () => Promise.resolve([
    { id: 'b1', name: 'Nairobi HQ', country: 'Kenya', currency: 'KES', city: null, address: null, active: true, is_default: true },
    { id: 'b2', name: 'Dar es Salaam', country: 'Tanzania', currency: 'TZS', city: null, address: null, active: true, is_default: false },
  ]),
}));
vi.mock('../../lib/kpiApi', () => ({ downloadCsv }));
// missed-scan requests (MissedScanApprovals.test.tsx tests them)
vi.mock('../../lib/missedScanApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/missedScanApi')>()),
  loadMissedScans: () => Promise.resolve([]),
  loadMissedScanSettings: () => Promise.resolve({ daysBack: 7, approver: 'manager' }),
}));

import AttendancePage from './AttendancePage';
import { addDays, nairobiToday, weekOf } from '../../lib/attendance';

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

/** The page opens on Today (FIG-1203); these tests are about the summary over a range of dates, one click away. */
const renderRange = async () => {
  render(<AttendancePage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
};

beforeEach(() => {
  vi.clearAllMocks();
  people.list = [person('E1', 'Amina Otieno', 'Sales', 'Nairobi HQ'), person('E2', 'Baraka Juma', 'Ops', 'Dar es Salaam')];
  api.loadAttendanceAccess.mockResolvedValue(HR);
  api.loadTrackingFrom.mockResolvedValue('2026-10-22');
  api.saveTrackingFrom.mockResolvedValue(undefined);
  api.loadDayScans.mockResolvedValue([]);
  api.loadOddHoursUntil.mockResolvedValue('05:00');
  api.saveOddHoursUntil.mockResolvedValue(undefined);
  api.loadClockInSettings.mockResolvedValue({ policy: 'anywhere', networks: [], radiusM: 300 });
  api.loadScannerAddresses.mockResolvedValue([]);
  api.loadBranchLocations.mockResolvedValue([]);
  api.loadWebReasons.mockResolvedValue(new Map());
  api.loadAttendanceDays.mockResolvedValue(DAYS);
  api.loadSchedules.mockResolvedValue([]);
  api.setAttendanceDay.mockResolvedValue(undefined);
  api.saveSchedule.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Attendance page', () => {
  it('loads this week and shows each person’s present, late, absent and leave days', async () => {
    await renderRange();
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
    await renderRange();
    await screen.findByText('Amina Otieno');
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'Dar es Salaam' } });
    expect(screen.queryByText('Amina Otieno')).toBeNull();
    expect(screen.getByText('Baraka Juma')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'amina' } });
    expect(screen.queryByText('Baraka Juma')).toBeNull();
  });

  it('refuses a backwards date range', async () => {
    await renderRange();
    await screen.findByText('Amina Otieno');
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2020-01-01' } });
    expect(screen.getByRole('alert').textContent).toMatch(/end date must be on or after/);
  });

  it('shows one person’s days and HR corrects one, with a note', async () => {
    await renderRange();
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
    // Today's load, the range's, then the range again after the correction
    await waitFor(() => expect(api.loadAttendanceDays).toHaveBeenCalledTimes(3));
  });

  it('exports the days shown as CSV', async () => {
    await renderRange();
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
    await renderRange();
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
    await renderRange();
    await screen.findByText('Amina Otieno');
    fireEvent.click(screen.getByRole('button', { name: 'Work schedule' }));
    const from = (await screen.findByLabelText('Count attendance from')) as HTMLInputElement;
    expect(from.value).toBe('2026-10-22');
    expect(within(from.closest('div.grid') as HTMLElement).getByText(/Days before this don't count: not present, late or absent\. Their scans are still kept\./)).toBeTruthy();
    fireEvent.change(from, { target: { value: '2026-10-19' } });
    fireEvent.click(within(from.closest('div.grid') as HTMLElement).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveTrackingFrom).toHaveBeenCalledWith('2026-10-19'));
  });

  it('flags odd-hours days in the summary and on the day, and lists each day’s scans', async () => {
    const flag = 'Clocked in at 12:01 am, before 5:00 am';
    api.loadAttendanceDays.mockResolvedValue([
      ...DAYS.filter((d) => d.day !== '2026-10-19' || d.employeeNumber !== 'E1'),
      day('E1', '2026-10-19', { status: 'present', clockIn: '2026-10-18T21:01:00Z', clockOut: '2026-10-19T14:05:00Z', hours: 17.07, lateMinutes: 0, flag }),
    ]);
    api.loadDayScans.mockResolvedValue([
      { at: '2026-10-18T21:01:00Z', via: 'scanner', scannerName: 'Front Door', kind: 'clock_in', reason: null, verify: 1, status: 1, punchMode: 'first_last' },
      { at: '2026-10-19T05:02:00Z', via: 'app', scannerName: null, kind: 'between', reason: null },
      { at: '2026-10-19T09:30:00Z', via: 'scanner', scannerName: 'Front Door', kind: 'between', reason: null },
      { at: '2026-10-19T14:05:00Z', via: 'scanner', scannerName: 'Front Door', kind: 'clock_out', reason: null },
      { at: '2026-10-19T16:00:00Z', via: 'scanner', scannerName: 'Front Door', kind: 'held', reason: 'clock_ahead' },
    ]);
    await renderRange();
    await screen.findByText('Amina Otieno');
    expect(within(rowOf('Amina Otieno')).getByText('1 flagged')).toBeTruthy();
    expect(within(rowOf('Baraka Juma')).queryByText(/flagged/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open days for Amina Otieno' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Odd hours')).toBeTruthy();
    expect(within(dialog).getByText(flag)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show scans for Mon 19 Oct' }));
    expect(api.loadDayScans).toHaveBeenCalledWith('E1', '2026-10-19');
    const list = await within(dialog).findByRole('list', { name: 'Scans on Mon 19 Oct' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '12:01 am · Front Door · fingerprint · clock-in',
      '8:02 am · App',
      '12:30 pm · Front Door',
      '5:05 pm · Front Door · clock-out',
      "7:00 pm · Front Door · not counted (the scanner's clock was ahead)",
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hide scans for Mon 19 Oct' }));
    expect(within(dialog).queryByRole('list')).toBeNull();
  });

  it('says when a day has no scans, and when the scans can’t be loaded', async () => {
    await renderRange();
    fireEvent.click(await screen.findByRole('button', { name: 'Open days for Amina Otieno' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show scans for Wed 21 Oct' }));
    expect(await within(dialog).findByText('No scans or clock-ins this day.')).toBeTruthy();
    api.loadDayScans.mockRejectedValue(new Error('You can see your own attendance and your team\'s only'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show scans for Tue 20 Oct' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/your own attendance/);
  });

  it('counts today’s time so far for someone still in, and marks past days without a clock-out', async () => {
    const today = nairobiToday();
    const yesterday = addDays(today, -1);
    const twoHoursAgo = new Date(Date.now() - (2 * 60 + 10) * 60_000).toISOString();
    api.loadAttendanceDays.mockResolvedValue([
      day('E1', today, { status: 'present', clockIn: twoHoursAgo, lateMinutes: 0 }),
      day('E2', yesterday, { status: 'present', clockIn: `${yesterday}T05:00:00Z`, lateMinutes: 0 }),
    ]);
    await renderRange();
    await screen.findByText('Amina Otieno');
    expect(within(rowOf('Amina Otieno')).getByText(/^2h 1[01]m so far$/)).toBeTruthy();
    expect(within(rowOf('Baraka Juma')).getByText('1 day without a clock-out')).toBeTruthy();
    expect(within(rowOf('Baraka Juma')).queryByText(/so far/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open days for Baraka Juma' }));
    expect(within(await screen.findByRole('dialog')).getByText('No clock-out')).toBeTruthy();
  });

  it('a scanner’s last scan today before the end time is "Last scan", counted so far; after it, the clock-out (FIG-1200)', async () => {
    const today = nairobiToday();
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    api.loadAttendanceDays.mockResolvedValue([
      day('E1', today, { status: 'present', clockIn: threeHoursAgo, clockOut: anHourAgo, hours: 2, lateMinutes: 0, source: 'scanner', clockOutVia: 'scanner', endTime: '23:59' }),
      day('E2', today, { status: 'present', clockIn: threeHoursAgo, clockOut: anHourAgo, hours: 2, lateMinutes: 0, source: 'scanner', clockOutVia: 'scanner', endTime: '00:00' }),
    ]);
    await renderRange();
    await screen.findByText('Amina Otieno');
    expect(within(rowOf('Amina Otieno')).getByText(/^(2h 59m|3h 00m) so far$/)).toBeTruthy();
    expect(within(rowOf('Baraka Juma')).getByText('2h 00m')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open days for Amina Otieno' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/^Last scan \d{1,2}:\d{2} [ap]m$/)).toBeTruthy();
    expect(within(dialog).getByText(/so far$/)).toBeTruthy();
  });

  it('an app clock-out or HR’s correction is a clock-out straight away', async () => {
    const today = nairobiToday();
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    api.loadAttendanceDays.mockResolvedValue([
      day('E1', today, { status: 'present', clockIn: threeHoursAgo, clockOut: anHourAgo, hours: 2, lateMinutes: 0, source: 'scanner', clockOutVia: 'app', endTime: '23:59' }),
      day('E2', today, { status: 'present', clockIn: threeHoursAgo, clockOut: anHourAgo, hours: 2, lateMinutes: 0, source: 'hr', clockOutVia: 'hr', endTime: '23:59' }),
    ]);
    await renderRange();
    await screen.findByText('Amina Otieno');
    expect(within(rowOf('Amina Otieno')).getByText('2h 00m')).toBeTruthy();
    expect(within(rowOf('Baraka Juma')).getByText('2h 00m')).toBeTruthy();
  });

  it('shows where each clock-in was made: App · field with a map link, App · office, Scanner; and in the scans (FIG-1200)', async () => {
    api.loadAttendanceDays.mockResolvedValue([
      day('E1', '2026-10-19', { status: 'present', clockIn: '2026-10-19T05:05:00Z', source: 'app', place: 'field', placeLocation: { latitude: 0.5143, longitude: 35.2698 } }),
      day('E1', '2026-10-20', { status: 'present', clockIn: '2026-10-20T05:05:00Z', source: 'app', place: 'office', placeDetail: 'Office network' }),
      day('E1', '2026-10-21', { status: 'present', clockIn: '2026-10-21T05:05:00Z', source: 'scanner' }),
    ]);
    api.loadDayScans.mockResolvedValue([{ at: '2026-10-19T05:05:00Z', via: 'app', scannerName: null, kind: 'clock_in', reason: null }]);
    await renderRange();
    fireEvent.click(await screen.findByRole('button', { name: 'Open days for Amina Otieno' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('App · field')).toBeTruthy();
    const link = within(dialog).getByRole('link', { name: '0.51430, 35.26980' }) as HTMLAnchorElement;
    expect(link.href).toBe('https://www.google.com/maps?q=0.5143,35.2698');
    expect(within(dialog).getByText('App · office')).toBeTruthy();
    expect(within(dialog).getByText('Office network')).toBeTruthy();
    expect(within(dialog).getByText('Scanner')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show scans for Mon 19 Oct' }));
    const list = await within(dialog).findByRole('list', { name: 'Scans on Mon 19 Oct' });
    expect(within(list).getByRole('listitem').textContent).toBe('8:05 am · App · field · clock-in');
  });

  it('shows a day before attendance counts as "Not counted", with its clock-in', async () => {
    api.loadAttendanceDays.mockResolvedValue([
      day('E1', '2026-10-19', { status: null, counted: false, clockIn: '2026-10-19T10:00:00Z', clockOut: '2026-10-19T14:00:00Z', hours: 4 }),
    ]);
    await renderRange();
    fireEvent.click(await screen.findByRole('button', { name: 'Open days for Amina Otieno' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Not counted')).toBeTruthy();
    expect(within(dialog).getByText('1:00 pm')).toBeTruthy();
    expect(within(dialog).getByText('4h 00m')).toBeTruthy();
  });

  it('sets the odd-hours clock-in time', async () => {
    await renderRange();
    await screen.findByText('Amina Otieno');
    fireEvent.click(screen.getByRole('button', { name: 'Work schedule' }));
    const until = (await screen.findByLabelText('Odd-hours clock-in before')) as HTMLInputElement;
    expect(until.value).toBe('05:00');
    const card = until.closest('div.grid') as HTMLElement;
    expect(within(card).getByText(/A clock-in after midnight and before this time is flagged and HR is notified\. 00:00 turns it off\./)).toBeTruthy();
    expect(within(card).getByText(/before 5:00 am are flagged/)).toBeTruthy();
    fireEvent.change(until, { target: { value: '13:00' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    expect(within(card).getByRole('alert').textContent).toMatch(/00:00 to 12:00/);
    expect(api.saveOddHoursUntil).not.toHaveBeenCalled();
    fireEvent.change(until, { target: { value: '00:00' } });
    expect(within(card).getByText(/aren't flagged/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveOddHoursUntil).toHaveBeenCalledWith('00:00'));
  });

  it('a manager sees their team, without corrections or schedules', async () => {
    api.loadAttendanceAccess.mockResolvedValue(MANAGER);
    api.loadAttendanceDays.mockResolvedValue(DAYS.filter((d) => d.employeeNumber === 'E1'));
    await renderRange();
    await screen.findByText('Amina Otieno');
    expect(screen.getByText('Showing you and the people who report to you.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Work schedule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scanners' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open days for Amina Otieno' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: /^Correct/ })).toBeNull();
  });
});
