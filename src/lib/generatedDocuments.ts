import { supabase } from './supabase';
import { currentUserAndTenant, openPrivateFile } from './privateFiles';

// The archive of documents the app makes (migration 20261026000000): each PDF is kept in the private
// "generated-documents" bucket under <company>/<kind>/, with a generated_documents row saying what it is, about whom,
// who made it, when, who it was emailed to and its SHA-256. Rows and files never change; each row is in the audit trail.

export interface GeneratedDocument {
  id: string;
  kind: string;
  title: string;
  employee_number: string | null;
  reference_id: string | null;
  file_path: string;
  file_size: number | null;
  sha256: string | null;
  emailed_to: string[];
  created_by: string | null;
  created_at: string;
}

export const DOCUMENT_KIND_LABELS: Record<string, string> = {
  exit_letter: 'Exit letter',
  offer_letter: 'Offer letter',
  offer_acceptance: 'Accepted offer',
};

const COLUMNS = 'id, kind, title, employee_number, reference_id, file_path, file_size, sha256, emailed_to, created_by, created_at';

const fail = (error: { message?: string } | null, fallback: string): never => {
  throw new Error(error?.message || fallback);
};

/** The file's SHA-256 in hex, so anyone can later check a copy is the one that was sent. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface NewDocument {
  kind: string;
  title: string;
  employeeNumber?: string | null;
  referenceId?: string | null;
  pdf: Blob;
  emailedTo?: string[];
}

/** Keeps the PDF and records it. */
export async function archiveDocument(doc: NewDocument): Promise<GeneratedDocument> {
  const { tenantId } = await currentUserAndTenant();
  const path = `${tenantId}/${doc.kind}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from('generated-documents')
    .upload(path, doc.pdf, { contentType: 'application/pdf', upsert: false });
  if (uploadError) fail(uploadError, 'The document was not saved.');
  const { data, error } = await supabase
    .from('generated_documents')
    .insert({
      kind: doc.kind,
      title: doc.title.trim().slice(0, 300) || 'Document',
      employee_number: doc.employeeNumber ?? null,
      reference_id: doc.referenceId ?? null,
      file_path: path,
      file_size: doc.pdf.size,
      sha256: await sha256Hex(doc.pdf),
      emailed_to: doc.emailedTo ?? [],
    })
    .select(COLUMNS)
    .single();
  if (error) fail(error, 'The document was not recorded.');
  return data as GeneratedDocument;
}

/** The documents made for one exit, offer, ... newest first. */
export async function loadDocumentsFor(referenceId: string): Promise<GeneratedDocument[]> {
  const { data, error } = await supabase.from('generated_documents').select(COLUMNS).eq('reference_id', referenceId).order('created_at', { ascending: false });
  if (error) fail(error, 'Could not load the documents.');
  return (data ?? []) as GeneratedDocument[];
}

export const openGeneratedDocument = (doc: Pick<GeneratedDocument, 'file_path'>) => openPrivateFile('generated-documents', doc.file_path);
