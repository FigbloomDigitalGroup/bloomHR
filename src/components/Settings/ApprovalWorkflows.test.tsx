import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApprovalWorkflow } from '../../lib/approvals';

const state = vi.hoisted(() => ({ canEdit: true, workflow: null as null | ApprovalWorkflow }));
const saveApprovalWorkflow = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasAnyPermission: () => state.canEdit }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
// a stand-in picker: a button that picks the CTO
vi.mock('../UI/EmployeePicker', () => ({
  default: ({ label, onChange }: { label?: string; onChange: (e: unknown) => void }) => (
    <button type="button" onClick={() => onChange({ employeeNumber: 'E-CTO', fullName: 'Chris Cto' })}>Pick {label}</button>
  ),
}));
vi.mock('../../lib/approvals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/approvals')>()),
  loadApprovalWorkflow: () => Promise.resolve(state.workflow),
  saveApprovalWorkflow,
}));

import ApprovalWorkflowsCard from './ApprovalWorkflows';

// today's chain, as every company starts
const DEFAULT: ApprovalWorkflow = {
  kind: 'leave',
  admins_can_act: true,
  department_head_available: false,
  steps: [
    { approver_type: 'leave_approver', skip_if_requester: true },
    { approver_type: 'role', approver_role: 'HR', skip_if_requester: true },
  ],
};

const preview = () => screen.getByTestId('approval-preview').textContent;

beforeEach(() => {
  state.canEdit = true;
  state.workflow = { ...DEFAULT, steps: DEFAULT.steps.map((s) => ({ ...s })) };
  saveApprovalWorkflow.mockReset();
  saveApprovalWorkflow.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('Approval workflows card', () => {
  it('shows the company’s chain as a preview', async () => {
    render(<ApprovalWorkflowsCard />);
    await screen.findByTestId('approval-preview');
    expect(preview()).toBe('Leave: Leave approver → HR');
  });

  it('adds a named person as a step, names it, and saves the steps in order', async () => {
    render(<ApprovalWorkflowsCard />);
    await screen.findByTestId('approval-preview');
    fireEvent.change(screen.getByLabelText('Who approves', { selector: '#step-1-type' }), { target: { value: 'reports_to' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    fireEvent.change(screen.getByLabelText('Who approves', { selector: '#step-3-type' }), { target: { value: 'person' } });
    // nobody chosen yet: cannot save
    expect(screen.getByText('Choose who approves')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Person' }));
    expect(preview()).toBe('Leave: Line manager → HR → Chris Cto');
    fireEvent.change(screen.getByLabelText('Name shown (optional)', { selector: '#step-3-label' }), { target: { value: 'CTO' } });
    expect(preview()).toBe('Leave: Line manager → HR → CTO');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveApprovalWorkflow).toHaveBeenCalled());
    const [kind, steps, admins] = saveApprovalWorkflow.mock.calls[0];
    expect(kind).toBe('leave');
    expect(admins).toBe(true);
    expect(steps.map((s: { approver_type: string }) => s.approver_type)).toEqual(['reports_to', 'role', 'person']);
    expect(steps[2]).toMatchObject({ approver_employee_number: 'E-CTO', label: 'CTO' });
  });

  it('reorders and removes steps', async () => {
    render(<ApprovalWorkflowsCard />);
    await screen.findByTestId('approval-preview');
    fireEvent.click(screen.getByRole('button', { name: 'Move step 2 up' }));
    expect(preview()).toBe('Leave: HR → Leave approver');
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
    expect(preview()).toBe('Leave: Leave approver');
    // the last step cannot be removed
    expect((screen.getByRole('button', { name: 'Remove step 1' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sets an alternate approver by role', async () => {
    render(<ApprovalWorkflowsCard />);
    await screen.findByTestId('approval-preview');
    fireEvent.change(screen.getByLabelText('Alternate approver (optional)', { selector: '#step-2-alt' }), { target: { value: 'role' } });
    expect(screen.getByText('Choose the alternate’s role')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Alternate’s role'), { target: { value: 'ADMIN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveApprovalWorkflow).toHaveBeenCalled());
    expect(saveApprovalWorkflow.mock.calls[0][1][1]).toMatchObject({ alternate_type: 'role', alternate_role: 'ADMIN' });
  });

  it('offers department heads only where departments are set up', async () => {
    const { unmount } = render(<ApprovalWorkflowsCard />);
    await screen.findByTestId('approval-preview');
    expect(screen.queryAllByRole('option', { name: 'Department head' })).toEqual([]);
    unmount();
    state.workflow = { ...DEFAULT, department_head_available: true };
    render(<ApprovalWorkflowsCard />);
    await screen.findByTestId('approval-preview');
    expect(screen.getAllByRole('option', { name: 'Department head' }).length).toBe(2);
  });

  it('is read-only for people who may not change it', async () => {
    state.canEdit = false;
    render(<ApprovalWorkflowsCard />);
    await screen.findByTestId('approval-preview');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add step' })).toBeNull();
    expect((screen.getByLabelText('Who approves', { selector: '#step-1-type' }) as HTMLSelectElement).disabled).toBe(true);
  });
});
