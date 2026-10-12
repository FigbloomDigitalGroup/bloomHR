import { supabase } from './supabase';
import { apiRequest } from './adminApi';
import { fetchAll } from './fetchAll';

// Paying an approved payroll run by M-Pesa or bank (FIG-744). The server queues and sends the payments and records
// each one (table payroll_payments); this page only reads them and asks the server to queue or retry.

export type PaymentChannel = 'mpesa' | 'bank';
export type PaymentStatus = 'queued' | 'sending' | 'sent' | 'paid' | 'failed' | 'unknown';

export interface PayrollPayment {
  id: string;
  employee_number: string;
  employee_name: string | null;
  channel: PaymentChannel;
  phone: string | null;
  bank_name: string | null;
  account_number: string | null;
  amount: number;
  status: PaymentStatus;
  attempts: number;
  receipt: string | null;
  result_desc: string | null;
  updated_at: string;
}

export interface SkippedEmployee {
  employee_number: string;
  employee_name: string | null;
  reason: string;
}

export const loadRunPayments = (runId: string): Promise<PayrollPayment[]> =>
  fetchAll<PayrollPayment>((from, to) =>
    supabase
      .from('payroll_payments')
      .select('id, employee_number, employee_name, channel, phone, bank_name, account_number, amount, status, attempts, receipt, result_desc, updated_at')
      .eq('run_id', runId)
      .order('employee_number')
      .order('id')
      .range(from, to)
  );

/** Queues a payment for everyone in the run paid by M-Pesa or bank; anyone already queued is left as they are. */
export const queueRunPayments = (runId: string) =>
  apiRequest<{ queued: number; alreadyQueued: number; skipped: SkippedEmployee[] }>('POST', '/payroll-payments/queue', { runId });

/** Puts the run's failed payments back in the queue (never ones whose outcome is unknown). */
export const retryFailedPayments = (runId: string) => apiRequest<{ requeued: number }>('POST', '/payroll-payments/retry-failed', { runId });

const STATUSES: PaymentStatus[] = ['queued', 'sending', 'sent', 'paid', 'failed', 'unknown'];

export interface ChannelSummary {
  count: Record<PaymentStatus, number>;
  amount: Record<PaymentStatus, number>;
  total: number;
}

/** Counts and amounts per channel and status. */
export function summarisePayments(payments: PayrollPayment[]): Record<PaymentChannel, ChannelSummary> {
  const empty = (): ChannelSummary => ({
    count: Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<PaymentStatus, number>,
    amount: Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<PaymentStatus, number>,
    total: 0,
  });
  const out = { mpesa: empty(), bank: empty() };
  for (const p of payments) {
    const c = out[p.channel];
    if (!c) continue;
    c.count[p.status] += 1;
    c.amount[p.status] += Number(p.amount) || 0;
    c.total += 1;
  }
  return out;
}

/** Payments still on their way: worth checking again shortly. */
export const inProgress = (payments: PayrollPayment[]) => payments.some((p) => ['queued', 'sending', 'sent'].includes(p.status));
