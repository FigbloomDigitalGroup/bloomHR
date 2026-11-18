import { addMonths, loanPaidOut, scheduleTotals, type InterestMethod, type LoanInstalment, type LoanStatus } from './loans';

// The loan agreement form (migration 20261118100000): the check-off loan application with its key facts statement,
// repayment schedule, terms, salary deduction authority, declaration and lender approval, filled in from the loan and
// signed with people's saved signatures. These are the sums and words it needs; LoanAgreementDocument draws it.

export type LoanFormStatus = 'none' | 'uploaded' | 'accepted' | 'sent_back';

/** One approved loan's form (employee_loan_forms). */
export interface LoanForm {
  loan_id: string;
  required: boolean;
  borrower_signature: string | null;
  borrower_signed_at: string | null;
  approver_signature: string | null;
  approver_name: string | null;
  approver_title: string | null;
  approver_signed_at: string | null;
  status: LoanFormStatus;
  file_path: string | null;
  file_name: string | null;
  uploaded_at: string | null;
  send_back_reason: string | null;
  employer_signature: string | null;
  employer_officer: string | null;
  employer_officer_title: string | null;
  reviewed_at: string | null;
  /** the witness, added in the app (20261118200000) */
  witness_name?: string | null;
  witness_id_number?: string | null;
  witness_signature?: string | null;
  witness_signed_at?: string | null;
  /** HR's part: who did the affordability assessment, and the checklist items ticked */
  affordability_by?: string | null;
  checks?: ChecklistItem[];
}

/** The checklist items HR ticks; "Signed application/agreement Loan form" ticks itself once HR accepts the form. */
export const CHECKLIST = [
  { id: 'guarantor_docs', label: 'Signed Guarantor section, Guarantor ID & KRA' },
  { id: 'id_kra', label: 'Applicants Copy of National ID / passport & KRA Pin' },
  { id: 'payslips', label: 'Latest three months’ pay slips or employer salary confirmation' },
] as const;

/** The colleague asked to witness the borrower's signature (employee_loan_witnesses, 20261118400000). */
export interface LoanWitness {
  loan_id: string;
  employee_number: string;
  witness_name: string;
  status: 'asked' | 'signed' | 'declined';
  decline_reason: string | null;
  signed_at: string | null;
}

/**
 * The details on the form that can be corrected for one loan when the employee record has them wrong or missing
 * (employee_loan_form_values, 20261118400000). Corrections show on the form; the record stays as it is.
 */
export const FORM_VALUE_FIELDS = [
  { id: 'id_number', label: 'National ID / Passport number' },
  { id: 'kra_pin', label: 'KRA PIN' },
  { id: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { id: 'mobile', label: 'Mobile number (registered M-Pesa line)' },
  { id: 'email', label: 'Email address' },
  { id: 'town', label: 'County / Town' },
  { id: 'workstation', label: 'Workstation / Department' },
  { id: 'job_title', label: 'Job title' },
  { id: 'payroll_number', label: 'Payroll number' },
  { id: 'employment_type', label: 'Employment type (Permanent, Fixed term or Probation)' },
  { id: 'contract_end_date', label: 'Contract end date', type: 'date' },
  { id: 'gross_salary', label: 'Gross monthly salary (KSh)', type: 'number' },
  { id: 'net_salary', label: 'Net monthly salary before this loan (KSh)', type: 'number' },
] as const;
export type FormValueField = (typeof FORM_VALUE_FIELDS)[number]['id'];
export type FormValues = Partial<Record<FormValueField, string>>;

/** What the record says for each correctable field, as text (gross and net from the latest payslip, or basic pay). */
export function recordValues(borrower: BorrowerDetails, latestPay: { gross: number; net: number } | null): FormValues {
  const out: FormValues = {
    id_number: borrower.idNumber ?? undefined,
    kra_pin: borrower.kraPin ?? undefined,
    date_of_birth: borrower.dateOfBirth ?? undefined,
    mobile: borrower.mobile ?? undefined,
    email: borrower.email ?? undefined,
    town: borrower.town ?? undefined,
    workstation: borrower.workstation ?? undefined,
    job_title: borrower.jobTitle ?? undefined,
    payroll_number: borrower.payrollNumber ?? undefined,
    employment_type: borrower.employmentType ?? undefined,
    contract_end_date: borrower.contractEndDate ?? undefined,
    gross_salary: latestPay ? String(latestPay.gross) : borrower.basicSalary !== null ? String(borrower.basicSalary) : undefined,
    net_salary: latestPay ? String(latestPay.net) : undefined,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== '')) as FormValues;
}

/** The borrower's details and pay with the loan's corrections on top. */
export function withCorrections(
  borrower: BorrowerDetails,
  latestPay: { gross: number; net: number; period: string } | null,
  values: FormValues
): { borrower: BorrowerDetails; latestPay: { gross: number; net: number; period: string } | null } {
  const v = (k: FormValueField, fallback: string | null) => values[k] ?? fallback;
  const gross = values.gross_salary ?? (latestPay ? String(latestPay.gross) : borrower.basicSalary !== null ? String(borrower.basicSalary) : null);
  const net = values.net_salary ?? (latestPay ? String(latestPay.net) : null);
  return {
    borrower: {
      ...borrower,
      idNumber: v('id_number', borrower.idNumber),
      kraPin: v('kra_pin', borrower.kraPin),
      dateOfBirth: v('date_of_birth', borrower.dateOfBirth),
      mobile: v('mobile', borrower.mobile),
      email: v('email', borrower.email),
      town: v('town', borrower.town),
      workstation: v('workstation', borrower.workstation),
      jobTitle: v('job_title', borrower.jobTitle),
      payrollNumber: v('payroll_number', borrower.payrollNumber),
      employmentType: v('employment_type', borrower.employmentType),
      contractEndDate: v('contract_end_date', borrower.contractEndDate),
    },
    latestPay:
      gross === null && net === null && !latestPay
        ? null
        : { gross: Number(gross ?? 0), net: Number(net ?? 0), period: latestPay?.period ?? '' },
  };
}

/** The colleague who guarantees a loan (employee_loan_guarantors, 20261118200000). */
export interface LoanGuarantor {
  loan_id: string;
  employee_number: string;
  guarantor_name: string;
  status: 'asked' | 'signed' | 'declined';
  decline_reason: string | null;
  relationship: string | null;
  alternative_phone: string | null;
  residential_address: string | null;
  id_number: string | null;
  kra_pin: string | null;
  date_of_birth: string | null;
  mobile: string | null;
  email: string | null;
  town: string | null;
  signature: string | null;
  signed_at: string | null;
}
export type ChecklistItem = (typeof CHECKLIST)[number]['id'];

/** Who lends, as the form's heading and terms name them (the company itself when no other lender is set). */
export interface LenderDetails {
  name: string;
  /** e.g. "CBK-licensed digital credit provider" */
  licence: string | null;
  address: string | null;
  postalAddress: string | null;
  phone: string | null;
  email: string | null;
  complaintsEmail: string | null;
  logoUrl: string | null;
}

/** The form's own settings (on loan_settings). */
export interface LoanFormSettings {
  lender_name: string | null;
  lender_licence: string | null;
  lender_address: string | null;
  lender_postal_address: string | null;
  lender_phone: string | null;
  lender_email: string | null;
  complaints_email: string | null;
  /** the one-off charge on an overdue amount, printed on the form; null = none */
  late_charge_percent: number | null;
  /** what happens to the balance if the borrower dies or is permanently incapacitated */
  incapacity_terms: string | null;
  require_signed_form: boolean;
}

export const DEFAULT_LOAN_FORM_SETTINGS: LoanFormSettings = {
  lender_name: null,
  lender_licence: null,
  lender_address: null,
  lender_postal_address: null,
  lender_phone: null,
  lender_email: null,
  complaints_email: null,
  late_charge_percent: null,
  incapacity_terms: null,
  require_signed_form: true,
};

/** The company profile fields the lender falls back to. */
export interface CompanyForLender {
  company_name: string | null;
  logo_url: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  official_phone: string | null;
  official_email: string | null;
}

const clean = (v: string | null | undefined) => (v ?? '').trim() || null;

/**
 * The lender on the form: the one in the loan settings when a name is set (a company lending through an outside
 * lender), otherwise the company itself, from its profile. Settings fields fill in only what they have.
 */
export function lenderDetails(settings: LoanFormSettings, company: CompanyForLender | null): LenderDetails {
  const own = !clean(settings.lender_name);
  const companyAddress = [company?.address_line1, company?.address_line2, company?.city].map(clean).filter(Boolean).join(', ') || null;
  return {
    name: clean(settings.lender_name) ?? clean(company?.company_name) ?? 'The Lender',
    licence: clean(settings.lender_licence),
    address: clean(settings.lender_address) ?? (own ? companyAddress : null),
    postalAddress: clean(settings.lender_postal_address) ?? (own ? clean(company?.postal_code) : null),
    phone: clean(settings.lender_phone) ?? (own ? clean(company?.official_phone) : null),
    email: clean(settings.lender_email) ?? (own ? clean(company?.official_email) : null),
    complaintsEmail: clean(settings.complaints_email) ?? clean(settings.lender_email) ?? (own ? clean(company?.official_email) : null),
    logoUrl: own ? clean(company?.logo_url) : null,
  };
}

/** The agreement reference printed on the form: LN-1A2B3C4D (from the loan's id, so it never changes). */
export const loanReference = (loanId: string) => `LN-${loanId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

/** The day an instalment is due: the last day of its pay month. */
export const dueDate = (period: string): Date => {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m, 0);
};

/** dd/mm/yyyy, as the form's date boxes are. */
export const formDate = (value: Date | string | null | undefined): string => {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/**
 * The annual percentage rate: the monthly rate at which the money received (`netReceived`, now) equals the
 * instalments (one a month, the first a month later), times 12. Null when it can't be worked out (nothing received,
 * nothing repaid, or less repaid than received).
 */
export function annualPercentageRate(netReceived: number, payments: number[]): number | null {
  const total = payments.reduce((s, p) => s + p, 0);
  if (!(netReceived > 0) || payments.length === 0 || !(total > 0)) return null;
  if (total < netReceived) return null;
  const presentValue = (r: number) => payments.reduce((s, p, i) => s + p / Math.pow(1 + r, i + 1), 0);
  let low = 0;
  let high = 1;
  while (presentValue(high) > netReceived && high < 1e6) high *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (presentValue(mid) > netReceived) low = mid;
    else high = mid;
  }
  return Math.round(((low + high) / 2) * 12 * 1000) / 10;
}

/** The loan fields the key facts need. */
export interface LoanForFacts {
  principal: number;
  annual_rate: number;
  interest_method: InterestMethod;
  months: number;
  start_period: string;
  total_interest: number | null;
}

export interface KeyFacts {
  grossLoan: number;
  months: number;
  rate: number;
  method: InterestMethod;
  /** interest taken off the payout (up-front loans); 0 otherwise */
  upfrontInterest: number;
  /** interest charged over the term (reducing balance and flat loans); 0 for up-front */
  termInterest: number;
  netDisbursement: number;
  totalRepayable: number;
  instalments: number;
  monthlyInstalment: number;
  apr: number | null;
  firstDue: Date | null;
  finalDue: Date | null;
  schedule: { no: number; due: Date; payment: number; balanceAfter: number }[];
}

/** The key facts statement and repayment schedule for a loan, from its schedule. */
export function keyFacts(loan: LoanForFacts, schedule: LoanInstalment[]): KeyFacts {
  const totals = scheduleTotals(schedule);
  const upfront = loan.interest_method === 'upfront';
  const netDisbursement = loanPaidOut({ principal: loan.principal, interest_method: loan.interest_method, total_interest: loan.total_interest ?? totals.totalInterest });
  let owed = totals.totalRepayable;
  const rows = schedule.map((i) => {
    owed = Math.round((owed - i.payment) * 100) / 100;
    return { no: i.instalment_no, due: dueDate(i.period), payment: i.payment, balanceAfter: Math.max(0, owed) };
  });
  return {
    grossLoan: loan.principal,
    months: loan.months,
    rate: loan.annual_rate,
    method: loan.interest_method,
    upfrontInterest: upfront ? totals.totalInterest : 0,
    termInterest: upfront ? 0 : totals.totalInterest,
    netDisbursement,
    totalRepayable: totals.totalRepayable,
    instalments: schedule.length,
    monthlyInstalment: totals.instalment,
    apr: annualPercentageRate(netDisbursement, schedule.map((i) => i.payment)),
    firstDue: schedule.length ? dueDate(schedule[0].period) : loan.start_period ? dueDate(loan.start_period) : null,
    finalDue: schedule.length ? dueDate(schedule[schedule.length - 1].period) : loan.start_period ? dueDate(addMonths(loan.start_period, loan.months - 1)) : null,
    schedule: rows,
  };
}

/** The borrower's details from their employee record (whatever of these the company keeps). */
export interface BorrowerDetails {
  fullName: string;
  idNumber: string | null;
  kraPin: string | null;
  dateOfBirth: string | null;
  mobile: string | null;
  email: string | null;
  town: string | null;
  employer: string | null;
  workstation: string | null;
  jobTitle: string | null;
  employeeNumber: string;
  payrollNumber: string | null;
  employmentType: string | null;
  contractEndDate: string | null;
  basicSalary: number | null;
}

const field = (row: Record<string, unknown>, ...names: string[]) => {
  for (const n of names) {
    const v = row[n];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return null;
};

/** The borrower's details out of an employees row (columns the company doesn't use come out empty). */
export function borrowerFromEmployee(row: Record<string, unknown>, employer: string | null): BorrowerDetails {
  const salary = parseFloat(String(row['Basic Salary'] ?? '').replace(/[^0-9.]/g, ''));
  return {
    fullName: [row['First Name'], row['Middle Name'], row['Last Name']].map((v) => String(v ?? '').trim()).filter(Boolean).join(' '),
    idNumber: field(row, 'ID Number', 'National ID', 'Passport Number'),
    kraPin: field(row, 'Tax PIN', 'KRA PIN'),
    dateOfBirth: field(row, 'Date of Birth'),
    mobile: field(row, 'Mobile Number', 'Personal Mobile', 'Work Mobile'),
    email: field(row, 'Personal Email', 'Work Email'),
    town: field(row, 'Town'),
    employer,
    workstation: [field(row, 'Office', 'Office Branch', 'Branch'), field(row, 'Department')].filter(Boolean).join(' / ') || null,
    jobTitle: field(row, 'Job Title'),
    employeeNumber: String(row['Employee Number'] ?? ''),
    payrollNumber: field(row, 'Payroll Number'),
    employmentType: field(row, 'Employee Type', 'Employment Type'),
    contractEndDate: field(row, 'Contract End Date'),
    basicSalary: Number.isFinite(salary) ? salary : null,
  };
}

/** Which of the form's employment boxes the employee type ticks. */
export const employmentBox = (type: string | null): 'permanent' | 'fixed_term' | 'probation' | null => {
  const t = (type ?? '').toLowerCase();
  if (!t) return null;
  if (t.includes('probation')) return 'probation';
  if (t.includes('permanent')) return 'permanent';
  if (t.includes('contract') || t.includes('fixed') || t.includes('temporary') || t.includes('casual')) return 'fixed_term';
  return null;
};

/** Where a loan's form stands, for the borrower and HR. */
export function formStage(
  loan: { status: LoanStatus },
  form: LoanForm | null | undefined,
  ready = false
): { label: string; tone: 'neutral' | 'warning' | 'info' | 'success' | 'danger' } {
  if (!form) return loan.status === 'requested' ? { label: 'Form: signed after approval', tone: 'neutral' } : { label: 'No form', tone: 'neutral' };
  if (form.status === 'accepted') return { label: 'Signed form accepted', tone: 'success' };
  if (form.status === 'uploaded' || ready) return { label: 'Signed form to review', tone: 'info' };
  if (form.status === 'sent_back') return { label: 'Signed form sent back', tone: 'danger' };
  if (loan.status !== 'approved') return { label: 'Form not uploaded', tone: 'neutral' };
  return form.borrower_signature ? { label: 'Signed, to upload', tone: 'warning' } : { label: 'Form to sign', tone: 'warning' };
}

/**
 * Signed by the borrower, witnessed and (when the form is required) guaranteed in the app, the witness since HR last
 * sent it back: ready for HR without an upload (as the database's loan_form_signed_in_app).
 */
export const readyInApp = (form: LoanForm | null | undefined, guarantor: Pick<LoanGuarantor, 'status'> | null | undefined) =>
  !!form &&
  (form.status === 'none' || form.status === 'sent_back') &&
  !!form.borrower_signature &&
  !!form.witness_signature &&
  (!form.reviewed_at || (form.witness_signed_at ?? '') > form.reviewed_at) &&
  (!form.required || guarantor?.status === 'signed');

/** Payout waits for this loan's signed form. */
export const formHoldsPayout = (form: LoanForm | null | undefined) => !!form && form.required && form.status !== 'accepted';

/** A file name for the form: loan-form-LN-1A2B3C4D-jane-wanjiku.pdf */
export const loanFormFileName = (loanId: string, name: string) =>
  `loan-form-${loanReference(loanId)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'borrower'}.pdf`;

export const MAX_FORM_BYTES = 20 * 1024 * 1024;

/** What is wrong with a signed copy before it is uploaded, or null. */
export function signedFormProblem(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.pdf$/i.test(file.name)) return 'Upload the signed form as a PDF. Signed on paper? Scan it to PDF (most phone scanner apps can).';
  if (file.size > MAX_FORM_BYTES) return 'The file is over 20 MB. Scan it at a lower quality and try again.';
  if (file.size === 0) return 'The file is empty.';
  return null;
}
