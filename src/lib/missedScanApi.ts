import { supabase } from './supabase';
import { addDays, dayLabel, formatTime, nairobiToIso, nairobiToday } from './attendance';

// Missed-scan requests (migration 20261025100000, FIG-1201): "I forgot to scan", approved by the manager or HR. The
// database decides who may ask, see and decide; these turn its answers into plain shapes.

export type MissedScanStatus = 'pending' | 'approved' | 'declined' | 'cancelled';
export type MissedScanApprover = 'manager' | 'hr';

export interface MissedScan {
  id: string;
  employeeNumber: string;
  employeeName: string;
  /** "YYYY-MM-DD" */
  day: string;
  cameInAt: string | null;
  leftAt: string | null;
  reason: string;
  status: MissedScanStatus;
  approver: MissedScanApprover;
  managerNumber: string | null;
  managerName: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  comment: string | null;
  /** the signed-in person may approve or decline it now */
  canDecide: boolean;
  /** the signed-in person's own */
  mine: boolean;
}

/** The portal form's rules: how far back, and who the request goes to. */
export interface MissedScanRules {
  daysBack: number;
  approver: MissedScanApprover;
  approverName: string;
}

export interface MissedScanSettings {
  daysBack: number;
  approver: MissedScanApprover;
}

export const DEFAULT_MISSED_SCAN_SETTINGS: MissedScanSettings = { daysBack: 7, approver: 'manager' };
export const MAX_MISSED_SCAN_DAYS_BACK = 31;

export const MISSED_SCAN_STATUS_LABEL: Record<MissedScanStatus, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export const MISSED_SCAN_STATUS_TONE: Record<MissedScanStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  declined: 'danger',
  cancelled: 'neutral',
};

const fail = (error: unknown): never => {
  const e = (error ?? {}) as { message?: string; code?: string };
  if (/attendance_settings_missed_scan_days_check/.test(e.message ?? '')) throw new Error(`Choose 0 to ${MAX_MISSED_SCAN_DAYS_BACK} days`);
  if (e.code === '42501' && /row-level security/.test(e.message ?? '')) throw new Error('You are not allowed to do that');
  throw new Error(e.message || 'Something went wrong');
};

export const toMissedScan = (r: Record<string, unknown>): MissedScan => ({
  id: String(r.id ?? ''),
  employeeNumber: String(r.employee_number ?? ''),
  employeeName: String(r.employee_name ?? r.employee_number ?? ''),
  day: String(r.work_date ?? ''),
  cameInAt: (r.came_in_at as string | null) ?? null,
  leftAt: (r.left_at as string | null) ?? null,
  reason: String(r.reason ?? ''),
  status: (r.status as MissedScanStatus) ?? 'pending',
  approver: (r.approver as MissedScanApprover) ?? 'hr',
  managerNumber: (r.manager_number as string | null) ?? null,
  managerName: (r.manager_name as string | null) ?? null,
  createdAt: String(r.created_at ?? ''),
  decidedAt: (r.decided_at as string | null) ?? null,
  decidedByName: (r.decided_by_name as string | null) ?? null,
  comment: (r.decision_comment as string | null) ?? null,
  canDecide: r.can_decide === true,
  mine: r.mine === true,
});

// ---------------------------------------------------------------------------------------------
// plain helpers
// ---------------------------------------------------------------------------------------------
/** "came in 7:59 am, left 5:10 pm" */
export function missedScanTimes(m: Pick<MissedScan, 'cameInAt' | 'leftAt'>): string {
  return [m.cameInAt && `came in ${formatTime(m.cameInAt)}`, m.leftAt && `left ${formatTime(m.leftAt)}`].filter(Boolean).join(', ');
}

/** Who it is waiting for: "Mary Kamau" or "HR". */
export const missedScanWaitingOn = (m: Pick<MissedScan, 'approver' | 'managerName'>) =>
  m.approver === 'manager' && m.managerName ? m.managerName : 'HR';

/**
 * One line for the day's history: "Missed scan, approved by Mary Kamau: came in 7:59 am, 'forgot to scan'",
 * "Missed scan, waiting for HR: ...", "Missed scan, declined by HR: ... Comment: ...".
 */
export function missedScanLine(m: MissedScan): string {
  const head = m.status === 'pending'
    ? `waiting for ${missedScanWaitingOn(m)}`
    : m.status === 'cancelled'
      ? 'cancelled'
      : `${m.status} by ${m.decidedByName ?? 'HR'}`;
  const comment = m.comment ? ` Comment: ${m.comment}` : '';
  return `Missed scan, ${head}: ${missedScanTimes(m)}, '${m.reason}'.${comment}`;
}

/** The days a request may be for: today and up to daysBack before it, newest first. */
export function missedScanDays(daysBack: number, today: string = nairobiToday()): string[] {
  return Array.from({ length: Math.max(0, daysBack) + 1 }, (_, i) => addDays(today, -i));
}

/** "Today", "Yesterday", else "Thu 22 Oct". */
export function missedScanDayLabel(day: string, today: string = nairobiToday()): string {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return dayLabel(day);
}

export interface MissedScanDraft {
  day: string;
  /** "HH:MM", or empty */
  cameIn: string;
  left: string;
  reason: string;
}

/** What's wrong with a request before it is sent (the database checks again), or null. */
export function missedScanProblem(d: MissedScanDraft, now: Date = new Date()): string | null {
  if (!d.day) return 'Choose the day';
  if (!d.cameIn && !d.left) return 'Enter the time you came in or the time you left';
  if (d.cameIn && d.left && d.left <= d.cameIn) return 'The time you left must be after the time you came in';
  const latest = [d.cameIn, d.left].filter(Boolean).map((t) => new Date(nairobiToIso(d.day, t)).getTime());
  if (latest.some((t) => t > now.getTime())) return "A time that hasn't happened yet can't be asked for";
  if (!d.reason.trim()) return 'Say why the scan was missed';
  if (d.reason.trim().length > 300) return 'Keep the reason to 300 characters';
  return null;
}

// ---------------------------------------------------------------------------------------------
// the database
// ---------------------------------------------------------------------------------------------
export async function loadMissedScanRules(): Promise<MissedScanRules> {
  const { data, error } = await supabase.rpc('attendance_missed_scan_rules');
  if (error) fail(error);
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    daysBack: Number(d.days_back ?? 7),
    approver: (d.approver as MissedScanApprover) ?? 'hr',
    approverName: String(d.approver_name ?? 'HR'),
  };
}

export interface MissedScanFilter {
  status?: MissedScanStatus;
  employeeNumber?: string;
  from?: string;
  to?: string;
}

/** The requests the signed-in person may see, newest first. */
export async function loadMissedScans(filter: MissedScanFilter = {}): Promise<MissedScan[]> {
  const { data, error } = await supabase.rpc('attendance_missed_scans', {
    p_status: filter.status ?? null,
    p_employee: filter.employeeNumber ?? null,
    p_from: filter.from ?? null,
    p_to: filter.to ?? null,
  });
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map(toMissedScan);
}

export async function requestMissedScan(d: MissedScanDraft): Promise<void> {
  const { error } = await supabase.rpc('attendance_missed_scan_request', {
    p_date: d.day,
    p_in: d.cameIn ? nairobiToIso(d.day, d.cameIn) : null,
    p_out: d.left ? nairobiToIso(d.day, d.left) : null,
    p_reason: d.reason.trim(),
  });
  if (error) fail(error);
}

export async function cancelMissedScan(id: string): Promise<void> {
  const { error } = await supabase.rpc('attendance_missed_scan_cancel', { p_id: id });
  if (error) fail(error);
}

export async function decideMissedScan(id: string, decision: 'approve' | 'decline', comment?: string): Promise<void> {
  const { error } = await supabase.rpc('attendance_missed_scan_decide', {
    p_id: id,
    p_decision: decision,
    p_comment: comment?.trim() || null,
  });
  if (error) fail(error);
}

export async function loadMissedScanSettings(): Promise<MissedScanSettings> {
  const { data, error } = await supabase.from('attendance_settings').select('missed_scan_days_back, missed_scan_approver').maybeSingle();
  if (error) fail(error);
  if (!data) return DEFAULT_MISSED_SCAN_SETTINGS;
  return {
    daysBack: Number(data.missed_scan_days_back ?? 7),
    approver: (data.missed_scan_approver as MissedScanApprover) ?? 'manager',
  };
}

/** Saves them (a company without settings yet keeps counting attendance from the day it already did). */
export async function saveMissedScanSettings(s: MissedScanSettings): Promise<void> {
  const { error } = await supabase
    .from('attendance_settings')
    .upsert({ missed_scan_days_back: s.daysBack, missed_scan_approver: s.approver }, { onConflict: 'tenant_id' });
  if (error) fail(error);
}
