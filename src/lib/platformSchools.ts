import { ApiError, apiRequest } from './adminApi';
import { hrRequestPending } from './hrRequests';
import type { HrState } from './platformSchoolHr';

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
  /** when a school admin asked for Figbloom HR in Schools; null when not asked (missing from an older Schools) */
  hr_requested_at?: string | null;
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

/** The statuses a school can be suspended from (not onboarding or setup_stalled); a suspended one is reactivated. */
export const SUSPENDABLE_STATUSES = ['active', 'trial', 'overdue'];

/** What the console offers for a school in this status: suspend, reactivate, or nothing. */
export function schoolAction(status: string): SchoolStatusChange | null {
  if (SUSPENDABLE_STATUSES.includes(status)) return 'suspended';
  if (status === 'suspended') return 'active';
  return null;
}

/**
 * The message for a refused suspend or reactivate. Schools answers 422 status_not_settable when it doesn't allow that
 * change from the school's status (trial and overdue, until Schools is updated): said plainly, with Schools' words.
 */
export function statusChangeError(err: unknown, school: Pick<School, 'name' | 'status'>, to: SchoolStatusChange): string {
  if (err instanceof ApiError && err.code === 'status_not_settable') {
    const what = to === 'suspended' ? 'suspended' : 'reactivated';
    return `Figbloom Schools doesn't allow ${school.name} to be ${what} while it is ${statusLabel(school.status).toLowerCase()}.${
      err.message ? ` (${err.message})` : ''
    }`;
  }
  return err instanceof Error && err.message ? err.message : 'The school was not changed.';
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

/**
 * A school's HR & Payroll state, which the console gets from the Figbloom platform, not from Schools
 * (useSchoolHr.ts); null when the school isn't on the platform or the platform couldn't be asked.
 */
export type SchoolHrStateOf = (school: School) => { state: HrState } | null | undefined;

/** Whether the school asked for Figbloom HR that isn't switched on (or being switched on) yet. */
export const schoolHrRequestPending = (school: School, hrOf?: SchoolHrStateOf) =>
  hrRequestPending({ hr_requested_at: school.hr_requested_at, hr: hrOf?.(school) ?? null });

/**
 * The schools with this status ('all' for any) whose name, slug or ID matches the search; with hrRequested, only those
 * asking for HR & Payroll that isn't switched on yet, the longest waiting first.
 */
export function filterSchools(
  list: School[],
  { status, search, hrRequested = false, hrOf }: { status: string; search: string; hrRequested?: boolean; hrOf?: SchoolHrStateOf }
): School[] {
  const q = search.trim().toLowerCase();
  const matches = (s: School) =>
    s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q) || s.id.toLowerCase().startsWith(q);
  const shown = list.filter(
    (s) => (status === 'all' || s.status === status) && (!q || matches(s)) && (!hrRequested || schoolHrRequestPending(s, hrOf))
  );
  return hrRequested ? shown.sort((a, b) => Date.parse(a.hr_requested_at!) - Date.parse(b.hr_requested_at!)) : shown;
}
