import { supabase } from './supabase';
import { isPlatformAdmin } from './platformRates';

// Console roles (migration 20261103100000_platform_roles.sql). The database decides what each role may do
// (has_platform_permission(), and every platform write function checks it); the console only hides what you can't do.
// Keep ROLE_PERMISSIONS and staffChangeAllowed() in step with platform_role_allows() and
// platform_staff_change_allowed() there.

export type PlatformRole = 'owner' | 'admin' | 'support' | 'viewer';
export type PlatformPermission = 'view' | 'suspend_companies' | 'approve_companies' | 'edit_rates' | 'manage_staff';

export const PLATFORM_ROLES: PlatformRole[] = ['owner', 'admin', 'support', 'viewer'];

export const ROLE_LABELS: Record<PlatformRole, string> = { owner: 'Owner', admin: 'Admin', support: 'Support', viewer: 'Viewer' };

export const ROLE_DESCRIPTIONS: Record<PlatformRole, string> = {
  owner: 'Everything, including adding, removing and changing owners.',
  admin: 'Approves companies, edits statutory rates and manages staff, but never owners.',
  support: 'Sees everything, and suspends or reactivates companies.',
  viewer: 'Sees everything, changes nothing.',
};

const ROLE_PERMISSIONS: Record<PlatformRole, PlatformPermission[]> = {
  owner: ['view', 'suspend_companies', 'approve_companies', 'edit_rates', 'manage_staff'],
  admin: ['view', 'suspend_companies', 'approve_companies', 'edit_rates', 'manage_staff'],
  support: ['view', 'suspend_companies'],
  viewer: ['view'],
};

export const isPlatformRole = (value: unknown): value is PlatformRole => PLATFORM_ROLES.includes(value as PlatformRole);

/** Whether this role allows that (false with no role). */
export function roleCan(role: PlatformRole | null | undefined, permission: PlatformPermission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Whether someone with role `actor` may give `target` (their role now, null for someone new) the role `next` (null
 * when removing them). Owners: anything. Admins: never an owner, either way. Others: nothing.
 */
export function staffChangeAllowed(actor: PlatformRole | null | undefined, target: PlatformRole | null, next: PlatformRole | null): boolean {
  if (actor === 'owner') return true;
  if (actor === 'admin') return target !== 'owner' && next !== 'owner';
  return false;
}

/** The roles `actor` may give someone (to invite them, or to change theirs). */
export const assignableRoles = (actor: PlatformRole | null | undefined): PlatformRole[] =>
  PLATFORM_ROLES.filter((r) => staffChangeAllowed(actor, null, r));

/**
 * The signed-in person's console role, or null when they are not a platform admin. Before the roles migration is
 * applied there is no platform_role(): every platform admin could do everything then, so they count as owners.
 */
export async function myPlatformRole(): Promise<PlatformRole | null> {
  const { data, error } = await supabase.rpc('platform_role');
  if (!error) return isPlatformRole(data) ? data : null;
  // PostgREST's "no such function" (or Postgres's): the migration isn't applied yet
  const missing = error.code === 'PGRST202' || error.code === '42883';
  return missing && (await isPlatformAdmin()) ? 'owner' : null;
}
