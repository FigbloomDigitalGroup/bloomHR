import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../lib/salaryAdvanceApi', () => ({
  loadAdvanceQueue: vi.fn(),
  loadPayees: vi.fn(),
  approveAdvance: vi.fn(),
  declineAdvance: vi.fn(),
  markAdvancePaid: vi.fn(),
}));
// the real client must never be reached from the queue (it goes through salaryAdvanceApi)
vi.mock('../../lib/supabase', () => ({ supabase: new Proxy({}, { get: () => { throw new Error('supabase used'); } }) }));

import * as api from '../../lib/salaryAdvanceApi';
import AdvanceQueue from './AdvanceQueue';

const mocked = vi.mocked(api);
const asked = new Date().toISOString();
const ROWS = [
  { id: 'p1', 'Employee Number': 'E1', 'Full Name': 'Jane Wanjiru', 'Amount Requested': 5000, status: 'Pending', time_added: asked },
  { id: 'a1', 'Employee Number': 'E2', 'Full Name': 'Peter Otieno', 'Amount Requested': 4000, status: 'approved', time_added: asked },
  { id: 'a2', 'Employee Number': 'E3', 'Full Name': 'Mary Akinyi', 'Amount Requested': 3000, status: 'approved', time_added: asked },
];
const PAYEES = {
  E1: { 'First Name': 'Jane', 'Last Name': 'Wanjiru', payment_method: 'M-Pesa', 'Mobile Number': '0712345678' },
  E2: { 'First Name': 'Peter', 'Last Name': 'Otieno', payment_method: 'M-Pesa', 'Mobile Number': '0712345678' },
  E3: { 'First Name': 'Mary', 'Last Name': 'Akinyi', payment_method: 'M-Pesa', 'Mobile Number': '' },
};

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocked.loadAdvanceQueue.mockResolvedValue(ROWS);
  mocked.loadPayees.mockResolvedValue(PAYEES);
  for (const f of [mocked.approveAdvance, mocked.declineAdvance, mocked.markAdvancePaid]) f.mockResolvedValue(undefined);
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = () => render(<AdvanceQueue canDecide demoDelayMs={20} />);
const card = (id: string) => screen.getByTestId(`advance-${id}`);

describe('the advance queue', () => {
  it('approves a pending request', async () => {
    show();
    await screen.findByText('Jane Wanjiru');
    fireEvent.click(within(card('p1')).getByRole('button', { name: 'Approve' }));
    await vi.waitFor(() => expect(mocked.approveAdvance).toHaveBeenCalledWith('p1'));
  });

  it('declines only with a reason', async () => {
    show();
    await screen.findByText('Jane Wanjiru');
    fireEvent.click(within(card('p1')).getByRole('button', { name: 'Decline' }));
    const dialog = screen.getByRole('dialog', { name: 'Decline advance' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/reason/);
    expect(mocked.declineAdvance).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Over the limit' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    await vi.waitFor(() => expect(mocked.declineAdvance).toHaveBeenCalledWith('p1', 'Over the limit'));
  });

  it('demo pay: confirms, simulates the send, and saves or sends nothing', async () => {
    show();
    await screen.findByText('Jane Wanjiru');
    fireEvent.click(screen.getByRole('button', { name: /Approved \(2\)/ }));
    fireEvent.click(within(card('a1')).getByRole('button', { name: /Pay advance/ }));
    const dialog = screen.getByRole('dialog', { name: 'Pay advance' });
    expect(within(dialog).getByText('Demo mode — no money moves')).toBeTruthy();
    expect(within(dialog).getByText('M-Pesa 0712 *** 678')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay KSh 4,000' }));
    expect(await within(dialog).findByText('Advance of KSh 4,000 sent to Peter Otieno (M-Pesa 0712 *** 678)')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocked.markAdvancePaid).not.toHaveBeenCalled();
    expect(mocked.approveAdvance).not.toHaveBeenCalled();
    expect(mocked.loadAdvanceQueue).toHaveBeenCalledTimes(1);
  });

  it('demo pay: a missing M-Pesa number is an error and blocks paying', async () => {
    show();
    await screen.findByText('Jane Wanjiru');
    fireEvent.click(screen.getByRole('button', { name: /Approved \(2\)/ }));
    fireEvent.click(within(card('a2')).getByRole('button', { name: /Pay advance/ }));
    const dialog = screen.getByRole('dialog', { name: 'Pay advance' });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/No M-Pesa number/);
    const pay = within(dialog).getByRole('button', { name: 'Pay KSh 3,000' }) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    fireEvent.click(pay);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocked.markAdvancePaid).not.toHaveBeenCalled();
  });

  it('mark as paid records the real payment, showing what payroll will take back', async () => {
    show();
    await screen.findByText('Jane Wanjiru');
    fireEvent.click(screen.getByRole('button', { name: /Approved \(2\)/ }));
    fireEvent.click(within(card('a1')).getByRole('button', { name: 'Mark as paid' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark as paid' });
    expect(within(dialog).getByText(/KSh 4,000 off .* pay/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as paid' }));
    await vi.waitFor(() => expect(mocked.markAdvancePaid).toHaveBeenCalledWith('a1'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the queue without actions to those who may not decide', async () => {
    render(<AdvanceQueue canDecide={false} />);
    await screen.findByText('Jane Wanjiru');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});
