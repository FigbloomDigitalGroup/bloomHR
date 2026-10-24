import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../lib/salaryAdvanceApi', () => ({
  loadAdvanceQueue: vi.fn(),
  approveAdvance: vi.fn(),
  declineAdvance: vi.fn(),
}));
// finance (the 'payments' module) records the payment in Payments to make
const perms = { modules: ['salaryadmin', 'payments'] };
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => perms.modules.includes(p), loading: false }),
}));
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
// a request's approval chain (20261025700000): none by default, so these decide directly as before
const chains: { value: Record<string, unknown> } = { value: {} };
vi.mock('../../lib/approvals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/approvals')>()),
  decideApproval: vi.fn(async () => 'approved'),
  loadApprovalChains: vi.fn(async () => chains.value),
}));
// the real client must never be reached from the queue (it goes through salaryAdvanceApi)
vi.mock('../../lib/supabase', () => ({ supabase: new Proxy({}, { get: () => { throw new Error('supabase used'); } }) }));

import * as api from '../../lib/salaryAdvanceApi';
import * as approvals from '../../lib/approvals';
import AdvanceQueue from './AdvanceQueue';

const mocked = vi.mocked(api);
const asked = new Date().toISOString();
const ROWS = [
  { id: 'p1', 'Employee Number': 'E1', 'Full Name': 'Jane Wanjiru', 'Amount Requested': 5000, status: 'Pending', time_added: asked },
  { id: 'a1', 'Employee Number': 'E2', 'Full Name': 'Peter Otieno', 'Amount Requested': 4000, status: 'approved', time_added: asked },
  { id: 'a2', 'Employee Number': 'E3', 'Full Name': 'Mary Akinyi', 'Amount Requested': 3000, status: 'approved', time_added: asked },
];

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  chains.value = {};
  perms.modules = ['salaryadmin', 'payments'];
  mocked.loadAdvanceQueue.mockResolvedValue(ROWS);
  for (const f of [mocked.approveAdvance, mocked.declineAdvance]) f.mockResolvedValue(undefined);
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = () => render(<AdvanceQueue canDecide />);
const card = (id: string) => screen.getByTestId(`advance-${id}`);

const chainFor = (canDecide: boolean) => ({
  record_id: 'p1', request_id: 'q1', status: 'pending', current_step: 1, can_approve: canDecide, can_reject: canDecide,
  steps: [{ position: 1, label: 'Line manager', approver_type: 'reports_to', status: 'current', waiting_on: 'Max Manager',
            actor_name: null, acted_as: null, comment: null, acted_at: null }],
});

describe('the advance queue', () => {
  it('a request on an approval chain is decided through it, and its chain shows', async () => {
    chains.value = { p1: chainFor(true) };
    show();
    await screen.findByText('Jane Wanjiru');
    expect(within(card('p1')).getByText(/Line manager/)).toBeTruthy();
    fireEvent.click(within(card('p1')).getByRole('button', { name: 'Approve' }));
    await vi.waitFor(() => expect(vi.mocked(approvals.decideApproval)).toHaveBeenCalledWith('q1', 'approved', ''));
    expect(mocked.approveAdvance).not.toHaveBeenCalled();
  });

  it('on a chain, only its step’s approvers get the buttons, whatever the screen allows', async () => {
    chains.value = { p1: chainFor(false) };
    show();
    await screen.findByText('Jane Wanjiru');
    expect(within(card('p1')).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(card('p1')).queryByRole('button', { name: 'Decline' })).toBeNull();
  });

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

  it('an approved advance is paid from Payments to make: finance gets the way there, nothing is paid here', async () => {
    show();
    await screen.findByText('Jane Wanjiru');
    fireEvent.click(screen.getByRole('button', { name: /Approved \(2\)/ }));
    expect(within(card('a1')).queryByRole('button', { name: /Mark as paid|Pay advance/ })).toBeNull();
    fireEvent.click(within(card('a1')).getByRole('button', { name: 'Record payment' }));
    expect(navigate).toHaveBeenCalledWith('/payments');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('without the payments module, an approved advance says finance pays it', async () => {
    perms.modules = ['salaryadmin'];
    show();
    await screen.findByText('Jane Wanjiru');
    fireEvent.click(screen.getByRole('button', { name: /Approved \(2\)/ }));
    expect(within(card('a1')).queryByRole('button', { name: 'Record payment' })).toBeNull();
    expect(within(card('a1')).getByText(/Waiting for finance to pay it/)).toBeTruthy();
  });

  it('shows the queue without actions to those who may not decide', async () => {
    render(<AdvanceQueue canDecide={false} />);
    await screen.findByText('Jane Wanjiru');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});
