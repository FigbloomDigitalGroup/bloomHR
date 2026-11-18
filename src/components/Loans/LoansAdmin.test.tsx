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
  cancelLoan: vi.fn(),
  createLoan: vi.fn(),
  saveLoanSettings: vi.fn(),
  saveLoanProduct: vi.fn(),
}));
// whether the signed-in person may decide the request comes from its approval chain (the database), not the page
const chain = { can: true };
vi.mock('../../lib/approvals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/approvals')>()),
  decideApproval: vi.fn(),
  loadApprovalChains: vi.fn(async () => ({
    r1: {
      record_id: 'r1', request_id: 'q1', status: 'pending', current_step: 1, can_approve: chain.can, can_reject: chain.can,
      steps: [{ position: 1, label: 'Staff loans', approver_type: 'module', status: 'current', waiting_on: 'anyone with Staff loans',
                actor_name: null, acted_as: null, comment: null, acted_at: null }],
    },
  })),
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
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('../UI/EmployeePicker', () => ({
  default: ({ onChange }: { onChange: (e: { employeeNumber: string } | null) => void }) => (
    <button type="button" onClick={() => onChange({ employeeNumber: 'E9' })}>
      Pick Peter
    </button>
  ),
}));
vi.mock('../../lib/loanFormApi', () => ({
  loadLoanForms: vi.fn(),
  currentUserId: vi.fn(),
  signAsApprover: vi.fn(),
  signAsBorrower: vi.fn(),
  uploadSignedForm: vi.fn(),
  reviewSignedForm: vi.fn(),
  openSignedForm: vi.fn(),
  loadLoanFormContext: vi.fn(),
  downloadLoanFormPdf: vi.fn(),
  loadLoanFormSettings: vi.fn(),
  saveLoanFormSettings: vi.fn(),
  loadGuarantors: vi.fn(),
  loadGuarantorChoices: vi.fn(),
  setGuarantor: vi.fn(),
  loadMyGuarantees: vi.fn(),
  loadGuarantorView: vi.fn(),
  signAsGuarantor: vi.fn(),
  declineGuarantee: vi.fn(),
  addWitness: vi.fn(),
  saveFormChecks: vi.fn(),
  loadMySignerIdentity: vi.fn(),
}));
// everyone here has a saved signature
vi.mock('../../lib/signatures', () => ({
  loadMySignature: vi.fn(async () => 'data:image/png;base64,SIG'),
  saveMySignature: vi.fn(),
  clearMySignature: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: new Proxy({}, { get: () => { throw new Error('supabase used'); } }) }));

import * as api from '../../lib/loansApi';
import { DEFAULT_LOAN_SETTINGS, addMonths, currentPeriod, loanSchedule } from '../../lib/loans';
import LoansAdmin from './LoansAdmin';
import * as formApi from '../../lib/loanFormApi';
import { DEFAULT_LOAN_FORM_SETTINGS } from '../../lib/loanForm';

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
const form = (over: Record<string, unknown>) => ({
  loan_id: 'x',
  required: true,
  borrower_signature: null,
  borrower_signed_at: null,
  approver_signature: null,
  approver_name: null,
  approver_title: null,
  approver_signed_at: null,
  status: 'none',
  file_path: null,
  file_name: null,
  uploaded_at: null,
  send_back_reason: null,
  employer_signature: null,
  employer_officer: null,
  employer_officer_title: null,
  reviewed_at: null,
  ...over,
});
const LOANS = [
  { ...base, id: 'r1', employee_number: 'E1', employee_name: 'Jane Wanjiru', principal: 100000, status: 'requested' as const, reason: 'School fees' },
  { ...base, id: 'a1', employee_number: 'E2', employee_name: 'Peter Otieno', principal: 100000, status: 'approved' as const, decided_by_email: 'hr@a.co' },
  { ...base, id: 'd1', employee_number: 'E3', employee_name: 'Mary Akinyi', principal: 12000, status: 'repaying' as const, months: 3, monthly_instalment: 4000 },
];

beforeEach(() => {
  vi.clearAllMocks();
  perms.role = 'HR';
  perms.modules = HR_MODULES;
  chain.can = true;
  mocked.loadAllLoans.mockResolvedValue(LOANS);
  mocked.loadLoanSettings.mockResolvedValue(DEFAULT_LOAN_SETTINGS);
  mocked.loadLoanProducts.mockResolvedValue([]);
  mocked.loadSchedules.mockResolvedValue({
    schedules: { d1: loanSchedule(12000, 0, 3, 'flat', currentPeriod()) },
    repayments: { d1: [{ loan_id: 'd1', pay_period: addMonths(currentPeriod(), -1), amount: 4000 }] },
  });
  for (const f of [mocked.declineLoan, mocked.cancelLoan]) f.mockResolvedValue(undefined);
  mocked.approveLoan.mockResolvedValue('approved');
  mocked.createLoan.mockResolvedValue('approved');
  vi.mocked(formApi.loadLoanForms).mockResolvedValue({});
  vi.mocked(formApi.currentUserId).mockResolvedValue('hr-user');
  vi.mocked(formApi.signAsApprover).mockResolvedValue(undefined);
  vi.mocked(formApi.reviewSignedForm).mockResolvedValue(undefined);
  vi.mocked(formApi.loadLoanFormSettings).mockResolvedValue(DEFAULT_LOAN_FORM_SETTINGS);
  vi.mocked(formApi.loadGuarantors).mockResolvedValue({});
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

  it('approves the step it waits on, with the first repayment month; the chain shows on the card', async () => {
    render(<LoansAdmin />);
    const card = await screen.findByTestId('loan-r1');
    expect(within(card).getByLabelText('Approval chain')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    const start = addMonths(currentPeriod(), 2);
    fireEvent.change(screen.getByLabelText('First repayment from'), { target: { value: start } });
    fireEvent.change(screen.getByLabelText('Note to the employee (optional)'), { target: { value: 'Approved by the committee' } });
    await within(screen.getByRole('dialog')).findByAltText('Your signature');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    await vi.waitFor(() => expect(mocked.approveLoan).toHaveBeenCalledWith('r1', 'q1', { comment: 'Approved by the committee', startPeriod: start }));
    // the final approval: the approver's saved signature goes on the form
    await vi.waitFor(() => expect(formApi.signAsApprover).toHaveBeenCalledWith('r1', 'data:image/png;base64,SIG'));
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
    await vi.waitFor(() => expect(mocked.declineLoan).toHaveBeenCalledWith('q1', 'A loan is still being repaid'));
  });

  it('an approved loan is paid out from Payments to make, by finance', async () => {
    perms.modules = [...HR_MODULES, 'payments'];
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByText('To pay out (1)'));
    const card = screen.getByTestId('loan-a1');
    expect(within(card).queryByRole('button', { name: /Mark as disbursed|Pay out/ })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Record payment' }));
    expect(navigate).toHaveBeenCalledWith('/payments');
  });

  it('a signed form holds the payout until HR accepts it, signing the employer undertaking', async () => {
    perms.modules = [...HR_MODULES, 'payments'];
    vi.mocked(formApi.loadLoanForms).mockResolvedValue({ a1: form({ loan_id: 'a1', status: 'uploaded', file_path: 'p', borrower_signature: 'x' }) } as never);
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByText('To pay out (1)'));
    const card = screen.getByTestId('loan-a1');
    expect(within(card).getByText('Signed form to review')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Record payment' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Accept form' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByAltText('Your signature');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept and sign' }));
    await vi.waitFor(() => expect(formApi.reviewSignedForm).toHaveBeenCalledWith('a1', true, 'data:image/png;base64,SIG'));
  });

  it('a form signed, witnessed and guaranteed in the app is accepted with no upload', async () => {
    perms.modules = [...HR_MODULES, 'payments'];
    vi.mocked(formApi.loadLoanForms).mockResolvedValue({
      a1: form({ loan_id: 'a1', borrower_signature: 'x', witness_signature: 'w', witness_name: 'Wanjiku W', witness_id_number: '123' }),
    } as never);
    vi.mocked(formApi.loadGuarantors).mockResolvedValue({ a1: { loan_id: 'a1', guarantor_name: 'Mary Akinyi', status: 'signed' } } as never);
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByText('To pay out (1)'));
    const card = screen.getByTestId('loan-a1');
    expect(within(card).getByText('Signed form to review')).toBeTruthy();
    expect(within(card).getByTestId('guarantor-a1').textContent).toMatch(/Mary Akinyi, signed/);
    expect(within(card).getByText(/Wanjiku W \(ID 123\)/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Accept form' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByAltText('Your signature');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept and sign' }));
    await vi.waitFor(() => expect(formApi.reviewSignedForm).toHaveBeenCalledWith('a1', true, 'data:image/png;base64,SIG'));
  });

  it('without the guarantor’s signature, a form signed in the app is not ready', async () => {
    vi.mocked(formApi.loadLoanForms).mockResolvedValue({ a1: form({ loan_id: 'a1', borrower_signature: 'x', witness_signature: 'w' }) } as never);
    vi.mocked(formApi.loadGuarantors).mockResolvedValue({ a1: { loan_id: 'a1', guarantor_name: 'Mary Akinyi', status: 'asked' } } as never);
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByText('To pay out (1)'));
    const card = screen.getByTestId('loan-a1');
    expect(within(card).queryByRole('button', { name: 'Accept form' })).toBeNull();
    expect(within(card).getByTestId('guarantor-a1').textContent).toMatch(/waiting for them to sign/);
  });

  it('HR fills in the checklist and who did the affordability assessment', async () => {
    vi.mocked(formApi.loadLoanForms).mockResolvedValue({ a1: form({ loan_id: 'a1' }) } as never);
    vi.mocked(formApi.loadMySignerIdentity).mockResolvedValue({ name: 'Hana Hr', title: 'HR Manager' });
    vi.mocked(formApi.saveFormChecks).mockResolvedValue(undefined);
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByText('To pay out (1)'));
    fireEvent.click(within(screen.getByTestId('loan-a1')).getByRole('button', { name: 'Checklist' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Affordability assessment completed by') as HTMLInputElement).value).toBe('Hana Hr');
    fireEvent.click(within(dialog).getByLabelText(/Applicants Copy of National ID/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save checklist' }));
    await vi.waitFor(() => expect(formApi.saveFormChecks).toHaveBeenCalledWith('a1', 'Hana Hr', ['id_kra']));
  });

  it('sends a signed form back with what to fix', async () => {
    vi.mocked(formApi.loadLoanForms).mockResolvedValue({ a1: form({ loan_id: 'a1', status: 'uploaded', file_path: 'p' }) } as never);
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByText('To pay out (1)'));
    fireEvent.click(within(screen.getByTestId('loan-a1')).getByRole('button', { name: 'Send back' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('What needs fixing?'), { target: { value: 'The witness has not signed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send back' }));
    await vi.waitFor(() => expect(formApi.reviewSignedForm).toHaveBeenCalledWith('a1', false, 'The witness has not signed'));
  });

  it('whoever approved signs the approval later if they did not when approving', async () => {
    mocked.loadAllLoans.mockResolvedValue(LOANS.map((l) => (l.id === 'a1' ? { ...l, decided_by: 'hr-user' } : l)));
    vi.mocked(formApi.loadLoanForms).mockResolvedValue({ a1: form({ loan_id: 'a1' }) } as never);
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByText('To pay out (1)'));
    fireEvent.click(await within(screen.getByTestId('loan-a1')).findByRole('button', { name: 'Sign the approval' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByAltText('Your signature');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign the approval' }));
    await vi.waitFor(() => expect(formApi.signAsApprover).toHaveBeenCalledWith('a1', 'data:image/png;base64,SIG'));
  });

  it('HR without the payments module is told finance pays the loan out', async () => {
    render(<LoansAdmin />);
    await screen.findByTestId('loan-r1');
    fireEvent.click(screen.getByText('To pay out (1)'));
    expect(within(screen.getByTestId('loan-a1')).getByText(/Waiting for finance to pay it/)).toBeTruthy();
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

  it('someone who may not manage loans or decide the step sees no buttons', async () => {
    chain.can = false;
    perms.role = 'MANAGER';
    perms.modules = ['dashboard', 'employees', 'employee-edit', 'leaves', 'expenses', 'salaryadmin', 'team-work'];
    render(<LoansAdmin />);
    const card = await screen.findByTestId('loan-r1');
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New loan' })).toBeNull();
  });

  it('the Payroll module sets up loans (Checker by default); approving is for the step’s approvers', async () => {
    chain.can = false;
    perms.role = 'CHECKER';
    perms.modules = ['dashboard', 'employees', 'payroll', 'settings'];
    render(<LoansAdmin />);
    const card = await screen.findByTestId('loan-r1');
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull();
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
    chain.can = false;
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
