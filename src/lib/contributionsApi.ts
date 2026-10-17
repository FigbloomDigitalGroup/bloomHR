import { supabase } from './supabase';
import { currentUserAndTenant, openPrivateFile, randomFileName } from './privateFiles';
import type { Contribution, ContributionForm } from './contributions';

// Staff contributions in the database (migration 20261019000000_contributions_nita.sql): the employee asks, payroll
// approves or declines, either stops. Every change goes through a database function that checks who may do it.

const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

const toContribution = (r: Record<string, unknown>): Contribution =>
  ({ ...r, amount: Number(r.amount) || 0, applied_amount: Number(r.applied_amount) || 0 }) as Contribution;

/** Payroll: every contribution in the company; anyone else: their own. Waiting ones first, then newest. */
export async function loadContributions(): Promise<Contribution[]> {
  const { data, error } = await supabase.rpc('employee_contributions_list');
  if (error) fail(error, 'Could not load contributions.');
  return ((data ?? []) as Record<string, unknown>[]).map(toContribution);
}

/** Uploads a supporting document to the employee's own folder in the private documents bucket; its path. */
export async function uploadContributionDocument(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('The document is over 10 MB.');
  const { userId, tenantId } = await currentUserAndTenant();
  const path = `${tenantId}/${userId}/contribution_${randomFileName(file.name)}`;
  const { error } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) fail(error, 'The document was not uploaded.');
  return path;
}

/** The employee asks for a contribution (with an optional document). */
export async function requestContribution(form: ContributionForm, file?: File | null): Promise<void> {
  const document = file ? await uploadContributionDocument(file) : null;
  const { error } = await supabase.rpc('request_contribution', {
    p_kind: form.kind,
    p_amount: Number(form.amount.replace(/[,\s]/g, '')),
    p_start: form.start_period,
    p_end: form.end_period || null,
    p_provider: form.provider.trim() || null,
    p_reference: form.reference.trim() || null,
    p_note: form.note.trim() || null,
    p_document: document,
  });
  if (error) {
    if (document) await supabase.storage.from('documents').remove([document]);
    fail(error, 'The request was not sent.');
  }
}

export async function decideContribution(id: string, approve: boolean, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('decide_contribution', { p_id: id, p_approve: approve, p_reason: reason?.trim() || null });
  if (error) fail(error, approve ? 'It was not approved.' : 'It was not declined.');
}

export async function stopContribution(id: string): Promise<void> {
  const { error } = await supabase.rpc('stop_contribution', { p_id: id });
  if (error) fail(error, 'It was not stopped.');
}

/** Payroll: brings employee amounts in line with the next payroll month (best effort; also runs daily). */
export async function syncContributions(): Promise<void> {
  await supabase.rpc('sync_my_company_contributions');
}

export const openContributionDocument = (path: string) => openPrivateFile('documents', path);
