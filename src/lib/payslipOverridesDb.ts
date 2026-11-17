import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import { editedColumnsOf, withPayslipEdits, type PayslipChange, type PayslipOverride, type StatutoryContext, type EditablePayslip } from './payslipOverrides';
import { reimbursementItemsOf, withReimbursements } from './reimbursements';
import { savedReimbursements } from './reimbursementsDb';

// The database side of payslip edits (lib/payslipOverrides; migration 20261018300000_payslip_edits): a run's edits,
// saving / removing one payslip's edits with its history row, and the history itself.

export interface PayslipEditRecord {
  id: string;
  run_id: string;
  pay_period: string;
  employee_id: string;
  action: 'edited' | 'removed';
  changes: PayslipChange[];
  overrides: PayslipOverride;
  reason: string;
  edited_by: string | null;
  edited_by_name: string | null;
  edited_at: string;
}

const missingTable = (err: { code?: string } | null | undefined) => ['42P01', 'PGRST205'].includes(err?.code ?? '');

/** A run's payslip edits, by employee number. */
export const loadRunOverrides = async (runId: string): Promise<Map<string, PayslipOverride>> => {
  try {
    const rows = await fetchAll<{ employee_id: string; overrides: PayslipOverride }>((from, to) =>
      supabase.from('payslip_overrides').select('employee_id, overrides').eq('run_id', runId).order('employee_id').range(from, to),
    );
    return new Map(rows.map((r) => [r.employee_id, r.overrides ?? {}]));
  } catch (err) {
    // a database without the table yet: no edits
    if (missingTable(err as { code?: string })) return new Map();
    throw err;
  }
};

// the edit works out net pay again from the calculation, so the saved payslip's reimbursements are added back to it
const writePayslip = async (runId: string, employeeId: string, payslip: Record<string, unknown>) => {
  const items = reimbursementItemsOf({ reimbursement_items: await savedReimbursements(runId, employeeId) });
  const { error } = await supabase
    .from('salary_history')
    .update(editedColumnsOf(withReimbursements({ ...payslip, reimbursements: 0 }, items)))
    .eq('run_id', runId)
    .eq('employee_id', employeeId);
  if (error) throw error;
};

/**
 * Saves a payslip's edits and its history row together, then writes the edited figures to the saved payslip
 * (recalculating the run applies the same edits again).
 */
export const savePayslipEdit = async (input: {
  runId: string;
  employeeId: string;
  override: PayslipOverride;
  changes: PayslipChange[];
  reason: string;
  /** the payslip with the edits applied */
  payslip: Record<string, unknown>;
}) => {
  const { error } = await supabase.rpc('save_payslip_edit', {
    p_run_id: input.runId,
    p_employee_id: input.employeeId,
    p_overrides: input.override,
    p_changes: input.changes,
    p_reason: input.reason,
  });
  if (error) throw error;
  await writePayslip(input.runId, input.employeeId, input.payslip);
};

/** Removes a payslip's edits (recorded in its history) and puts the calculated payslip back. */
export const removePayslipEdits = async (input: {
  runId: string;
  employeeId: string;
  changes: PayslipChange[];
  reason: string;
  /** the payslip as calculated, without edits */
  payslip: Record<string, unknown>;
}) => {
  const { error } = await supabase.rpc('remove_payslip_edits', {
    p_run_id: input.runId,
    p_employee_id: input.employeeId,
    p_changes: input.changes,
    p_reason: input.reason,
  });
  if (error) throw error;
  await writePayslip(input.runId, input.employeeId, { ...input.payslip, payslip_note: null });
};

/** One payslip's edit history (by month and employee, so it outlives a discarded draft), newest first. */
export const loadPayslipHistory = async (payPeriod: string, employeeId: string): Promise<PayslipEditRecord[]> => {
  const { data, error } = await supabase
    .from('payslip_edits')
    .select('id, run_id, pay_period, employee_id, action, changes, overrides, reason, edited_by, edited_by_name, edited_at')
    .eq('pay_period', payPeriod)
    .eq('employee_id', employeeId)
    .order('edited_at', { ascending: false });
  if (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as PayslipEditRecord[];
};

/**
 * The month's calculated payslips with the run's saved edits applied (read fresh, so recalculating never saves the
 * run without them). No run yet: no edits.
 */
export const withRunEdits = async <T extends Record<string, any>>(
  runId: string | null | undefined,
  records: T[],
  ctxFor: (record: T) => StatutoryContext,
): Promise<EditablePayslip<T>[]> => (runId ? withPayslipEdits(records, await loadRunOverrides(runId), ctxFor) : records);
