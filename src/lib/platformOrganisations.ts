import { supabase } from './supabase';

// Every company on the platform, for Figbloom's platform admins (/platform/organisations, migration
// 20261029100000_platform_organisations.sql). Everything comes from SECURITY DEFINER functions that check
// is_platform_admin(): the page never reads another company's tables. A new company waits for approval unless the
// auto-approve switch is on.

export type CompanyStatus = 'pending' | 'active' | 'rejected' | 'suspended';
export type CompanyAction = 'approve' | 'reject' | 'suspend' | 'reactivate';

export const COMPANY_STATUSES: CompanyStatus[] = ['pending', 'active', 'rejected', 'suspended'];

export const STATUS_LABELS: Record<CompanyStatus, string> = {
  pending: 'Waiting for approval',
  active: 'Active',
  rejected: 'Not approved',
  suspended: 'Suspended',
};

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: CompanyStatus;
  created_at: string;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  employees: number;
  users: number;
  payroll_runs: number;
  /** the latest sign-in of any of its members */
  last_activity: string | null;
  status_reason: string | null;
  status_changed_at: string | null;
  status_changed_by_email: string | null;
}

export interface OrganisationTotals {
  by_status: Record<CompanyStatus | 'total', number>;
  signups_by_week: { week: string; count: number }[];
  active_last_7_days: number;
  auto_approve: boolean;
}

/** The status of the company the signed-in person is working in (the app shows a waiting screen unless active). */
export interface MyCompanyStatus {
  tenant_id: string;
  name: string;
  status: CompanyStatus;
  status_reason: string | null;
  status_changed_at: string | null;
  /** other active companies they could switch to */
  other_active_companies: number;
}

const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

export async function listOrganisations(): Promise<Organisation[]> {
  const { data, error } = await supabase.rpc('platform_organisations');
  if (error) fail(error, 'Could not load the companies.');
  return ((data ?? []) as Organisation[]).map((o) => ({
    ...o,
    employees: Number(o.employees) || 0,
    users: Number(o.users) || 0,
    payroll_runs: Number(o.payroll_runs) || 0,
  }));
}

export async function organisationTotals(weeks = 8): Promise<OrganisationTotals> {
  const { data, error } = await supabase.rpc('platform_organisation_totals', { p_weeks: weeks });
  if (error) fail(error, 'Could not load the totals.');
  return data as OrganisationTotals;
}

/** Approve, reject (a reason is needed), suspend or reactivate a company. Returns its new status. */
export async function setCompanyStatus(id: string, action: CompanyAction, reason?: string | null): Promise<CompanyStatus> {
  const { data, error } = await supabase.rpc('set_company_status', { p_tenant: id, p_action: action, p_reason: reason?.trim() || null });
  if (error) fail(error, 'The company was not changed.');
  return data as CompanyStatus;
}

export async function setAutoApprove(on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_auto_approve_companies', { p_on: on });
  if (error) fail(error, 'The setting was not saved.');
  return data === true;
}

/** null when it cannot be told (the migration is not applied yet, or no company): the app then carries on as before. */
export async function myCompanyStatus(): Promise<MyCompanyStatus | null> {
  const { data, error } = await supabase.rpc('my_company_status');
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as MyCompanyStatus | undefined) ?? null;
}

/** The actions a company in this status offers. */
export function actionsFor(status: CompanyStatus): CompanyAction[] {
  switch (status) {
    case 'pending':
      return ['approve', 'reject'];
    case 'rejected':
      return ['approve'];
    case 'active':
      return ['suspend'];
    case 'suspended':
      return ['reactivate'];
    default:
      return [];
  }
}

export interface OrganisationFilter {
  status: CompanyStatus | 'all';
  search: string;
}

/** The companies matching the status filter and the name search (case and spaces ignored). */
export function filterOrganisations(list: Organisation[], { status, search }: OrganisationFilter): Organisation[] {
  const q = search.trim().toLowerCase();
  return list.filter((o) => (status === 'all' || o.status === status) && (!q || o.name.toLowerCase().includes(q)));
}
