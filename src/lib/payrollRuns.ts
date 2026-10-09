import { supabase } from './supabase';
import { IN_LIST_SIZE, chunks, fetchAll } from './fetchAll';
import { saveSalaryHistoryBatch, type SalaryHistoryRecord } from './salaryHistory';

/**
 * One payroll run per company per month (table payroll_runs). Its payslips are the salary_history rows for that
 * pay_period; the database attaches each saved row to the run and only lets them change while the run is a draft.
 * Staff see their payslip once the run is approved.
 */
export type PayrollRunStatus = 'draft' | 'approved' | 'paid';

export interface PayrollRun {
  id: string;
  pay_period: string;
  status: PayrollRunStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
}

export const getPayrollRun = async (payPeriod: string): Promise<PayrollRun | null> => {
  const { data, error } = await supabase.from('payroll_runs').select('*').eq('pay_period', payPeriod).maybeSingle();
  if (error) throw error;
  return data;
};

export const getRunPayslips = async (runId: string) =>
  fetchAll((from, to) => supabase.from('salary_history').select('*').eq('run_id', runId).order('id').range(from, to));

/**
 * Saves the month's payslips as its draft run (starting the run if needed): every record is written, and payslips of
 * employees no longer in `records` are removed, so the draft always matches the latest calculation.
 */
export const saveDraftRun = async (payPeriod: string, records: SalaryHistoryRecord[]) => {
  if (records.length === 0) throw new Error('There are no employees to pay for this month.');
  await saveSalaryHistoryBatch(records.map((r) => ({ ...r, pay_period: payPeriod })));

  // payslips of people no longer in the calculation, removed by id a chunk at a time (a filter listing thousands
  // of employee numbers would not fit in one request)
  const keep = new Set(records.map((r) => r.employee_id));
  const saved = await fetchAll<{ id: string; employee_id: string }>((from, to) =>
    supabase.from('salary_history').select('id, employee_id').eq('pay_period', payPeriod).order('id').range(from, to)
  );
  // (a payslip with no employee number is left alone, as before)
  const stale = saved.filter((p) => p.employee_id != null && !keep.has(p.employee_id)).map((p) => p.id);
  for (const ids of chunks(stale, IN_LIST_SIZE)) {
    const { error } = await supabase.from('salary_history').delete().in('id', ids);
    if (error) throw error;
  }
};

export const setRunStatus = async (runId: string, status: PayrollRunStatus) => {
  const { error } = await supabase.from('payroll_runs').update({ status }).eq('id', runId);
  if (error) throw error;
};

/** Deletes a draft run and its payslips. */
export const discardDraftRun = async (runId: string) => {
  const { error } = await supabase.from('payroll_runs').delete().eq('id', runId);
  if (error) throw error;
};

/** Message for a failed Supabase call: the database's own wording (e.g. "Reopen it first") when there is one. */
export const runErrorMessage = (err: unknown, fallback: string): string => {
  const message = err && typeof err === 'object' && 'message' in err ? err.message : null;
  return typeof message === 'string' && message ? message : fallback;
};
