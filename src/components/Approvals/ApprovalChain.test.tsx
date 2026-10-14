import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApprovalChain as Chain } from '../../lib/approvals';

const decideApproval = vi.hoisted(() => vi.fn());
vi.mock('../../lib/approvals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/approvals')>()),
  decideApproval,
}));

import ApprovalChain from './ApprovalChain';

const step = (position: number, label: string, status: Chain['steps'][number]['status'], extra: Partial<Chain['steps'][number]> = {}) => ({
  position, label, status, approver_type: 'role' as const, waiting_on: null, actor_name: null, acted_as: null, comment: null, acted_at: null, ...extra,
});

// Line manager approved, waiting on HR, then the CTO
const chain = (over: Partial<Chain> = {}): Chain => ({
  record_id: 'leave-1',
  request_id: 'req-1',
  status: 'pending',
  current_step: 2,
  can_approve: false,
  can_reject: false,
  steps: [
    step(1, 'Line manager', 'approved', { actor_name: 'Max Manager', comment: 'fine by me', acted_at: '2026-10-14T10:00:00Z' }),
    step(2, 'HR', 'current', { waiting_on: 'HR' }),
    step(3, 'CTO', 'upcoming'),
  ],
  ...over,
});

beforeEach(() => {
  decideApproval.mockReset();
});
afterEach(() => cleanup());

describe('Approval chain', () => {
  it('shows each step, who approved, and who it is waiting on', () => {
    render(<ApprovalChain chain={chain()} />);
    expect(screen.getByText('1. Line manager')).toBeTruthy();
    expect(screen.getByText(/Approved by Max Manager/)).toBeTruthy();
    expect(screen.getByText('“fine by me”')).toBeTruthy();
    expect(screen.getByText('Waiting on HR')).toBeTruthy();
    expect(screen.getByText('3. CTO')).toBeTruthy();
  });

  it('someone else sees no Approve or Reject', () => {
    render(<ApprovalChain chain={chain()} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('the current approver approves with a comment', async () => {
    decideApproval.mockResolvedValue('pending');
    const onDecided = vi.fn();
    render(<ApprovalChain chain={chain({ can_approve: true, can_reject: true })} onDecided={onDecided} />);
    fireEvent.change(screen.getByLabelText('Comment (optional)'), { target: { value: ' enjoy ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('pending'));
    expect(decideApproval).toHaveBeenCalledWith('req-1', 'approved', 'enjoy');
  });

  it('a later approver may only reject early', async () => {
    decideApproval.mockResolvedValue('rejected');
    const onDecided = vi.fn();
    render(<ApprovalChain chain={chain({ can_reject: true })} onDecided={onDecided} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('rejected'));
    expect(decideApproval).toHaveBeenCalledWith('req-1', 'rejected', '');
  });

  it('shows why the database refused', async () => {
    decideApproval.mockImplementation(async () => {
      throw new Error('You are not the approver for this step');
    });
    render(<ApprovalChain chain={chain({ can_approve: true, can_reject: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toBe('You are not the approver for this step');
  });

  it('a finished chain has no actions, and the compact form lists the steps', () => {
    const done = chain({
      status: 'rejected', can_approve: true,
      steps: [step(1, 'Line manager', 'rejected', { actor_name: 'Max Manager' }), step(2, 'HR', 'not_reached')],
    });
    const { unmount } = render(<ApprovalChain chain={done} />);
    expect(screen.getByText(/Rejected by Max Manager/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    unmount();
    render(<ApprovalChain chain={chain()} compact />);
    expect(screen.getByRole('list', { name: 'Approval chain' }).textContent).toBe('Line manager→HR→CTO');
    expect(screen.getByText('Waiting on HR')).toBeTruthy();
  });

  it('shows nothing without a chain', () => {
    const { container } = render(<ApprovalChain chain={undefined} />);
    expect(container.innerHTML).toBe('');
  });
});
