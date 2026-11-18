import { describe, expect, it } from 'vitest';
import { loanSchedule } from './loans';
import {
  DEFAULT_LOAN_FORM_SETTINGS,
  annualPercentageRate,
  borrowerFromEmployee,
  dueDate,
  employmentBox,
  formDate,
  formHoldsPayout,
  formStage,
  keyFacts,
  lenderDetails,
  loanFormFileName,
  loanReference,
  signedFormProblem,
  type LoanForm,
} from './loanForm';

const COMPANY = {
  company_name: 'Favour Farm Ltd',
  logo_url: 'https://x/logo.png',
  address_line1: 'Plot 4, Thika Road',
  address_line2: null,
  city: 'Nairobi',
  postal_code: '00100',
  official_phone: '+254 711 000 000',
  official_email: 'hr@favourfarm.co.ke',
};

const form = (over: Partial<LoanForm> = {}): LoanForm => ({
  loan_id: 'l1', required: true, borrower_signature: null, borrower_signed_at: null, approver_signature: null, approver_name: null,
  approver_title: null, approver_signed_at: null, status: 'none', file_path: null, file_name: null, uploaded_at: null,
  send_back_reason: null, employer_signature: null, employer_officer: null, employer_officer_title: null, reviewed_at: null, ...over,
});

describe('the lender on the form', () => {
  it('is the company itself, from its profile, when no lender is set', () => {
    expect(lenderDetails(DEFAULT_LOAN_FORM_SETTINGS, COMPANY)).toEqual({
      name: 'Favour Farm Ltd',
      licence: null,
      address: 'Plot 4, Thika Road, Nairobi',
      postalAddress: '00100',
      phone: '+254 711 000 000',
      email: 'hr@favourfarm.co.ke',
      complaintsEmail: 'hr@favourfarm.co.ke',
      logoUrl: 'https://x/logo.png',
    });
  });

  it('is an outside lender when one is named: none of the company’s details or logo leak in', () => {
    const lender = lenderDetails(
      { ...DEFAULT_LOAN_FORM_SETTINGS, lender_name: 'Moneysta Capital Investment Ltd', lender_licence: 'CBK-licensed digital credit provider', lender_email: 'info@moneysta.co.ke' },
      COMPANY
    );
    expect(lender).toMatchObject({
      name: 'Moneysta Capital Investment Ltd',
      licence: 'CBK-licensed digital credit provider',
      address: null,
      phone: null,
      email: 'info@moneysta.co.ke',
      complaintsEmail: 'info@moneysta.co.ke',
      logoUrl: null,
    });
  });
});

describe('the key facts', () => {
  it('a 30,000 loan at 20% up front over 3 months: 6,000 off, 24,000 paid out, 10,000 a month', () => {
    const loan = { principal: 30000, annual_rate: 20, interest_method: 'upfront' as const, months: 3, start_period: '2026-12', total_interest: 6000 };
    const facts = keyFacts(loan, loanSchedule(30000, 20, 3, 'upfront', '2026-12'));
    expect(facts).toMatchObject({ grossLoan: 30000, upfrontInterest: 6000, termInterest: 0, netDisbursement: 24000, totalRepayable: 30000, instalments: 3, monthlyInstalment: 10000 });
    expect(facts.schedule.map((r) => [formDate(r.due), r.payment, r.balanceAfter])).toEqual([
      ['31/12/2026', 10000, 20000],
      ['31/01/2027', 10000, 10000],
      ['28/02/2027', 10000, 0],
    ]);
    expect(formDate(facts.firstDue)).toBe('31/12/2026');
    expect(formDate(facts.finalDue)).toBe('28/02/2027');
    expect(facts.apr).toBeGreaterThan(144);
    expect(facts.apr).toBeLessThan(145);
  });

  it('a reducing balance loan pays out the whole amount and shows its interest over the term', () => {
    const loan = { principal: 100000, annual_rate: 12, interest_method: 'reducing_balance' as const, months: 12, start_period: '2026-11', total_interest: 6619 };
    const facts = keyFacts(loan, loanSchedule(100000, 12, 12, 'reducing_balance', '2026-11'));
    expect(facts).toMatchObject({ upfrontInterest: 0, termInterest: 6619, netDisbursement: 100000, totalRepayable: 106619 });
    // the annual percentage rate of a 12% reducing balance loan is 12%
    expect(facts.apr).toBe(12);
  });

  it('the APR needs money received and at least as much repaid', () => {
    expect(annualPercentageRate(0, [100])).toBeNull();
    expect(annualPercentageRate(100, [])).toBeNull();
    expect(annualPercentageRate(100, [40, 40])).toBeNull();
    expect(annualPercentageRate(100, [50, 50])).toBe(0);
  });

  it('an instalment is due on the last day of its month', () => {
    expect(formDate(dueDate('2028-02'))).toBe('29/02/2028');
    expect(formDate('not a date')).toBe('');
  });
});

describe('the borrower', () => {
  it('comes from the employee record, whatever the company keeps', () => {
    const b = borrowerFromEmployee(
      {
        'Employee Number': 'E1', 'First Name': 'Jane', 'Middle Name': 'W', 'Last Name': 'Wanjiru', 'ID Number': '12345678', 'Tax PIN': 'A001234567Z',
        'Date of Birth': '1990-05-01', 'Mobile Number': '0712345678', 'Work Email': 'jane@farm.co.ke', Office: 'Thika', Department: 'Dairy',
        'Job Title': 'Supervisor', 'Employee Type': 'Fixed Term Contract', 'Contract End Date': '2027-06-30', 'Basic Salary': '45,000',
      },
      'Favour Farm Ltd'
    );
    expect(b).toMatchObject({
      fullName: 'Jane W Wanjiru', idNumber: '12345678', kraPin: 'A001234567Z', mobile: '0712345678', email: 'jane@farm.co.ke',
      workstation: 'Thika / Dairy', employer: 'Favour Farm Ltd', employmentType: 'Fixed Term Contract', basicSalary: 45000, payrollNumber: null,
    });
    expect(employmentBox(b.employmentType)).toBe('fixed_term');
    expect(employmentBox('Permanent')).toBe('permanent');
    expect(employmentBox('On probation')).toBe('probation');
    expect(employmentBox(null)).toBeNull();
  });
});

describe('where the form stands', () => {
  it('follows the loan and the signed copy', () => {
    expect(formStage({ status: 'requested' }, undefined).label).toBe('Form: signed after approval');
    expect(formStage({ status: 'requested' }, form()).label).toBe('Form to sign');
    expect(formStage({ status: 'requested' }, form({ borrower_signature: 'x' })).label).toBe('Signed, to upload');
    expect(formStage({ status: 'approved' }, form()).label).toBe('Form to sign');
    expect(formStage({ status: 'approved' }, form({ borrower_signature: 'x' })).label).toBe('Signed, to upload');
    expect(formStage({ status: 'approved' }, form({ status: 'uploaded' })).label).toBe('Signed form to review');
    expect(formStage({ status: 'approved' }, form({ status: 'sent_back' })).tone).toBe('danger');
    expect(formStage({ status: 'disbursed' }, form({ status: 'accepted' })).label).toBe('Signed form accepted');
  });

  it('holds the payout only when required and not yet accepted', () => {
    expect(formHoldsPayout(undefined)).toBe(false);
    expect(formHoldsPayout(form())).toBe(true);
    expect(formHoldsPayout(form({ required: false }))).toBe(false);
    expect(formHoldsPayout(form({ status: 'accepted' }))).toBe(false);
  });
});

describe('files and names', () => {
  it('names the reference and the file from the loan', () => {
    expect(loanReference('1a2b3c4d-5e6f-7a8b-9c0d-112233445566')).toBe('LN-1A2B3C4D');
    expect(loanFormFileName('1a2b3c4d-5e6f', 'Jane W. Wanjiru')).toBe('loan-form-LN-1A2B3C4D-jane-w-wanjiru.pdf');
  });

  it('takes only a PDF up to 20 MB as the signed copy', () => {
    expect(signedFormProblem({ name: 'form.pdf', size: 1000 })).toBeNull();
    expect(signedFormProblem({ name: 'form.jpg', size: 1000 })).toMatch(/PDF/);
    expect(signedFormProblem({ name: 'form.pdf', size: 21 * 1024 * 1024 })).toMatch(/20 MB/);
    expect(signedFormProblem({ name: 'form.pdf', size: 0 })).toMatch(/empty/);
  });
});

describe('the borrowing limit by monthly repayment (20261119300000)', () => {
  it('a third of basic salary a month: 3 months is the basic salary, 6 months twice it', async () => {
    const { DEFAULT_LOAN_SETTINGS, maxLoanFor } = await import('./loans');
    const s = { ...DEFAULT_LOAN_SETTINGS, max_instalment_divisor: 3 };
    expect(maxLoanFor(s, '74,784', { months: 3, rate: 20, method: 'upfront' })).toBe(74784);
    expect(maxLoanFor(s, 74784, { months: 6, rate: 25, method: 'upfront' })).toBe(149568);
    // the lowest limit wins
    expect(maxLoanFor({ ...s, max_amount: 100000 }, 74784, { months: 6, rate: 25, method: 'upfront' })).toBe(100000);
    // without it, the other limits as before
    expect(maxLoanFor({ ...DEFAULT_LOAN_SETTINGS, max_salary_multiple: 2 }, 74784, { months: 6, rate: 25, method: 'upfront' })).toBe(149568);
  });
});

