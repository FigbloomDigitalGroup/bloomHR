import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AttendanceToday } from '../../lib/attendance';

const api = vi.hoisted(() => ({
  loadToday: vi.fn(),
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  currentLocation: vi.fn(),
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
});
afterEach(cleanup);

describe('ClockCard', () => {
  it('shows today’s schedule and clocks in with the location', async () => {
    api.loadToday.mockResolvedValue(today());
    api.clockIn.mockResolvedValue(today({ status: 'present', clockIn: '2026-10-22T05:05:00Z' }));
    render(<ClockCard />);
    expect(await screen.findByText('Expected 8:00 am · late after 8:30 am')).toBeTruthy();
    expect(screen.getByText("You haven't clocked in today.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Clock in/ }));
    await waitFor(() => expect(api.clockIn).toHaveBeenCalledWith({ latitude: -1.28, longitude: 36.82, accuracy: 20 }));
    expect(await screen.findByText('8:05 am')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Clock out/ })).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Clocked in at 8:05 am');
  });

  it('carries on without a location when the person says no', async () => {
    api.currentLocation.mockResolvedValue(null);
    api.loadToday.mockResolvedValue(today());
    api.clockIn.mockResolvedValue(today({ status: 'present', clockIn: '2026-10-22T05:05:00Z' }));
    render(<ClockCard />);
    fireEvent.click(await screen.findByRole('button', { name: /Clock in/ }));
    await waitFor(() => expect(api.clockIn).toHaveBeenCalledWith(null));
  });

  it('shows Late, the minutes late and hours so far while clocked in', async () => {
    api.loadToday.mockResolvedValue(today({ status: 'late', clockIn: new Date(Date.now() - 90 * 60_000).toISOString(), lateMinutes: 40 }));
    render(<ClockCard />);
    expect(await screen.findByText('Late')).toBeTruthy();
    expect(screen.getByText('40 min late')).toBeTruthy();
    expect(screen.getByText('Hours so far')).toBeTruthy();
    expect(screen.getByText('1h 30m')).toBeTruthy();
  });

  it('after clocking out offers to clock in again, and shows the database’s refusal', async () => {
    api.loadToday.mockResolvedValue(today({ status: 'present', clockIn: '2026-10-22T05:00:00Z', clockOut: '2026-10-22T14:00:00Z' }));
    api.clockIn.mockRejectedValue(new Error('Something went wrong'));
    render(<ClockCard />);
    expect(await screen.findByText('9h 00m')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Clock in again/ }));
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
});
