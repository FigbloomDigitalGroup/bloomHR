import { supabase } from './supabase';
import { chunks } from './fetchAll';
import { describeCompanyError } from './companyApi';

// Invitations for many people at once (FIG-818). The browser only queues them (enqueue_invitations, migration
// 20261014300000); the send-invites Edge Function, run every minute, makes each invitation and emails it, and keeps
// each person's status. So HR can close the tab: the progress is read back from the database.

/** People per enqueue call (the database takes up to 1000). */
export const ENQUEUE_BATCH_SIZE = 500;

export interface QueuedInvites {
  batchId: string;
  queued: number;
  /** already in the company: nothing to send */
  skipped: number;
  /** not queued, and why */
  rejected: { email: string; reason: string }[];
}

export interface InviteProgress {
  total: number;
  queued: number;
  sending: number;
  sent: number;
  skipped: number;
  failed: number;
  failures: { email: string; error: string | null }[];
}

const newBatchId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/**
 * Queues an invitation for each person, a chunk at a time, all in one batch (whose progress can then be followed).
 * A chunk the database refuses is reported as rejected with the reason; the rest are still queued.
 */
export async function queueInvitations(
  people: { email: string; role?: string; companyRoleId?: string | null }[],
  batchId: string = newBatchId(),
  chunkSize = ENQUEUE_BATCH_SIZE
): Promise<QueuedInvites> {
  const result: QueuedInvites = { batchId, queued: 0, skipped: 0, rejected: [] };
  for (const chunk of chunks(people, chunkSize)) {
    const { data, error } = await supabase.rpc('enqueue_invitations', {
      p_people: chunk.map((p) => ({ email: p.email, role: p.role ?? 'STAFF', ...(p.companyRoleId ? { company_role_id: p.companyRoleId } : {}) })),
      p_batch: batchId,
    });
    if (error) {
      const reason = describeCompanyError(error);
      result.rejected.push(...chunk.map((p) => ({ email: p.email, reason })));
      continue;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { queued?: number; skipped?: number; rejected?: QueuedInvites['rejected'] } | null;
    result.queued += row?.queued ?? 0;
    result.skipped += row?.skipped ?? 0;
    result.rejected.push(...(row?.rejected ?? []));
  }
  return result;
}

export async function inviteBatchProgress(batchId: string): Promise<InviteProgress> {
  const { data, error } = await supabase.rpc('invitation_batch_progress', { p_batch: batchId });
  if (error) throw new Error(describeCompanyError(error));
  const p = (data ?? {}) as Partial<InviteProgress>;
  return {
    total: p.total ?? 0,
    queued: p.queued ?? 0,
    sending: p.sending ?? 0,
    sent: p.sent ?? 0,
    skipped: p.skipped ?? 0,
    failed: p.failed ?? 0,
    failures: p.failures ?? [],
  };
}

/** Puts the batch's failed invitations back in the queue. Returns how many. */
export async function retryFailedInvitations(batchId: string): Promise<number> {
  const { data, error } = await supabase.rpc('retry_failed_invitations', { p_batch: batchId });
  if (error) throw new Error(describeCompanyError(error));
  return Number(data ?? 0);
}

/** Done (sent, skipped or failed) out of the total, and whether anything is still to go. */
export const progressSummary = (p: InviteProgress) => {
  const done = p.sent + p.skipped + p.failed;
  return { done, total: p.total, waiting: p.queued + p.sending, finished: p.total > 0 && p.queued + p.sending === 0 };
};

// the last batch, so its progress shows again after the page is reopened (this browser only; a convenience)
const LAST_BATCH_KEY = 'figbloom.inviteBatch';

export function rememberInviteBatch(batchId: string | null) {
  try {
    if (batchId) localStorage.setItem(LAST_BATCH_KEY, batchId);
    else localStorage.removeItem(LAST_BATCH_KEY);
  } catch {
    /* storage unavailable: progress shows only until the page is left */
  }
}

export function lastInviteBatch(): string | null {
  try {
    return localStorage.getItem(LAST_BATCH_KEY);
  } catch {
    return null;
  }
}
