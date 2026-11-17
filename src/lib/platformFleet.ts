import { ApiError, apiRequest } from './adminApi';
import type { HrState } from './platformSchoolHr';
import type { GroupAction } from './platformSchoolGroups';

// Figbloom Fleet's companies in the console (/platform/fleet/companies, ERP/FLEET_PLATFORM_CONTRACT.md 3). Fleet's own
// summaries (owner, plan, vehicles, drivers, trips, last ping) joined by bloomHR's backend (platform_fleet_routes.js)
// to the platform's status for each company. Approving, rejecting, suspending and reactivating are decided on the
// Figbloom platform, as for school groups (same actions and console permissions); Fleet applies them.

export type FleetAction = GroupAction;
export type FleetStatus = 'pending' | 'active' | 'suspended' | 'rejected';

export const FLEET_STATUSES: FleetStatus[] = ['pending', 'active', 'suspended', 'rejected'];

/** As the backend allows. */
export const MAX_FLEET_REASON = 500;

export const FLEET_STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for approval',
  active: 'Active',
  suspended: 'Suspended',
  rejected: 'Not approved',
  unregistered: 'Not on the platform yet',
};

export interface FleetCompany {
  /** Fleet's own ID (Company.id) */
  id: string;
  name: string;
  /** Fleet's own status (follows the platform's decision once Fleet has applied it) */
  fleet_status: string | null;
  plan: string | null;
  created_at: string | null;
  owner_name: string | null;
  owner_email: string | null;
  vehicles: number | null;
  drivers: number | null;
  admins: number | null;
  trips_last_30_days: number | null;
  last_location_at: string | null;
  /** false: on the platform, but not in Fleet's list */
  in_fleet: boolean;
  /** the platform's ID for the company (its organisation); null until Fleet has registered it */
  organization_id: string | null;
  /** the platform's decision; null until Fleet has registered it */
  status: FleetStatus | null;
  status_reason: string | null;
  /** the platform's account (tenant) for the company, where HR & Payroll is switched on; null until registered */
  platform_tenant_id?: string | null;
  /** HR & Payroll for the company (ERP/FLEET_HR_CONTRACT.md); null without a platform account */
  hr?: FleetHr | null;
}

/** off: not switched on; enabling: switched on, HR hasn't linked its company yet; on: linked; unknown: couldn't ask. */
export interface FleetHr {
  state: HrState;
  module_status: string | null;
  hr_tenant_id: string | null;
}

export interface FleetCompaniesList {
  generated_at: string | null;
  companies: FleetCompany[];
  truncated: boolean;
  /** whether the platform answered: without it the companies have no status and nothing can be decided */
  platform: { ok: true } | { ok: false; code: string; message: string };
}

/** Why the list could not be shown: Fleet is not connected (503), did not answer (502), or something else. */
export type FleetProblem = 'not_connected' | 'unavailable' | 'other';

export function fleetProblem(err: unknown): FleetProblem {
  if (err instanceof ApiError) {
    if (err.status === 503 || err.code === 'fleet_not_connected') return 'not_connected';
    if (err.status === 502 || err.code === 'fleet_unavailable') return 'unavailable';
  }
  return 'other';
}

export async function listFleetCompanies(): Promise<FleetCompaniesList> {
  const result = await apiRequest<FleetCompaniesList>('GET', '/platform/fleet/companies');
  if (!Array.isArray(result?.companies)) throw new Error('Figbloom Fleet sent something the console does not understand.');
  return {
    generated_at: result.generated_at ?? null,
    companies: result.companies,
    truncated: !!result.truncated,
    platform: result.platform && result.platform.ok === false ? result.platform : { ok: true },
  };
}

export async function setFleetCompanyStatus(
  organizationId: string,
  action: FleetAction,
  reason: string
): Promise<{ organization_id: string; status: FleetStatus; status_reason: string | null } | null> {
  const trimmed = reason.trim();
  const result = await apiRequest<{ company?: { organization_id: string; status: FleetStatus; status_reason: string | null } }>(
    'POST',
    `/platform/fleet/companies/${encodeURIComponent(organizationId)}/status`,
    { action, ...(trimmed ? { reason: trimmed } : {}) }
  );
  return result.company ?? null;
}

/** Switches HR & Payroll on for a Fleet company (its platform account). Returns its HR state now. */
export async function enableFleetHr(platformTenantId: string): Promise<FleetHr> {
  const result = await apiRequest<{ company?: { platform_tenant_id: string; hr?: FleetHr } }>(
    'POST',
    `/platform/fleet/hr/${encodeURIComponent(platformTenantId)}/enable`
  );
  if (!result?.company?.hr) throw new Error('The Figbloom platform sent something the console does not understand.');
  return result.company.hr;
}

/** The list with one company's HR state replaced (after switching it on). */
export const withFleetHr = (list: FleetCompany[], platformTenantId: string, hr: FleetHr) =>
  list.map((c) => (c.platform_tenant_id === platformTenantId ? { ...c, hr } : c));

/** The status tab a company is under: the platform's, or unregistered. */
export const statusOf = (c: FleetCompany) => c.status ?? 'unregistered';

/** The companies with this status ('all' for any) whose name, owner or ID match. */
export function filterCompanies(list: FleetCompany[], { status, search }: { status: string; search: string }): FleetCompany[] {
  const q = search.trim().toLowerCase();
  const matches = (c: FleetCompany) =>
    c.name.toLowerCase().includes(q) ||
    (c.owner_email ?? '').toLowerCase().includes(q) ||
    (c.owner_name ?? '').toLowerCase().includes(q) ||
    c.id.toLowerCase() === q;
  return list.filter((c) => (status === 'all' || statusOf(c) === status) && (!q || matches(c)));
}

export interface FleetTotals {
  companies: number;
  pending: number;
  active: number;
  suspended: number;
  rejected: number;
  unregistered: number;
  vehicles: number;
  drivers: number;
  trips: number;
}

export function fleetTotals(list: FleetCompany[]): FleetTotals {
  const count = (s: string) => list.filter((c) => statusOf(c) === s).length;
  const sum = (k: 'vehicles' | 'drivers' | 'trips_last_30_days') => list.reduce((t, c) => t + (Number(c[k]) || 0), 0);
  return {
    companies: list.length,
    pending: count('pending'),
    active: count('active'),
    suspended: count('suspended'),
    rejected: count('rejected'),
    unregistered: count('unregistered'),
    vehicles: sum('vehicles'),
    drivers: sum('drivers'),
    trips: sum('trips_last_30_days'),
  };
}
