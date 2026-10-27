import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// An admin applies for a salary advance on someone's behalf (Salary advance > Requests > Apply for someone).

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/salaryAdvanceApi', () => ({ loadEmployeeForAdvance: vi.fn(), requestAdvanceFor: vi.fn() }));
// picking someone: a plain button standing in for the search
vi.mock('../UI/EmployeePicker', () => ({
  default: ({ label, onChange }: { label: string; onChange: (e: unknown) => void }) => (
    <button type="button" onClick={() => onChange({ employeeNumber: 'E7', fullName: 'Amina Hassan', status: 'Active' })}>
      {label}: pick Amina
    </button>
  ),
}));

import * as api from '../../lib/salaryAdvanceApi';
import ApplyForSomeone from './ApplyForSomeone';

const mocked = vi.mocked(api);
const AMINA = { employeeNumber: 'E7', fullName: 'Amina Hassan', office: 'Mombasa', basicSalary: '40000', terminated: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocked.loadEmployeeForAdvance.mockResolvedValue(AMINA);
  mocked.requestAdvanceFor.mockResolvedValue('pending');
});
afterEach(cleanup);

const fill = (amount: string) => {
  fireEvent.click(screen.getByRole('button', { name: /pick Amina/ }));
  fireEvent.change(screen.getByLabelText('Amount (KSh)'), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Hospital bill for her son' } });
};

describe('Apply for someone', () => {
  it('needs the person, an amount and a reason', async () => {
    render(<ApplyForSomeone open onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toEqual(['Choose who the advance is for.', 'Enter the amount needed.', expect.stringMatching(/at least 10 characters/)]);
    expect(mocked.requestAdvanceFor).not.toHaveBeenCalled();
  });

  it('applies for any amount for them, sent for approval, and says it comes off the next pay in full', async () => {
    const onSaved = vi.fn();
    render(<ApplyForSomeone open onClose={() => {}} onSaved={onSaved} />);
    fill('150000'); // more than 20% of her basic: no limit
    expect(screen.getByTestId('apply-plan').textContent).toMatch(/^KSh 150,000 comes off the next pay in full/);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await vi.waitFor(() =>
      expect(mocked.requestAdvanceFor).toHaveBeenCalledWith(AMINA, { amount: 150000, reason: 'Hospital bill for her son', approveNow: false }),
    );
    expect(mocked.loadEmployeeForAdvance).toHaveBeenCalledWith('E7');
    expect(onSaved).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Advance for Amina Hassan sent for approval');
  });

  it('Approve it now: approved when the admin decides its only step, or onward to the next approver', async () => {
    mocked.requestAdvanceFor.mockResolvedValueOnce('approved').mockResolvedValueOnce('your-step-approved');
    render(<ApplyForSomeone open onClose={() => {}} onSaved={() => {}} />);
    fill('20000');
    fireEvent.click(screen.getByLabelText(/Approve it now/));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Advance for Amina Hassan approved. Pay it from Payments to make.'));
    expect(mocked.requestAdvanceFor.mock.calls[0][1].approveNow).toBe(true);

    fill('20000');
    fireEvent.click(screen.getByLabelText(/Approve it now/));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Advance for Amina Hassan: your step is approved. It now goes to the next approver.'));
  });

  it('not for someone whose employment has ended', async () => {
    mocked.loadEmployeeForAdvance.mockResolvedValue({ ...AMINA, terminated: true });
    render(<ApplyForSomeone open onClose={() => {}} onSaved={() => {}} />);
    fill('5000');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Amina Hassan's employment has ended."));
    expect(mocked.requestAdvanceFor).not.toHaveBeenCalled();
  });
});
