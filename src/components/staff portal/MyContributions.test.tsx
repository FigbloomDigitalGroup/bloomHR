import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Contribution } from '../../lib/contributions';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  request: vi.fn(),
  stop: vi.fn(),
  open: vi.fn(),
  confirm: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('../../lib/contributionsApi', () => ({
  loadContributions: mocks.load,
  requestContribution: mocks.request,
  stopContribution: mocks.stop,
  openContributionDocument: mocks.open,
}));
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: mocks.confirm }));
vi.mock('react-hot-toast', () => ({ default: { success: mocks.toastSuccess, error: mocks.toastError } }));

import MyContributions from './MyContributions';
import { periodOf } from '../../lib/contributions';

const NOW = periodOf();
const base: Contribution = {
  id: 'c1', employee_number: 'E1', employee_name: 'Mia Me', kind: 'sacco', amount: 2000, start_period: '2026-10', end_period: null,
  provider: 'Stima Sacco', reference: 'M-123', note: null, document_path: null, status: 'active', decline_reason: null, decided_at: null,
  stopped_at: null, stop_period: null, applied_amount: 0, created_at: '2026-10-01T00:00:00Z', next_payroll_period: '2026-11',
};

beforeEach(() => {
  mocks.load.mockReset();
  mocks.request.mockReset().mockResolvedValue(undefined);
  mocks.stop.mockReset().mockResolvedValue(undefined);
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
});
afterEach(() => cleanup());

describe('My contributions (FIG-898)', () => {
  it('shows what is running and the requests, with their status and reason', async () => {
    mocks.load.mockResolvedValue([
      base,
      { ...base, id: 'c2', kind: 'insurance_premium', provider: 'Jubilee', amount: 4000, status: 'declined', decline_reason: 'Policy is not on your life' },
      { ...base, id: 'c3', kind: 'pension_avc', provider: null, amount: 1500, status: 'pending' },
    ]);
    render(<MyContributions />);
    expect(await screen.findByText(/SACCO · Stima Sacco · KSh 2,000 a month/)).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Declined')).toBeTruthy();
    expect(screen.getByText('Reason: Policy is not on your life')).toBeTruthy();
    expect(screen.getByText('Waiting for payroll')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });

  it('asks for a contribution: checks the form, explains the tax effect, sends it', async () => {
    mocks.load.mockResolvedValue([]);
    render(<MyContributions />);
    expect(await screen.findByText('None yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add a contribution/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to payroll' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Choose what kind/);
    expect(mocks.request).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'insurance_premium' } });
    expect(screen.getByTestId('contribution-effect').textContent).toMatch(/Not taken from your pay/);
    fireEvent.change(screen.getByLabelText('Amount a month (KSh)'), { target: { value: '3,000' } });
    fireEvent.change(screen.getByLabelText(/Provider/), { target: { value: 'Jubilee' } });
    fireEvent.change(screen.getByLabelText('Member, policy or account number'), { target: { value: 'POL-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to payroll' }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalled());
    expect(mocks.request.mock.calls[0][0]).toMatchObject({ kind: 'insurance_premium', amount: '3,000', start_period: NOW, provider: 'Jubilee', reference: 'POL-9' });
    expect(mocks.request.mock.calls[0][1]).toBeNull();
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  });

  it('stops a running contribution after confirming', async () => {
    mocks.load.mockResolvedValue([base]);
    render(<MyContributions />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith('c1'));
    expect(mocks.confirm.mock.calls[0][0].message).toMatch(/stops from November 2026/);
  });

  it('shows the reason from the database when sending fails', async () => {
    mocks.load.mockResolvedValue([]);
    mocks.request.mockRejectedValue(new Error('You already have a sacco request waiting for payroll'));
    render(<MyContributions />);
    fireEvent.click(await screen.findByRole('button', { name: /Add a contribution/ }));
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'sacco' } });
    fireEvent.change(screen.getByLabelText('Amount a month (KSh)'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to payroll' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('You already have a sacco request waiting for payroll'));
  });
});
