import { supabase } from './supabase';
import type { PayoutBatch, PayoutKind, PayoutLine } from './piecePayouts';

// Piece rate payouts (migration 20261020200000): payroll makes, reviews, approves and exports batches (a worker reads
// their own through myWorkApi.loadMyPayouts). The database decides who may do what (payroll only; a second approver by default).

const fail = (error: { message?: string } | null) => {
  if (error) throw new Error(error.message || 'Something went wrong');
};

const BATCH_COLUMNS =
  'id, kind, period_from, period_to, pay_period, country, currency, status, notes, worker_count, flagged_count, gross_total, ahl_total, reserve_total, wht_total, net_total, created_by, created_at, approved_by, approved_at, exported_at, cancelled_at, cancel_reason';

export async function loadPayoutBatches(): Promise<PayoutBatch[]> {
  const { data, error } = await supabase.from('work_payout_batches').select(BATCH_COLUMNS).order('created_at', { ascending: false }).limit(200);
  fail(error);
  return (data ?? []) as PayoutBatch[];
}

export async function loadPayoutBatch(id: string): Promise<PayoutBatch | null> {
  const { data, error } = await supabase.from('work_payout_batches').select(BATCH_COLUMNS).eq('id', id).maybeSingle();
  fail(error);
  return (data ?? null) as PayoutBatch | null;
}

export async function loadPayoutLines(batchId: string): Promise<PayoutLine[]> {
  const { data, error } = await supabase.from('work_payout_lines').select('*').eq('batch_id', batchId).order('worker_name');
  fail(error);
  return (data ?? []) as PayoutLine[];
}

/**
 * Makes a payout. A payout is in one currency (FIG-905): give the country when the company pays people in more than
 * one; without it the database refuses a payout that would mix currencies.
 */
export async function createPayoutBatch(kind: PayoutKind, from: string, to: string, workers: string[] | null = null, country: string | null = null): Promise<string> {
  const { data, error } = await supabase.rpc('create_work_payout_batch', { p_kind: kind, p_from: from, p_to: to, p_workers: workers, p_notes: null, p_country: country });
  fail(error);
  return data as string;
}

export async function removePayoutLine(lineId: string) {
  const { error } = await supabase.rpc('remove_work_payout_line', { p_line: lineId });
  fail(error);
}

export async function refreshPayoutDetails(batchId: string) {
  const { error } = await supabase.rpc('refresh_work_payout_details', { p_batch: batchId });
  fail(error);
}

export async function approvePayoutBatch(batchId: string) {
  const { error } = await supabase.rpc('approve_work_payout_batch', { p_batch: batchId });
  fail(error);
}

export async function cancelPayoutBatch(batchId: string, reason: string | null) {
  const { error } = await supabase.rpc('cancel_work_payout_batch', { p_batch: batchId, p_reason: reason });
  fail(error);
}

export async function markPayoutExported(batchId: string) {
  const { error } = await supabase.rpc('mark_work_payout_exported', { p_batch: batchId });
  fail(error);
}

/** The company's Equity account payments are debited from (set on Payroll > Exports); '' when not set. */
export async function loadEquityDebitAccount(): Promise<string> {
  const { data, error } = await supabase.from('company_payroll_settings').select('equity_debit_account').maybeSingle();
  fail(error);
  return String((data as { equity_debit_account?: string | null } | null)?.equity_debit_account ?? '');
}
