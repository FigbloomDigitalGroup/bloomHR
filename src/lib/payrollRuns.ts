import { supabase } from './supabase';
import { IN_LIST_SIZE, chunks, fetchAll } from './fetchAll';
import { saveSalaryHistoryBatch, type SalaryHistoryRecord } from './salaryHistory';
import type { Rates } from './statutoryCalc';

/**
 * One payroll run per company per month (table payroll_runs). Its payslips are the salary_history rows for that
 * pay_period; the database attaches each saved row to the run.
 *
 * FIG-905: the run is approved per country (payroll_run_countries). Each country's payslips change only while that
 * country is a draft, and staff see theirs once their country is approved. The run's own status is the sum of its
 * countries (draft while any is, paid when all are, approved otherwise).
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

/** Every payroll run the company has, newest month first (the History tab). */
export const listPayrollRuns = async (): Promise<PayrollRun[]> => {
  const { data, error } = await supabase.from('payroll_runs').select('*').order('pay_period', { ascending: false });
  if (error) throw error;
  return data ?? [];
};

/** One country's part of a month's run (payroll_run_countries). */
export interface PayrollRunCountry {
  id: string;
  run_id: string;
  country: string;
  currency: string | null;
  status: PayrollRunStatus;
  approved_by: string | null;
  approved_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
}

/** The run's countries and where each stands (empty for a run from before countries were recorded). */
export const getRunCountries = async (runId: string): Promise<PayrollRunCountry[]> => {
  const { data, error } = await supabase.from('payroll_run_countries').select('*').eq('run_id', runId).order('country');
  if (error) {
    // a database without the table yet (migration 20261020900000): the run as one country
    if (['42P01', 'PGRST205'].includes((error as { code?: string }).code ?? '')) return [];
    throw error;
  }
  return (data ?? []) as PayrollRunCountry[];
};

/**
 * Approves (draft -> approved), reopens (approved -> draft) or marks paid (approved -> paid) several countries of the
 * run at once. Returns the countries that changed (a country not in the starting status is left alone).
 */
export const setCountriesStatus = async (runId: string, countries: string[], status: PayrollRunStatus): Promise<string[]> => {
  if (countries.length === 0) return [];
  const { data, error } = await supabase.rpc('set_payroll_countries_status', { p_run: runId, p_countries: countries, p_status: status });
  if (error) throw error;
  return (data ?? []) as string[];
};

/** Discards the draft payslips of some countries (the run itself goes when nothing is left in it). */
export const discardDraftCountries = async (runId: string, countries: string[]) => {
  for (const country of countries) {
    const { error } = await supabase.from('salary_history').delete().eq('run_id', runId).eq('country', country);
    if (error) throw error;
  }
  const { data, error } = await supabase.from('salary_history').select('id').eq('run_id', runId).limit(1);
  if (error) throw error;
  if ((data ?? []).length === 0) await discardDraftRun(runId);
};

export const getRunPayslips = async (runId: string) =>
  fetchAll((from, to) => supabase.from('salary_history').select('*').eq('run_id', runId).order('id').range(from, to));

/**
 * Saves the month's payslips as its draft run (starting the run if needed): every record is written, and payslips of
 * employees no longer in `records` are removed, so the draft always matches the latest calculation. Countries already
 * approved or paid (`lockedCountries`) are left as they are: their payslips are neither saved nor removed.
 */
export const saveDraftRun = async (
  payPeriod: string,
  records: SalaryHistoryRecord[],
  lockedCountries: string[] = [],
  /** the rates each country was worked out with (FIG-813): recorded so a later rate change flags the draft */
  ratesUsed?: Map<string, Rates | null> | null,
) => {
  if (records.length === 0) throw new Error('There are no employees to pay for this month.');
  await saveSalaryHistoryBatch(records.map((r) => ({ ...r, pay_period: payPeriod })));

  // payslips of people no longer in the calculation, removed by id a chunk at a time (a filter listing thousands
  // of employee numbers would not fit in one request)
  const keep = new Set(records.map((r) => r.employee_id));
  const locked = new Set(lockedCountries.map((c) => c.trim().toLowerCase()));
  const saved = await fetchAll<{ id: string; employee_id: string; country?: string | null }>((from, to) =>
    supabase.from('salary_history').select('id, employee_id, country').eq('pay_period', payPeriod).order('id').range(from, to)
  );
  // (a payslip with no employee number is left alone, as before; so is a locked country's)
  const stale = saved
    .filter((p) => p.employee_id != null && !keep.has(p.employee_id) && !locked.has(String(p.country || 'Kenya').trim().toLowerCase()))
    .map((p) => p.id);
  for (const ids of chunks(stale, IN_LIST_SIZE)) {
    const { error } = await supabase.from('salary_history').delete().in('id', ids);
    if (error) throw error;
  }

  if (ratesUsed) {
    const run = await getPayrollRun(payPeriod);
    const saved = new Set(records.map((r) => String((r as { country?: unknown }).country || 'Kenya').trim().toLowerCase()));
    const used = Object.fromEntries([...ratesUsed].filter(([country, rates]) => rates && saved.has(country.trim().toLowerCase()) && !locked.has(country.trim().toLowerCase())));
    if (run && Object.keys(used).length) await recordRunRates(run.id, used as Record<string, Rates>);
  }
};

/** A database without migration 20261021800000 yet: the stale-rates check is skipped, never an error. */
const missingFunction = (error: unknown) => ['42883', 'PGRST202'].includes((error as { code?: string } | null)?.code ?? '');

/** Records the rates each draft country of the run was worked out with (approved countries are left as they are). */
export const recordRunRates = async (runId: string, rates: Record<string, Rates>): Promise<string[]> => {
  const { data, error } = await supabase.rpc('record_payroll_rates', { p_run: runId, p_rates: rates });
  if (error) {
    if (missingFunction(error)) return [];
    throw error;
  }
  return (data ?? []) as string[];
};

/**
 * The run's draft countries whose statutory rates for the month changed since they were worked out (a new platform
 * rate, a company's own rate): they must be recalculated before they can be approved. Approved and paid countries are
 * never listed: they never change.
 */
export const getStaleCountries = async (runId: string): Promise<string[]> => {
  const { data, error } = await supabase.rpc('payroll_stale_countries', { p_run: runId });
  if (error) {
    if (missingFunction(error)) return [];
    throw error;
  }
  return ((data ?? []) as unknown[]).map((c) => (typeof c === 'string' ? c : String((c as Record<string, unknown>)?.payroll_stale_countries ?? '')));
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
