import { supabase } from './supabase';
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

export const getRunPayslips = async (runId: string) => {
  const { data, error } = await supabase.from('salary_history').select('*').eq('run_id', runId);
  if (error) throw error;
  return data ?? [];
};

/** PostgREST `in` list: ("a","b") with quotes and backslashes escaped */
const inList = (values: string[]) => `(${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;

/**
 * Saves the month's payslips as its draft run (starting the run if needed): every record is written, and payslips of
 * employees no longer in `records` are removed, so the draft always matches the latest calculation.
 */
export const saveDraftRun = async (payPeriod: string, records: SalaryHistoryRecord[]) => {
  if (records.length === 0) throw new Error('There are no employees to pay for this month.');
  await saveSalaryHistoryBatch(records.map((r) => ({ ...r, pay_period: payPeriod })));

  const { error } = await supabase
    .from('salary_history')
    .delete()
    .eq('pay_period', payPeriod)
    .not('employee_id', 'in', inList(records.map((r) => r.employee_id)));
  if (error) throw error;
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
