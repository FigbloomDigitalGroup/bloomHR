import { supabase } from './supabase';
import { apiRequest } from './adminApi';

// Figbloom's platform admins, for the console's Staff page (/platform/staff, migration 20261102100000_platform_staff.sql).
// Listing, removing and the log come from SECURITY DEFINER functions that check is_platform_admin(). Inviting needs
// the service key (it may create a login), so it goes through the backend (POST /api/platform/staff/invite,
// platform_routes.js), which checks the caller is a platform admin too.

export interface PlatformStaffMember {
  user_id: string;
  email: string;
  note: string | null;
  added_by: string | null;
  added_by_email: string | null;
  added_at: string;
  last_sign_in_at: string | null;
  /** whether they also belong to a company */
  in_company: boolean;
  companies: number;
}

export interface PlatformAdminChange {
  id: string;
  user_id: string | null;
  email: string | null;
  action: 'added' | 'removed';
  note: string | null;
  changed_by: string | null;
  changed_by_email: string | null;
  changed_at: string;
}

export interface InviteResult {
  ok: true;
  email: string;
  userId: string | null;
  /** a new login was created and emailed a link to set a password */
  invited: boolean;
  alreadyAdmin: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether this looks like an email address (the server checks again). */
export const isEmail = (value: string) => {
  const v = value.trim();
  return v.length <= 254 && EMAIL_RE.test(v);
};

const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

export async function listPlatformStaff(): Promise<PlatformStaffMember[]> {
  const { data, error } = await supabase.rpc('platform_staff');
  if (error) fail(error, 'Could not load the platform admins.');
  return ((data ?? []) as PlatformStaffMember[]).map((s) => ({ ...s, companies: Number(s.companies) || 0 }));
}

export async function recentPlatformAdminChanges(limit = 10): Promise<PlatformAdminChange[]> {
  const { data, error } = await supabase.rpc('platform_admin_changes_recent', { p_limit: limit });
  if (error) fail(error, 'Could not load the recent changes.');
  return (data ?? []) as PlatformAdminChange[];
}

/** Removes a platform admin (not yourself, not the last one); a reason is needed. */
export async function removePlatformAdmin(userId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('remove_platform_admin', { p_user: userId, p_reason: reason.trim() });
  if (error) fail(error, 'The platform admin was not removed.');
}

/** Makes the person with this email a platform admin, creating their login (and emailing them) if they have none. */
export function invitePlatformAdmin(email: string, note: string): Promise<InviteResult> {
  return apiRequest<InviteResult>('POST', '/platform/staff/invite', { email: email.trim(), note: note.trim() || null });
}
