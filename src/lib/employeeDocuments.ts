import { supabase } from './supabase';
import { currentUserAndTenant, openPrivateFile } from './privateFiles';

// Onboarding documents and referees (20261012400000). The employee uploads their own files into their folder of the
// private "documents" bucket and lists their referees; HR sees them, accepts or rejects each file (a rejection says
// why), and decides which documents the company and each employee must provide.

export type DocumentSection = 'core' | 'qualifications' | 'role' | 'claims';

export const SECTION_TITLES: Record<DocumentSection, string> = {
  core: 'Core attachments',
  qualifications: 'Qualifications',
  role: 'Role-specific documents',
  claims: 'Tax exemption and relief documents',
};

export interface ChecklistItem {
  code: string;
  label: string;
  section: DocumentSection;
  description: string | null;
  allows_many: boolean;
  required: boolean;
  sort: number;
}

export type DocumentStatus = 'pending' | 'accepted' | 'rejected';

export interface EmployeeDocument {
  id: string;
  employee_id: string;
  code: string;
  file_path: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  status: DocumentStatus;
  review_note: string | null;
  reviewed_at: string | null;
  uploaded_at: string;
}

export interface Referee {
  id?: string;
  full_name: string;
  organisation: string;
  position: string;
  phone: string;
  email: string;
  relationship: string;
}

export const emptyReferee = (): Referee => ({ full_name: '', organisation: '', position: '', phone: '', email: '', relationship: '' });

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = { pending: 'Waiting for HR', accepted: 'Accepted', rejected: 'Rejected' };

/** What a file may be: PDF, Word or an image, up to 10 MB. */
export const ACCEPTED_FILES = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.heic';
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = /\.(pdf|docx?|jpe?g|png|webp|heic)$/i;

/** Why a file can't be uploaded, or null when it can. */
export const fileProblem = (file: File): string | null => {
  if (!ALLOWED.test(file.name)) return 'Upload a PDF, Word document or photo (JPG, PNG)';
  if (file.size > MAX_BYTES) return 'The file is larger than 10 MB';
  if (file.size === 0) return 'The file is empty';
  return null;
};

const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

// ---------------------------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------------------------
/** Every document type, with whether this employee must provide it (no id: the signed-in employee's own). */
export async function loadChecklist(employeeId?: string): Promise<ChecklistItem[]> {
  const { data, error } = await supabase.rpc('document_checklist', employeeId ? { p_employee: employeeId } : {});
  if (error) fail(error, 'Could not load the list of documents.');
  return (data ?? []) as ChecklistItem[];
}

export async function loadDocuments(employeeId: string): Promise<EmployeeDocument[]> {
  const { data, error } = await supabase.from('employee_documents').select('*').eq('employee_id', employeeId).order('uploaded_at', { ascending: false });
  if (error) fail(error, 'Could not load the documents.');
  return (data ?? []) as EmployeeDocument[];
}

export const openDocument = (doc: Pick<EmployeeDocument, 'file_path'>) => openPrivateFile('documents', doc.file_path);

// ---------------------------------------------------------------------------------------------
// the employee
// ---------------------------------------------------------------------------------------------
/** Uploads a file to the employee's own folder and records it (waiting for HR). Undoes the upload if recording fails. */
export async function uploadMyDocument(employeeId: string, code: string, file: File): Promise<void> {
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  const { userId, tenantId } = await currentUserAndTenant();
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${tenantId}/${userId}/onboarding/${code}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const stored = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (stored.error) fail(stored.error, 'The file was not uploaded.');
  const { error } = await supabase.from('employee_documents').insert({
    employee_id: employeeId, code, file_path: path, file_name: file.name, content_type: file.type || null, size_bytes: file.size,
  });
  if (error) {
    await supabase.storage.from('documents').remove([path]);
    fail(error, 'The file was not saved.');
  }
}

/** Removes a file the employee uploaded (not one HR accepted). */
export async function deleteMyDocument(doc: EmployeeDocument): Promise<void> {
  const { data, error } = await supabase.from('employee_documents').delete().eq('id', doc.id).select('id');
  if (error) fail(error, 'The file was not removed.');
  if (!data?.length) throw new Error('This file can’t be removed (HR has accepted it).');
  await supabase.storage.from('documents').remove([doc.file_path]);
}

export async function loadReferees(employeeId: string): Promise<Referee[]> {
  const { data, error } = await supabase.from('employee_referees').select('*').eq('employee_id', employeeId).order('created_at');
  if (error) fail(error, 'Could not load the referees.');
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id), full_name: String(r.full_name ?? ''), organisation: String(r.organisation ?? ''), position: String(r.position ?? ''),
    phone: String(r.phone ?? ''), email: String(r.email ?? ''), relationship: String(r.relationship ?? ''),
  }));
}

/** Why a referee can't be saved, or null. */
export const refereeProblem = (r: Referee): string | null => {
  if (!r.full_name.trim()) return 'Add the referee’s full name';
  if (!r.phone.trim() && !r.email.trim()) return 'Add a phone number or email for the referee';
  return null;
};

export async function saveReferee(employeeId: string, r: Referee): Promise<void> {
  const problem = refereeProblem(r);
  if (problem) throw new Error(problem);
  const row = {
    employee_id: employeeId, full_name: r.full_name.trim(), organisation: r.organisation.trim() || null, position: r.position.trim() || null,
    phone: r.phone.trim() || null, email: r.email.trim() || null, relationship: r.relationship.trim() || null,
  };
  const { error } = r.id
    ? await supabase.from('employee_referees').update(row).eq('id', r.id)
    : await supabase.from('employee_referees').insert(row);
  if (error) fail(error, 'The referee was not saved.');
}

export async function deleteReferee(id: string): Promise<void> {
  const { error } = await supabase.from('employee_referees').delete().eq('id', id);
  if (error) fail(error, 'The referee was not removed.');
}

// ---------------------------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------------------------
export async function acceptDocument(id: string): Promise<void> {
  const { error } = await supabase.rpc('review_employee_document', { p_document: id, p_decision: 'accept', p_note: null });
  if (error) fail(error, 'Could not accept the document.');
}

export async function rejectDocument(id: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error('Say why the document is rejected.');
  const { error } = await supabase.rpc('review_employee_document', { p_document: id, p_decision: 'reject', p_note: reason.trim() });
  if (error) fail(error, 'Could not reject the document.');
}

/** Role-specific documents HR asked this employee for. */
export async function loadEmployeeRequirements(employeeId: string): Promise<string[]> {
  const { data, error } = await supabase.from('employee_document_requirements').select('code').eq('employee_id', employeeId);
  if (error) fail(error, 'Could not load the requested documents.');
  return (data ?? []).map((r: { code: string }) => r.code);
}

export async function setEmployeeRequirement(employeeId: string, code: string, required: boolean): Promise<void> {
  const { error } = required
    ? await supabase.from('employee_document_requirements').upsert({ employee_id: employeeId, code }, { onConflict: 'employee_id,code' })
    : await supabase.from('employee_document_requirements').delete().eq('employee_id', employeeId).eq('code', code);
  if (error) fail(error, 'The change was not saved.');
}

export interface DocumentTypeSetting {
  code: string;
  label: string;
  section: DocumentSection;
  required_by_default: boolean;
  /** the company's own choice, or null to use the default */
  required: boolean | null;
}

/** Every document type that a company can require (not the claim documents, which follow the employee's claims). */
export async function loadCompanyDocumentSettings(): Promise<DocumentTypeSetting[]> {
  const [types, settings] = await Promise.all([
    supabase.from('document_types').select('code, label, section, required_by_default, sort').is('required_when', null).order('sort'),
    supabase.from('company_document_settings').select('code, required'),
  ]);
  if (types.error) fail(types.error, 'Could not load the document types.');
  if (settings.error) fail(settings.error, 'Could not load the company’s settings.');
  const chosen = new Map((settings.data ?? []).map((s: { code: string; required: boolean }) => [s.code, s.required]));
  return (types.data ?? []).map((t: { code: string; label: string; section: DocumentSection; required_by_default: boolean }) => ({
    code: t.code, label: t.label, section: t.section, required_by_default: t.required_by_default, required: chosen.get(t.code) ?? null,
  }));
}

export async function setCompanyDocumentRequired(code: string, required: boolean): Promise<void> {
  const { error } = await supabase.from('company_document_settings').upsert({ code, required, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,code' });
  if (error) fail(error, 'The setting was not saved.');
}
