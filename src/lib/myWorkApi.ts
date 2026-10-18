import { supabase } from './supabase';
import { currentUserAndTenant, randomFileName } from './privateFiles';
import type { MyEarnings, MyEntry, MyJob, MyWorkProfile } from './myWork';

// The staff portal's "My work": the signed-in worker's own entries, jobs and earnings (migration 20261020100000). The
// database only ever returns their own rows here; recording and submitting reuse pieceRateApi (saveDayCells,
// submitEntries), whose rules make a worker's entries their own and send them to their supervisor.

export const WORK_FILES_BUCKET = 'work-files' as const;
export const MAX_JOB_FILE_BYTES = 10 * 1024 * 1024;

const fail = (error: { message?: string } | null) => {
  if (error) throw new Error(error.message || 'Something went wrong');
};

export async function loadMyWorkProfile(): Promise<MyWorkProfile> {
  const { data, error } = await supabase.rpc('my_work_profile');
  fail(error);
  return (data ?? { employee_number: null, qualifies: false }) as MyWorkProfile;
}

const ENTRY_COLUMNS =
  'id, employee_number, work_date, work_type_id, quantity, rate, amount, status, source, notes, rejection_reason, entered_by, paid_out_at, reopened_at';

export async function loadMyEntries(employeeNumber: string, from: string, to: string): Promise<MyEntry[]> {
  const { data, error } = await supabase
    .from('work_entries')
    .select(ENTRY_COLUMNS)
    .eq('employee_number', employeeNumber)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date', { ascending: false })
    .limit(2000);
  fail(error);
  return (data ?? []) as MyEntry[];
}

export async function loadMyJobs(employeeNumber: string): Promise<MyJob[]> {
  const { data, error } = await supabase
    .from('contract_jobs')
    .select('id, employee_number, title, description, amount, start_date, due_date, status, completed_at, completion_notes, completion_file, completion_file_name, sent_back_reason, approved_at, paid_out_at, created_at')
    .eq('employee_number', employeeNumber)
    .order('created_at', { ascending: false })
    .limit(500);
  fail(error);
  return (data ?? []) as MyJob[];
}

export async function loadMyEarnings(month: string): Promise<MyEarnings> {
  const { data, error } = await supabase.rpc('my_work_earnings', { p_month: month });
  fail(error);
  return data as MyEarnings;
}

/** Marks my own open job done, with an optional note and photo or document; the approver is told. */
export async function completeMyJob(jobId: string, note: string, file?: File | null) {
  let path: string | null = null;
  if (file) {
    if (file.size > MAX_JOB_FILE_BYTES) throw new Error('Files can be up to 10 MB');
    const { tenantId } = await currentUserAndTenant();
    path = `${tenantId}/${jobId}/${randomFileName(file.name)}`;
    const { error: upErr } = await supabase.storage.from(WORK_FILES_BUCKET).upload(path, file, { contentType: file.type || undefined });
    if (upErr) throw new Error(upErr.message || 'Could not upload the file');
  }
  const { error } = await supabase.rpc('complete_my_job', {
    p_job: jobId, p_note: note.trim() || null, p_file: path, p_file_name: file ? file.name.slice(0, 300) : null,
  });
  if (error) {
    if (path) await supabase.storage.from(WORK_FILES_BUCKET).remove([path]);
    fail(error);
  }
}
