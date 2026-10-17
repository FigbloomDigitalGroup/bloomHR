import { TAX_RULES, explainRule } from './kenyaTaxTreatment';
import type { Rates } from './statutoryCalc';

/**
 * Contributions staff ask for from their pay (FIG-898, table employee_contributions, migration
 * 20261019000000_contributions_nita.sql). Payroll approves or declines each; approving turns it into the payroll input
 * it belongs to, which payroll already reads:
 *
 *   sacco, welfare, other                    a voluntary deduction line (employee_deductions), taken after tax
 *   pension_avc, prmf                        added to the employee's pension / PRMF amount: taken from pay and
 *                                            deducted before PAYE up to the legal limit (lib/statutoryCalc)
 *   insurance_premium, mortgage_interest     added to the employee's insurance premium / mortgage interest: lowers
 *                                            PAYE (relief, or a deduction up to its cap); the employee pays the
 *                                            insurer or lender, nothing is taken from pay
 */

export const CONTRIBUTION_KINDS = ['pension_avc', 'sacco', 'welfare', 'insurance_premium', 'mortgage_interest', 'prmf', 'other'] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

export type ContributionStatus = 'pending' | 'declined' | 'cancelled' | 'active' | 'stopped' | 'ended';

export interface Contribution {
  id: string;
  employee_number: string;
  employee_name: string;
  kind: ContributionKind;
  amount: number;
  /** 'YYYY-MM' */
  start_period: string;
  end_period: string | null;
  provider: string | null;
  reference: string | null;
  note: string | null;
  /** in the private documents bucket */
  document_path: string | null;
  status: ContributionStatus;
  decline_reason: string | null;
  decided_at: string | null;
  stopped_at: string | null;
  /** the first month it is no longer taken */
  stop_period: string | null;
  /** pension, PRMF, insurance, mortgage: what it currently adds to the employee's amount */
  applied_amount: number;
  created_at: string;
  /** the first month a change can still reach (after the latest approved payroll) */
  next_payroll_period: string;
}

export const KIND_LABELS: Record<ContributionKind, string> = {
  pension_avc: 'Pension (AVC)',
  sacco: 'SACCO',
  welfare: 'Welfare',
  insurance_premium: 'Insurance premium (for relief)',
  mortgage_interest: 'Mortgage interest (for relief)',
  prmf: 'Post-retirement medical fund',
  other: 'Other',
};

/** How each kind reaches payroll, in a sentence. */
export const KIND_EFFECT: Record<ContributionKind, string> = {
  pension_avc: 'Taken from your pay and deducted before PAYE, up to the legal limit.',
  sacco: 'Taken from your pay after tax and paid to your SACCO.',
  welfare: 'Taken from your pay after tax.',
  insurance_premium: 'Not taken from your pay: you keep paying the insurer. It gives you insurance relief off your PAYE.',
  mortgage_interest: 'Not taken from your pay: you keep paying the lender. The interest is deducted before PAYE, up to the limit.',
  prmf: 'Taken from your pay and deducted before PAYE, up to the legal limit.',
  other: 'Taken from your pay after tax.',
};

/** Where an approved one shows up for payroll. */
export const KIND_PAYROLL_INPUT: Record<ContributionKind, string> = {
  pension_avc: "Adds to the employee's pension contribution",
  sacco: 'A "SACCO" voluntary deduction',
  welfare: 'A "Welfare" voluntary deduction',
  insurance_premium: "Adds to the employee's insurance premium (relief)",
  mortgage_interest: "Adds to the employee's mortgage interest",
  prmf: "Adds to the employee's post-retirement medical fund",
  other: 'A voluntary deduction named after the provider',
};

/** The cited tax rule (lib/kenyaTaxTreatment) for each kind that has one. */
const RULE_FOR: Partial<Record<ContributionKind, string>> = {
  pension_avc: 'pension',
  prmf: 'post_retirement_medical',
  insurance_premium: 'insurance',
  mortgage_interest: 'mortgage_interest',
  sacco: 'sacco',
  welfare: 'welfare',
};

/** The tax rule's explanation for a kind, with its cap from the rates when given; '' when there is none. */
export const taxNoteFor = (kind: ContributionKind, rates?: Rates | null) => {
  const rule = TAX_RULES.find((r) => r.id === RULE_FOR[kind]);
  return rule ? explainRule(rule, rates) : '';
};

export const STATUS_LABELS: Record<ContributionStatus, string> = {
  pending: 'Waiting for payroll',
  declined: 'Declined',
  cancelled: 'Withdrawn',
  active: 'Active',
  stopped: 'Stopped',
  ended: 'Ended',
};

export const statusTone = (s: ContributionStatus): 'success' | 'warning' | 'danger' | 'neutral' =>
  s === 'active' ? 'success' : s === 'pending' ? 'warning' : s === 'declined' ? 'danger' : 'neutral';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

/** "From October 2026", "October 2026 to March 2027", "October 2026 only" */
export const monthsText = (start: string, end: string | null) =>
  !end ? `From ${monthLabel(start)}` : end === start ? `${monthLabel(start)} only` : `${monthLabel(start)} to ${monthLabel(end)}`;

/** 'YYYY-MM' of a date (this month by default). */
export const periodOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const ksh = (n: number) => `KSh ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

export interface ContributionForm {
  kind: ContributionKind | '';
  amount: string;
  start_period: string;
  end_period: string;
  provider: string;
  reference: string;
  note: string;
}

export const EMPTY_FORM: ContributionForm = { kind: '', amount: '', start_period: '', end_period: '', provider: '', reference: '', note: '' };

/** What is wrong with a request before it is sent (the database checks the same); [] when it can be sent. */
export function formProblems(f: ContributionForm, thisMonth = periodOf()): string[] {
  const problems: string[] = [];
  const amount = Number(f.amount.replace(/[,\s]/g, ''));
  if (!f.kind) problems.push('Choose what kind of contribution it is.');
  if (!f.amount.trim() || !Number.isFinite(amount) || amount <= 0) problems.push('Enter the amount a month (above 0).');
  else if (amount > 10_000_000) problems.push('That amount is too large.');
  if (!PERIOD.test(f.start_period)) problems.push('Choose the month it starts.');
  else if (f.start_period < thisMonth) problems.push('It can’t start in a month that has passed.');
  if (f.end_period && (!PERIOD.test(f.end_period) || (PERIOD.test(f.start_period) && f.end_period < f.start_period)))
    problems.push('The last month can’t be before the first.');
  if (f.kind === 'other' && !f.provider.trim()) problems.push('Say who it is paid to.');
  return problems;
}

/** Whether the employee (or payroll) can still stop it: waiting, or running and not past its last month. */
export const canStop = (c: Pick<Contribution, 'status' | 'end_period' | 'next_payroll_period'>) =>
  c.status === 'pending' || (c.status === 'active' && (!c.end_period || c.end_period >= c.next_payroll_period));

/** Contributions that are running now or will start (approved and not stopped or ended). */
export const activeContributions = (list: Contribution[]) => list.filter((c) => c.status === 'active');
