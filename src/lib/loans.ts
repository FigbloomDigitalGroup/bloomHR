// Employee loans: the instalment, the amortisation schedule, and what payroll takes back each month.
//
// The database builds each loan's schedule with the same sums (public.loan_schedule, migration 20261016700000); this is
// the copy the screens use for the preview while someone types, and payroll uses for what is due.
//
//   reducing balance: a fixed payment P·r / (1 − (1 + r)^−n), r the monthly rate (annual / 12). Each month's interest is
//                     r on what is still owed; the rest of the payment pays the loan down. A 0% loan is P / n a month.
//   flat:             interest is the annual rate on the whole amount for the whole term, spread evenly over the months.
//
// The schedule is in whole shillings; the last instalment takes the rounding so the principal and the interest add up
// exactly. Payroll takes everything due up to the month less what was already repaid, so a month that could not cover
// its instalment carries the shortfall forward.

export type InterestMethod = 'reducing_balance' | 'flat';

export type LoanStatus = 'requested' | 'approved' | 'rejected' | 'disbursed' | 'repaying' | 'completed' | 'cancelled';

export interface LoanSettings {
  annual_rate: number;
  interest_method: InterestMethod;
  min_months: number;
  max_months: number;
  /** the most anyone may borrow, in KSh; null = no fixed limit */
  max_amount: number | null;
  /** the most anyone may borrow as a multiple of their basic salary; null = no such limit */
  max_salary_multiple: number | null;
  staff_can_apply: boolean;
}

/** A company without saved settings lends on these (the database uses the same). */
export const DEFAULT_LOAN_SETTINGS: LoanSettings = {
  annual_rate: 12,
  interest_method: 'reducing_balance',
  min_months: 1,
  max_months: 12,
  max_amount: null,
  max_salary_multiple: null,
  staff_can_apply: true,
};

export interface LoanProduct {
  id: string;
  name: string;
  annual_rate: number;
  interest_method: InterestMethod;
  max_months: number;
  active: boolean;
}

export interface LoanInstalment {
  instalment_no: number;
  /** the pay month, 'YYYY-MM' */
  period: string;
  payment: number;
  principal: number;
  interest: number;
  /** principal still owed after this instalment */
  balance: number;
}

export interface LoanRepayment {
  loan_id: string;
  pay_period: string;
  amount: number;
}

export const INTEREST_METHODS: { id: InterestMethod; label: string; hint: string }[] = [
  { id: 'reducing_balance', label: 'Reducing balance', hint: 'Interest is charged on what is still owed, so it falls each month' },
  { id: 'flat', label: 'Flat rate', hint: 'Interest is charged on the full amount for the whole term' },
];

export const interestMethodLabel = (method: string | null | undefined) =>
  INTEREST_METHODS.find((m) => m.id === method)?.label ?? 'Reducing balance';

export const STATUS_LABELS: Record<LoanStatus, string> = {
  requested: 'Waiting for approval',
  approved: 'Approved, not paid out',
  rejected: 'Declined',
  disbursed: 'Paid out',
  repaying: 'Repaying',
  completed: 'Repaid',
  cancelled: 'Cancelled',
};

/** Loans payroll takes instalments for. */
export const ACTIVE_STATUSES: LoanStatus[] = ['disbursed', 'repaying'];

// half away from zero, as Postgres rounds numerics; the first step drops floating-point dust (0.4999999 -> 0.5)
const roundKsh = (n: number) => {
  const clean = Math.round(n * 1e6) / 1e6;
  return Math.sign(clean) * Math.round(Math.abs(clean));
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export const formatKsh = (amount: number) => `KSh ${round2(amount).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

/** The period n months after `period` (YYYY-MM). */
export const addMonths = (period: string, n: number) => {
  const [y, m] = period.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};

export const periodLabel = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Date(y, m - 1, 1).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
};

export const currentPeriod = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

/**
 * The monthly instalment before rounding to shillings (to the cent): the annuity payment for reducing balance, or
 * (principal + flat interest) / months.
 */
export const monthlyInstalment = (principal: number, annualRate: number, months: number, method: InterestMethod): number => {
  const n = Math.max(1, Math.floor(months) || 1);
  if (!(principal > 0)) return 0;
  const rate = Math.max(0, annualRate || 0);
  if (method === 'flat') return round2((principal + (principal * rate * n) / 1200) / n);
  if (rate === 0) return round2(principal / n);
  const r = rate / 1200;
  return round2((principal * r) / (1 - Math.pow(1 + r, -n)));
};

/** The full schedule from `startPeriod`, in whole shillings (the last instalment evens out the rounding). */
export const loanSchedule = (
  principal: number,
  annualRate: number,
  months: number,
  method: InterestMethod,
  startPeriod: string,
): LoanInstalment[] => {
  if (!(principal > 0) || !startPeriod) return [];
  const n = Math.max(1, Math.floor(months) || 1);
  const rate = Math.max(0, annualRate || 0);
  const out: LoanInstalment[] = [];
  let balance = principal;

  if (method === 'flat') {
    const totalInterest = roundKsh((principal * rate * n) / 1200);
    const partPrincipal = roundKsh(principal / n);
    const partInterest = roundKsh(totalInterest / n);
    for (let i = 1; i <= n; i++) {
      const last = i === n;
      const p = last ? balance : partPrincipal;
      const interest = last ? totalInterest - partInterest * (n - 1) : partInterest;
      balance = round2(balance - p);
      out.push({ instalment_no: i, period: addMonths(startPeriod, i - 1), payment: round2(p + interest), principal: p, interest, balance });
    }
    return out;
  }

  const r = rate / 1200;
  const payment = rate === 0 ? roundKsh(principal / n) : roundKsh((principal * r) / (1 - Math.pow(1 + r, -n)));
  for (let i = 1; i <= n; i++) {
    const interest = roundKsh((balance * rate) / 1200);
    const p = i === n ? balance : Math.max(Math.min(payment - interest, balance), 0);
    balance = round2(balance - p);
    out.push({ instalment_no: i, period: addMonths(startPeriod, i - 1), payment: round2(p + interest), principal: p, interest, balance });
  }
  return out;
};

export interface LoanTotals {
  /** the first instalment (what most months take) */
  instalment: number;
  totalInterest: number;
  totalRepayable: number;
}

export const scheduleTotals = (schedule: LoanInstalment[]): LoanTotals => ({
  instalment: schedule[0]?.payment ?? 0,
  totalInterest: round2(schedule.reduce((s, i) => s + i.interest, 0)),
  totalRepayable: round2(schedule.reduce((s, i) => s + i.payment, 0)),
});

/** Total interest over the loan. */
export const totalInterest = (schedule: LoanInstalment[]) => scheduleTotals(schedule).totalInterest;

/** What the schedule has due up to and including `period`. */
export const scheduledUpTo = (schedule: LoanInstalment[], period: string) =>
  round2(schedule.filter((i) => i.period <= period).reduce((s, i) => s + i.payment, 0));

/** What has been repaid in months before `period` (or in all months, without one). */
export const repaidBefore = (repayments: Pick<LoanRepayment, 'pay_period' | 'amount'>[], period?: string) =>
  round2(repayments.filter((r) => !period || r.pay_period < period).reduce((s, r) => s + Number(r.amount || 0), 0));

/** What is still to be repaid (principal and interest) after the repayments so far. */
export const outstandingBalance = (schedule: LoanInstalment[], repayments: Pick<LoanRepayment, 'pay_period' | 'amount'>[]) =>
  Math.max(0, round2(scheduleTotals(schedule).totalRepayable - repaidBefore(repayments)));

/**
 * What payroll takes for the loan in `period`: everything due up to that month less what earlier months repaid
 * (so an instalment pay could not cover comes back the month after), never more than is left. The month's own
 * repayment, if a draft of it was saved, does not count against it.
 */
export const loanDueFor = (schedule: LoanInstalment[], repayments: Pick<LoanRepayment, 'pay_period' | 'amount'>[], period: string) => {
  const before = repaidBefore(repayments, period);
  const left = round2(scheduleTotals(schedule).totalRepayable - before);
  return Math.max(0, Math.min(round2(scheduledUpTo(schedule, period) - before), left));
};

export interface PayrollLoan {
  id: string;
  employee_number: string;
  product_name: string | null;
  status: LoanStatus;
  schedule: LoanInstalment[];
  repayments: Pick<LoanRepayment, 'pay_period' | 'amount'>[];
}

export interface LoanDeductionLine {
  name: string;
  amount: number;
  loan_id: string;
}

export const loanLineName = (productName: string | null | undefined) => `Loan repayment: ${productName?.trim() || 'Staff loan'}`;

/**
 * The loan lines on one employee's payslip for `period`, oldest loan first, so that together they take no more than
 * `available` (the net pay before loans): what does not fit is left for next month. A loan with nothing to take is
 * left off.
 */
export const loanDeductionsFor = (loans: PayrollLoan[], employeeNumber: string, period: string, available: number): LoanDeductionLine[] => {
  let room = Math.max(0, round2(available));
  const lines: LoanDeductionLine[] = [];
  for (const loan of loans) {
    if (String(loan.employee_number) !== String(employeeNumber) || !ACTIVE_STATUSES.includes(loan.status)) continue;
    const amount = Math.min(loanDueFor(loan.schedule, loan.repayments, period), room);
    if (amount <= 0) continue;
    room = round2(room - amount);
    lines.push({ name: loanLineName(loan.product_name), amount: round2(amount), loan_id: loan.id });
  }
  return lines;
};

export interface LoanRequestInput {
  amount: string;
  months: number;
  reason: string;
}

/** The most this person may borrow (the lower of the two limits), or null when there is no limit. */
export const maxLoanFor = (settings: LoanSettings, basicSalary: unknown): number | null => {
  const limits: number[] = [];
  if (settings.max_amount) limits.push(Number(settings.max_amount));
  if (settings.max_salary_multiple) limits.push(Math.floor((parseFloat(String(basicSalary ?? '')) || 0) * Number(settings.max_salary_multiple)));
  return limits.length ? Math.min(...limits) : null;
};

/** The longest term for a loan type (or the company's, without one). */
export const maxMonthsFor = (settings: LoanSettings, product?: Pick<LoanProduct, 'max_months'> | null) => product?.max_months ?? settings.max_months;

/** What is wrong with a request, by field; empty when it may be sent. */
export const validateLoanRequest = (
  input: LoanRequestInput,
  limits: { minMonths: number; maxMonths: number; maxAmount: number | null },
): Partial<Record<keyof LoanRequestInput, string>> => {
  const errors: Partial<Record<keyof LoanRequestInput, string>> = {};
  const amount = Number(input.amount);
  if (!String(input.amount ?? '').trim() || !Number.isFinite(amount) || amount <= 0) errors.amount = 'Enter the amount you want to borrow.';
  else if (limits.maxAmount !== null && amount > limits.maxAmount) errors.amount = `The most you can borrow is ${formatKsh(limits.maxAmount)}.`;
  if (!Number.isInteger(input.months) || input.months < limits.minMonths || input.months > limits.maxMonths) {
    errors.months = `Choose between ${limits.minMonths} and ${limits.maxMonths} months.`;
  }
  if (String(input.reason ?? '').trim().length < 10) errors.reason = 'Tell us what the loan is for in a few words (at least 10 characters).';
  return errors;
};

/** What is wrong with the company's loan settings, or null. */
export const settingsError = (s: LoanSettings): string | null => {
  if (!(s.annual_rate >= 0 && s.annual_rate <= 100)) return 'The interest rate must be between 0% and 100% a year.';
  if (!Number.isInteger(s.min_months) || s.min_months < 1 || s.min_months > 120) return 'The shortest term must be 1 to 120 months.';
  if (!Number.isInteger(s.max_months) || s.max_months < 1 || s.max_months > 120) return 'The longest term must be 1 to 120 months.';
  if (s.min_months > s.max_months) return 'The shortest term can’t be longer than the longest.';
  if (s.max_amount !== null && !(s.max_amount > 0)) return 'The most anyone may borrow must be above 0, or left empty.';
  if (s.max_salary_multiple !== null && !(s.max_salary_multiple > 0)) return 'The salary multiple must be above 0, or left empty.';
  return null;
};
