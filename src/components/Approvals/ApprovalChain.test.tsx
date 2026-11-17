import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApprovalChain as Chain } from '../../lib/approvals';

const decideApproval = vi.hoisted(() => vi.fn());
const reopenLeave = vi.hoisted(() => vi.fn());
vi.mock('../../lib/approvals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/approvals')>()),
  decideApproval,
  reopenLeave,
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
  reopenLeave.mockReset();
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
    fireEvent.change(screen.getByLabelText('Comment (optional to approve, required to reject)'), { target: { value: ' enjoy ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('pending'));
    expect(decideApproval).toHaveBeenCalledWith('req-1', 'approved', 'enjoy');
  });

  it('a later approver may only reject early', async () => {
    decideApproval.mockResolvedValue('rejected');
    const onDecided = vi.fn();
    render(<ApprovalChain chain={chain({ can_reject: true })} onDecided={onDecided} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Comment (optional to approve, required to reject)'), { target: { value: ' short staffed ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('rejected'));
    expect(decideApproval).toHaveBeenCalledWith('req-1', 'rejected', 'short staffed');
  });

  it('rejecting needs a reason', () => {
    render(<ApprovalChain chain={chain({ can_approve: true, can_reject: true })} />);
    fireEvent.change(screen.getByLabelText('Comment (optional to approve, required to reject)'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('alert').textContent).toBe('Give a reason for rejecting: the employee will see it');
    expect(decideApproval).not.toHaveBeenCalled();
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
    // still pending: the step already approved isn't summarised
    expect(screen.queryByText(/Approved by/)).toBeNull();
  });

  it('the compact form says who rejected or approved a finished request, and why', () => {
    const rejected = chain({
      status: 'rejected',
      steps: [
        step(1, 'Leave approver', 'rejected', { actor_name: 'Ian Duncan', comment: 'short staffed', acted_at: '2026-10-23T10:00:00Z' }),
        step(2, 'Operations', 'not_reached'),
      ],
    });
    const { unmount } = render(<ApprovalChain chain={rejected} compact />);
    // with the day and the time it was decided
    expect(screen.getByText(/^Rejected by Ian Duncan, .*\d{2}:\d{2}/)).toBeTruthy();
    expect(screen.getByText('“short staffed”')).toBeTruthy();
    unmount();

    const approved = chain({
      status: 'approved',
      steps: [
        step(1, 'Leave approver', 'approved', { actor_name: 'Ian Duncan' }),
        step(2, 'Operations', 'approved', { actor_name: 'Zilpar Okoth', acted_as: 'admin' }),
      ],
    });
    render(<ApprovalChain chain={approved} compact />);
    expect(screen.getByText(/^Approved by Zilpar Okoth \(admin\)/)).toBeTruthy();
    expect(screen.queryByText(/Ian Duncan/)).toBeNull();
  });

  it('shows nothing without a chain', () => {
    const { container } = render(<ApprovalChain chain={undefined} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('sending approved leave back to pending', () => {
  const approved = (over: Partial<Chain> = {}) => chain({
    status: 'approved',
    current_step: 3,
    steps: [step(1, 'Line manager', 'approved'), step(2, 'HR', 'approved'), step(3, 'Operations', 'approved')],
    ...over,
  });

  it('only whoever may reopen sees the button', () => {
    render(<ApprovalChain chain={approved()} />);
    expect(screen.queryByRole('button', { name: 'Send back to pending' })).toBeNull();
    cleanup();
    render(<ApprovalChain chain={approved({ can_reopen: true })} />);
    expect(screen.getByRole('button', { name: 'Send back to pending' })).toBeTruthy();
  });

  it('needs a reason, then sends it back', async () => {
    reopenLeave.mockResolvedValue(undefined);
    const onDecided = vi.fn();
    render(<ApprovalChain chain={approved({ can_reopen: true })} onDecided={onDecided} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send back to pending' }));
    const send = screen.getByRole('button', { name: 'Send back to pending' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why is it going back? (required)'), { target: { value: ' Stock take ' } });
    fireEvent.click(send);
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('pending'));
    expect(reopenLeave).toHaveBeenCalledWith('leave-1', 'Stock take');
  });

  it('shows the refusal', async () => {
    reopenLeave.mockRejectedValue(new Error('This leave has already started'));
    render(<ApprovalChain chain={approved({ can_reopen: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send back to pending' }));
    fireEvent.change(screen.getByLabelText('Why is it going back? (required)'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send back to pending' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already started/);
  });

  it('a reopened chain says who sent it back and why', () => {
    render(<ApprovalChain chain={chain({ reopened: { actor_name: 'Otis Ops', comment: 'Stock take', acted_at: '2026-10-20T10:00:00Z' } })} />);
    expect(screen.getByText(/Sent back to pending by Otis Ops/)).toBeTruthy();
    expect(screen.getByText('“Stock take”')).toBeTruthy();
  });
});
