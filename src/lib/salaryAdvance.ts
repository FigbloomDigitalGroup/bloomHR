import { normalisePhone } from './onboardingValidation';
import { paymentKind, paymentMethodLabel } from './paymentMethods';

// Salary advances: how much a person may ask for, how payroll takes it back, and where each request stands.
//
// An advance is paid once and repaid through payroll. A one-month advance comes off the pay of the month it was
// asked for, in full (as payroll has always done). An advance spread over N months comes off in N equal parts,
// starting that same month; the last part takes any rounding so the parts add up to the amount exactly.
// Payroll only takes back advances that are paid (status 'paid' and payment_processed 'true').
// A part that an approved payslip did not take (the advance was recorded paid after that month's payroll, or the
// person had no payslip that month) comes off the next payroll, counted from the person's first approved payslip
// (earlier months were paid outside the app).

/** The most a person may ask for, as a share of their basic salary (the company's long-standing rule). */
export const ADVANCE_LIMIT_SHARE = 0.2;

/** The repayment choices offered: one month, or spread over up to this many. The database allows up to 12. */
export const MAX_REPAYMENT_MONTHS = 6;

/** The shortest reason accepted. */
export const MIN_REASON_LENGTH = 10;

export interface AdvanceRow {
  id?: string;
  'Employee Number'?: string | number | null;
  'Full Name'?: string | null;
  'Amount Requested'?: number | string | null;
  'Reason for Advance'?: string | null;
  status?: string | null;
  payment_processed?: string | boolean | null;
  payment_date?: string | null;
  time_added?: string | Date | null;
  repayment_months?: number | string | null;
  admin_notes?: string | null;
  admin_approval_date?: string | null;
  admin_rejection_date?: string | null;
  approved_by_email?: string | null;
  rejected_by_email?: string | null;
  paid_by_email?: string | null;
  mpesa_transaction_id?: string | null;
}

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());
const round2 = (n: number) => Math.round(n * 100) / 100;

export const formatKsh = (amount: number) => `KSh ${round2(amount).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

/** The amount asked for (what payroll takes back). */
export const advanceAmount = (row: AdvanceRow) => parseFloat(String(row['Amount Requested'] ?? '')) || 0;

/** How many months the advance is repaid over: a whole number, at least 1 (older rows have none and are 1). */
export const repaymentMonths = (row: AdvanceRow) => {
  const n = Math.floor(Number(row.repayment_months));
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

/** The payroll period (YYYY-MM) an advance was asked for in; blank when it has no usable date. */
export const advancePeriod = (timeAdded: unknown): string => {
  if (!timeAdded) return '';
  if (typeof timeAdded === 'string' && timeAdded.length >= 7) return timeAdded.substring(0, 7);
  const d = new Date(timeAdded as string);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

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

export interface Instalment {
  period: string;
  amount: number;
}

/** The parts an amount is taken back in: `months` equal parts from `startPeriod`, the last one evening out the cents. */
export const repaymentSchedule = (amount: number, months: number, startPeriod: string): Instalment[] => {
  if (!startPeriod || !(amount > 0)) return [];
  const n = Math.max(1, Math.floor(months) || 1);
  // one month: the amount exactly as asked, as payroll has always taken it
  if (n === 1) return [{ period: startPeriod, amount }];
  const part = round2(amount / n);
  return Array.from({ length: n }, (_, i) => ({
    period: addMonths(startPeriod, i),
    amount: i === n - 1 ? round2(amount - part * (n - 1)) : part,
  }));
};

/** An advance's own schedule. */
export const advanceSchedule = (row: AdvanceRow) => repaymentSchedule(advanceAmount(row), repaymentMonths(row), advancePeriod(row.time_added));

/** What one approved payslip took back for advances (salary_history.advance_deduction). */
export interface AdvanceTaken {
  employee_number: string;
  pay_period: string;
  amount: number;
}

/**
 * What payroll takes from an employee's pay for `period` (YYYY-MM), from the paid advances payroll loaded: this
 * month's parts, plus earlier parts that approved payslips did not take (`taken`, the person's approved payslips
 * before `period`), from their first approved payslip on. Without a period every advance counts in full, as before.
 */
export const advanceDeductionFor = (
  advances: AdvanceRow[],
  employeeNumber: unknown,
  period: string | null | undefined,
  taken: AdvanceTaken[] = [],
): number => {
  if (!employeeNumber) return 0;
  // loose equality: employee numbers come as text or numbers
  const own = advances.filter((adv) => adv['Employee Number'] == employeeNumber);
  if (!period) return own.reduce((sum, adv) => sum + advanceAmount(adv), 0);
  const parts = own.flatMap(advanceSchedule);
  const due = parts.filter((i) => i.period === period).reduce((s, i) => s + i.amount, 0);
  const before = taken.filter((t) => String(t.employee_number) === String(employeeNumber) && t.pay_period < period);
  if (before.length === 0) return round2(due);
  const from = before.reduce((min, t) => (t.pay_period < min ? t.pay_period : min), before[0].pay_period);
  const owed = parts.filter((i) => i.period >= from && i.period < period).reduce((s, i) => s + i.amount, 0);
  const took = before.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  return round2(due + Math.max(0, owed - took));
};

export const isPaid = (row: AdvanceRow) => {
  const s = text(row.status).toLowerCase();
  return (s === 'paid' || s === 'completed') && text(row.payment_processed).toLowerCase() === 'true';
};

export interface RepaymentProgress {
  total: number;
  repaid: number;
  remaining: number;
  months: number;
  instalment: number;
  /** the next part to come off pay, if any is left */
  next?: Instalment;
  lastPeriod: string;
}

/**
 * How much of a paid advance has come back, counting the parts of months before `currentPeriod` as taken (payroll
 * runs at the end of the month, so this month's part is still to come).
 */
export const repaymentProgress = (row: AdvanceRow, currentPeriod: string): RepaymentProgress => {
  const schedule = advanceSchedule(row);
  const total = advanceAmount(row);
  const repaid = isPaid(row) ? round2(schedule.filter((i) => i.period < currentPeriod).reduce((s, i) => s + i.amount, 0)) : 0;
  return {
    total,
    repaid,
    remaining: round2(total - repaid),
    months: repaymentMonths(row),
    instalment: schedule[0]?.amount ?? total,
    next: isPaid(row) ? schedule.find((i) => i.period >= currentPeriod) : undefined,
    lastPeriod: schedule[schedule.length - 1]?.period ?? '',
  };
};

export const currentPeriod = (now = new Date()) => advancePeriod(now);

/** Where a request stands, in the order a request moves through. */
export type AdvanceStage = 'requested' | 'approved' | 'paid' | 'repaying' | 'repaid' | 'declined';

export const advanceStage = (row: AdvanceRow, period = currentPeriod()): AdvanceStage => {
  const s = text(row.status).toLowerCase();
  if (s === 'rejected' || s === 'declined') return 'declined';
  if (isPaid(row)) {
    const p = repaymentProgress(row, period);
    if (p.remaining <= 0) return 'repaid';
    return p.repaid > 0 ? 'repaying' : 'paid';
  }
  // marked paid without payment_processed: payroll does not take it back, but it was paid
  if (s === 'paid' || s === 'completed') return 'paid';
  if (s === 'approved' || s === 'processing') return 'approved';
  return 'requested';
};

/** The queue tab a request belongs in. */
export type QueueTab = 'pending' | 'approved' | 'paid' | 'declined';

export const queueTab = (row: AdvanceRow): QueueTab => {
  const stage = advanceStage(row);
  if (stage === 'declined') return 'declined';
  if (stage === 'requested') return 'pending';
  if (stage === 'approved') return 'approved';
  return 'paid';
};

/** The most this person may ask for. */
export const maxAdvanceFor = (basicSalary: unknown) => Math.floor((parseFloat(String(basicSalary ?? '')) || 0) * ADVANCE_LIMIT_SHARE);

export interface AdvanceRequestInput {
  amount: string;
  reason: string;
  months: number;
}

/** What is wrong with a request, by field; empty when it may be sent. */
export const validateAdvanceRequest = (input: AdvanceRequestInput, maxAmount: number): Partial<Record<keyof AdvanceRequestInput, string>> => {
  const errors: Partial<Record<keyof AdvanceRequestInput, string>> = {};
  const amount = Number(input.amount);
  if (!text(input.amount) || !Number.isFinite(amount) || amount <= 0) errors.amount = 'Enter the amount you need.';
  else if (amount > maxAmount) errors.amount = `The most you can ask for is ${formatKsh(maxAmount)} (${ADVANCE_LIMIT_SHARE * 100}% of your basic salary).`;
  if (text(input.reason).length < MIN_REASON_LENGTH) errors.reason = `Tell us why in a few words (at least ${MIN_REASON_LENGTH} characters).`;
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > MAX_REPAYMENT_MONTHS) {
    errors.months = `Choose between 1 and ${MAX_REPAYMENT_MONTHS} months.`;
  }
  return errors;
};

// ---------------------------------------------------------------------------------------------
// where the money goes (for the demo "Pay advance")
// ---------------------------------------------------------------------------------------------

export interface PayeeRecord {
  'First Name'?: string | null;
  'Middle Name'?: string | null;
  'Last Name'?: string | null;
  payment_method?: string | null;
  'Mobile Number'?: string | null;
  Bank?: string | null;
  'Account Number'?: string | null;
  account_number_name?: string | null;
}

export interface PayeeCheck {
  method: string;
  /** where the money would go, as shown in the confirmation */
  destination: string;
  /** set when the details are not good enough to pay; paying is blocked */
  error?: string;
}

const KENYAN_MOBILE = /^(0[17]\d{8}|\+?254[17]\d{8})$/;

/** A Kenyan mobile number as 07xxxxxxxx (or 01xxxxxxxx). */
export const localPhone = (value: unknown) => {
  const p = normalisePhone(value).replace(/^\+/, '');
  return p.startsWith('254') ? `0${p.slice(3)}` : p;
};

/** 0712 *** 678: enough to recognise the number without showing all of it. */
export const maskPhone = (value: unknown) => {
  const p = localPhone(value);
  return p.length === 10 ? `${p.slice(0, 4)} *** ${p.slice(7)}` : p;
};

const words = (value: unknown) => text(value).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

/** Whether a bank account name belongs to the employee: every word of it is one of their names, or two of them are. */
export const accountNameMatches = (accountName: unknown, employee: PayeeRecord) => {
  const account = words(accountName);
  if (account.length === 0) return true;
  const names = new Set(words([employee['First Name'], employee['Middle Name'], employee['Last Name']].join(' ')));
  const shared = account.filter((w) => names.has(w)).length;
  return shared === account.length || shared >= 2;
};

/** How the employee is paid and whether the saved details are good enough to send an advance. */
export const checkPayee = (employee: PayeeRecord | null | undefined): PayeeCheck => {
  if (!employee) return { method: 'Unknown', destination: '', error: 'No employee record was found for this request.' };
  const method = paymentMethodLabel(employee.payment_method);
  const kind = paymentKind(employee.payment_method);
  if (kind === 'cash') {
    return { method, destination: 'Cash', error: 'This employee is paid in cash. Pay them in person, then use Mark as paid.' };
  }
  if (kind === 'mobile') {
    const phone = text(employee['Mobile Number']);
    if (!phone) return { method, destination: '', error: `No ${method} number is saved for this employee. Add it to their profile first.` };
    if (!KENYAN_MOBILE.test(normalisePhone(phone))) {
      return { method, destination: phone, error: `The ${method} number "${phone}" is not a valid Kenyan mobile number (like 0712345678).` };
    }
    return { method, destination: `${method} ${maskPhone(phone)}` };
  }
  const bank = text(employee.Bank);
  const account = text(employee['Account Number']);
  if (!bank || !account) return { method, destination: bank, error: 'No bank account is saved for this employee (bank and account number). Add it to their profile first.' };
  const masked = account.length > 4 ? `****${account.slice(-4)}` : account;
  if (!accountNameMatches(employee.account_number_name, employee)) {
    return {
      method,
      destination: `${bank} ${masked}`,
      error: `The account name "${text(employee.account_number_name)}" does not match the employee's name. Check the account before paying.`,
    };
  }
  return { method, destination: `${bank} ${masked}` };
};
