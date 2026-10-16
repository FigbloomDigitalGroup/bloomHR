import { supabase } from './supabase';
import type { CasualDay, CasualPayLine, CasualPayRun, CasualWorker, DayPortion, LimitAlert, SheetDay } from './casualPay';

// The casual workers page's reads and writes. The database decides who may do what (20261017900000).

const fail = (error: { message?: string } | null) => {
  if (error) throw new Error(error.message || 'Something went wrong');
};

export async function loadCasuals(): Promise<CasualWorker[]> {
  const { data, error } = await supabase.rpc('casual_workers');
  fail(error);
  return (data ?? []) as CasualWorker[];
}

export interface CasualInput {
  employee_number?: string;
  first_name: string;
  last_name: string;
  id_number?: string;
  phone?: string;
  daily_rate: number | string;
  start_date?: string;
  department_id?: string | null;
  supervisor_email?: string;
  payment_method?: string;
  bank?: string;
  bank_branch?: string;
  account_name?: string;
  account_number?: string;
}

export async function saveCasual(input: CasualInput): Promise<string> {
  const { data, error } = await supabase.rpc('save_casual', { p: input });
  fail(error);
  return String(data);
}

export async function registerCasuals(rows: Omit<CasualInput, 'employee_number'>[]) {
  const { data, error } = await supabase.rpc('register_casuals', { p_rows: rows });
  fail(error);
  return (data ?? []) as { row: number; employee_number?: string; error?: string }[];
}

export async function finishCasual(employeeNumber: string, lastDay: string) {
  const { error } = await supabase.rpc('finish_casual', { p_employee: employeeNumber, p_last_day: lastDay });
  fail(error);
}

export async function rejoinCasual(employeeNumber: string, start: string) {
  const { error } = await supabase.rpc('rejoin_casual', { p_employee: employeeNumber, p_start: start });
  fail(error);
}

export async function loadDays(from: string, to: string): Promise<CasualDay[]> {
  const { data, error } = await supabase
    .from('casual_days')
    .select('id, employee_number, work_date, portion, daily_rate, amount, status, pay_run_id, paid_at')
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date')
    .limit(10000);
  fail(error);
  return (data ?? []) as CasualDay[];
}

/** Set one day: a portion records (or changes) it, null removes it. */
export async function setDay(employeeNumber: string, day: string, portion: DayPortion | null, existing?: CasualDay) {
  if (portion === null) {
    if (!existing) return;
    const { error } = await supabase.from('casual_days').delete().eq('id', existing.id);
    fail(error);
    return;
  }
  if (existing) {
    const { error } = await supabase.from('casual_days').update({ portion }).eq('id', existing.id);
    fail(error);
    return;
  }
  const { error } = await supabase.from('casual_days').insert({ employee_number: employeeNumber, work_date: day, portion });
  fail(error);
}

/** Days from a spreadsheet: each one added or changed; returns the ones the database refused, with why. */
export async function uploadDays(days: SheetDay[]) {
  if (!days.length) return [];
  const dates = days.map((d) => d.work_date).sort();
  const existing = await loadDays(dates[0], dates[dates.length - 1]);
  const byKey = new Map(existing.map((d) => [`${d.employee_number}|${d.work_date}`, d]));
  const refused: { day: SheetDay; problem: string }[] = [];
  for (const day of days) {
    const old = byKey.get(`${day.employee_number}|${day.work_date}`);
    const { error } = old
      ? await supabase.from('casual_days').update({ portion: day.portion }).eq('id', old.id)
      : await supabase.from('casual_days').insert({ ...day, source: 'upload' });
    if (error) refused.push({ day, problem: error.message });
  }
  return refused;
}

export async function approveDays(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from('casual_days').update({ status: 'approved' }).in('id', ids);
  fail(error);
}

export async function loadRuns(): Promise<CasualPayRun[]> {
  const { data, error } = await supabase
    .from('casual_pay_runs')
    .select('id, period_start, period_end, status, notes, total, created_at, approved_at, paid_on')
    .order('period_start', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  fail(error);
  return (data ?? []) as CasualPayRun[];
}

export async function loadRunLines(runId: string): Promise<CasualPayLine[]> {
  const { data, error } = await supabase.from('casual_pay_lines').select('*').eq('run_id', runId).order('worker_name');
  fail(error);
  return (data ?? []) as CasualPayLine[];
}

export async function createRun(start: string, end: string, notes?: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_casual_pay_run', { p_start: start, p_end: end, p_notes: notes ?? null });
  fail(error);
  return String(data);
}

export async function refreshRun(runId: string) {
  const { error } = await supabase.rpc('refresh_casual_pay_run', { p_run: runId });
  fail(error);
}

export async function saveAdjustment(lineId: string, additions: number, deductions: number, note: string) {
  const { error } = await supabase
    .from('casual_pay_lines')
    .update({ additions, deductions, adjustment_note: note.trim() || null })
    .eq('id', lineId);
  fail(error);
}

export async function approveRun(runId: string) {
  const { error } = await supabase.rpc('approve_casual_pay_run', { p_run: runId });
  fail(error);
}

export async function reopenRun(runId: string) {
  const { error } = await supabase.rpc('reopen_casual_pay_run', { p_run: runId });
  fail(error);
}

export async function markRunPaid(runId: string, paidOn: string) {
  const { error } = await supabase.rpc('mark_casual_pay_run_paid', { p_run: runId, p_paid_on: paidOn });
  fail(error);
}

export async function deleteRun(runId: string) {
  const { error } = await supabase.from('casual_pay_runs').delete().eq('id', runId);
  fail(error);
}

export async function loadLimitAlerts(): Promise<LimitAlert[]> {
  const { data, error } = await supabase.rpc('casual_limit_alerts');
  fail(error);
  return (data ?? []) as LimitAlert[];
}

export async function loadDayLimit(): Promise<number> {
  const { data, error } = await supabase.rpc('casual_day_limit');
  fail(error);
  return Number(data) || 30;
}

export async function saveDayLimit(days: number) {
  const { error } = await supabase.rpc('set_casual_day_limit', { p_days: days });
  fail(error);
}
