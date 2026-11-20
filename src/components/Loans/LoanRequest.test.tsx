import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../lib/loansApi', () => ({
  loadLoanSettings: vi.fn(),
  loadLoanProducts: vi.fn(),
  loadMyLoans: vi.fn(),
  requestLoan: vi.fn(),
  withdrawLoan: vi.fn(),
  loadFirstOpenPeriod: vi.fn(),
  loadMyPay: vi.fn(async () => ({ basic: null, net: null })),
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
  loadWitnesses: vi.fn(async () => ({})),
  loadFormValues: vi.fn(async () => ({})),
  saveFormValues: vi.fn(),
  setWitness: vi.fn(),
  loadMyWitnessing: vi.fn(async () => []),
  loadWitnessView: vi.fn(),
  signAsWitness: vi.fn(),
  declineWitness: vi.fn(),
  deleteCancelledLoan: vi.fn(),
  attachSignedForm: vi.fn(),
  loadAffordability: vi.fn(async () => ({})),
  confirmAffordability: vi.fn(),
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
import { DEFAULT_LOAN_SETTINGS, addMonths, currentPeriod, loanSchedule } from '../../lib/loans';
import { DEFAULT_LOAN_FORM_SETTINGS } from '../../lib/loanForm';
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
  mocked.requestLoan.mockResolvedValue('new-loan');
  // this month's payroll isn't approved yet
  mocked.loadFirstOpenPeriod.mockResolvedValue(currentPeriod());
  mocked.withdrawLoan.mockResolvedValue(undefined);
  vi.mocked(formApi.loadLoanForms).mockResolvedValue({});
  vi.mocked(formApi.signAsBorrower).mockResolvedValue(undefined);
  vi.mocked(formApi.uploadSignedForm).mockResolvedValue(undefined);
  vi.mocked(formApi.loadGuarantors).mockResolvedValue({});
  vi.mocked(formApi.loadGuarantorChoices).mockResolvedValue([{ employee_number: 'E2', name: 'Peter Otieno' }]);
  vi.mocked(formApi.loadLoanFormSettings).mockResolvedValue(DEFAULT_LOAN_FORM_SETTINGS);
  vi.mocked(formApi.setGuarantor).mockResolvedValue(undefined);
  vi.mocked(formApi.loadMyGuarantees).mockResolvedValue([]);
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
    // a guarantor is needed while the company requires the signed form
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    expect(await screen.findByText('Choose a colleague to guarantee your loan.')).toBeTruthy();
    expect(mocked.requestLoan).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Guarantor \(a colleague at the company\)/), { target: { value: 'E2' } });
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    await vi.waitFor(() =>
      expect(mocked.requestLoan).toHaveBeenCalledWith(ME, {
        productId: null,
        amount: 60000,
        months: 6,
        reason: 'School fees for next term',
        details: { residentialAddress: 'Kileleshwa, Nairobi', otherLoanRepayments: '2000', disbursementAccount: '0712 345 678' },
        startPeriod: addMonths(currentPeriod(), 1),
        statedNetPay: null,
      }),
    );
    await vi.waitFor(() => expect(formApi.setGuarantor).toHaveBeenCalledWith('new-loan', 'E2'));
  });

  it('may start repaying from this month’s pay while its payroll is open', async () => {
    render(<LoanRequest />);
    await screen.findByText('KSh 150,000');
    const start = screen.getByLabelText('Start repaying from') as HTMLSelectElement;
    expect(start.value).toBe(addMonths(currentPeriod(), 1));
    expect([...start.options].map((o) => o.value)).toEqual([currentPeriod(), addMonths(currentPeriod(), 1)]);
    expect(start.options[0].textContent).toMatch(/\(this month\)/);
    fireEvent.change(start, { target: { value: currentPeriod() } });
    fireEvent.change(amount(), { target: { value: '6000' } });
    fireEvent.change(screen.getByLabelText('What is it for?'), { target: { value: 'School fees for next term' } });
    fireEvent.change(screen.getByLabelText(/Guarantor \(a colleague at the company\)/), { target: { value: 'E2' } });
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    await vi.waitFor(() => expect(mocked.requestLoan).toHaveBeenCalledWith(ME, expect.objectContaining({ startPeriod: currentPeriod() })));
  });

  it('once this month’s payroll is approved, next month is the earliest', async () => {
    mocked.loadFirstOpenPeriod.mockResolvedValue(addMonths(currentPeriod(), 1));
    render(<LoanRequest />);
    await screen.findByText('KSh 150,000');
    const start = screen.getByLabelText('Start repaying from') as HTMLSelectElement;
    await vi.waitFor(() => expect([...start.options].map((o) => o.value)).toEqual([addMonths(currentPeriod(), 1), addMonths(currentPeriod(), 2)]));
  });

  it('with the take-home check on and an out-of-date payslip, asks for net pay; the limit follows it', async () => {
    mocked.loadLoanSettings.mockResolvedValue({ ...SETTINGS, interest_method: 'upfront', annual_rate: 20, max_salary_multiple: null, max_instalment_divisor: 3, min_take_home_divisor: 3 });
    // basic 50,000: a third is 16,667; with 30,000 net, the repayment can be at most 30,000 - 16,667 = 13,333 a month: 40,000 over 3 months
    render(<LoanRequest />);
    const net = await screen.findByLabelText('Your current net monthly pay (KSh)');
    fireEvent.change(net, { target: { value: '30000' } });
    fireEvent.change(screen.getByLabelText('Repay over (months)'), { target: { value: '3' } });
    expect((await screen.findByText(/You can borrow up to/)).textContent).toMatch(/KSh 40,000/);
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

describe('asked to witness', () => {
  it('a colleague signs as witness once the borrower has signed', async () => {
    vi.mocked(formApi.loadMyWitnessing).mockResolvedValue([{ loan_id: 'w1', witness_name: 'Jane Wanjiru', status: 'asked' }] as never);
    vi.mocked(formApi.loadWitnessView).mockResolvedValue({
      borrower_name: 'Peter Otieno', principal: 9000, months: 3, product_name: null, loan_status: 'approved', borrower_signed: true,
      borrower_signature: 'data:image/png;base64,PETER',
    });
    vi.mocked(formApi.signAsWitness).mockResolvedValue(undefined);
    render(<LoanRequest />);
    const section = await screen.findByTestId('witness-requests');
    expect(await within(section).findByText('Peter Otieno')).toBeTruthy();
    expect(within(section).getByAltText("The borrower's signature")).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Sign as witness' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByAltText('Your signature');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign as witness' }));
    await vi.waitFor(() => expect(formApi.signAsWitness).toHaveBeenCalledWith('w1', 'data:image/png;base64,SIG'));
  });

  it('before the borrower signs, the witness waits', async () => {
    vi.mocked(formApi.loadMyWitnessing).mockResolvedValue([{ loan_id: 'w1', witness_name: 'Jane Wanjiru', status: 'asked' }] as never);
    vi.mocked(formApi.loadWitnessView).mockResolvedValue({
      borrower_name: 'Peter Otieno', principal: 9000, months: 3, product_name: null, loan_status: 'requested', borrower_signed: false, borrower_signature: null,
    });
    render(<LoanRequest />);
    const section = await screen.findByTestId('witness-requests');
    expect(await within(section).findByText('Borrower signs first')).toBeTruthy();
    expect((within(section).getByRole('button', { name: 'Sign as witness' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('asked to guarantee', () => {
  it('a colleague reads the form and signs as guarantor with their saved signature', async () => {
    vi.mocked(formApi.loadMyGuarantees).mockResolvedValue([{ loan_id: 'g1', guarantor_name: 'Jane Wanjiru', status: 'asked' }] as never);
    vi.mocked(formApi.loadGuarantorView).mockResolvedValue({
      loan: { ...loan({ id: 'g1', status: 'approved', principal: 30000 }), employee_name: 'Peter Otieno' },
      schedule: [],
      guarantor: { loan_id: 'g1', guarantor_name: 'Jane Wanjiru', status: 'asked' },
      context: { settings: DEFAULT_LOAN_FORM_SETTINGS, lender: { name: 'Farm Ltd' }, borrower: { fullName: 'Peter Otieno' }, latestPay: null, payout: null },
    } as never);
    vi.mocked(formApi.signAsGuarantor).mockResolvedValue(undefined);
    render(<LoanRequest />);
    const section = await screen.findByTestId('guarantee-requests');
    expect(await within(section).findByText('Peter Otieno')).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Sign as guarantor' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByAltText('Your signature');
    const sign = within(dialog).getByRole('button', { name: 'Sign as guarantor' }) as HTMLButtonElement;
    expect(sign.disabled).toBe(true); // the relationship is needed
    fireEvent.change(within(dialog).getByLabelText('Relationship to borrower'), { target: { value: 'Colleague' } });
    fireEvent.click(sign);
    await vi.waitFor(() =>
      expect(formApi.signAsGuarantor).toHaveBeenCalledWith('g1', 'data:image/png;base64,SIG', { relationship: 'Colleague', alternativePhone: '', address: '' })
    );
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
