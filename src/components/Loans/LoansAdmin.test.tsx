import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../lib/loansApi', () => ({
  loadAllLoans: vi.fn(),
  loadLoanSettings: vi.fn(),
  loadLoanProducts: vi.fn(),
  loadSchedules: vi.fn(),
  approveLoan: vi.fn(),
  declineLoan: vi.fn(),
  markLoanDisbursed: vi.fn(),
  cancelLoan: vi.fn(),
  createLoan: vi.fn(),
  saveLoanSettings: vi.fn(),
  saveLoanProduct: vi.fn(),
}));
const HR_MODULES = ['dashboard', 'employees', 'hr-admin', 'leaves', 'loans'];
const perms = { role: 'HR', modules: HR_MODULES };
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => {
    const has = (p: string) => perms.role === 'ADMIN' || perms.modules.includes(p);
    return {
      userRole: perms.role,
      permissions: perms.modules,
      hasPermission: has,
      hasAnyPermission: (ps: string[]) => ps.some(has),
      hasAllPermissions: (ps: string[]) => ps.every(has),
      loading: false,
    };
  },
}));
vi.mock('../UI/EmployeePicker', () => ({
  default: ({ onChange }: { onChange: (e: { employeeNumber: string } | null) => void }) => (
    <button type="button" onClick={() => onChange({ employeeNumber: 'E9' })}>
      Pick Peter
    </button>
  ),
}));
vi.mock('../../lib/supabase', () => ({ supabase: new Proxy({}, { get: () => { throw new Error('supabase used'); } }) }));

import * as api from '../../lib/loansApi';
import { DEFAULT_LOAN_SETTINGS, addMonths, currentPeriod, loanSchedule } from '../../lib/loans';
import LoansAdmin from './LoansAdmin';

const mocked = vi.mocked(api);
const base = {
  product_id: null,
  product_name: null,
  annual_rate: 12,
  interest_method: 'reducing_balance' as const,
  months: 12,
  start_period: addMonths(currentPeriod(), 1),
  monthly_instalment: 8885,
  total_interest: 6619,
  total_repayable: 106619,
  reason: null,
  decided_by_email: null,
  decided_at: null,
  decision_comment: null,
  disbursed_by_email: null,
  disbursed_at: null,
  created_at: '2026-10-01T08:00:00Z',
};
const LOANS = [
  { ...base, id: 'r1', employee_number: 'E1', employee_name: 'Jane Wanjiru', principal: 100000, status: 'requested' as const, reason: 'School fees' },
  { ...base, id: 'a1', employee_number: 'E2', employee_name: 'Peter Otieno', principal: 100000, status: 'approved' as const, decided_by_email: 'hr@a.co' },
  { ...base, id: 'd1', employee_number: 'E3', employee_name: 'Mary Akinyi', principal: 12000, status: 'repaying' as const, months: 3, monthly_instalment: 4000 },
];

beforeEach(() => {
  vi.clearAllMocks();
  perms.role = 'HR';
  perms.modules = HR_MODULES;
  mocked.loadAllLoans.mockResolvedValue(LOANS);
  mocked.loadLoanSettings.mockResolvedValue(DEFAULT_LOAN_SETTINGS);
  mocked.loadLoanProducts.mockResolvedValue([]);
  mocked.loadSchedules.mockResolvedValue({
    schedules: { d1: loanSchedule(12000, 0, 3, 'flat', currentPeriod()) },
    repayments: { d1: [{ loan_id: 'd1', pay_period: addMonths(currentPeriod(), -1), amount: 4000 }] },
  });
  for (const f of [mocked.approveLoan, mocked.declineLoan, mocked.markLoanDisbursed, mocked.cancelLoan, mocked.createLoan]) f.mockResolvedValue(undefined);
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the loans page', () => {
  it('lists requests to decide, with the totals at the top', async () => {
    render(<LoansAdmin />);
    const card = await screen.findByTestId('loan-r1');
    expect(within(card).getByText('Jane Wanjiru')).toBeTruthy();
    expect(within(card).getByText('“School fees”')).toBeTruthy();
    expect(screen.getByText('Requests (1)')).toBeTruthy();
    expect(screen.getByText('KSh 8,000')).toBeTruthy(); // owed on Mary's loan
  });

  it('approves with the first repayment month', async () => {
    render(<LoansAdmin />);
    const card = await screen.findByTestId('loan-r1');
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    const start = addMonths(currentPeriod(), 2);
    fireEvent.change(screen.getByLabelText('First repayment from'), { target: { value: start } });
    fireEvent.change(screen.getByLabelText('Note to the employee (optional)'), { target: { value: 'Approved by the committee' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    await vi.waitFor(() => expect(mocked.approveLoan).toHaveBeenCalledWith('r1', { comment: 'Approved by the committee', startPeriod: start }));
  });

  it('a decline needs a reason', async () => {
    render(<LoansAdmin />);
    fireEvent.click(within(await screen.findByTestId('loan-r1')).getByRole('button', { name: 'Decline' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Give a reason/);
    expect(mocked.declineLoan).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'A loan is still being repaid' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    await vi.waitFor(() => expect(mocked.declineLoan).toHaveBeenCalledWith('r1', 'A loan is still being repaid'));
  });

  it('marks an approved loan disbursed, after asking', async () => {
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByText('To pay out (1)'));
    fireEvent.click(within(screen.getByTestId('loan-a1')).getByRole('button', { name: 'Mark as disbursed' }));
    await vi.waitFor(() => expect(mocked.markLoanDisbursed).toHaveBeenCalledWith('a1'));
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toMatch(/does not send any money/);
  });

  it('shows a repaying loan’s schedule and balance', async () => {
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByText('Repaying (1)'));
    const card = screen.getByTestId('loan-d1');
    expect(within(card).getByText('KSh 4,000 of KSh 12,000 repaid')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Schedule' }));
    expect(within(screen.getByRole('dialog')).getAllByRole('row')).toHaveLength(5);
  });

  it('sets up a loan for an employee', async () => {
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByRole('button', { name: 'New loan' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set up loan' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Choose the employee');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pick Peter' }));
    fireEvent.change(within(dialog).getByLabelText('Amount (KSh)'), { target: { value: '100000' } });
    expect(within(dialog).getByTestId('new-loan-preview').textContent).toBe('KSh 8,885 a month · KSh 6,619 interest · KSh 106,619 in all');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set up loan' }));
    await vi.waitFor(() =>
      expect(mocked.createLoan).toHaveBeenCalledWith({
        employeeNumber: 'E9',
        productId: null,
        amount: 100000,
        months: 12,
        startPeriod: addMonths(currentPeriod(), 1),
        annualRate: null,
        interestMethod: null,
        reason: '',
      }),
    );
  });

  it('someone who may not manage loans sees no buttons', async () => {
    perms.role = 'MANAGER';
    perms.modules = ['dashboard', 'employees', 'employee-edit', 'leaves', 'expenses', 'salaryadmin', 'team-work'];
    render(<LoansAdmin />);
    const card = await screen.findByTestId('loan-r1');
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New loan' })).toBeNull();
  });

  it('the Payroll module manages loans (Checker by default)', async () => {
    perms.role = 'CHECKER';
    perms.modules = ['dashboard', 'employees', 'payroll', 'settings'];
    render(<LoansAdmin />);
    const card = await screen.findByTestId('loan-r1');
    expect(within(card).getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New loan' })).toBeTruthy();
  });

  it('a custom role based on Manager with Staff loans manages loans', async () => {
    perms.role = 'MANAGER';
    perms.modules = ['dashboard', 'employees', 'loans'];
    render(<LoansAdmin />);
    const card = await screen.findByTestId('loan-r1');
    expect(within(card).getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('HR whose role lost Staff loans (and has no Payroll) does not', async () => {
    perms.role = 'HR';
    perms.modules = HR_MODULES.filter((m) => m !== 'loans');
    render(<LoansAdmin />);
    const card = await screen.findByTestId('loan-r1');
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New loan' })).toBeNull();
  });
});

describe('loan settings', () => {
  it('saves the rate and terms, and refuses impossible ones', async () => {
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByText('Settings'));
    const rate = await screen.findByLabelText('Interest rate (% a year)');
    fireEvent.change(rate, { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Most anyone may borrow (KSh)'), { target: { value: '200000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() =>
      expect(mocked.saveLoanSettings).toHaveBeenCalledWith({ ...DEFAULT_LOAN_SETTINGS, annual_rate: 14, max_amount: 200000 }),
    );
    fireEvent.change(screen.getByLabelText('Shortest term (months)'), { target: { value: '24' } });
    expect(screen.getByText('The shortest term can’t be longer than the longest.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds a loan type', async () => {
    mocked.saveLoanProduct.mockResolvedValue(undefined);
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByText('Settings'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add loan type' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Emergency loan' } });
    fireEvent.change(screen.getByLabelText('Rate (% a year)'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Longest term for this type (months)'), { target: { value: '6' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add loan type' }).at(-1)!);
    await vi.waitFor(() =>
      expect(mocked.saveLoanProduct).toHaveBeenCalledWith({
        id: undefined,
        name: 'Emergency loan',
        annual_rate: 8,
        interest_method: 'reducing_balance',
        max_months: 6,
        active: true,
      }),
    );
  });
});
