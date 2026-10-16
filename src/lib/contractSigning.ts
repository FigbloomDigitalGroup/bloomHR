import { supabase } from './supabase';
import { currentUserAndTenant, openPrivateFile, randomFileName } from './privateFiles';
import { parseDay } from './contract';
import type { StatusTone } from '../components/UI';

/**
 * Contract signing: HR sends an employee a contract, the employee returns it signed, HR accepts it or sends it back
 * (table employee_contracts and the private employee-contracts bucket, see 20261017400000_contract_signing.sql). The
 * database enforces who may do what; these are the screens' reads and writes, and the small rules they show.
 */

export type ContractSigningStatus = 'sent' | 'viewed' | 'signed' | 'accepted' | 'sent_back' | 'cancelled';

export interface SigningContract {
  id: string;
  tenant_id: string;
  employee_number: string;
  title: string;
  message: string | null;
  sign_by: string | null;
  file_path: string;
  file_name: string | null;
  signed_path: string | null;
  signed_file_name: string | null;
  status: ContractSigningStatus;
  send_back_reason: string | null;
  cancel_reason: string | null;
  sent_at: string;
  viewed_at: string | null;
  signed_at: string | null;
  reviewed_at: string | null;
  cancelled_at: string | null;
  /** filled in from the directory (HR's list) */
  employee_name?: string;
}

export const BUCKET = 'employee-contracts' as const;

/** What HR sees for each status. */
export const STATUS_LABEL: Record<ContractSigningStatus, string> = {
  sent: 'Sent',
  viewed: 'Viewed',
  signed: 'Signed, to review',
  accepted: 'Accepted',
  sent_back: 'Sent back',
  cancelled: 'Cancelled',
};

export const STATUS_TONE: Record<ContractSigningStatus, StatusTone> = {
  sent: 'neutral',
  viewed: 'info',
  signed: 'warning',
  accepted: 'success',
  sent_back: 'danger',
  cancelled: 'neutral',
};

/** What the employee sees for each status (cancelled contracts are not shown to them). */
export const MY_STATUS_LABEL: Record<ContractSigningStatus, string> = {
  sent: 'To sign',
  viewed: 'To sign',
  signed: 'Waiting for HR',
  accepted: 'Accepted',
  sent_back: 'Needs fixing',
  cancelled: 'Cancelled',
};

/** Still with the employee: they have it, but HR has no signed copy to look at. */
export const WAITING_ON_EMPLOYEE: ContractSigningStatus[] = ['sent', 'viewed', 'sent_back'];

/** The employee may upload (or replace) their signed copy until HR accepts it. */
export const canUploadSigned = (status: ContractSigningStatus) => WAITING_ON_EMPLOYEE.includes(status) || status === 'signed';

/** HR may cancel anything not yet accepted. */
export const canCancel = (status: ContractSigningStatus) => status !== 'accepted' && status !== 'cancelled';

// ---------------------------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------------------------
/** The contract HR sends is a PDF or Word file; the signed copy is a PDF (the database refuses anything else). Up to 20 MB. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
/** For the file pickers' accept attribute. */
export const CONTRACT_FILE_ACCEPT = '.pdf,.doc,.docx';
export const SIGNED_FILE_ACCEPT = '.pdf';

/** The content type to store a file with, from its name (browsers sometimes give none for Word files); null if not taken. */
export function contentTypeFor(fileName: string): string | null {
  const extension = (fileName.split('.').pop() || '').toLowerCase();
  return fileName.includes('.') ? CONTENT_TYPES[extension] ?? null : null;
}

/** Why a file can't be used, or null when it can. The contract HR sends is a PDF or Word file; a signed copy is a PDF. */
export function contractFileProblem(file: Pick<File, 'name' | 'size'>, kind: 'contract' | 'signed'): string | null {
  const type = contentTypeFor(file.name);
  if (kind === 'signed' && type !== 'application/pdf') {
    return 'The signed copy must be a PDF. If you signed on paper, scan it to PDF (most phone scanner apps can) and upload that.';
  }
  if (!type) return 'Choose a PDF or Word file';
  if (file.size <= 0) return 'That file is empty';
  if (file.size > MAX_FILE_BYTES) return 'That file is larger than 20 MB';
  return null;
}

// ---------------------------------------------------------------------------------------------
// sign-by dates
// ---------------------------------------------------------------------------------------------
export type DueState = 'overdue' | 'due-soon' | 'due' | null;

/** Where a contract stands against its sign-by date: only while it is still with the employee. */
export function dueState(contract: Pick<SigningContract, 'sign_by' | 'status'>, today: Date = new Date()): DueState {
  const due = parseDay(contract.sign_by);
  if (!due || !WAITING_ON_EMPLOYEE.includes(contract.status)) return null;
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((due.getTime() - day.getTime()) / 86_400_000);
  if (days < 0) return 'overdue';
  return days <= 3 ? 'due-soon' : 'due';
}

/** HR's list filters. */
export type ContractFilter = 'review' | 'waiting' | 'accepted' | 'all';
export function matchesFilter(contract: Pick<SigningContract, 'status'>, filter: ContractFilter): boolean {
  if (filter === 'review') return contract.status === 'signed';
  if (filter === 'waiting') return WAITING_ON_EMPLOYEE.includes(contract.status);
  if (filter === 'accepted') return contract.status === 'accepted';
  return true;
}

// ---------------------------------------------------------------------------------------------
// reads and writes
// ---------------------------------------------------------------------------------------------
const COLUMNS =
  'id, tenant_id, employee_number, title, message, sign_by, file_path, file_name, signed_path, signed_file_name, status, send_back_reason, cancel_reason, sent_at, viewed_at, signed_at, reviewed_at, cancelled_at';

const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

async function withNames(contracts: SigningContract[]): Promise<SigningContract[]> {
  const numbers = [...new Set(contracts.map((c) => c.employee_number))];
  if (!numbers.length) return contracts;
  const { data } = await supabase.from('employee_directory').select('"Employee Number", "First Name", "Last Name"').in('"Employee Number"', numbers);
  const names = new Map(
    ((data ?? []) as Record<string, string | null>[]).map((r) => [
      String(r['Employee Number']),
      [r['First Name'], r['Last Name']].filter(Boolean).join(' '),
    ])
  );
  return contracts.map((c) => ({ ...c, employee_name: names.get(c.employee_number) || c.employee_number }));
}

/** HR: every contract in the company, newest first. */
export async function listContracts(): Promise<SigningContract[]> {
  const { data, error } = await supabase.from('employee_contracts').select(COLUMNS).order('sent_at', { ascending: false });
  if (error) fail(error, 'Could not load contracts.');
  return withNames((data ?? []) as SigningContract[]);
}

/** The employee: their own contracts (the database shows them nothing else), newest first. */
export async function listMyContracts(): Promise<SigningContract[]> {
  const { data, error } = await supabase.from('employee_contracts').select(COLUMNS).order('sent_at', { ascending: false });
  if (error) fail(error, 'Could not load your contracts.');
  return (data ?? []) as SigningContract[];
}

async function upload(path: string, file: File) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: contentTypeFor(file.name) ?? undefined, upsert: false });
  if (error) fail(error, 'Could not upload the file.');
}
const removeQuietly = async (paths: string[]) => {
  try {
    await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    // a leftover file is harmless: nothing points at it
  }
};

export interface NewContract {
  employeeNumbers: string[];
  title: string;
  message?: string;
  signBy?: string | null;
  file: File;
}

/**
 * HR sends the contract to each person: one copy of the file and one contract each, so each is signed and tracked on
 * its own. Returns who it went to and who it didn't (with why).
 */
export async function sendContracts(input: NewContract): Promise<{ sent: string[]; failed: { employeeNumber: string; error: string }[] }> {
  const problem = contractFileProblem(input.file, 'contract');
  if (problem) throw new Error(problem);
  const { tenantId } = await currentUserAndTenant();
  const sent: string[] = [];
  const failed: { employeeNumber: string; error: string }[] = [];
  for (const employeeNumber of input.employeeNumbers) {
    const id = crypto.randomUUID();
    const path = `${tenantId}/${id}/original-${randomFileName(input.file.name)}`;
    try {
      await upload(path, input.file);
      const { error } = await supabase.from('employee_contracts').insert({
        id,
        employee_number: employeeNumber,
        title: input.title.trim(),
        message: input.message?.trim() || null,
        sign_by: input.signBy || null,
        file_path: path,
        file_name: input.file.name.slice(0, 255),
      });
      if (error) {
        await removeQuietly([path]);
        fail(error, 'Could not send the contract.');
      }
      sent.push(employeeNumber);
    } catch (err) {
      failed.push({ employeeNumber, error: err instanceof Error ? err.message : 'Could not send the contract.' });
    }
  }
  return { sent, failed };
}

/**
 * Opens the contract HR sent, or the signed copy. When the employee opens the contract the first time, it is marked
 * viewed (after the tab is open, so the browser doesn't block it).
 */
export async function openContractFile(contract: SigningContract, which: 'contract' | 'signed', asEmployee = false): Promise<void> {
  const path = which === 'contract' ? contract.file_path : contract.signed_path;
  if (!path) throw new Error('There is no signed copy yet');
  await openPrivateFile(BUCKET, path);
  if (asEmployee && which === 'contract' && !contract.viewed_at) {
    await supabase.rpc('contract_mark_viewed', { p_id: contract.id });
  }
}

/** The employee uploads their signed copy, a PDF (or a new one in place of the last). The old file is removed. */
export async function uploadSignedCopy(contract: SigningContract, file: File): Promise<SigningContract> {
  const problem = contractFileProblem(file, 'signed');
  if (problem) throw new Error(problem);
  if (!canUploadSigned(contract.status)) throw new Error('HR has already accepted your signed contract');
  const path = `${contract.tenant_id}/${contract.id}/signed-${randomFileName(file.name)}`;
  await upload(path, file);
  const { data, error } = await supabase.rpc('contract_submit_signed', { p_id: contract.id, p_path: path, p_file_name: file.name.slice(0, 255) });
  if (error) {
    await removeQuietly([path]);
    fail(error, 'Could not submit your signed copy.');
  }
  if (contract.signed_path && contract.signed_path !== path) await removeQuietly([contract.signed_path]);
  return data as SigningContract;
}

/** HR accepts the signed copy, or sends it back saying what to fix. */
export async function reviewContract(id: string, accept: boolean, reason?: string): Promise<SigningContract> {
  const { data, error } = await supabase.rpc('contract_review', { p_id: id, p_accept: accept, p_reason: reason?.trim() || null });
  if (error) fail(error, accept ? 'Could not accept the contract.' : 'Could not send the contract back.');
  return data as SigningContract;
}

/** HR withdraws a contract that hasn't been accepted. */
export async function cancelContract(id: string, reason?: string): Promise<SigningContract> {
  const { data, error } = await supabase.rpc('contract_cancel', { p_id: id, p_reason: reason?.trim() || null });
  if (error) fail(error, 'Could not cancel the contract.');
  return data as SigningContract;
}
