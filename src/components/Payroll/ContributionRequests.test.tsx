import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Contribution } from '../../lib/contributions';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  decide: vi.fn(),
  stop: vi.fn(),
  sync: vi.fn(),
  open: vi.fn(),
  confirm: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../../lib/contributionsApi', () => ({
  loadContributions: mocks.load,
  decideContribution: mocks.decide,
  stopContribution: mocks.stop,
  syncContributions: mocks.sync,
  openContributionDocument: mocks.open,
}));
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: mocks.confirm }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: mocks.toastError } }));

import ContributionRequests from './ContributionRequests';

const base: Contribution = {
  id: 'c1', employee_number: 'E1', employee_name: 'Mia Me', kind: 'pension_avc', amount: 1500, start_period: '2026-11', end_period: null,
  provider: 'Zamara', reference: 'Z-1', note: 'Top-up', document_path: 't/u/contribution_x.pdf', status: 'pending', decline_reason: null,
  decided_at: null, stopped_at: null, stop_period: null, applied_amount: 0, created_at: '2026-10-01T00:00:00Z', next_payroll_period: '2026-11',
};

beforeEach(() => {
  mocks.load.mockReset();
  mocks.decide.mockReset().mockResolvedValue(undefined);
  mocks.stop.mockReset().mockResolvedValue(undefined);
  mocks.sync.mockReset().mockResolvedValue(undefined);
  mocks.open.mockReset().mockResolvedValue(undefined);
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.toastError.mockReset();
});
afterEach(() => cleanup());

describe('Contribution requests for payroll (FIG-898)', () => {
  it('shows nothing when nobody has asked', async () => {
    mocks.load.mockResolvedValue([]);
    const { container } = render(<ContributionRequests />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(mocks.sync).toHaveBeenCalled();
  });

  it('lists a request with where it goes in payroll, and approves it', async () => {
    mocks.load.mockResolvedValue([base]);
    const changed = vi.fn();
    render(<ContributionRequests onChanged={changed} />);
    expect(await screen.findByText('Mia Me')).toBeTruthy();
    expect(screen.getByText(/\(1 to review\)/)).toBeTruthy();
    expect(screen.getByText("Adds to the employee's pension contribution")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Document/ }));
    expect(mocks.open).toHaveBeenCalledWith('t/u/contribution_x.pdf');
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith('c1', true));
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it('declining needs a reason', async () => {
    mocks.load.mockResolvedValue([base]);
    render(<ContributionRequests />);
    fireEvent.click(await screen.findByRole('button', { name: /Decline/ }));
    const confirm = () => screen.getAllByRole('button', { name: 'Decline' }).at(-1) as HTMLElement;
    fireEvent.click(confirm());
    expect(mocks.toastError).toHaveBeenCalledWith('Give the employee a reason.');
    expect(mocks.decide).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason for the employee'), { target: { value: 'Scheme not registered' } });
    fireEvent.click(confirm());
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith('c1', false, 'Scheme not registered'));
  });

  it('running ones can be stopped', async () => {
    mocks.load.mockResolvedValue([{ ...base, status: 'active', kind: 'sacco' }]);
    render(<ContributionRequests />);
    expect(await screen.findByText('Nothing to review.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Running' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith('c1'));
  });
});
