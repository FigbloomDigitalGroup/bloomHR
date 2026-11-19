// Employee loans: the instalment, the amortisation schedule, and what payroll takes back each month.
//
// The database builds each loan's schedule with the same sums (public.loan_schedule, migration 20261016700000); this is
// the copy the screens use for the preview while someone types, and payroll uses for what is due.
//
//   reducing balance: a fixed payment P·r / (1 − (1 + r)^−n), r the monthly rate (annual / 12). Each month's interest is
//                     r on what is still owed; the rest of the payment pays the loan down. A 0% loan is P / n a month.
//   flat:             interest is the annual rate on the whole amount for the whole term, spread evenly over the months.
//   upfront:          the rate is charged once on the loan, whatever the term, and taken off what is paid out: the
//                     amount is what the employee repays (P / n a month) and they receive P less rate% of P. A KSh 100,000
//                     loan at 20% pays out 80,000 and books 20,000 interest. Here the schedule's principal is the share
//                     of each instalment that repays the money paid out, and its balance is the loan amount still to repay.
//
// The schedule is in whole shillings; the last instalment takes the rounding so the principal and the interest add up
// exactly. Payroll takes everything due up to the month less what was already repaid, so a month that could not cover
// its instalment carries the shortfall forward.

export type InterestMethod = 'reducing_balance' | 'flat' | 'upfront';

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
  /**
   * The monthly repayment at most the basic salary divided by this (3: a third), 20261119300000; null = no such limit.
   * With interest off up front, a loan is then up to basic ÷ 3 × its months.
   */
  max_instalment_divisor: number | null;
  /**
   * Take-home pay after the repayment and other loans at least the basic salary divided by this (3: a third, the
   * Employment Act's minimum), 20261119300000; null = no such check.
   */
  min_take_home_divisor: number | null;
  staff_can_apply: boolean;
  /**
   * Fixed terms, each with its own rate (20261118500000), e.g. 3 months at 20% and 6 at 25%. Empty: any term from the
   * shortest to the longest, at the company's or the loan type's rate.
   */
  term_rates: TermRate[];
}

export interface TermRate {
  months: number;
  rate: number;
}

/** The rate for a term when the company lends on fixed terms; null when it doesn't, or the term isn't one of them. */
export const termRateFor = (settings: Pick<LoanSettings, 'term_rates'>, months: number): number | null =>
  settings.term_rates.find((t) => t.months === months)?.rate ?? null;

/** A company without saved settings lends on these (the database uses the same). */
export const DEFAULT_LOAN_SETTINGS: LoanSettings = {
  annual_rate: 12,
  interest_method: 'reducing_balance',
  min_months: 1,
  max_months: 12,
  max_amount: null,
  max_salary_multiple: null,
  max_instalment_divisor: null,
  min_take_home_divisor: null,
  staff_can_apply: true,
  term_rates: [],
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
  /** principal still owed after this instalment (for 'upfront', what is still to be repaid of the loan amount) */
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
  {
    id: 'upfront',
    label: 'Interest off up front',
    hint: 'The rate is charged once per loan and taken off the payout: at 20%, a KSh 100,000 loan pays out KSh 80,000 and KSh 100,000 is repaid',
  },
];

/** The rate as words: "12% a year", or "20% of the loan" when it is charged once up front. */
export const rateText = (rate: number, method: string | null | undefined) => `${rate}% ${method === 'upfront' ? 'of the loan' : 'a year'}`;

/** The label for a rate field, by how interest is charged. */
export const rateFieldLabel = (method: string | null | undefined) =>
  method === 'upfront' ? 'Interest rate (% of the loan, charged once)' : 'Interest rate (% a year)';

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
  if (method === 'upfront') return round2(principal / n);
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

  if (method === 'upfront') {
    const paidOut = roundKsh(principal - (principal * rate) / 100);
    const partPayment = roundKsh(principal / n);
    // each instalment's principal is its share of the payout, on the running total so the parts add up exactly and
    // no month's interest goes below 0
    let paid = 0;
    let principalSoFar = 0;
    for (let i = 1; i <= n; i++) {
      const last = i === n;
      const payment = last ? balance : partPayment;
      paid = round2(paid + payment);
      const upTo = last ? paidOut : roundKsh((paid * paidOut) / principal);
      const p = round2(upTo - principalSoFar);
      principalSoFar = upTo;
      balance = round2(balance - payment);
      out.push({ instalment_no: i, period: addMonths(startPeriod, i - 1), payment, principal: p, interest: round2(payment - p), balance });
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
  /** what the employee receives: the amount borrowed, less the interest when it is taken off up front */
  paidOut: number;
}

export const scheduleTotals = (schedule: LoanInstalment[]): LoanTotals => {
  const totalInterest = round2(schedule.reduce((s, i) => s + i.interest, 0));
  const totalRepayable = round2(schedule.reduce((s, i) => s + i.payment, 0));
  return { instalment: schedule[0]?.payment ?? 0, totalInterest, totalRepayable, paidOut: round2(totalRepayable - totalInterest) };
};

/** What is paid out to the employee for a loan (the amount, less up-front interest). */
export const loanPaidOut = (loan: { principal: number; interest_method: string; total_interest: number | null }) =>
  loan.interest_method === 'upfront' ? round2(loan.principal - (loan.total_interest ?? 0)) : loan.principal;

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
export const maxLoanFor = (
  settings: LoanSettings,
  basicSalary: unknown,
  term?: { months: number; rate: number; method: InterestMethod },
  pay?: { net: number | null; otherRepayments: number }
): number | null => {
  const basic = parseFloat(String(basicSalary ?? '').replace(/[^0-9.]/g, '')) || 0;
  const limits: number[] = [];
  if (settings.max_amount) limits.push(Number(settings.max_amount));
  if (settings.max_salary_multiple) limits.push(Math.floor(basic * Number(settings.max_salary_multiple)));
  const cap = monthlyRepaymentCap(settings, basic, pay);
  if (cap !== null && term) limits.push(mostForInstalment(cap, term.rate, term.months, term.method));
  return limits.length ? Math.min(...limits) : null;
};

/**
 * The most the monthly repayment may be (as employee_loans_within_pay): the stricter of a share of basic salary and
 * what net pay leaves after other loans and the minimum take-home pay. Null when neither applies (or net pay is
 * unknown and only the take-home rule is set).
 */
export const monthlyRepaymentCap = (
  settings: Pick<LoanSettings, 'max_instalment_divisor' | 'min_take_home_divisor'>,
  basic: number,
  pay?: { net: number | null; otherRepayments: number }
): number | null => {
  const caps: number[] = [];
  if (settings.max_instalment_divisor) caps.push(basic / settings.max_instalment_divisor);
  if (settings.min_take_home_divisor && pay?.net != null) {
    caps.push(Math.max(0, pay.net - (pay.otherRepayments || 0) - basic / settings.min_take_home_divisor));
  }
  return caps.length ? Math.min(...caps) : null;
};

/** The most that can be borrowed so each instalment is at most `cap` (as loan_most_for_instalment in the database). */
export const mostForInstalment = (cap: number, rate: number, months: number, method: InterestMethod): number => {
  const n = Math.max(1, Math.floor(months) || 1);
  if (!(cap > 0)) return 0;
  if (method === 'upfront' || !(rate > 0)) return Math.floor(cap * n + 1e-9);
  if (method === 'flat') return Math.floor(cap / (1 / n + rate / 1200));
  const i = rate / 1200;
  return Math.floor((cap * (1 - Math.pow(1 + i, -n))) / i);
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
  if (!(s.annual_rate >= 0 && s.annual_rate <= 100)) return `The interest rate must be between 0% and 100%${s.interest_method === 'upfront' ? '' : ' a year'}.`;
  if (!Number.isInteger(s.min_months) || s.min_months < 1 || s.min_months > 120) return 'The shortest term must be 1 to 120 months.';
  if (!Number.isInteger(s.max_months) || s.max_months < 1 || s.max_months > 120) return 'The longest term must be 1 to 120 months.';
  if (s.min_months > s.max_months) return 'The shortest term can’t be longer than the longest.';
  if (s.max_amount !== null && !(s.max_amount > 0)) return 'The most anyone may borrow must be above 0, or left empty.';
  if (s.max_salary_multiple !== null && !(s.max_salary_multiple > 0)) return 'The salary multiple must be above 0, or left empty.';
  if (s.max_instalment_divisor !== null && !(s.max_instalment_divisor > 0)) return 'The basic salary divider must be above 0, or left empty.';
  if (s.min_take_home_divisor !== null && !(s.min_take_home_divisor > 0)) return 'The take-home divider must be above 0, or left empty.';
  for (const t of s.term_rates) {
    if (!Number.isInteger(t.months) || t.months < 1 || t.months > 120) return 'Each fixed term must be 1 to 120 whole months.';
    if (!(t.rate >= 0 && t.rate <= 100)) return 'Each fixed term’s rate must be between 0% and 100%.';
  }
  if (new Set(s.term_rates.map((t) => t.months)).size !== s.term_rates.length) return 'Each fixed term can be listed once.';
  return null;
};
