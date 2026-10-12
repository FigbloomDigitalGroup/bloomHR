import { supabase } from './supabase';
import { currentUserAndTenant, openPrivateFile } from './privateFiles';
import { fileProblem } from './employeeDocuments';

// Health records (20261012500000): voluntary, with consent. The employee adds medical conditions and disability /
// accommodation needs with supporting documents; HR and administrators read them through health_records_for, which
// logs every read, and opening a document is logged too.

export type HealthKind = 'condition' | 'accommodation';

export const HEALTH_KIND_LABELS: Record<HealthKind, string> = {
  condition: 'Medical condition',
  accommodation: 'Disability or accommodation need',
};

export interface HealthFile {
  id: string;
  file_path: string;
  file_name: string;
}

export interface HealthRecord {
  id?: string;
  kind: HealthKind;
  title: string;
  details: string;
  institution: string;
  diagnosed_on: string;
  files?: HealthFile[];
}

export interface HealthInfo {
  consent_given_at: string | null;
  records: HealthRecord[];
}

export const emptyHealthRecord = (): HealthRecord => ({ kind: 'condition', title: '', details: '', institution: '', diagnosed_on: '' });

export const CONSENT_TEXT =
  'I choose to share this health information with my employer so it can support me at work (for example in an emergency ' +
  'or by adjusting my work). I understand that HR and administrators can see it, that each time they look at it is ' +
  'recorded, that it is not needed for my onboarding, and that I can withdraw my consent at any time, which deletes it.';

const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

/** The employee's health information (their own, or for HR anyone's: that read is logged). */
export async function loadHealth(employeeId: string): Promise<HealthInfo> {
  const { data, error } = await supabase.rpc('health_records_for', { p_employee: employeeId });
  if (error) fail(error, 'Could not load the health information.');
  const h = (data ?? {}) as { consent_given_at?: string | null; records?: Record<string, unknown>[] };
  return {
    consent_given_at: h.consent_given_at ?? null,
    records: (h.records ?? []).map((r) => ({
      id: String(r.id), kind: r.kind as HealthKind, title: String(r.title ?? ''), details: String(r.details ?? ''),
      institution: String(r.institution ?? ''), diagnosed_on: String(r.diagnosed_on ?? ''), files: (r.files ?? []) as HealthFile[],
    })),
  };
}

export async function giveHealthConsent(employeeId: string): Promise<void> {
  const { error } = await supabase.from('employee_health_consents').insert({ employee_id: employeeId });
  if (error) fail(error, 'Your consent was not saved.');
}

/** Withdraws consent: the documents are removed from storage, then the records (the database deletes them with the consent). */
export async function withdrawHealthConsent(employeeId: string, info: HealthInfo): Promise<void> {
  const paths = info.records.flatMap((r) => (r.files ?? []).map((f) => f.file_path));
  if (paths.length) await supabase.storage.from('documents').remove(paths);
  const { error } = await supabase.from('employee_health_consents').delete().eq('employee_id', employeeId);
  if (error) fail(error, 'Your consent was not withdrawn.');
}

export const healthRecordProblem = (r: HealthRecord): string | null =>
  r.title.trim() ? null : r.kind === 'condition' ? 'Name the condition' : 'Describe the need';

/** Saves a record and returns its id. */
export async function saveHealthRecord(employeeId: string, r: HealthRecord): Promise<string> {
  const problem = healthRecordProblem(r);
  if (problem) throw new Error(problem);
  const row = {
    employee_id: employeeId, kind: r.kind, title: r.title.trim(), details: r.details.trim() || null,
    institution: r.institution.trim() || null, diagnosed_on: r.diagnosed_on || null,
  };
  const { data, error } = r.id
    ? await supabase.from('employee_health_records').update(row).eq('id', r.id).select('id').single()
    : await supabase.from('employee_health_records').insert(row).select('id').single();
  if (error) fail(error, 'The health information was not saved.');
  return String((data as { id: string }).id);
}

export async function deleteHealthRecord(r: HealthRecord): Promise<void> {
  const paths = (r.files ?? []).map((f) => f.file_path);
  if (paths.length) await supabase.storage.from('documents').remove(paths);
  const { error } = await supabase.from('employee_health_records').delete().eq('id', r.id);
  if (error) fail(error, 'The health information was not removed.');
}

/** Uploads a supporting document into the employee's own health folder. Undoes the upload if recording fails. */
export async function uploadHealthFile(recordId: string, file: File): Promise<void> {
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  const { userId, tenantId } = await currentUserAndTenant();
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${tenantId}/${userId}/health/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const stored = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (stored.error) fail(stored.error, 'The document was not uploaded.');
  const { error } = await supabase.from('employee_health_files').insert({
    record_id: recordId, file_path: path, file_name: file.name, content_type: file.type || null, size_bytes: file.size,
  });
  if (error) {
    await supabase.storage.from('documents').remove([path]);
    fail(error, 'The document was not saved.');
  }
}

export async function deleteHealthFile(f: HealthFile): Promise<void> {
  await supabase.storage.from('documents').remove([f.file_path]);
  const { error } = await supabase.from('employee_health_files').delete().eq('id', f.id);
  if (error) fail(error, 'The document was not removed.');
}

/** Opens a health document; HR opening one is logged. */
export async function openHealthFile(f: HealthFile): Promise<void> {
  // the tab opens straight away (browsers block tabs opened after waiting); the view is logged alongside
  await Promise.all([
    openPrivateFile('documents', f.file_path),
    supabase.rpc('log_health_file_view', { p_file: f.id }).then(({ error }) => {
      if (error) fail(error, 'Could not record that you opened this document.');
    }),
  ]);
}
