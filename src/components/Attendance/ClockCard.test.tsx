import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { nairobiToday, type AttendanceToday } from '../../lib/attendance';

const api = vi.hoisted(() => ({
  loadToday: vi.fn(),
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  currentLocation: vi.fn(),
  loadClockRules: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/attendanceApi', () => api);

import ClockCard from './ClockCard';

const today = (over: Partial<AttendanceToday> = {}): AttendanceToday => ({
  date: '2026-10-22', status: null, clockIn: null, clockOut: null, lateMinutes: null, workingDay: true,
  startTime: '08:00', endTime: '17:00', lateAfter: '08:30', graceMinutes: 30, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.currentLocation.mockResolvedValue({ latitude: -1.28, longitude: 36.82, accuracy: 20 });
  api.loadClockRules.mockResolvedValue({ policy: 'anywhere', arrangement: 'on_site', mode: 'anywhere', wantsLocation: false });
});
afterEach(cleanup);

describe('ClockCard', () => {
  it("shows today's schedule and clocks in with the location", async () => {
    api.loadToday.mockResolvedValue(today());
    api.clockIn.mockResolvedValue(today({ status: 'present', clockIn: '2026-10-22T05:05:00Z' }));
    render(<ClockCard />);
    expect(await screen.findByText('Expected 8:00 am · late after 8:30 am')).toBeTruthy();
    expect(screen.getByText("You haven't clocked in today.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Clock in$/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Working remotely today' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Clock in$/ }));
    await waitFor(() => expect(api.clockIn).toHaveBeenCalledWith({ latitude: -1.28, longitude: 36.82, accuracy: 20 }, 'Working remotely today'));
    expect(await screen.findByText('8:05 am')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Clock out/ })).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Clocked in at 8:05 am');
  });

  it('carries on without a location when the person says no', async () => {
    api.currentLocation.mockResolvedValue(null);
    api.loadToday.mockResolvedValue(today());
    api.clockIn.mockResolvedValue(today({ status: 'present', clockIn: '2026-10-22T05:05:00Z' }));
    render(<ClockCard />);
    fireEvent.click(await screen.findByRole('button', { name: /^Clock in$/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Working remotely today' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Clock in$/ }));
    await waitFor(() => expect(api.clockIn).toHaveBeenCalledWith(null, 'Working remotely today'));
  });

  it('shows Late, the minutes late and hours so far while clocked in', async () => {
    api.loadToday.mockResolvedValue(today({ status: 'late', clockIn: new Date(Date.now() - 90 * 60_000).toISOString(), lateMinutes: 40 }));
    render(<ClockCard />);
    expect(await screen.findByText('Late')).toBeTruthy();
    expect(screen.getByText('40 min late')).toBeTruthy();
    expect(screen.getByText('Hours so far')).toBeTruthy();
    expect(screen.getByText('1h 30m')).toBeTruthy();
  });

  it("after clocking out offers to clock in again, and shows the database's refusal", async () => {
    api.loadToday.mockResolvedValue(today({ status: 'present', clockIn: '2026-10-22T05:00:00Z', clockOut: '2026-10-22T14:00:00Z' }));
    api.clockIn.mockRejectedValue(new Error('Something went wrong'));
    render(<ClockCard />);
    expect(await screen.findByText('9h 00m')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Clock in again/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Working remotely today' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Clock in$/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Something went wrong'));
  });

  it('says so on a day off', async () => {
    api.loadToday.mockResolvedValue(today({ status: 'off', workingDay: false }));
    render(<ClockCard />);
    expect(await screen.findByText('Not a working day for you')).toBeTruthy();
  });

  it('explains when the account has no employee record', async () => {
    api.loadToday.mockRejectedValue(new Error("Your account isn't linked to an employee record, so attendance can't be recorded. Please contact HR."));
    render(<ClockCard />);
    expect(await screen.findByText(/isn't linked to an employee record/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Clock in/ })).toBeNull();
  });

  it('keeps a clock-in refusal on the card, with the reason', async () => {
    api.loadClockRules.mockResolvedValue({ policy: 'office', arrangement: 'on_site', mode: 'office', wantsLocation: true });
    api.loadToday.mockResolvedValue(today());
    api.clockIn.mockRejectedValue(new Error("Clock in from the office, or ask HR. You're 2.4 km from Nairobi."));
    render(<ClockCard />);
    fireEvent.click(await screen.findByRole('button', { name: /^Clock in$/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Working remotely today' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Clock in$/ }));
    expect((await screen.findByRole('alert')).textContent).toBe("Clock in from the office, or ask HR. You're 2.4 km from Nairobi.");
    expect(toast.error).toHaveBeenCalledWith("Clock in from the office, or ask HR. You're 2.4 km from Nairobi.");
  });

  it("scanner only: no Clock in button, it says to use the scanner; a scanner day can't be clocked out here", async () => {
    api.loadClockRules.mockResolvedValue({ policy: 'scanner_only', arrangement: 'on_site', mode: 'scanner', wantsLocation: false });
    api.loadToday.mockResolvedValue(today());
    render(<ClockCard />);
    expect(await screen.findByText('Clock in at the office scanner.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Clock in/ })).toBeNull();
    cleanup();
    api.loadToday.mockResolvedValue(today({ status: 'present', clockIn: new Date(Date.now() - 60 * 60_000).toISOString(), source: 'scanner' }));
    render(<ClockCard />);
    expect(await screen.findByText('Clock out at the office scanner.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Clock out/ })).toBeNull();
  });

  it('a field worker at a scanner-only company still clocks in from the app', async () => {
    api.loadClockRules.mockResolvedValue({ policy: 'scanner_only', arrangement: 'field', mode: 'anywhere', wantsLocation: true });
    api.loadToday.mockResolvedValue(today());
    render(<ClockCard />);
    expect(await screen.findByRole('button', { name: /Clock in/ })).toBeTruthy();
  });

  it("a scanner's last scan before the end of the day is \"Last scan\", with hours so far and Clock out still offered", async () => {
    const clockInAt = new Date(Date.now() - 120 * 60_000).toISOString();
    api.loadToday.mockResolvedValue(today({
      date: nairobiToday(), status: 'present', clockIn: clockInAt, clockOut: new Date(Date.now() - 30 * 60_000).toISOString(),
      clockOutVia: 'scanner', source: 'scanner', endTime: '23:59',
    }));
    render(<ClockCard />);
    expect(await screen.findByText('Last scan')).toBeTruthy();
    expect(screen.getByText('Hours so far')).toBeTruthy();
    expect(screen.getByText('2h 00m')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Clock out/ })).toBeTruthy();
  });

  it('after the end time (or an app clock-out) the last scan is the clock-out', async () => {
    api.loadToday.mockResolvedValue(today({
      date: nairobiToday(), status: 'present', clockIn: '2026-10-22T05:00:00Z', clockOut: '2026-10-22T13:00:00Z',
      clockOutVia: 'scanner', source: 'scanner', endTime: '00:00',
    }));
    render(<ClockCard />);
    expect(await screen.findByText('Clocked out')).toBeTruthy();
    expect(screen.getByText('8h 00m')).toBeTruthy();
  });
});
