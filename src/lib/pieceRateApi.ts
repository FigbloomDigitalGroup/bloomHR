import { supabase } from './supabase';
import type {
  ContractJob, ImportRow, JobStatus, PayBasis, PayFrequency, SheetWorkRow, WhtCategory, WorkEntry, WorkImport, WorkPerson,
  WorkRate, WorkSettings, WorkTotal, WorkType, WorkerKind,
} from './pieceRate';
import { DEFAULT_WORK_SETTINGS } from './pieceRate';

// Piece rate and contract jobs: the reads and writes. The database decides who may do what (20261014100000,
// 20261019800000): payroll everything, a supervisor their team, a worker their own.

const fail = (error: { message?: string } | null) => {
  if (error) throw new Error(error.message || 'Something went wrong');
};

type Outcome = { failed: { id: string; error: string }[] };
const firstProblem = (out: Outcome | null) => out?.failed?.[0]?.error ?? null;

// ---------------------------------------------------------------------------------------------
// kinds of work and rates
// ---------------------------------------------------------------------------------------------
export async function loadWorkTypes(): Promise<WorkType[]> {
  const { data, error } = await supabase
    .from('work_types')
    .select('id, name, unit, rate, active, effective_from, effective_to')
    .order('name');
  fail(error);
  return (data ?? []) as WorkType[];
}

export async function loadWorkRates(): Promise<WorkRate[]> {
  const { data, error } = await supabase.from('work_type_rates').select('id, work_type_id, rate, effective_from').order('effective_from');
  fail(error);
  return (data ?? []) as WorkRate[];
}

export interface WorkTypeInput {
  name: string;
  unit: string;
  rate: number;
  active: boolean;
  effective_from: string | null;
  effective_to: string | null;
}

/** A new kind of work, or a change to one (its rate is changed with setWorkRate, from a date). */
export async function saveWorkType(input: WorkTypeInput, id?: string) {
  if (id) {
    const { rate: _rate, ...rest } = input;
    void _rate;
    const { error } = await supabase.from('work_types').update(rest).eq('id', id);
    fail(error);
    return;
  }
  const { error } = await supabase.from('work_types').insert(input);
  fail(error);
}

export async function setWorkRate(typeId: string, rate: number, from: string) {
  const { error } = await supabase.rpc('set_work_rate', { p_type: typeId, p_rate: rate, p_from: from });
  fail(error);
}

// ---------------------------------------------------------------------------------------------
// workers and settings
// ---------------------------------------------------------------------------------------------
export async function loadWorkPeople(): Promise<WorkPerson[]> {
  const { data, error } = await supabase.rpc('work_people');
  fail(error);
  return (data ?? []) as WorkPerson[];
}

export async function setWorkerPay(employeeNumber: string, kind: Exclude<WorkerKind, 'casual'>, basis: PayBasis, frequency: PayFrequency, wht: WhtCategory | null) {
  const { error } = await supabase.rpc('set_worker_pay', {
    p_employee: employeeNumber, p_kind: kind, p_basis: basis, p_frequency: frequency, p_wht: wht,
  });
  fail(error);
}

export async function loadWorkSettings(): Promise<WorkSettings> {
  const { data, error } = await supabase.rpc('work_settings');
  fail(error);
  const s = (data ?? {}) as Partial<WorkSettings>;
  return {
    supervisor_work_needs_approval: s.supervisor_work_needs_approval ?? DEFAULT_WORK_SETTINGS.supervisor_work_needs_approval,
    payout_reserve_rate: Number(s.payout_reserve_rate ?? DEFAULT_WORK_SETTINGS.payout_reserve_rate),
  };
}

export async function saveWorkSettings(patch: Partial<WorkSettings>) {
  const { error } = await supabase.rpc('set_work_settings', { p: patch });
  fail(error);
}

/** The signed-in person's auth id (to tell their own entries from others'). */
export async function myUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// recorded work
// ---------------------------------------------------------------------------------------------
const ENTRY_COLUMNS = 'id, employee_number, work_date, work_type_id, quantity, rate, amount, status, source, notes, rejection_reason, entered_by, paid_out_at';

export async function loadEntries(from: string, to: string): Promise<WorkEntry[]> {
  const { data, error } = await supabase
    .from('work_entries')
    .select(ENTRY_COLUMNS)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date')
    .limit(10000);
  fail(error);
  return (data ?? []) as WorkEntry[];
}

export async function loadWaitingEntries(): Promise<WorkEntry[]> {
  const { data, error } = await supabase
    .from('work_entries')
    .select(ENTRY_COLUMNS)
    .eq('status', 'submitted')
    .order('work_date')
    .limit(5000);
  fail(error);
  return (data ?? []) as WorkEntry[];
}

export interface CellChange {
  employee_number: string;
  work_type_id: string;
  /** null clears the cell */
  quantity: number | null;
  existing?: WorkEntry;
}

/** Saves a day's changed cells as drafts (new), changes (existing) or removals (cleared). Returns the entries kept. */
export async function saveDayCells(day: string, changes: CellChange[]): Promise<string[]> {
  const kept: string[] = [];
  for (const c of changes) {
    if (c.existing) {
      if (c.quantity === null) {
        const { error } = await supabase.from('work_entries').delete().eq('id', c.existing.id);
        fail(error);
      } else {
        const { error } = await supabase.from('work_entries').update({ quantity: c.quantity }).eq('id', c.existing.id);
        fail(error);
        kept.push(c.existing.id);
      }
    } else if (c.quantity !== null) {
      const { data, error } = await supabase
        .from('work_entries')
        .insert({ employee_number: c.employee_number, work_date: day, work_type_id: c.work_type_id, quantity: c.quantity, status: 'draft', source: 'supervisor' })
        .select('id')
        .single();
      fail(error);
      if (data) kept.push((data as { id: string }).id);
    }
  }
  return kept;
}

export async function submitEntries(ids: string[]) {
  if (!ids.length) return { submitted: 0, approved: 0, problem: null as string | null };
  const { data, error } = await supabase.rpc('submit_work_entries', { p_ids: ids });
  fail(error);
  const out = data as { submitted: number; approved: number } & Outcome;
  return { submitted: out.submitted, approved: out.approved, problem: firstProblem(out) };
}

export async function decideEntries(ids: string[], decision: 'approved' | 'rejected', reason?: string) {
  const { data, error } = await supabase.rpc('decide_work_entries', { p_ids: ids, p_decision: decision, p_reason: reason ?? null });
  fail(error);
  const out = data as { done: number } & Outcome;
  return { done: out.done, problem: firstProblem(out) };
}

export async function reopenEntries(ids: string[]) {
  const { data, error } = await supabase.rpc('reopen_work_entries', { p_ids: ids });
  fail(error);
  const out = data as { done: number } & Outcome;
  return { done: out.done, problem: firstProblem(out) };
}

// ---------------------------------------------------------------------------------------------
// the spreadsheet
// ---------------------------------------------------------------------------------------------
export async function checkImport(rows: SheetWorkRow[]): Promise<ImportRow[]> {
  const { data, error } = await supabase.rpc('check_work_import', { p_rows: rows });
  fail(error);
  return (data ?? []) as ImportRow[];
}

export async function importEntries(fileName: string, rows: SheetWorkRow[]) {
  const { data, error } = await supabase.rpc('import_work_entries', { p_file_name: fileName, p_rows: rows });
  fail(error);
  return data as { import_id: string; imported: number; problems: { row: number; error: string }[] };
}

export async function loadImports(): Promise<WorkImport[]> {
  const { data, error } = await supabase
    .from('work_imports')
    .select('id, file_name, row_count, imported_count, problem_count, problems, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  fail(error);
  return (data ?? []) as WorkImport[];
}

// ---------------------------------------------------------------------------------------------
// contract jobs and totals
// ---------------------------------------------------------------------------------------------
export async function loadJobs(): Promise<ContractJob[]> {
  const { data, error } = await supabase
    .from('contract_jobs')
    .select('id, employee_number, title, description, amount, start_date, due_date, status, completed_at, completion_notes, sent_back_reason, approved_at, paid_out_at, created_at')
    .order('created_at', { ascending: false })
    .limit(2000);
  fail(error);
  return (data ?? []) as ContractJob[];
}

export interface JobInput {
  employee_number: string;
  title: string;
  description: string | null;
  amount: number;
  start_date: string | null;
  due_date: string | null;
}

export async function createJob(input: JobInput) {
  const { error } = await supabase.from('contract_jobs').insert(input);
  fail(error);
}

export async function moveJob(id: string, status: JobStatus, note?: string) {
  const patch: Record<string, unknown> = { status };
  if (status === 'open') patch.sent_back_reason = note ?? null;
  if (status === 'completed' && note) patch.completion_notes = note;
  const { error } = await supabase.from('contract_jobs').update(patch).eq('id', id);
  fail(error);
}

export async function loadTotals(from: string, to: string): Promise<WorkTotal[]> {
  const { data, error } = await supabase.rpc('work_totals', { p_from: from, p_to: to });
  fail(error);
  return (data ?? []) as WorkTotal[];
}
