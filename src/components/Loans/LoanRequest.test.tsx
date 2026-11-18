import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../lib/loansApi', () => ({
  loadLoanSettings: vi.fn(),
  loadLoanProducts: vi.fn(),
  loadMyLoans: vi.fn(),
  requestLoan: vi.fn(),
  withdrawLoan: vi.fn(),
}));
vi.mock('../../lib/salaryAdvanceApi', () => ({ loadMyEmployee: vi.fn() }));
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
}));
// everyone here has a saved signature
vi.mock('../../lib/signatures', () => ({
  loadMySignature: vi.fn(async () => 'data:image/png;base64,SIG'),
  saveMySignature: vi.fn(),
  clearMySignature: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: new Proxy({}, { get: () => { throw new Error('supabase used'); } }) }));

import * as api from '../../lib/loansApi';
import * as advanceApi from '../../lib/salaryAdvanceApi';
import * as formApi from '../../lib/loanFormApi';
import { DEFAULT_LOAN_SETTINGS, loanSchedule } from '../../lib/loans';
import LoanRequest from './LoanRequest';

const mocked = vi.mocked(api);
const ME = { employeeNumber: 'E1', fullName: 'Jane Wanjiru', office: 'Nairobi', basicSalary: '50000', terminated: false };
const SETTINGS = { ...DEFAULT_LOAN_SETTINGS, max_salary_multiple: 3 };
const PRODUCTS = [{ id: 'p1', name: 'School fees loan', annual_rate: 6, interest_method: 'flat' as const, max_months: 6, active: true }];

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

const loan = (over: Record<string, unknown>) => ({
  id: 'l1',
  employee_number: 'E1',
  product_id: null,
  product_name: null,
  principal: 12000,
  annual_rate: 0,
  interest_method: 'reducing_balance',
  months: 3,
  start_period: '2026-10',
  monthly_instalment: 4000,
  total_interest: 0,
  total_repayable: 12000,
  status: 'repaying',
  reason: 'Rent',
  decided_by_email: null,
  decided_at: null,
  decision_comment: null,
  disbursed_by_email: null,
  disbursed_at: null,
  created_at: '2026-09-20T10:00:00Z',
  schedule: loanSchedule(12000, 0, 3, 'reducing_balance', '2026-10'),
  repayments: [{ loan_id: 'l1', pay_period: '2026-10', amount: 4000 }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(advanceApi.loadMyEmployee).mockResolvedValue(ME);
  mocked.loadLoanSettings.mockResolvedValue(SETTINGS);
  mocked.loadLoanProducts.mockResolvedValue(PRODUCTS);
  mocked.loadMyLoans.mockResolvedValue([]);
  mocked.requestLoan.mockResolvedValue(undefined);
  mocked.withdrawLoan.mockResolvedValue(undefined);
  vi.mocked(formApi.loadLoanForms).mockResolvedValue({});
  vi.mocked(formApi.signAsBorrower).mockResolvedValue(undefined);
  vi.mocked(formApi.uploadSignedForm).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const amount = () => screen.getByLabelText('Amount (KSh)');

describe('applying for a loan', () => {
  it('works out the instalment, the interest and the total as they type', async () => {
    render(<LoanRequest />);
    expect(await screen.findByText('KSh 150,000')).toBeTruthy(); // 3 x basic salary
    fireEvent.change(amount(), { target: { value: '100000' } });
    const preview = screen.getByTestId('loan-preview');
    // 12% a year, reducing balance, over the default 12 months
    expect(within(preview).getByText('KSh 8,885')).toBeTruthy();
    expect(within(preview).getByText('KSh 6,619')).toBeTruthy();
    expect(within(preview).getByText('KSh 106,619')).toBeTruthy();

    // a loan type with its own (flat) rate and a shorter longest term
    fireEvent.change(screen.getByLabelText('Type of loan'), { target: { value: 'p1' } });
    expect((screen.getByLabelText('Repay over (months)') as HTMLSelectElement).value).toBe('6');
    expect(within(screen.getByTestId('loan-preview')).getByText('KSh 3,000')).toBeTruthy(); // 6% flat for 6 months
    expect(within(screen.getByTestId('loan-preview')).getByText('KSh 103,000')).toBeTruthy();
  });

  it('blocks more than the limit and a missing reason', async () => {
    render(<LoanRequest />);
    await screen.findByText('KSh 150,000');
    fireEvent.change(amount(), { target: { value: '200000' } });
    expect(screen.getByRole('alert').textContent).toBe('The most you can borrow is KSh 150,000.');
    expect(screen.queryByTestId('loan-preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    expect(mocked.requestLoan).not.toHaveBeenCalled();
  });

  it('sends the request', async () => {
    render(<LoanRequest />);
    await screen.findByText('KSh 150,000');
    fireEvent.change(amount(), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText('Repay over (months)'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('What is it for?'), { target: { value: 'School fees for next term' } });
    fireEvent.change(screen.getByLabelText('Where you live (residential address)'), { target: { value: 'Kileleshwa, Nairobi' } });
    fireEvent.change(screen.getByLabelText('Other loan repayments a month (KSh)'), { target: { value: '2000' } });
    fireEvent.change(screen.getByLabelText('Pay the loan to (M-Pesa number or account)'), { target: { value: '0712 345 678' } });
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    await vi.waitFor(() =>
      expect(mocked.requestLoan).toHaveBeenCalledWith(ME, {
        productId: null,
        amount: 60000,
        months: 6,
        reason: 'School fees for next term',
        details: { residentialAddress: 'Kileleshwa, Nairobi', otherLoanRepayments: '2000', disbursementAccount: '0712 345 678' },
      }),
    );
  });

  it('cannot apply while applications are closed', async () => {
    mocked.loadLoanSettings.mockResolvedValue({ ...SETTINGS, staff_can_apply: false });
    render(<LoanRequest />);
    expect(await screen.findByText('Loan applications are closed. Please speak to HR.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Send request/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('my loans', () => {
  it('shows the balance, the schedule and the reason for a decline', async () => {
    mocked.loadMyLoans.mockResolvedValue([
      loan({}),
      loan({ id: 'l2', status: 'rejected', decision_comment: 'Still repaying the last one', principal: 5000 }),
    ] as never);
    render(<LoanRequest />);
    expect(await screen.findByText('KSh 4,000 of KSh 12,000 repaid')).toBeTruthy();
    expect(screen.getByText('Still repaying the last one')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See schedule' }));
    expect(screen.getByText('Taken by payroll')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(5); // header, three months, total
  });

  it('withdraws a request still waiting, after asking', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    mocked.loadMyLoans.mockResolvedValue([loan({ status: 'requested', repayments: [] })] as never);
    render(<LoanRequest />);
    expect(await screen.findByText('You already have a loan request waiting for a decision.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    await vi.waitFor(() => expect(mocked.withdrawLoan).toHaveBeenCalledWith('l1'));
  });
});

describe('the loan form', () => {
  it('an approved loan is signed with the saved signature, then the signed copy is uploaded', async () => {
    mocked.loadMyLoans.mockResolvedValue([loan({ status: 'approved', repayments: [] })] as never);
    vi.mocked(formApi.loadLoanForms).mockResolvedValue({ l1: form({ loan_id: 'l1' }) } as never);
    render(<LoanRequest />);
    expect(await screen.findByText('Form to sign')).toBeTruthy();
    expect(screen.getByText(/finance pays it out once HR accepts the signed copy/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign with my signature' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByAltText('Your signature');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign the form' }));
    await vi.waitFor(() => expect(formApi.signAsBorrower).toHaveBeenCalledWith('l1', 'data:image/png;base64,SIG'));

    const pdf = new File(['%PDF'], 'signed.pdf', { type: 'application/pdf' });
    fireEvent.change(document.getElementById('loan-form-file-l1')!, { target: { files: [pdf] } });
    await vi.waitFor(() => expect(formApi.uploadSignedForm).toHaveBeenCalledWith(expect.objectContaining({ id: 'l1' }), pdf));
  });

  it('a request has only a draft form; an accepted one has nothing left to do', async () => {
    mocked.loadMyLoans.mockResolvedValue([loan({ status: 'requested', repayments: [] }), loan({ id: 'l2', status: 'approved', repayments: [] })] as never);
    vi.mocked(formApi.loadLoanForms).mockResolvedValue({ l2: form({ loan_id: 'l2', status: 'accepted', file_path: 'p' }) } as never);
    render(<LoanRequest />);
    expect(await screen.findByText('Form: signed after approval')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Draft form' })).toBeTruthy();
    expect(screen.getByText('Signed form accepted')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sign with my signature|Upload signed form/ })).toBeNull();
  });
});
