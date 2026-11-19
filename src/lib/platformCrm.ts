import { ApiError, apiRequest, type ApiFieldError } from './adminApi';

// Figbloom CRM's organisations in the console (/platform/crm/organizations, ERP/CRM_PLATFORM_CONTRACT.md 3). CRM's own
// summaries (admin, members, invitations, leads, open deals, companies, last activity: counts only, never deal values or
// customer data) joined by bloomHR's backend (platform_crm_routes.js) to the platform's status for each organisation.
// Figbloom staff create organisations here (through CRM); suspending and reactivating are decided on the Figbloom
// platform, as for Fleet, and CRM applies them. Nothing to approve: CRM registers new organisations as active.

export type CrmAction = 'suspend' | 'reactivate';

/** As the backend allows. */
export const MAX_CRM_REASON = 500;

/** The status tabs, in order (others show only when an organisation has one). */
export const CRM_STATUSES = ['active', 'suspended'];

export const CRM_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  suspended: 'Suspended',
  inactive: 'Inactive',
  pending: 'Waiting for approval',
  rejected: 'Not approved',
  unregistered: 'Not on the platform yet',
};

export interface CrmOrganisation {
  /** CRM's own ID (Organization.id) */
  id: string;
  name: string;
  slug: string | null;
  /** CRM's own status (follows the platform's decision once CRM has applied it) */
  crm_status: string | null;
  created_at: string | null;
  /** the first Management member */
  admin_name: string | null;
  admin_email: string | null;
  active_members: number | null;
  pending_invitations: number | null;
  leads: number | null;
  open_deals: number | null;
  companies: number | null;
  last_activity_at: string | null;
  /** the platform's ID as CRM knows it: null until CRM has registered the organisation (within a minute) */
  platform_organization_id: string | null;
  /** false: on the platform, but not in CRM's list */
  in_crm: boolean;
  /** the platform's organisation found for it; null until registered (or without the platform) */
  organization_id: string | null;
  /** the platform's decision; null until registered */
  status: string | null;
  status_reason: string | null;
}

export interface CrmOrganisationsList {
  organizations: CrmOrganisation[];
  truncated: boolean;
  /** whether the platform answered: without it the organisations show CRM's own status and nothing can be changed */
  platform: { ok: true } | { ok: false; code: string; message: string };
}

export interface NewCrmOrganisation {
  name: string;
  slug?: string;
  adminName: string;
  adminEmail: string;
}

/** Why the list could not be shown: CRM is not connected (503), did not answer (502), or something else. */
export type CrmProblem = 'not_connected' | 'unavailable' | 'other';

export function crmProblem(err: unknown): CrmProblem {
  if (err instanceof ApiError) {
    if (err.status === 503 || err.code === 'crm_not_connected') return 'not_connected';
    if (err.status === 502 || err.code === 'crm_unavailable') return 'unavailable';
  }
  return 'other';
}

export async function listCrmOrganisations(): Promise<CrmOrganisationsList> {
  const result = await apiRequest<CrmOrganisationsList>('GET', '/platform/crm/organizations');
  if (!Array.isArray(result?.organizations)) throw new Error('Figbloom CRM sent something the console does not understand.');
  return {
    organizations: result.organizations,
    truncated: !!result.truncated,
    platform: result.platform && result.platform.ok === false ? result.platform : { ok: true },
  };
}

/** Creates an organisation in CRM (its admin is invited by CRM). Field errors come back on the ApiError. */
export async function createCrmOrganisation(input: NewCrmOrganisation): Promise<CrmOrganisation> {
  const slug = input.slug?.trim();
  const result = await apiRequest<{ organization?: CrmOrganisation }>('POST', '/platform/crm/organizations', {
    name: input.name.trim(),
    ...(slug ? { slug } : {}),
    adminName: input.adminName.trim(),
    adminEmail: input.adminEmail.trim(),
  });
  if (!result?.organization?.id) throw new Error('Figbloom CRM sent something the console does not understand.');
  return result.organization;
}

/** The form's field errors from a refused create, by field ({} when there are none). */
export function fieldErrorsByPath(err: unknown): Record<string, string> {
  const list: ApiFieldError[] = err instanceof ApiError ? err.fieldErrors : [];
  const out: Record<string, string> = {};
  for (const f of list) if (!out[f.path]) out[f.path] = f.message;
  return out;
}

export async function setCrmOrganisationStatus(
  organizationId: string,
  action: CrmAction,
  reason: string
): Promise<{ organization_id: string; status: string; status_reason: string | null } | null> {
  const trimmed = reason.trim();
  const result = await apiRequest<{ organization?: { organization_id: string; status: string; status_reason: string | null } }>(
    'POST',
    `/platform/crm/organizations/${encodeURIComponent(organizationId)}/status`,
    { action, ...(trimmed ? { reason: trimmed } : {}) }
  );
  return result.organization ?? null;
}

/** The status shown: the platform's decision, else CRM's own, else not on the platform yet. */
export const statusOf = (o: CrmOrganisation) => o.status ?? o.crm_status ?? 'unregistered';

/**
 * What can be done to it now: suspend an active one, reactivate a suspended one. Nothing until the platform knows it
 * and its status came from the platform.
 */
export function crmActions(o: CrmOrganisation): CrmAction[] {
  if (!o.organization_id || !o.status) return [];
  if (o.status === 'active') return ['suspend'];
  if (o.status === 'suspended') return ['reactivate'];
  return [];
}

/** Whether CRM has registered it with the platform yet (it does so within a minute of creating it). */
export const registered = (o: CrmOrganisation) => !!(o.platform_organization_id || o.organization_id);

/** The organisations with this status ('all' for any) whose name, slug, admin or ID match. */
export function filterOrganisations(list: CrmOrganisation[], { status, search }: { status: string; search: string }): CrmOrganisation[] {
  const q = search.trim().toLowerCase();
  const matches = (o: CrmOrganisation) =>
    o.name.toLowerCase().includes(q) ||
    (o.slug ?? '').toLowerCase().includes(q) ||
    (o.admin_email ?? '').toLowerCase().includes(q) ||
    (o.admin_name ?? '').toLowerCase().includes(q) ||
    o.id.toLowerCase() === q;
  return list.filter((o) => (status === 'all' || statusOf(o) === status) && (!q || matches(o)));
}

export interface CrmTotals {
  organisations: number;
  active: number;
  suspended: number;
  members: number;
}

export function crmTotals(list: CrmOrganisation[]): CrmTotals {
  const count = (s: string) => list.filter((o) => statusOf(o) === s).length;
  return {
    organisations: list.length,
    active: count('active'),
    suspended: count('suspended'),
    members: list.reduce((t, o) => t + (Number(o.active_members) || 0), 0),
  };
}

/** One organisation, fresh from CRM and the platform (the detail panel). */
export async function getCrmOrganisation(id: string): Promise<CrmOrganisation> {
  const result = await apiRequest<{ organization?: CrmOrganisation }>('GET', `/platform/crm/organizations/${encodeURIComponent(id)}`);
  if (!result?.organization?.id) throw new Error('Figbloom CRM sent something the console does not understand.');
  return result.organization;
}
