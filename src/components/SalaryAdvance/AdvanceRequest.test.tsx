import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../lib/salaryAdvanceApi', () => ({
  loadMyEmployee: vi.fn(),
  loadAdvanceWindow: vi.fn(),
  loadMyAdvances: vi.fn(),
  requestAdvance: vi.fn(),
  watchMyAdvances: vi.fn(() => () => {}),
}));

import * as api from '../../lib/salaryAdvanceApi';
import AdvanceRequest from './AdvanceRequest';

const mocked = vi.mocked(api);
const ME = { employeeNumber: 'E1', fullName: 'Jane Wanjiru', office: 'Nairobi', basicSalary: '50000', terminated: false };
const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 3, 12).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mocked.loadMyEmployee.mockResolvedValue(ME);
  mocked.loadAdvanceWindow.mockResolvedValue({ open: true, message: '' });
  mocked.loadMyAdvances.mockResolvedValue([]);
  mocked.requestAdvance.mockResolvedValue(undefined);
});
afterEach(cleanup);

const amount = () => screen.getByLabelText('Amount (KSh)');
const reason = () => screen.getByLabelText('Reason');

describe('asking for an advance', () => {
  it('has no limit: any amount is sent, to come off the next pay in full', async () => {
    render(<AdvanceRequest />);
    await screen.findByText('The whole amount comes off your next pay.');
    expect(screen.queryByText(/20%/)).toBeNull();
    fireEvent.change(amount(), { target: { value: '120000' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('advance-plan').textContent).toMatch(/^KSh 120,000 comes off the next pay in full/);
    // nothing to spread it over
    expect(screen.queryByLabelText(/Spread over months/)).toBeNull();
    expect(screen.queryByLabelText('Number of months')).toBeNull();
    fireEvent.change(reason(), { target: { value: 'School fees for next term' } });
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    await vi.waitFor(() => expect(mocked.requestAdvance).toHaveBeenCalledWith(ME, { amount: 120000, reason: 'School fees for next term' }));
  });

  it('needs a reason', async () => {
    render(<AdvanceRequest />);
    await screen.findByText('The whole amount comes off your next pay.');
    fireEvent.change(amount(), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 10 characters/);
    expect(mocked.requestAdvance).not.toHaveBeenCalled();
  });

  it('cannot ask while requests are closed', async () => {
    mocked.loadAdvanceWindow.mockResolvedValue({ open: false, message: 'Closed until the 1st.' });
    render(<AdvanceRequest />);
    expect(await screen.findByText('Closed until the 1st.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Send request/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists requests with where they stand, and the reason for a decline', async () => {
    mocked.loadMyAdvances.mockResolvedValue([
      { id: 'a1', 'Amount Requested': 6000, status: 'paid', payment_processed: 'true', repayment_months: 3, time_added: lastMonth },
      { id: 'a2', 'Amount Requested': 2000, status: 'rejected', admin_notes: 'Still repaying the last one', time_added: lastMonth },
    ]);
    render(<AdvanceRequest />);
    expect(await screen.findByText('KSh 2,000 of KSh 6,000 repaid')).toBeTruthy();
    // the pill and the current step of the timeline
    expect(screen.getAllByText('Repaying')).toHaveLength(2);
    expect(screen.getByText('Still repaying the last one')).toBeTruthy();
  });
});
