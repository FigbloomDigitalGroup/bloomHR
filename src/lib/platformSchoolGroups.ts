import { ApiError, apiRequest } from './adminApi';
import type { School } from './platformSchools';

// Figbloom Schools' school groups (organisations) in the console (/platform/school-groups, design 5.8). They are
// approved, rejected, suspended and reactivated on the Figbloom platform, through bloomHR's backend
// (platform_school_groups_routes.js), which checks the caller's console role. Figbloom Schools follows the platform's
// decision from switch-on (decisions_live); until then the page says so.

export type GroupStatus = 'pending' | 'active' | 'suspended' | 'rejected';
export type GroupAction = 'approve' | 'reject' | 'suspend' | 'reactivate';

export const GROUP_STATUSES: GroupStatus[] = ['pending', 'active', 'suspended', 'rejected'];

/** As the backend allows (platform_school_groups_routes.js). */
export const MAX_GROUP_REASON = 500;

export const GROUP_STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for approval',
  active: 'Active',
  suspended: 'Suspended',
  rejected: 'Not approved',
};

export interface GroupSchool {
  /** the platform's ID for the school */
  id: string;
  name: string;
  status: string | null;
  /** Figbloom Schools' own ID and address for it */
  local_tenant_id: string | null;
  local_slug: string | null;
}

export interface SchoolGroup {
  id: string;
  name: string;
  status: string;
  status_reason: string | null;
  owner_email: string | null;
  created_at: string | null;
  local_organization_id: string | null;
  tenant_count: number;
  schools: GroupSchool[];
}

export interface SchoolGroupsList {
  groups: SchoolGroup[];
  counts: Partial<Record<GroupStatus, number>>;
  truncated: boolean;
  /** whether Figbloom Schools applies these decisions yet (SCHOOL_GROUP_DECISIONS_LIVE) */
  decisions_live: boolean;
}

/** Why the list could not be shown: the platform is not connected (503), did not answer (502), or something else. */
export type GroupsProblem = 'not_connected' | 'unavailable' | 'other';

export function groupsProblem(err: unknown): GroupsProblem {
  if (err instanceof ApiError) {
    if (err.status === 503 || err.code === 'platform_not_connected') return 'not_connected';
    if (err.status === 502 || err.code === 'platform_unavailable') return 'unavailable';
  }
  return 'other';
}

export async function listSchoolGroups(): Promise<SchoolGroupsList> {
  const result = await apiRequest<SchoolGroupsList>('GET', '/platform/school-groups');
  if (!Array.isArray(result?.groups)) throw new Error('The Figbloom platform sent something the console does not understand.');
  return { ...result, counts: result.counts ?? {}, truncated: !!result.truncated, decisions_live: result.decisions_live === true };
}

export async function setSchoolGroupStatus(id: string, action: GroupAction, reason: string): Promise<SchoolGroup | null> {
  const trimmed = reason.trim();
  const result = await apiRequest<{ group?: SchoolGroup }>('POST', `/platform/school-groups/${encodeURIComponent(id)}/status`, {
    action,
    ...(trimmed ? { reason: trimmed } : {}),
  });
  return result.group ?? null;
}

/** The actions a group in this status offers (the backend checks them again). */
export function groupActions(status: string): GroupAction[] {
  switch (status) {
    case 'pending':
      return ['approve', 'reject'];
    case 'active':
      return ['suspend'];
    case 'suspended':
    case 'rejected':
      return ['reactivate'];
    default:
      return [];
  }
}

/** The console permission an action needs: approving and rejecting are Owner/Admin; suspending and reactivating, Support too. */
export const actionPermission = (a: GroupAction) => (a === 'approve' || a === 'reject' ? 'approve_companies' : 'suspend_companies');

/** An action needs a reason: rejecting and suspending. */
export const needsReason = (a: GroupAction) => a === 'reject' || a === 'suspend';

export interface GroupPeople {
  students: number;
  teachers: number;
  parents: number;
  /** schools found in Figbloom Schools' list (the others are counted as unknown) */
  matched: number;
}

/** A group's people, added up from Figbloom Schools' list (school ID = the group school's local_tenant_id). */
export function groupPeople(group: SchoolGroup, schoolsById: Map<string, School>): GroupPeople {
  const total: GroupPeople = { students: 0, teachers: 0, parents: 0, matched: 0 };
  for (const s of group.schools) {
    const found = s.local_tenant_id ? schoolsById.get(s.local_tenant_id) : undefined;
    if (!found) continue;
    total.matched += 1;
    total.students += Number(found.students) || 0;
    total.teachers += Number(found.teachers) || 0;
    total.parents += Number(found.parents) || 0;
  }
  return total;
}

/** The groups with this status ('all' for any) whose name, owner, or any of whose schools' names or addresses match. */
export function filterGroups(list: SchoolGroup[], { status, search }: { status: string; search: string }): SchoolGroup[] {
  const q = search.trim().toLowerCase();
  const matches = (g: SchoolGroup) =>
    g.name.toLowerCase().includes(q) ||
    (g.owner_email ?? '').toLowerCase().includes(q) ||
    g.schools.some((s) => s.name.toLowerCase().includes(q) || (s.local_slug ?? '').toLowerCase().includes(q));
  return list.filter((g) => (status === 'all' || g.status === status) && (!q || matches(g)));
}

export interface GroupTotals {
  groups: number;
  pending: number;
  active: number;
  suspendedOrRejected: number;
  suspended: number;
  rejected: number;
  empty: number;
}

export function groupTotals(list: SchoolGroup[]): GroupTotals {
  const count = (s: string) => list.filter((g) => g.status === s).length;
  return {
    groups: list.length,
    pending: count('pending'),
    active: count('active'),
    suspended: count('suspended'),
    rejected: count('rejected'),
    suspendedOrRejected: count('suspended') + count('rejected'),
    empty: list.filter((g) => (g.tenant_count || g.schools.length) === 0).length,
  };
}
