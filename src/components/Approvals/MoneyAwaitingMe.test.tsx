import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../lib/approvals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/approvals')>()),
  loadMoneyAwaitingMe: vi.fn(),
  loadApprovalChains: vi.fn(),
  decideApproval: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: new Proxy({}, { get: () => { throw new Error('supabase used'); } }) }));

import * as approvals from '../../lib/approvals';
import MoneyAwaitingMe from './MoneyAwaitingMe';

const mocked = vi.mocked(approvals);
const chain = (record: string, request: string) => ({
  record_id: record, request_id: request, status: 'pending' as const, current_step: 1, can_approve: true, can_reject: true,
  steps: [{ position: 1, label: 'Line manager', approver_type: 'reports_to' as const, status: 'current' as const, waiting_on: 'Max Manager',
            actor_name: null, acted_as: null, comment: null, acted_at: null }],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocked.loadMoneyAwaitingMe.mockResolvedValue([
    { request_id: 'q1', kind: 'loan', record_id: 'l1', employee_number: 'E1', summary: "Esther One's loan request of KES 30,000.00 over 6 months",
      step_label: 'Line manager', created_at: '2026-10-23T08:00:00Z' },
    { request_id: 'q2', kind: 'requisition', record_id: 'r1', employee_number: 'E2', summary: "Eric Two's requisition of KES 900.00 to Eric Two for Bus fare",
      step_label: 'Line manager', created_at: '2026-10-23T09:00:00Z' },
  ]);
  mocked.loadApprovalChains.mockImplementation(async (kind): Promise<Record<string, approvals.ApprovalChain>> =>
    kind === 'loan' ? { l1: chain('l1', 'q1') } : { r1: chain('r1', 'q2') });
  mocked.decideApproval.mockResolvedValue('approved');
});
afterEach(cleanup);

describe('money requests waiting on me (staff portal)', () => {
  it('lists each with what it is, and approves through its chain', async () => {
    render(<MoneyAwaitingMe />);
    const loan = await screen.findByTestId('money-awaiting-q1');
    expect(within(loan).getByText(/Loan request · Line manager/)).toBeTruthy();
    expect(within(loan).getByText("Esther One's loan request of KES 30,000.00 over 6 months")).toBeTruthy();
    expect(screen.getByTestId('money-awaiting-q2')).toBeTruthy();
    expect(mocked.loadApprovalChains).toHaveBeenCalledWith('loan', ['l1']);
    expect(mocked.loadApprovalChains).toHaveBeenCalledWith('requisition', ['r1']);
    fireEvent.click(within(loan).getByRole('button', { name: /Approve/ }));
    await vi.waitFor(() => expect(mocked.decideApproval).toHaveBeenCalledWith('q1', 'approved', ''));
  });

  it('shows nothing when nothing waits', async () => {
    mocked.loadMoneyAwaitingMe.mockResolvedValue([]);
    const { container } = render(<MoneyAwaitingMe />);
    await vi.waitFor(() => expect(mocked.loadMoneyAwaitingMe).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
