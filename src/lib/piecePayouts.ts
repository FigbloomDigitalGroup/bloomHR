// Piece rate stage 4 (FIG-812; migration 20261020200000): payout batches. The holdback maths (the database works out
// the same when a batch is made) and the files finance uploads to the bank or M-Pesa. Nothing here moves money.
import { addDays, weekStart } from './casualPay';
import { equityFile, mpesaPhone, type ExportFile } from './payrollExports';
import { isKesPayslip, mpesaKenyaNote } from './paymentMethods';
import type { EmployeeRecord } from './profileCompleteness';

export type PayoutKind = 'daily' | 'weekly' | 'job' | 'ad_hoc';
export type PayoutStatus = 'draft' | 'approved' | 'exported' | 'cancelled';
export type PayoutPaymentKind = 'mobile' | 'bank' | 'cash';

export interface PayoutBatch {
  id: string;
  kind: PayoutKind;
  period_from: string;
  period_to: string;
  pay_period: string;
  /** the country and currency of everyone in it (FIG-905): a payout never mixes currencies */
  country?: string | null;
  currency?: string | null;
  status: PayoutStatus;
  notes: string | null;
  worker_count: number;
  flagged_count: number;
  gross_total: number | string;
  ahl_total: number | string;
  reserve_total: number | string;
  wht_total: number | string;
  net_total: number | string;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  exported_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export interface PayoutLine {
  id: string;
  batch_id: string;
  employee_number: string;
  worker_name: string;
  worker_kind: string;
  wht_category: string | null;
  work_from: string | null;
  work_to: string | null;
  work_amount: number | string;
  jobs_amount: number | string;
  gross: number | string;
  ahl_rate: number | string;
  reserve_rate: number | string;
  wht_rate: number | string;
  ahl: number | string;
  reserve: number | string;
  wht: number | string;
  rounding: number | string;
  net: number | string;
  payment_method: string | null;
  payment_kind: PayoutPaymentKind;
  phone: string | null;
  bank: string | null;
  bank_branch: string | null;
  bank_code: string | null;
  branch_code: string | null;
  account_name: string | null;
  account_number: string | null;
  payroll_number: string | null;
  id_number: string | null;
  problem: string | null;
}

export interface MyPayouts {
  pay_period: string;
  gross: number | string;
  paid: number | string;
  ahl: number | string;
  reserve: number | string;
  wht: number | string;
  held: number | string;
  payouts: { kind: PayoutKind; from: string; to: string; approved_at: string; gross: number | string; net: number | string; held: number | string }[];
}

export const PAYOUT_KIND_LABEL: Record<PayoutKind, string> = { daily: 'Daily', weekly: 'Weekly', job: 'Job completion', ad_hoc: 'Ad hoc' };
export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = { draft: 'Draft', approved: 'Approved', exported: 'Exported', cancelled: 'Cancelled' };
export const PAYOUT_STATUS_TONE: Record<PayoutStatus, 'warning' | 'info' | 'success' | 'neutral'> = {
  draft: 'warning', approved: 'info', exported: 'success', cancelled: 'neutral',
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------------------------
// what is held back
// ---------------------------------------------------------------------------------------------
export interface HoldbackRates {
  contractor: boolean;
  /** AHL (employees only), e.g. 0.015 */
  ahlRate: number;
  /** the company's reserve, e.g. 0.1 */
  reserveRate: number;
  /** withholding tax (contractors only), e.g. 0.03 */
  whtRate: number;
  /** contractors have the reserve held too (company setting, default off) */
  contractorReserve?: boolean;
}

/**
 * One payout's holdbacks, as create_work_payout_batch works them out: employees AHL + reserve, contractors withholding
 * tax (+ reserve only when the company says so). The net is rounded down to whole shillings, never below 0; the cents
 * left over are held with the rest (rounding), so gross = net + ahl + reserve + wht + rounding.
 */
export function payoutHoldbacks(gross: number, r: HoldbackRates) {
  const g = cents(Math.max(0, gross));
  const ahl = r.contractor ? 0 : cents(g * r.ahlRate);
  const wht = r.contractor ? cents(g * r.whtRate) : 0;
  const reserve = !r.contractor || r.contractorReserve ? cents(g * r.reserveRate) : 0;
  const net = Math.max(0, Math.floor(cents(g - ahl - reserve - wht)));
  return { gross: g, ahl, reserve, wht, net, rounding: cents(g - ahl - reserve - wht - net) };
}

export const lineHeld = (l: Pick<PayoutLine, 'gross' | 'net'>) => cents(num(l.gross) - num(l.net));

/** The days a new batch of a kind covers by default: within one month, never a day still to come. */
export function defaultPeriod(kind: PayoutKind, today: string) {
  const monthStart = `${today.slice(0, 7)}-01`;
  if (kind === 'daily') return { from: today, to: today };
  if (kind === 'weekly') {
    const monday = weekStart(today);
    const sunday = addDays(monday, 6);
    return { from: monday < monthStart ? monthStart : monday, to: sunday > today ? today : sunday };
  }
  return { from: monthStart, to: today };
}

// ---------------------------------------------------------------------------------------------
// the files
// ---------------------------------------------------------------------------------------------
const REF: Record<PayoutKind, string> = { daily: 'Daily pay', weekly: 'Weekly pay', job: 'Job pay', ad_hoc: 'Pay' };

/** What the bank or M-Pesa shows against each payment: "Weekly pay 2026-10-12 to 2026-10-18". */
export const payoutReference = (b: Pick<PayoutBatch, 'kind' | 'period_from' | 'period_to'>) =>
  `${REF[b.kind]} ${b.period_from}${b.period_to !== b.period_from ? ` to ${b.period_to}` : ''}`;

export const payoutFileSlug = (b: Pick<PayoutBatch, 'kind' | 'period_from' | 'period_to'>) =>
  `payout-${b.kind.replace('_', '-')}-${b.period_from}${b.period_to !== b.period_from ? `-to-${b.period_to}` : ''}`;

/** An account number as banks take it: spaces and dashes dropped. */
export const cleanAccount = (v: unknown) => text(v).replace(/[\s-]/g, '');
/** 5 to 20 letters or digits once spaces and dashes are dropped. */
export const isValidAccount = (v: unknown) => /^[0-9A-Za-z]{5,20}$/.test(cleanAccount(v));

const paying = (lines: PayoutLine[], kind: PayoutPaymentKind) => lines.filter((l) => l.payment_kind === kind && num(l.net) > 0);
const problem = (l: PayoutLine, missing: string[]) => ({ name: l.worker_name || l.employee_number, employeeNumber: l.employee_number, missing });

export const PAYOUT_BANK_HEADERS = [
  'Name', 'ID Number', 'Bank', 'Bank Code', 'Branch', 'Branch Code', 'Account Name', 'Account Number', 'Amount', 'Reference', 'Employee Number',
] as const;

/** A generic bank bulk-payment file: one row per worker paid by bank. */
export function payoutBankFile(lines: PayoutLine[], batch: Pick<PayoutBatch, 'kind' | 'period_from' | 'period_to'>): ExportFile {
  const ls = paying(lines, 'bank');
  const ref = payoutReference(batch);
  return {
    headers: PAYOUT_BANK_HEADERS,
    rows: ls.map((l) => [
      l.worker_name, text(l.id_number), text(l.bank), text(l.bank_code), text(l.bank_branch), text(l.branch_code),
      text(l.account_name) || l.worker_name, cleanAccount(l.account_number), num(l.net).toFixed(2), ref, l.employee_number,
    ]),
    problems: ls
      .map((l) => problem(l, [...(text(l.bank) ? [] : ['Bank']), ...(isValidAccount(l.account_number) ? [] : ['Account number (5 to 20 letters or digits)'])]))
      .filter((p) => p.missing.length > 0),
  };
}

/** Safaricom's bulk (B2C) payment layout: phone as 2547XXXXXXXX, whole-shilling amount, name, reference. */
export const PAYOUT_MPESA_HEADERS = ['Phone Number', 'Amount', 'Name', 'Reference'] as const;

export function payoutMpesaFile(
  lines: PayoutLine[],
  batch: Pick<PayoutBatch, 'kind' | 'period_from' | 'period_to'> & Partial<Pick<PayoutBatch, 'currency'>>,
): ExportFile {
  const mobile = paying(lines, 'mobile');
  // M-Pesa Kenya pays KES only: a TZS or UGX payout's mobile money goes by its own country's file
  if (!isKesPayslip(batch)) {
    return { headers: PAYOUT_MPESA_HEADERS, rows: [], problems: [], note: mpesaKenyaNote(mobile.map(() => batch)) ?? undefined };
  }
  const ls = mobile;
  const ref = payoutReference(batch);
  return {
    headers: PAYOUT_MPESA_HEADERS,
    rows: ls.map((l) => [mpesaPhone(l.phone), String(Math.floor(num(l.net))), l.worker_name, ref]),
    problems: ls.filter((l) => !mpesaPhone(l.phone)).map((l) => problem(l, ['M-Pesa number (07XXXXXXXX or 2547XXXXXXXX)'])),
  };
}

/** Equity Bank Eazzy Biz: the payroll's own generator (lib/payrollExports), fed the batch's lines. */
export function payoutEquityFile(lines: PayoutLine[], debitAccount: string): ExportFile {
  const ls = lines.filter((l) => l.payment_kind !== 'cash' && num(l.net) > 0);
  const payslips = ls.map((l) => ({
    employee_id: l.employee_number, employee_name: l.worker_name, net_pay: num(l.net),
    payment_method: l.payment_kind === 'mobile' ? 'M-Pesa' : 'Bank Transfer',
  }));
  const employees: EmployeeRecord[] = ls.map((l) => ({
    'Employee Number': l.employee_number, 'First Name': l.worker_name, Bank: l.bank, bank_code: l.bank_code, branch_code: l.branch_code,
    'Account Number': cleanAccount(l.account_number), account_number_name: l.account_name, 'Mobile Number': l.phone,
  }));
  return equityFile(payslips, employees, debitAccount);
}

export const cashLines = (lines: PayoutLine[]) => lines.filter((l) => l.payment_kind === 'cash' && num(l.net) > 0);

export interface MyPayoutTotals {
  paid: number;
  held: number;
  count: number;
}

export const myPayoutTotals = (p: MyPayouts | null): MyPayoutTotals => ({
  paid: num(p?.paid),
  held: num(p?.held),
  count: p?.payouts?.length ?? 0,
});
