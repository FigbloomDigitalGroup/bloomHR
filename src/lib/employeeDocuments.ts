import { supabase } from './supabase';
import { currentUserAndTenant, openPrivateFile } from './privateFiles';

// Onboarding documents and referees (20261012400000). The employee uploads their own files into their folder of the
// private "documents" bucket and lists their referees; HR sees them, accepts or rejects each file (a rejection says
// why), and decides which documents the company and each employee must provide.

export type DocumentSection = 'core' | 'qualifications' | 'role' | 'claims' | 'other';

export const SECTION_TITLES: Record<DocumentSection, string> = {
  core: 'Core attachments',
  qualifications: 'Qualifications',
  role: 'Role-specific documents',
  claims: 'Tax exemption and relief documents',
  other: 'Other documents',
};

/** The generic type for a document the employee names themselves (20261021900000): it needs a title. */
export const OTHER_DOCUMENT = 'other';

/**
 * How many files a document takes (20261022000000), the company's setting else the type's default:
 * one file (extra pages allowed for a split scan), named slots each filled once (an ID's Front and Back), or many
 * labelled files.
 */
export type FileMode = 'single' | 'slots' | 'many';

export interface ChecklistItem {
  code: string;
  label: string;
  section: DocumentSection;
  description: string | null;
  allows_many: boolean;
  required: boolean;
  sort: number;
  /** the effective files setting (missing: from allows_many) */
  file_mode?: FileMode;
  /** the slot names for this employee's identity type */
  slots?: string[] | null;
  /** the slot definition: a list, or a list per identity type ("*": any other) */
  slots_def?: unknown;
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
  /** the employee's own title (always set for "other") and description */
  title?: string | null;
  description?: string | null;
  /** the slot ("Front") or extra page ("Page 2") it is, and the employee's label ("BSc Commerce") */
  part?: string | null;
  label?: string | null;
  /** HR accepted this one file as the whole document */
  complete?: boolean;
  /** its type's label (also for a type not on this employee's list) */
  type_label?: string | null;
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
/**
 * The document types for this employee's country, with whether they must provide it (no id: the signed-in employee's
 * own). Never includes "other".
 */
export async function loadChecklist(employeeId?: string): Promise<ChecklistItem[]> {
  const args = employeeId ? { p_employee: employeeId } : {};
  const [list, files] = await Promise.all([supabase.rpc('document_checklist', args), supabase.rpc('document_files', args)]);
  if (list.error) fail(list.error, 'Could not load the list of documents.');
  // without the files settings every document is one file or many, as before
  type Files = { code: string; file_mode: FileMode; slots: string[] | null; slots_def: unknown };
  const settings = new Map<string, Files>(((files.error ? [] : files.data) ?? []).map((f: Files) => [f.code, f] as const));
  return ((list.data ?? []) as ChecklistItem[]).map((item) => {
    const f = settings.get(item.code);
    return f ? { ...item, file_mode: f.file_mode, slots: f.slots, slots_def: f.slots_def } : item;
  });
}

/** Slot names from a definition: a list, or a list per identity type ("*": any other). Mirrors document_slots_resolve. */
export const resolveSlots = (def: unknown, identityType?: string | null): string[] | null => {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null);
  if (Array.isArray(def)) return list(def);
  if (def && typeof def === 'object') {
    const byType = def as Record<string, unknown>;
    return list((identityType && byType[identityType]) || byType['*']) ?? [];
  }
  return null;
};

/** The files setting of a checklist item; given the identity type the employee has just chosen, its slots follow it. */
export const filesSetting = (
  item: Pick<ChecklistItem, 'allows_many' | 'file_mode' | 'slots' | 'slots_def'>, identityType?: string | null
): { mode: FileMode; slots: string[] } => {
  const mode: FileMode = item.file_mode ?? (item.allows_many ? 'many' : 'single');
  if (mode !== 'slots') return { mode, slots: [] };
  const slots = (identityType && item.slots_def ? resolveSlots(item.slots_def, identityType) : null) ?? item.slots ?? [];
  return slots.length ? { mode, slots } : { mode: 'single', slots: [] };
};

const EXTRA_PAGE = /^Page ([2-9]|[1-9][0-9]+)$/;
/** The page of a file of a one-file document: 1, or n for an extra page "Page n". */
export const pageOf = (doc: Pick<EmployeeDocument, 'part'>): number => (doc.part && EXTRA_PAGE.test(doc.part) ? Number(doc.part.slice(5)) : 1);

/** The slot a file fills: its part, else (an older file with none) the first slot. */
export const slotOf = (doc: Pick<EmployeeDocument, 'part'>, slots: string[]): string => (doc.part && slots.includes(doc.part) ? doc.part : slots[0]);

/** A document's files by slot, and the slots still needed (no file that was not rejected). Mirrors document_slot_states. */
export const slotsView = (files: EmployeeDocument[], slots: string[]) => {
  const whole = files.some((f) => f.complete && f.status === 'accepted');
  const bySlot = slots.map((slot) => {
    const mine = files.filter((f) => slotOf(f, slots) === slot);
    return { slot, files: mine, live: mine.find((f) => f.status !== 'rejected') ?? null };
  });
  const missing = whole ? [] : bySlot.filter((s) => !s.live).map((s) => s.slot);
  return { bySlot, missing, whole };
};

/** What a file is within its document: its slot or page ("Front", "Page 2") and its label. */
export const fileCaption = (doc: Pick<EmployeeDocument, 'part' | 'label'>, mode: FileMode, slots: string[], pages = 1): string =>
  [mode === 'slots' ? slotOf(doc, slots) : mode === 'single' && pages > 1 ? `Page ${pageOf(doc)}` : null, doc.label?.trim() || null]
    .filter(Boolean).join(' · ');

/** The label prompt for a many-files document; dependants' and beneficiaries' documents must say whose they are. */
export const labelPrompt = (code: string): { label: string; placeholder: string; required: boolean } =>
  code === 'dependants_documents' || code === 'beneficiary_documents'
    ? { label: 'Whose document? (name and relationship)', placeholder: 'e.g. Zawadi Wanjiru, daughter', required: true }
    : { label: 'Label (optional)', placeholder: code === 'academic_certificate' ? 'e.g. KCSE certificate, BSc Commerce' : 'What is this file?', required: false };

export async function loadDocuments(employeeId: string): Promise<EmployeeDocument[]> {
  const { data, error } = await supabase.from('employee_documents').select('*, type:document_types(label)').eq('employee_id', employeeId)
    .order('uploaded_at', { ascending: false });
  if (error) fail(error, 'Could not load the documents.');
  return (data ?? []).map(({ type, ...doc }: Record<string, unknown>) => ({
    ...doc, type_label: (type as { label?: string } | null)?.label ?? null,
  })) as EmployeeDocument[];
}

/** What a file is called on screen: its own title, else its type's label. */
export const documentName = (doc: Pick<EmployeeDocument, 'code' | 'title' | 'type_label'>, checklist: Pick<ChecklistItem, 'code' | 'label'>[]): string =>
  doc.title?.trim() || checklist.find((c) => c.code === doc.code)?.label || doc.type_label
  || (doc.code === OTHER_DOCUMENT ? 'Other document' : doc.code.replace(/_/g, ' '));

/** Whether a file belongs under "Other documents": its type is not one this employee is asked for. */
export const isExtraDocument = (doc: Pick<EmployeeDocument, 'code'>, checklist: Pick<ChecklistItem, 'code' | 'required'>[]): boolean =>
  !checklist.some((c) => c.code === doc.code && c.required);

/** The types an employee may add as an extra document: those on their list they are not asked for (not tax claims). */
export const extraDocumentTypes = (checklist: ChecklistItem[]): ChecklistItem[] =>
  checklist.filter((c) => !c.required && c.section !== 'claims' && c.code !== OTHER_DOCUMENT);

export const openDocument = (doc: Pick<EmployeeDocument, 'file_path'>) => openPrivateFile('documents', doc.file_path);

// ---------------------------------------------------------------------------------------------
// the employee
// ---------------------------------------------------------------------------------------------
/**
 * Uploads a file to the employee's own folder and records it (waiting for HR). Undoes the upload if recording fails.
 * An "other" document needs a title; any document may have one and a description.
 */
export async function uploadMyDocument(
  employeeId: string, code: string, file: File, extra?: { title?: string; description?: string; part?: string; label?: string }
): Promise<void> {
  const title = extra?.title?.trim() || null;
  const description = extra?.description?.trim() || null;
  const part = extra?.part?.trim() || null;
  const label = extra?.label?.trim() || null;
  if (code === OTHER_DOCUMENT && !title) throw new Error('Give the document a title');
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  const { userId, tenantId } = await currentUserAndTenant();
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${tenantId}/${userId}/onboarding/${code}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const stored = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (stored.error) fail(stored.error, 'The file was not uploaded.');
  const { error } = await supabase.from('employee_documents').insert({
    employee_id: employeeId, code, file_path: path, file_name: file.name, content_type: file.type || null, size_bytes: file.size,
    ...(title ? { title } : {}), ...(description ? { description } : {}), ...(part ? { part } : {}), ...(label ? { label } : {}),
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

/** HR accepts one file as the whole document (an older single ID file, or one scan with both sides). */
export async function acceptDocumentAsComplete(id: string): Promise<void> {
  const { error } = await supabase.rpc('accept_document_as_complete', { p_document: id });
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
  /** the countries it applies to (null: every country) */
  countries: string[] | null;
  /** the company's own choice, or null to use the default */
  required: boolean | null;
  description?: string | null;
  /** the default files setting, and the company's own (null: the default) */
  default_file_mode?: FileMode;
  default_slots?: unknown;
  file_mode?: FileMode | null;
  slots?: string[] | null;
  /** one of the company's own types */
  custom?: boolean;
}

/** Every document type that a company can require (not the claim documents, which follow the employee's claims). */
export async function loadCompanyDocumentSettings(): Promise<DocumentTypeSetting[]> {
  const [types, settings] = await Promise.all([
    supabase.from('document_types').select('code, label, section, description, required_by_default, countries, sort, file_mode, slots, tenant_id, active')
      .is('required_when', null).neq('section', 'other').eq('active', true).order('sort'),
    supabase.from('company_document_settings').select('code, required, file_mode, slots'),
  ]);
  if (types.error) fail(types.error, 'Could not load the document types.');
  if (settings.error) fail(settings.error, 'Could not load the company’s settings.');
  type Chosen = { code: string; required: boolean | null; file_mode?: FileMode | null; slots?: unknown };
  type Type = {
    code: string; label: string; section: DocumentSection; description?: string | null; required_by_default: boolean;
    countries?: string[] | null; file_mode?: FileMode; slots?: unknown; tenant_id?: string | null;
  };
  const chosen = new Map((settings.data ?? []).map((s: Chosen) => [s.code, s]));
  return (types.data ?? []).map((t: Type) => {
    const c = chosen.get(t.code);
    return {
      code: t.code, label: t.label, section: t.section, description: t.description ?? null, required_by_default: t.required_by_default,
      countries: t.countries ?? null, required: c?.required ?? null,
      default_file_mode: t.file_mode ?? 'single', default_slots: t.slots ?? null,
      file_mode: c?.file_mode ?? null, slots: Array.isArray(c?.slots) ? (c.slots as string[]) : null, custom: !!t.tenant_id,
    };
  });
}

/** The company's files setting for a type (null: back to the default). Slots need at least one name. */
export async function setDocumentFilesSetting(code: string, mode: FileMode | null, slots?: string[]): Promise<void> {
  const { error } = await supabase.rpc('set_document_files_setting', { p_code: code, p_file_mode: mode, p_slots: mode === 'slots' ? slots ?? [] : null });
  if (error) fail(error, 'The setting was not saved.');
}

export interface CompanyDocumentType {
  code?: string;
  label: string;
  description: string;
  section: 'core' | 'qualifications' | 'role';
  /** empty: every country */
  countries: string[];
  required: boolean;
  file_mode: FileMode;
  slots: string[];
}

/** Creates (no code) or changes one of the company's own document types; returns its code. */
export async function saveCompanyDocumentType(t: CompanyDocumentType): Promise<string> {
  if (!t.label.trim()) throw new Error('Give the document a name');
  const { data, error } = await supabase.rpc('save_company_document_type', {
    p_code: t.code ?? null, p_label: t.label.trim(), p_description: t.description.trim() || null, p_section: t.section,
    p_countries: t.countries.length ? t.countries : null, p_required: t.required, p_file_mode: t.file_mode,
    p_slots: t.file_mode === 'slots' ? t.slots : null,
  });
  if (error) fail(error, 'The document type was not saved.');
  return String(data);
}

/** Removes one of the company's own types: deleted, or deactivated when employees have uploaded files of it. */
export async function removeCompanyDocumentType(code: string): Promise<'deleted' | 'deactivated'> {
  const { data, error } = await supabase.rpc('remove_company_document_type', { p_code: code });
  if (error) fail(error, 'The document type was not removed.');
  return data === 'deactivated' ? 'deactivated' : 'deleted';
}

export async function setCompanyDocumentRequired(code: string, required: boolean): Promise<void> {
  const { error } = await supabase.from('company_document_settings').upsert({ code, required, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,code' });
  if (error) fail(error, 'The setting was not saved.');
}
