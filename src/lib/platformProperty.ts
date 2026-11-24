import { ApiError, apiRequest } from './adminApi';
import type { HrState } from './platformSchoolHr';
import { hrRequestPending } from './hrRequests';

// Figbloom Property's workspaces in the console (/platform/property/workspaces, ERP/PROPERTY_PLATFORM_CONTRACT.md 3).
// Property's own summaries (creator, plan, properties, units, occupied units, team members, tenants: counts only, never
// tenant names, contacts, leases or payments) joined by bloomHR's backend (platform_property_routes.js) to the platform's
// status for each workspace. Customers sign themselves up in Property, so there is nothing to create or approve here:
// suspending and reactivating (suspend_companies) are decided on the Figbloom platform, as for Fleet, and Property
// applies them. A workspace
// its owner switched off in Property (active: false while the platform says active) is "deactivated by owner".

export type PropertyAction = 'suspend' | 'reactivate';

/** As the backend allows. */
export const MAX_PROPERTY_REASON = 500;

/** The status tabs, in order (others show only when a workspace has one). */
export const PROPERTY_STATUSES = ['active', 'suspended', 'deactivated'];

export const PROPERTY_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  suspended: 'Suspended',
  deactivated: 'Deactivated by owner',
  inactive: 'Inactive',
  pending: 'Waiting for approval',
  rejected: 'Not approved',
  unregistered: 'Not on the platform yet',
};

export const PLAN_STATUS_LABELS: Record<string, string> = {
  trialing: 'Trial',
  active: 'Paying',
  locked: 'Locked',
};

export interface PropertyWorkspace {
  /** Property's own ID (Workspace.id, a UUID) */
  id: string;
  name: string;
  slug: string | null;
  /** Property's own switch (Workspace.is_active): false when suspended, or switched off by its owner */
  property_active: boolean | null;
  created_at: string | null;
  /** who signed it up */
  creator_name: string | null;
  creator_email: string | null;
  plan_name: string | null;
  /** trialing | active | locked (Property's own billing) */
  plan_status: string | null;
  trial_ends_at: string | null;
  properties: number | null;
  units: number | null;
  occupied_units: number | null;
  team_members: number | null;
  tenants: number | null;
  /** the platform's IDs as Property knows them: null until Property has registered the workspace (within a minute) */
  platform_organization_id: string | null;
  /** the platform's account (tenant) for the workspace, where HR & Payroll is switched on */
  platform_tenant_id: string | null;
  registered_at: string | null;
  /** false: on the platform, but not in Property's list */
  in_property: boolean;
  /** the platform's organisation found for it; null until registered (or without the platform) */
  organization_id: string | null;
  /** the platform's decision; null until registered */
  status: string | null;
  status_reason: string | null;
  /** HR & Payroll for the workspace (ERP/PROPERTY_HR_CONTRACT.md); null without a platform account */
  hr?: PropertyHr | null;
  /** when a customer admin asked for Figbloom HR in Property; null when not asked (or an older Property that doesn't say) */
  hr_requested_at?: string | null;
}

/** off: not switched on; enabling: switched on, HR hasn't linked its company yet; on: linked; unknown: couldn't ask. */
export interface PropertyHr {
  state: HrState;
  module_status: string | null;
  hr_tenant_id: string | null;
}

export interface PropertyWorkspacesList {
  workspaces: PropertyWorkspace[];
  truncated: boolean;
  /** whether the platform answered: without it the workspaces show Property's own status and nothing can be changed */
  platform: { ok: true } | { ok: false; code: string; message: string };
}

/** Why the list could not be shown: Property is not connected (503), did not answer (502), or something else. */
export type PropertyProblem = 'not_connected' | 'unavailable' | 'other';

export function propertyProblem(err: unknown): PropertyProblem {
  if (err instanceof ApiError) {
    if (err.status === 503 || err.code === 'property_not_connected') return 'not_connected';
    if (err.status === 502 || err.code === 'property_unavailable') return 'unavailable';
  }
  return 'other';
}

const NOT_UNDERSTOOD = 'Figbloom Property sent something the console does not understand.';

export async function listPropertyWorkspaces(): Promise<PropertyWorkspacesList> {
  const result = await apiRequest<PropertyWorkspacesList>('GET', '/platform/property/workspaces');
  if (!Array.isArray(result?.workspaces)) throw new Error(NOT_UNDERSTOOD);
  return {
    workspaces: result.workspaces,
    truncated: !!result.truncated,
    platform: result.platform && result.platform.ok === false ? result.platform : { ok: true },
  };
}

/** One workspace, fresh from Property and the platform (the detail panel). */
export async function getPropertyWorkspace(id: string): Promise<PropertyWorkspace> {
  const result = await apiRequest<{ workspace?: PropertyWorkspace }>('GET', `/platform/property/workspaces/${encodeURIComponent(id)}`);
  if (!result?.workspace?.id) throw new Error(NOT_UNDERSTOOD);
  return result.workspace;
}

export async function setPropertyWorkspaceStatus(
  organizationId: string,
  action: PropertyAction,
  reason: string
): Promise<{ organization_id: string; status: string; status_reason: string | null } | null> {
  const trimmed = reason.trim();
  const result = await apiRequest<{ workspace?: { organization_id: string; status: string; status_reason: string | null } }>(
    'POST',
    `/platform/property/workspaces/${encodeURIComponent(organizationId)}/status`,
    { action, ...(trimmed ? { reason: trimmed } : {}) }
  );
  return result.workspace ?? null;
}

/**
 * The status shown: the platform's decision (an active one its owner switched off in Property is "deactivated"), else
 * Property's own (active or inactive), else not on the platform yet.
 */
export function statusOf(w: PropertyWorkspace): string {
  if (w.status) return w.status === 'active' && w.property_active === false ? 'deactivated' : w.status;
  if (w.property_active === true) return 'active';
  if (w.property_active === false) return 'inactive';
  return 'unregistered';
}

/**
 * What can be done to it now: suspend an active one (its owner's own switch-off included: the platform has it active),
 * reactivate a suspended one. Nothing until the platform knows it and its status came from the platform.
 */
export function propertyActions(w: PropertyWorkspace): PropertyAction[] {
  if (!w.organization_id || !w.status) return [];
  if (w.status === 'active') return ['suspend'];
  if (w.status === 'suspended') return ['reactivate'];
  return [];
}

/** Whether Property has registered it with the platform yet (it does so within a minute of sign-up). */
export const registered = (w: PropertyWorkspace) => !!(w.platform_organization_id || w.organization_id);

/**
 * The workspaces with this status ('all' for any) whose name, slug, creator or ID match; with hrRequested, only those
 * asking for HR & Payroll that isn't switched on yet, the longest waiting first.
 */
export function filterWorkspaces(
  list: PropertyWorkspace[],
  { status, search, hrRequested = false }: { status: string; search: string; hrRequested?: boolean }
): PropertyWorkspace[] {
  const q = search.trim().toLowerCase();
  const matches = (w: PropertyWorkspace) =>
    w.name.toLowerCase().includes(q) ||
    (w.slug ?? '').toLowerCase().includes(q) ||
    (w.creator_email ?? '').toLowerCase().includes(q) ||
    (w.creator_name ?? '').toLowerCase().includes(q) ||
    w.id.toLowerCase() === q;
  const shown = list.filter((w) => (status === 'all' || statusOf(w) === status) && (!q || matches(w)) && (!hrRequested || hrRequestPending(w)));
  return hrRequested ? shown.sort((a, b) => Date.parse(a.hr_requested_at!) - Date.parse(b.hr_requested_at!)) : shown;
}

export interface PropertyTotals {
  workspaces: number;
  active: number;
  suspended: number;
  deactivated: number;
  /** asking for HR & Payroll that isn't switched on yet */
  hr_requested: number;
  units: number;
}

export function propertyTotals(list: PropertyWorkspace[]): PropertyTotals {
  const count = (s: string) => list.filter((w) => statusOf(w) === s).length;
  return {
    workspaces: list.length,
    active: count('active'),
    suspended: count('suspended'),
    deactivated: count('deactivated'),
    hr_requested: list.filter(hrRequestPending).length,
    units: list.reduce((t, w) => t + (Number(w.units) || 0), 0),
  };
}

/** Switches HR & Payroll on for a Property workspace (its platform account). Returns its HR state now. */
export async function enablePropertyHr(platformTenantId: string): Promise<PropertyHr> {
  const result = await apiRequest<{ workspace?: { platform_tenant_id: string; hr?: PropertyHr } }>(
    'POST',
    `/platform/property/hr/${encodeURIComponent(platformTenantId)}/enable`
  );
  if (!result?.workspace?.hr) throw new Error('The Figbloom platform sent something the console does not understand.');
  return result.workspace.hr;
}

/** The list with one workspace's HR state replaced (after switching it on). */
export const withPropertyHr = (list: PropertyWorkspace[], platformTenantId: string, hr: PropertyHr) =>
  list.map((w) => (w.platform_tenant_id === platformTenantId ? { ...w, hr } : w));
