import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import LoanAgreementDocument from './LoanAgreementDocument';
import { loanSchedule } from '../../lib/loans';
import { DEFAULT_LOAN_FORM_SETTINGS, type LoanForm } from '../../lib/loanForm';
import type { LoanFormContext } from '../../lib/loanFormApi';
import type { EmployeeLoan } from '../../lib/loansApi';

afterEach(cleanup);

const LOAN: EmployeeLoan = {
  id: '1a2b3c4d-0000-0000-0000-000000000000',
  employee_number: 'E1',
  employee_name: 'Jane Wanjiru',
  product_id: null,
  product_name: 'Emergency loan',
  principal: 30000,
  annual_rate: 20,
  interest_method: 'upfront',
  months: 3,
  start_period: '2026-12',
  monthly_instalment: 10000,
  total_interest: 6000,
  total_repayable: 30000,
  status: 'approved',
  reason: 'School fees',
  decided_by: 'u1',
  decided_by_email: 'hr@farm.co.ke',
  decided_at: '2026-11-18T09:00:00Z',
  decision_comment: null,
  disbursed_by_email: null,
  disbursed_at: null,
  created_at: '2026-11-17T09:00:00Z',
  residential_address: 'Kileleshwa, Nairobi',
  other_loan_repayments: 2000,
  disbursement_account: '0712 345 678',
};

const CONTEXT: LoanFormContext = {
  settings: { ...DEFAULT_LOAN_FORM_SETTINGS, lender_name: 'Moneysta Capital Investment Ltd', late_charge_percent: 10, incapacity_terms: 'The balance is written off.' },
  lender: {
    name: 'Moneysta Capital Investment Ltd', licence: 'CBK-licensed digital credit provider', address: 'Enterprise Road, Nairobi', postalAddress: null,
    phone: '+254 700 594 586', email: 'info@moneysta.co.ke', complaintsEmail: 'compliance@moneysta.co.ke', logoUrl: null,
  },
  borrower: {
    fullName: 'Jane Wanjiru', idNumber: '12345678', kraPin: 'A001', dateOfBirth: '1990-05-01', mobile: '0712345678', email: 'jane@farm.co.ke', town: 'Nairobi',
    employer: 'Favour Farm Ltd', workstation: 'Thika', jobTitle: 'Supervisor', employeeNumber: 'E1', payrollNumber: null, employmentType: 'Permanent',
    contractEndDate: null, basicSalary: 45000,
  },
  latestPay: { gross: 50000, net: 38000, period: '2026-10' },
  payout: null,
};

const FORM: LoanForm = {
  loan_id: LOAN.id, required: true, borrower_signature: 'data:image/png;base64,BORROWER', borrower_signed_at: '2026-11-18T10:00:00Z',
  approver_signature: 'data:image/png;base64,APPROVER', approver_name: 'Hana Hr', approver_title: 'HR Manager', approver_signed_at: '2026-11-18T09:00:00Z',
  status: 'none', file_path: null, file_name: null, uploaded_at: null, send_back_reason: null, employer_signature: null, employer_officer: null,
  employer_officer_title: null, reviewed_at: null,
};

const renderForm = (form: LoanForm | null = FORM, loan: EmployeeLoan = LOAN) =>
  render(<LoanAgreementDocument loan={loan} form={form} context={CONTEXT} schedule={loanSchedule(30000, 20, 3, 'upfront', '2026-12')} />);

describe('the loan agreement form', () => {
  it('names the lender, the borrower and the key facts', () => {
    renderForm();
    const doc = screen.getByTestId('loan-agreement');
    expect(within(doc).getAllByText('Moneysta Capital Investment Ltd').length).toBeGreaterThan(0);
    expect(within(doc).getByText('CBK-licensed digital credit provider')).toBeTruthy();
    expect(within(doc).getAllByText('LN-1A2B3C4D').length).toBe(2);
    expect(within(doc).getByText('KSh 24,000')).toBeTruthy(); // net disbursement
    expect(within(doc).getByText('KSh 6,000')).toBeTruthy(); // upfront interest
    expect(within(doc).getByText('Paid to 0712 345 678')).toBeTruthy();
    expect(within(doc).getByText('10% of overdue amount, charged once; not compounded')).toBeTruthy();
    expect(doc.textContent).toMatch(/allow Moneysta Capital Investment Ltd to confirm your identity/);
    expect(doc.textContent).toMatch(/complain by email to compliance@moneysta.co.ke/);
  });

  it('carries the borrower’s signature twice and the approver’s once; the employer’s only once HR accepts', () => {
    renderForm();
    expect(screen.getAllByAltText("Borrower's signature")).toHaveLength(2);
    expect(screen.getByAltText("Approver's signature").getAttribute('src')).toBe('data:image/png;base64,APPROVER');
    expect(screen.queryByAltText("Employer officer's signature")).toBeNull();
    cleanup();
    renderForm({ ...FORM, status: 'accepted', employer_signature: 'data:image/png;base64,EMPLOYER', employer_officer: 'Owen Officer', reviewed_at: '2026-11-19T10:00:00Z' });
    expect(screen.getByAltText("Employer officer's signature")).toBeTruthy();
    expect(screen.getByText('Owen Officer')).toBeTruthy();
  });

  it('a request is a draft without signatures', () => {
    renderForm(null, { ...LOAN, status: 'requested', decided_at: null });
    expect(screen.getByText(/Draft: these figures are worked out from the request/)).toBeTruthy();
    expect(screen.queryByAltText("Borrower's signature")).toBeNull();
  });

  it('without a late charge, says none applies', () => {
    render(
      <LoanAgreementDocument
        loan={LOAN}
        form={FORM}
        context={{ ...CONTEXT, settings: { ...CONTEXT.settings, late_charge_percent: null } }}
        schedule={loanSchedule(30000, 20, 3, 'upfront', '2026-12')}
      />
    );
    expect(screen.getByTestId('loan-agreement').textContent).toMatch(/No late repayment penalty applies/);
  });
});
