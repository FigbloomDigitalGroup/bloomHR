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
  it('shows the limit and blocks an amount over it', async () => {
    render(<AdvanceRequest />);
    expect(await screen.findByText('KSh 10,000')).toBeTruthy();
    fireEvent.change(amount(), { target: { value: '12000' } });
    expect(screen.getByRole('alert').textContent).toMatch(/most you can ask for is KSh 10,000/);
    fireEvent.change(reason(), { target: { value: 'School fees for next term' } });
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    expect(mocked.requestAdvance).not.toHaveBeenCalled();
  });

  it('needs a reason', async () => {
    render(<AdvanceRequest />);
    await screen.findByText('KSh 10,000');
    fireEvent.change(amount(), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 10 characters/);
    expect(mocked.requestAdvance).not.toHaveBeenCalled();
  });

  it('sends a request spread over months, with the monthly part shown first', async () => {
    render(<AdvanceRequest />);
    await screen.findByText('KSh 10,000');
    fireEvent.change(amount(), { target: { value: '9000' } });
    fireEvent.change(reason(), { target: { value: 'School fees for next term' } });
    fireEvent.click(screen.getByLabelText(/Spread over months/));
    fireEvent.change(screen.getByLabelText('Number of months'), { target: { value: '3' } });
    expect(screen.getByTestId('advance-plan').textContent).toMatch(/KSh 3,000 a month/);
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    await vi.waitFor(() => expect(mocked.requestAdvance).toHaveBeenCalledWith(ME, { amount: 9000, reason: 'School fees for next term', months: 3 }));
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
