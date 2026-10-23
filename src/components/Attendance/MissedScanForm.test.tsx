import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { addDays, nairobiToday } from '../../lib/attendance';
import { missedScanDays, missedScanLine, missedScanProblem, type MissedScan } from '../../lib/missedScanApi';

const api = vi.hoisted(() => ({
  loadMissedScanRules: vi.fn(),
  requestMissedScan: vi.fn(),
  loadMissedScans: vi.fn(),
  cancelMissedScan: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/missedScanApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/missedScanApi')>()),
  ...api,
}));

import MyMissedScans from './MyMissedScans';

const today = nairobiToday();
const yesterday = addDays(today, -1);
const request = (over: Partial<MissedScan> = {}): MissedScan => ({
  id: 'r1', employeeNumber: 'E1', employeeName: 'Given Otieno', day: yesterday, cameInAt: `${yesterday}T04:59:00Z`, leftAt: null,
  reason: 'forgot to scan', status: 'pending', approver: 'manager', managerNumber: 'E-LEAD', managerName: 'Mary Kamau',
  createdAt: `${today}T05:00:00Z`, decidedAt: null, decidedByName: null, comment: null, canDecide: false, mine: true, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.loadMissedScanRules.mockResolvedValue({ daysBack: 2, approver: 'manager', approverName: 'Mary Kamau' });
  api.requestMissedScan.mockResolvedValue(undefined);
  api.loadMissedScans.mockResolvedValue([]);
  api.cancelMissedScan.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Forgot to scan?', () => {
  it('offers today and the days back the company allows, says who approves, and sends the request', async () => {
    render(<MyMissedScans />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot to scan?' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/It goes to Mary Kamau for approval/)).toBeTruthy();
    const options = within(dialog).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Today', 'Yesterday', expect.any(String)]);

    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: yesterday } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/came in or the time you left/);
    fireEvent.change(within(dialog).getByLabelText('Came in'), { target: { value: '07:59' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Say why/);
    expect(api.requestMissedScan).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'forgot to scan' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(api.requestMissedScan).toHaveBeenCalledWith({ day: yesterday, cameIn: '07:59', left: '', reason: 'forgot to scan' })
    );
    expect(toast.success).toHaveBeenCalledWith('Sent to Mary Kamau for approval');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the database’s refusal in the form', async () => {
    api.requestMissedScan.mockRejectedValue(new Error('You already have a request waiting for that day: cancel it to send a new one'));
    render(<MyMissedScans />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot to scan?' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/Mary Kamau/);
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: yesterday } });
    fireEvent.change(within(dialog).getByLabelText('Left'), { target: { value: '17:10' } });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'scanner off' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/already have a request waiting/);
  });

  it('lists the person’s own requests: waiting ones can be cancelled, decided ones say who decided', async () => {
    api.loadMissedScans.mockResolvedValue([
      request(),
      request({ id: 'r2', day: addDays(today, -3), status: 'declined', decidedByName: 'HR Hana', comment: 'At the bank' }),
      request({ id: 'r3', status: 'pending', mine: false, employeeName: 'Someone else' }),
    ]);
    render(<MyMissedScans />);
    const list = await screen.findByRole('list', { name: 'Your missed-scan requests' });
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/Waiting.*Yesterday: came in 7:59 am · waiting for Mary Kamau/);
    expect(items[1]).toMatch(/Declined.*came in 7:59 am · by HR Hana · "At the bank"/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel missed-scan request for Yesterday' }));
    await waitFor(() => expect(api.cancelMissedScan).toHaveBeenCalledWith('r1'));
  });
});

describe('the helpers', () => {
  it('days back: today and that many before it', () => {
    expect(missedScanDays(0, '2026-10-23')).toEqual(['2026-10-23']);
    expect(missedScanDays(2, '2026-10-23')).toEqual(['2026-10-23', '2026-10-22', '2026-10-21']);
  });

  it('checks a request before it is sent', () => {
    const now = new Date('2026-10-23T09:00:00Z'); // 12:00 in Nairobi
    const ok = { day: '2026-10-23', cameIn: '07:59', left: '', reason: 'forgot' };
    expect(missedScanProblem(ok, now)).toBeNull();
    expect(missedScanProblem({ ...ok, left: '07:00' }, now)).toMatch(/after the time you came in/);
    expect(missedScanProblem({ ...ok, cameIn: '13:00' }, now)).toMatch(/hasn't happened yet/);
  });

  it('the day’s history line', () => {
    expect(missedScanLine(request({ cameInAt: '2026-10-22T04:59:00Z', status: 'approved', decidedByName: 'Mary Kamau' })))
      .toBe("Missed scan, approved by Mary Kamau: came in 7:59 am, 'forgot to scan'.");
    expect(missedScanLine(request({ cameInAt: null, leftAt: '2026-10-22T14:10:00Z', approver: 'hr', managerName: null })))
      .toBe("Missed scan, waiting for HR: left 5:10 pm, 'forgot to scan'.");
  });
});
