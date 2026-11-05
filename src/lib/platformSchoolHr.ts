import { ApiError, apiRequest } from './adminApi';

// "HR & Payroll" per school in the console (ERP/SCHOOLS_HR_PHASE1_CONTRACT.md). Switching it on records the hr module
// for the school on the Figbloom platform, through bloomHR's backend (platform_school_hr_routes.js, which checks the
// console role); Figbloom HR then creates the school's HR company, invites its admins and links it back.

/** off: not switched on; enabling: switched on, HR hasn't linked its company yet; on: linked; unknown: couldn't ask. */
export type HrState = 'off' | 'enabling' | 'on' | 'unknown';

export interface SchoolHr {
  /** the platform's ID for the school */
  platform_tenant_id: string;
  name: string;
  /** Figbloom Schools' own ID and address for it */
  schools_tenant_id: string | null;
  schools_slug: string | null;
  hr: { state: HrState; module_status: string | null; hr_tenant_id: string | null };
}

export const HR_STATE_LABELS: Record<HrState, string> = { off: 'Off', enabling: 'Enabling', on: 'On', unknown: '—' };

const NOT_PLATFORM = 'The Figbloom platform sent something the console does not understand.';

/** Every school on the platform with its HR state. */
export async function listSchoolHr(): Promise<{ schools: SchoolHr[]; truncated: boolean }> {
  const result = await apiRequest<{ schools?: SchoolHr[]; truncated?: boolean }>('GET', '/platform/school-hr');
  if (!Array.isArray(result?.schools)) throw new Error(NOT_PLATFORM);
  return { schools: result.schools, truncated: !!result.truncated };
}

/** Switches HR & Payroll on for a school (its platform ID). Returns the school's HR state now. */
export async function enableSchoolHr(platformTenantId: string): Promise<SchoolHr> {
  const result = await apiRequest<{ school?: SchoolHr }>('POST', `/platform/school-hr/${encodeURIComponent(platformTenantId)}/enable`);
  if (!result?.school?.hr) throw new Error(NOT_PLATFORM);
  return result.school;
}

/** Whether the list failed because the platform isn't connected to the console (a setting), not a fault. */
export const platformNotConnected = (err: unknown) =>
  err instanceof ApiError && (err.status === 503 || err.code === 'platform_not_connected');

/** The schools by Figbloom Schools' own ID and by the platform's. */
export function indexSchoolHr(list: SchoolHr[]) {
  const bySchoolsId = new Map<string, SchoolHr>();
  const byPlatformId = new Map<string, SchoolHr>();
  for (const s of list) {
    byPlatformId.set(s.platform_tenant_id, s);
    if (s.schools_tenant_id) bySchoolsId.set(s.schools_tenant_id, s);
  }
  return { bySchoolsId, byPlatformId };
}

/** The list with one school replaced (after switching it on). */
export const withSchoolHr = (list: SchoolHr[], updated: SchoolHr) =>
  list.map((s) => (s.platform_tenant_id === updated.platform_tenant_id ? { ...s, ...updated } : s));
