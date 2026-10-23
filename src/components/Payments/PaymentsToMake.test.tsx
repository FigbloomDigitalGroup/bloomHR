import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../lib/paymentsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/paymentsApi')>();
  return {
    ...actual,
    loadPayments: vi.fn(),
    loadPayees: vi.fn(),
    loadRequisitions: vi.fn(),
    recordPayment: vi.fn(),
    createRequisition: vi.fn(),
    approveRequisition: vi.fn(),
    declineRequisition: vi.fn(),
    cancelRequisition: vi.fn(),
  };
});
// each pending requisition's approval chain (20261025600000): who may decide its step comes from the database
const chainMay = { value: true };
vi.mock('../../lib/approvals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/approvals')>()),
  decideApproval: vi.fn(),
  loadApprovalChains: vi.fn(async () => ({
    q1: {
      record_id: 'q1', request_id: 'req-q1', status: 'pending', current_step: 1, can_approve: chainMay.value, can_reject: chainMay.value,
      steps: [{ position: 1, label: 'Approve requisitions', approver_type: 'module', status: 'current', waiting_on: 'anyone with Approve requisitions',
                actor_name: null, acted_as: null, comment: null, acted_at: null }],
    },
  })),
}));
const perms = { role: 'CHECKER', modules: ['payments'] };
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => {
    const has = (p: string) => perms.role === 'ADMIN' || perms.modules.includes(p);
    return { userRole: perms.role, permissions: perms.modules, hasPermission: has, hasAnyPermission: (ps: string[]) => ps.some(has), loading: false };
  },
}));
vi.mock('../../hooks/useEmployeeDirectory', () => ({
  useEmployeeDirectory: () => ({ employees: [{ employeeNumber: 'E1', fullName: 'Jane Wanjiru' }], loading: false, error: null }),
}));
vi.mock('../UI/EmployeePicker', () => ({
  default: ({ onChange }: { onChange: (e: { employeeNumber: string } | null) => void }) => (
    <button type="button" onClick={() => onChange({ employeeNumber: 'E9' })}>
      Pick Peter
    </button>
  ),
}));
vi.mock('../../lib/supabase', () => ({ supabase: new Proxy({}, { get: () => { throw new Error('supabase used'); } }) }));

import * as api from '../../lib/paymentsApi';
import PaymentsToMake from './PaymentsToMake';

const mocked = vi.mocked(api);
const base = {
  payee_details: null,
  approved_by_email: 'hr@a.co',
  approved_at: '2026-10-20T08:00:00Z',
  paid_via: null,
  payment_reference: null,
  paid_on: null,
  payment_note: null,
  paid_by_email: null,
  paid_at: null,
};
const PAYMENTS = [
  { ...base, id: 'p1', source: 'salary_advance' as const, source_id: 's1', employee_number: 'E1', payee_name: 'Jane Wanjiru', amount: 8000, purpose: 'Salary advance: School fees', status: 'to_pay' as const },
  { ...base, id: 'p2', source: 'requisition' as const, source_id: 'r1', employee_number: null, payee_name: 'Acme Stationers', payee_details: 'Till 555123', amount: 25000, purpose: 'Requisition: Office chairs', status: 'to_pay' as const },
  { ...base, id: 'p3', source: 'loan' as const, source_id: 'l1', employee_number: 'E2', payee_name: 'Peter Otieno', amount: 30000, purpose: 'Loan', status: 'paid' as const, paid_via: 'bank' as const, payment_reference: 'TRF-1', paid_on: '2026-10-21', paid_at: '2026-10-21T09:00:00Z', paid_by_email: 'fin@a.co' },
];
const REQUISITIONS = [
  { id: 'q1', requested_by: 'E1', payee_type: 'employee' as const, payee_employee_number: 'E1', payee_name: 'Jane Wanjiru', payee_details: null, category: 'Supplies', amount: 4200, purpose: 'Printer toner', needed_by: null, status: 'pending' as const, decided_by_email: null, decided_at: null, decision_comment: null, paid_at: null, created_at: '2026-10-22T08:00:00Z' },
];

const show = (path = '/payments') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PaymentsToMake />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  perms.role = 'CHECKER';
  perms.modules = ['payments'];
  chainMay.value = true;
  mocked.loadPayments.mockResolvedValue(PAYMENTS);
  mocked.loadRequisitions.mockResolvedValue(REQUISITIONS);
  mocked.loadPayees.mockResolvedValue({
    E1: { employee_number: 'E1', payment_method: 'M-Pesa', mobile_number: '0712345678', bank: null, bank_branch: null, account_number: null, account_name: null },
  });
  mocked.recordPayment.mockResolvedValue(undefined);
  mocked.approveRequisition.mockResolvedValue('approved');
  mocked.declineRequisition.mockResolvedValue(undefined);
  mocked.createRequisition.mockResolvedValue('approved');
});
afterEach(cleanup);

describe('finance: what to pay', () => {
  it('lists what is waiting, with how to pay each one', async () => {
    show();
    const advance = await screen.findByTestId('payment-p1');
    expect(within(advance).getByText('Jane Wanjiru')).toBeTruthy();
    expect(within(advance).getByText(/M-Pesa 0712345678/)).toBeTruthy();
    expect(within(screen.getByTestId('payment-p2')).getByText(/Till 555123/)).toBeTruthy();
    expect(screen.queryByTestId('payment-p3')).toBeNull();
    expect(screen.getByText('To pay (2)')).toBeTruthy();
    // finance doesn't approve requisitions
    expect(screen.queryByRole('button', { name: /New requisition/ })).toBeNull();
  });

  it('records a payment: a reference is needed unless it was cash', async () => {
    show();
    fireEvent.click(within(await screen.findByTestId('payment-p1')).getByRole('button', { name: /Record payment/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'mpesa' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/reference/);
    expect(mocked.recordPayment).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('M-Pesa code'), { target: { value: 'QX12AB' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(mocked.recordPayment).toHaveBeenCalledWith('p1', expect.objectContaining({ via: 'mpesa', reference: 'QX12AB' })));
  });

  it('shows what was paid, how and with which reference', async () => {
    show('/payments?tab=paid');
    const row = (await screen.findByText('Peter Otieno')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Bank transfer')).toBeTruthy();
    expect(within(row).getByText('TRF-1')).toBeTruthy();
  });
});

describe('HR: requisitions', () => {
  beforeEach(() => {
    perms.role = 'HR';
    perms.modules = ['requisitions'];
  });

  it('HR without the payments module sees only the requisitions, and approves one', async () => {
    show();
    const card = await screen.findByTestId('requisition-q1');
    expect(screen.queryByText(/To pay/)).toBeNull();
    expect(within(card).getByText(/asked by Jane Wanjiru/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: /Approve/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocked.approveRequisition).toHaveBeenCalledWith('req-q1', ''));
  });

  it('turning one down needs a reason', async () => {
    show();
    fireEvent.click(within(await screen.findByTestId('requisition-q1')).getByRole('button', { name: /Turn down/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn down' }));
    expect(within(dialog).getByRole('alert')).toBeTruthy();
    expect(mocked.declineRequisition).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Not budgeted' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn down' }));
    await waitFor(() => expect(mocked.declineRequisition).toHaveBeenCalledWith('req-q1', 'Not budgeted'));
  });

  it('when the step is someone else’s (a longer chain), HR sees the chain and may cancel, not decide', async () => {
    chainMay.value = false;
    show();
    const card = await screen.findByTestId('requisition-q1');
    expect(within(card).getByLabelText('Approval chain')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: /Turn down/ })).toBeNull();
    expect(within(card).getByRole('button', { name: /Cancel/ })).toBeTruthy();
  });

  it('raises one for a supplier, approved at once', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: /New requisition/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText(/Someone else/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve requisition' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Enter who is paid');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Acme Stationers' } });
    fireEvent.change(within(dialog).getByLabelText('How to pay them'), { target: { value: 'Till 555123' } });
    fireEvent.change(within(dialog).getByLabelText('Amount (KSh)'), { target: { value: '25000' } });
    fireEvent.change(within(dialog).getByLabelText('What it is for'), { target: { value: 'Office chairs' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve requisition' }));
    await waitFor(() =>
      expect(mocked.createRequisition).toHaveBeenCalledWith(
        expect.objectContaining({ payeeType: 'other', payeeName: 'Acme Stationers', payeeDetails: 'Till 555123', amount: 25000, purpose: 'Office chairs', approve: true })
      )
    );
  });
});
