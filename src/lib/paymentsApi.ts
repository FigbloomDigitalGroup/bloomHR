import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import { requireUpdatedRows } from './requireUpdated';
import { paymentKind, paymentMethodLabel } from './paymentMethods';
import { decideApproval } from './approvals';

// Payments to make (migration 20261025400000, FIG-1209). Approved salary advances, loans, expenses and requisitions
// wait in one list; finance pays each outside the app and records how. The database fills the list, checks who may
// record a payment and marks the item it came from paid; these only read and call it. Nothing here moves money.

export type PaymentSource = 'salary_advance' | 'loan' | 'expense' | 'requisition';
export type PaymentStatus = 'to_pay' | 'paid' | 'cancelled';
/** How finance paid it. 'in_app' waits for a payment provider (inAppPayments.ts). */
export type PaidVia = 'bank' | 'mpesa' | 'airtel' | 'other_app' | 'cash' | 'cheque';

export const PAID_VIA: { id: PaidVia; label: string; reference: string }[] = [
  { id: 'bank', label: 'Bank transfer', reference: 'Bank reference' },
  { id: 'mpesa', label: 'M-Pesa', reference: 'M-Pesa code' },
  { id: 'airtel', label: 'Airtel Money', reference: 'Airtel Money code' },
  { id: 'other_app', label: 'Another app (Paystack, PesaPal...)', reference: 'Transaction reference' },
  { id: 'cheque', label: 'Cheque', reference: 'Cheque number' },
  { id: 'cash', label: 'Cash', reference: 'Receipt number (optional)' },
];

export const paidViaLabel = (via: string | null) => (via ? PAID_VIA.find((p) => p.id === via)?.label ?? via : 'Marked paid on its own screen');

export const SOURCE_LABEL: Record<PaymentSource, string> = {
  salary_advance: 'Salary advance',
  loan: 'Loan',
  expense: 'Expense claim',
  requisition: 'Requisition',
};

export interface PaymentRequest {
  id: string;
  source: PaymentSource;
  source_id: string;
  employee_number: string | null;
  payee_name: string;
  payee_details: string | null;
  amount: number;
  purpose: string | null;
  approved_by_email: string | null;
  approved_at: string;
  status: PaymentStatus;
  paid_via: PaidVia | null;
  payment_reference: string | null;
  paid_on: string | null;
  payment_note: string | null;
  paid_by_email: string | null;
  paid_at: string | null;
}

/** How to pay an employee, from their record (only for those with something waiting). */
export interface Payee {
  employee_number: string;
  payment_method: string | null;
  mobile_number: string | null;
  bank: string | null;
  bank_branch: string | null;
  account_number: string | null;
  account_name: string | null;
}

const toPayment = (row: Record<string, unknown>): PaymentRequest => ({ ...row, amount: Number(row.amount) }) as PaymentRequest;

const friendly = (error: { message?: string } | null) => new Error(error?.message || 'Not saved. Please try again.');

export async function loadPayments(): Promise<PaymentRequest[]> {
  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    supabase
      .from('payment_requests')
      .select(
        'id, source, source_id, employee_number, payee_name, payee_details, amount, purpose, approved_by_email, approved_at, status, paid_via, payment_reference, paid_on, payment_note, paid_by_email, paid_at'
      )
      .order('approved_at', { ascending: false })
      .order('id')
      .range(from, to)
  );
  return rows.map(toPayment);
}

export async function loadPayees(): Promise<Record<string, Payee>> {
  const { data, error } = await supabase.rpc('payment_payees');
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as Payee[]).map((p) => [p.employee_number, p]));
}

/** One line on how to pay an employee: "M-Pesa 0712 345 678" or "Bank Transfer: Equity, Kenyatta Ave, 0123 (Jane Doe)". */
export function payeeLine(p: Payee | undefined): string {
  if (!p) return '';
  const method = paymentMethodLabel(p.payment_method);
  const kind = paymentKind(p.payment_method);
  if (kind === 'mobile') return p.mobile_number ? `${method} ${p.mobile_number}` : `${method}: no phone number on record`;
  if (kind === 'cash') return 'Cash';
  const parts = [p.bank, p.bank_branch, p.account_number].map((x) => x?.trim()).filter(Boolean);
  if (parts.length === 0) return `${method}: no bank details on record`;
  return `${method}: ${parts.join(', ')}${p.account_name?.trim() ? ` (${p.account_name.trim()})` : ''}`;
}

export async function recordPayment(id: string, values: { via: PaidVia; reference: string; paidOn: string; note: string }) {
  const { error } = await supabase.rpc('record_payment', {
    p_id: id,
    p_via: values.via,
    p_reference: values.reference.trim() || null,
    p_paid_on: values.paidOn,
    p_note: values.note.trim() || null,
  });
  if (error) throw friendly(error);
}

// ---------------------------------------------------------------------------------------------
// requisitions
// ---------------------------------------------------------------------------------------------

export type RequisitionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'paid';

export interface Requisition {
  id: string;
  requested_by: string | null;
  payee_type: 'employee' | 'other';
  payee_employee_number: string | null;
  payee_name: string | null;
  payee_details: string | null;
  category: string | null;
  amount: number;
  purpose: string;
  needed_by: string | null;
  status: RequisitionStatus;
  decided_by_email: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  paid_at: string | null;
  created_at: string;
}

/** Suggestions for the category (anything else may be typed). */
export const REQUISITION_CATEGORIES = ['Supplies', 'Travel', 'Repairs', 'Equipment', 'Training', 'Welfare', 'Utilities', 'Other'];

const NOT_SAVED = 'The requisition was not saved: you do not have permission to change it, or it no longer exists.';

export async function loadRequisitions(): Promise<Requisition[]> {
  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    supabase
      .from('requisitions')
      .select(
        'id, requested_by, payee_type, payee_employee_number, payee_name, payee_details, category, amount, purpose, needed_by, status, decided_by_email, decided_at, decision_comment, paid_at, created_at'
      )
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to)
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }) as Requisition);
}

export interface NewRequisition {
  payeeType: 'employee' | 'other';
  employeeNumber: string;
  payeeName: string;
  payeeDetails: string;
  category: string;
  amount: number;
  purpose: string;
  neededBy: string;
  /** HR approving it as they raise it */
  approve: boolean;
}

/**
 * Saves a requisition. Asked to approve it at once, it stays approved only when the company's requisition approvals are
 * one step the signed-in person decides; otherwise it goes on the chain (20261025700000): the status it got is returned.
 */
export async function createRequisition(r: NewRequisition): Promise<RequisitionStatus> {
  const other = r.payeeType === 'other';
  const { data, error } = await supabase.from('requisitions').insert({
    payee_type: r.payeeType,
    payee_employee_number: other ? null : r.employeeNumber,
    payee_name: other ? r.payeeName.trim() : null,
    payee_details: other ? r.payeeDetails.trim() || null : null,
    category: r.category.trim() || null,
    amount: r.amount,
    purpose: r.purpose.trim(),
    needed_by: r.neededBy || null,
    status: r.approve ? 'approved' : 'pending',
  }).select('status').single();
  if (error) throw friendly(error);
  return (data?.status ?? 'pending') as RequisitionStatus;
}

async function update(id: string, values: Record<string, unknown>) {
  const { data, error } = await supabase.from('requisitions').update(values).eq('id', id).select('id');
  if (error) throw friendly(error);
  requireUpdatedRows(data, NOT_SAVED);
}

/** Approves the step a requisition waits on (its approval chain's request): 'approved' at the last, else 'pending'. */
export const approveRequisition = (requestId: string, comment: string) => decideApproval(requestId, 'approved', comment.trim());

/** Turns it down on its chain (a reason is needed). */
export async function declineRequisition(requestId: string, reason: string) {
  await decideApproval(requestId, 'rejected', reason.trim());
}

export const cancelRequisition = (id: string) => update(id, { status: 'cancelled' });
