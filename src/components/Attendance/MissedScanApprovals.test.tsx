import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MissedScan } from '../../lib/missedScanApi';

const api = vi.hoisted(() => ({
  loadMissedScans: vi.fn(),
  decideMissedScan: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/missedScanApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/missedScanApi')>()),
  ...api,
}));

import MissedScanApprovals from './MissedScanApprovals';

const request = (over: Partial<MissedScan> = {}): MissedScan => ({
  id: 'r1', employeeNumber: 'E1', employeeName: 'Given Otieno', day: '2026-10-22', cameInAt: '2026-10-22T04:59:00Z', leftAt: null,
  reason: 'forgot to scan', status: 'pending', approver: 'manager', managerNumber: 'E-LEAD', managerName: 'Mary Kamau',
  createdAt: '2026-10-22T08:00:00Z', decidedAt: null, decidedByName: null, comment: null, canDecide: true, mine: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.decideMissedScan.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Missed scans waiting', () => {
  it('lists only what the person may decide, and approves in one tap', async () => {
    api.loadMissedScans.mockResolvedValueOnce([
      request(),
      request({ id: 'r2', employeeNumber: 'E-ME', employeeName: 'Me Myself', canDecide: false, mine: true }),
    ]).mockResolvedValue([]);
    render(<MissedScanApprovals />);
    const list = await screen.findByRole('list', { name: 'Missed scans waiting' });
    expect(api.loadMissedScans).toHaveBeenCalledWith({ status: 'pending' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toMatch(/Given Otieno.*came in 7:59 am.*"forgot to scan".*Sent to Mary Kamau/);
    fireEvent.click(screen.getByRole('button', { name: "Approve Given Otieno's missed scan" }));
    await waitFor(() => expect(api.decideMissedScan).toHaveBeenCalledWith('r1', 'approve', undefined));
    expect(toast.success).toHaveBeenCalledWith("Approved: Given Otieno's day is corrected");
    expect(await screen.findByText('No missed scans waiting')).toBeTruthy();
  });

  it('declining needs a comment', async () => {
    api.loadMissedScans.mockResolvedValue([request({ approver: 'hr', managerName: null, managerNumber: null })]);
    render(<MissedScanApprovals />);
    fireEvent.click(await screen.findByRole('button', { name: "Decline Given Otieno's missed scan" }));
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Add a comment/);
    expect(api.decideMissedScan).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Why it is declined'), { target: { value: 'You were at the bank' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(api.decideMissedScan).toHaveBeenCalledWith('r1', 'decline', 'You were at the bank'));
  });

  it('shows the database’s refusal on the request', async () => {
    api.loadMissedScans.mockResolvedValue([request()]);
    api.decideMissedScan.mockRejectedValue(new Error("You can't decide your own request"));
    render(<MissedScanApprovals />);
    fireEvent.click(await screen.findByRole('button', { name: "Approve Given Otieno's missed scan" }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/your own request/);
  });

  it('says when nothing is waiting', async () => {
    api.loadMissedScans.mockResolvedValue([]);
    render(<MissedScanApprovals />);
    expect(await screen.findByText('No missed scans waiting')).toBeTruthy();
  });
});
