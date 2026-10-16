import { supabase } from './supabase';
import { currentUserAndTenant, openPrivateFile, randomFileName } from './privateFiles';
import { fileProblem } from './employeeDocuments';

// Documents with leave (FIG-876): a leave type can ask for one with the application (a doctor's report) and/or one
// after the leave starts (a birth notification). Files go in the private leave-documents bucket under
// <company>/<login>/...; the database checks "with the application" and keeps each file's path on the application
// (supabase/migrations/20261017300000_leave_documents.sql).

export const LEAVE_DOCUMENTS_BUCKET = 'leave-documents';

/** What one leave type asks for. */
export interface LeaveDocumentRule {
  leave_type: string;
  name: string | null;
  when: 'with_application' | 'after';
  within_days: number;
  if_longer_than: number;
  followup_name: string | null;
  followup_within_days: number;
}

/** What the leave check says is needed for the request on the form. */
export interface LeaveDocumentNeeded {
  name: string | null;
  when: 'with_application' | 'after';
  within_days: number;
  followup_name: string | null;
  followup_within_days: number;
}

export interface LeaveWithDocuments {
  id: string;
  'Leave Type': string;
  'Start Date': string;
  days?: number | string | null;
  status?: string | null;
  document_path?: string | null;
  document_name?: string | null;
  followup_document_path?: string | null;
  followup_document_name?: string | null;
}

export type DocumentKind = 'main' | 'followup';

/** One document a leave application needs or has. */
export interface LeaveDocumentState {
  kind: DocumentKind;
  /** what the leave type calls it, or "Document" for a file added where none was asked for */
  label: string;
  path: string | null;
  fileName: string | null;
  /** the last day to add it, when it is due after the leave starts */
  due: string | null;
  /** still missing after its last day (or missing when it was needed with the application) */
  overdue: boolean;
}

const addDays = (isoDay: string, days: number) => {
  const d = new Date(`${isoDay.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The documents an application needs (by its leave type's rule) or already has, with what is overdue on `today`. */
export function leaveDocuments(app: LeaveWithDocuments, rule: LeaveDocumentRule | undefined, today: string): LeaveDocumentState[] {
  const out: LeaveDocumentState[] = [];
  const start = /^\d{4}-\d{2}-\d{2}/.test(app['Start Date'] || '') ? app['Start Date'].slice(0, 10) : null;
  const rejected = /^(rejected|cancelled)$/i.test(app.status || '');
  const days = Number(app.days) || 0;
  const mainNeeded = !!rule?.name && days > (Number(rule.if_longer_than) || 0);
  if (mainNeeded || app.document_path) {
    const due = mainNeeded && rule?.when === 'after' && start ? addDays(start, rule.within_days) : null;
    out.push({
      kind: 'main',
      label: (mainNeeded && rule?.name) || 'Document',
      path: app.document_path ?? null,
      fileName: app.document_name ?? null,
      due,
      overdue: mainNeeded && !app.document_path && !rejected && (rule?.when === 'with_application' || (!!due && today > due)),
    });
  }
  if (rule?.followup_name || app.followup_document_path) {
    const due = rule?.followup_name && start ? addDays(start, rule.followup_within_days) : null;
    out.push({
      kind: 'followup',
      label: rule?.followup_name || 'Follow-up document',
      path: app.followup_document_path ?? null,
      fileName: app.followup_document_name ?? null,
      due,
      overdue: !!rule?.followup_name && !app.followup_document_path && !rejected && !!due && today > due,
    });
  }
  return out;
}

export async function loadLeaveDocumentRules(): Promise<LeaveDocumentRule[]> {
  const { data, error } = await supabase.rpc('leave_document_rules');
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as LeaveDocumentRule[];
}

/** Uploads a file to the signed-in login's folder; returns where it is, to save on the application. */
export async function uploadLeaveDocument(file: File): Promise<{ path: string; name: string }> {
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  const { userId, tenantId } = await currentUserAndTenant();
  const path = `${tenantId}/${userId}/${randomFileName(file.name)}`;
  const { error } = await supabase.storage.from(LEAVE_DOCUMENTS_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error('The document was not uploaded. Please try again.');
  return { path, name: file.name };
}

/** Adds (or replaces) a document on an application that already exists: the employee's own leave, or HR. */
export async function attachLeaveDocument(leaveId: string, kind: DocumentKind, file: File): Promise<void> {
  const { path, name } = await uploadLeaveDocument(file);
  const { error } = await supabase.rpc('attach_leave_document', { p_leave: leaveId, p_kind: kind, p_path: path, p_name: name });
  if (error) {
    await supabase.storage.from(LEAVE_DOCUMENTS_BUCKET).remove([path]);
    throw new Error(error.message);
  }
}

export const openLeaveDocument = (path: string) => openPrivateFile(LEAVE_DOCUMENTS_BUCKET, path);
