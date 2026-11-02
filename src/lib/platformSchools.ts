import { ApiError, apiRequest } from './adminApi';

// Figbloom Schools in the console (/platform/schools, ERP/SCHOOLS_CONSOLE_CONTRACT.md). Schools keeps its own
// database; the console reaches it through bloomHR's backend (platform_schools_routes.js), which checks the caller's
// console role and calls Schools' platform-schools function with a shared secret. Counts, statuses and one contact
// only: no names of students or staff.

export interface School {
  id: string;
  name: string;
  slug: string;
  /** as Schools stores it: at least active and suspended; anything else is shown as it comes */
  status: string;
  status_reason: string | null;
  /** the school's group, or null */
  organization: { id: string; name: string } | null;
  created_at: string;
  /** the first school admin's email, for support, or null */
  admin_email: string | null;
  students: number;
  teachers: number;
  parents: number;
  /** the latest sign-in of anyone in the school, or null */
  last_activity_at: string | null;
}

export interface SchoolsList {
  generated_at: string;
  schools: School[];
}

export type SchoolStatusChange = 'suspended' | 'active';

export const MAX_REASON = 500;

/** Why the list could not be shown: Schools is not connected (503), did not answer (502), or something else. */
export type SchoolsProblem = 'not_connected' | 'unavailable' | 'other';

export function schoolsProblem(err: unknown): SchoolsProblem {
  if (err instanceof ApiError) {
    if (err.status === 503 || err.code === 'schools_not_connected') return 'not_connected';
    if (err.status === 502 || err.code === 'schools_unavailable') return 'unavailable';
  }
  return 'other';
}

const NOT_SCHOOLS = 'Figbloom Schools sent something the console does not understand.';

/** Every school on Figbloom Schools. */
export async function listSchools(): Promise<SchoolsList> {
  const result = await apiRequest<SchoolsList>('GET', '/platform/schools');
  if (!Array.isArray(result?.schools)) throw new Error(NOT_SCHOOLS);
  return result;
}

/** Suspends (a reason is needed) or reactivates a school. Returns the school as it is now. */
export async function setSchoolStatus(id: string, status: SchoolStatusChange, reason: string): Promise<School | null> {
  const trimmed = reason.trim();
  const result = await apiRequest<{ school?: School }>('POST', `/platform/schools/${encodeURIComponent(id)}/status`, {
    status,
    ...(trimmed ? { reason: trimmed } : {}),
  });
  return result.school ?? null;
}

export interface SchoolTotals {
  schools: number;
  active: number;
  suspended: number;
  students: number;
}

export function schoolTotals(list: School[]): SchoolTotals {
  return {
    schools: list.length,
    active: list.filter((s) => s.status === 'active').length,
    suspended: list.filter((s) => s.status === 'suspended').length,
    students: list.reduce((sum, s) => sum + (Number.isFinite(s.students) ? s.students : 0), 0),
  };
}

/** The status tabs: All, Active, Suspended, then any other status Schools sent, as it came. */
export function statusFilters(list: School[]): string[] {
  const others = [...new Set(list.map((s) => s.status))].filter((s) => s !== 'active' && s !== 'suspended').sort();
  return ['all', 'active', 'suspended', ...others];
}

export const statusLabel = (status: string) => (status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ') : '—');

/** The schools with this status ('all' for any) whose name, slug or ID matches the search. */
export function filterSchools(list: School[], { status, search }: { status: string; search: string }): School[] {
  const q = search.trim().toLowerCase();
  const matches = (s: School) =>
    s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q) || s.id.toLowerCase().startsWith(q);
  return list.filter((s) => (status === 'all' || s.status === status) && (!q || matches(s)));
}
