import { supabase } from './supabase';
import type { DirectoryEmployee } from './employeeDirectory';

/**
 * The staff portal's Company area (20261018800000_staff_company.sql): who approves the signed-in employee's leave,
 * before they apply, and the company's people with only what an organogram needs.
 */

/** The Company area's pages: the staff portal's tab ids. */
export const COMPANY_SECTIONS = [
  { id: 'company-calendar', label: 'Calendar' },
  { id: 'company-organogram', label: 'Organogram' },
  { id: 'company-departments', label: 'Departments' },
  { id: 'company-approvers', label: 'Who approves my leave' },
] as const;

export type CompanySection = (typeof COMPANY_SECTIONS)[number]['id'];

export const isCompanySection = (tab: string): tab is CompanySection => COMPANY_SECTIONS.some((s) => s.id === tab);

export interface MyChainStep {
  position: number;
  /** what the step is called ("Line manager", "HR", or the company's own label) */
  label: string;
  approver_type: string;
  approver_role?: string | null;
  /** who decides it, in words ("Max Manager", "Jane Doe or John Kamau", "HR") */
  who?: string | null;
  /** passed-over steps only: 'requester' (the approver is you) or 'no approver' (nobody in that place) */
  reason?: string | null;
}

export interface MyApprovalChain {
  kind: string;
  has_employee_record: boolean;
  steps: MyChainStep[];
  skipped: MyChainStep[];
  also_told: string[];
  /** every step is passed over, so an admin decides */
  admin_fallback: boolean;
}

export async function loadMyApprovalChain(kind = 'leave'): Promise<MyApprovalChain | null> {
  const { data, error } = await supabase.rpc('my_approval_chain', { p_kind: kind });
  if (error) throw error;
  if (!data) return null;
  const c = data as Partial<MyApprovalChain>;
  return {
    kind: c.kind || kind,
    has_employee_record: !!c.has_employee_record,
    steps: c.steps || [],
    skipped: c.skipped || [],
    also_told: c.also_told || [],
    admin_fallback: !!c.admin_fallback,
  };
}

/** "HR", "an admin", "Checker" */
export function roleName(role: string | null | undefined): string {
  const r = (role || '').trim().toUpperCase();
  if (!r) return 'someone';
  if (r === 'ADMIN') return 'an admin';
  if (r === 'HR') return 'HR';
  return r.charAt(0) + r.slice(1).toLowerCase().replace(/_/g, ' ');
}

const STANDARD_LABELS = ['Leave approver', 'Line manager', 'Department head'];
const isRoleToken = (s: string) => /^[A-Z][A-Z0-9_]{0,39}$/.test(s);

/** One step in words: "Max Manager (line manager)", "HR", "HR or Jane Doe", "Hana Hr (People lead)". */
export function stepText(step: MyChainStep): string {
  const label = (step.label || '').trim();
  const who = (step.who || '').trim();
  if (step.approver_type === 'role') {
    // "HR or CHECKER or Jane Doe": the roles in words, people as they are
    const parts = (who || step.approver_role || '').split(' or ').map((p) => (isRoleToken(p.trim()) ? roleName(p.trim()) : p.trim()));
    const text = parts.filter(Boolean).join(' or ') || roleName(step.approver_role);
    const custom = label && label !== 'Admin' && label.toUpperCase() !== (step.approver_role || '').toUpperCase();
    return custom ? `${text} (${label})` : text;
  }
  if (!who || who === label) return who || label;
  return `${who} (${STANDARD_LABELS.includes(label) ? label.toLowerCase() : label})`;
}

/** "Your leave goes to Max Manager (line manager), then HR." */
export function chainSentence(chain: MyApprovalChain, what = 'leave'): string {
  const parts = chain.steps.map(stepText);
  if (!parts.length) return '';
  return `Your ${what} goes to ${parts.join(', then ')}.`;
}

/** "HR is also told when it is decided." */
export function alsoToldSentence(chain: MyApprovalChain): string {
  if (!chain.also_told.length) return '';
  const names = chain.also_told.map(roleName);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${names.length === 1 ? 'is' : 'are'} also told when it is decided.`;
}

/** Why a step is passed over, for this employee. */
export function skipText(step: MyChainStep): string {
  return step.reason === 'requester'
    ? `${step.label}: skipped, because that is you`
    : `${step.label}: skipped, because you have nobody set here`;
}

interface CompanyDirectoryRow {
  id: string;
  employee_number: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  job_title: string | null;
  department_id: string | null;
  department: string | null;
  reports_to_id: string | null;
  photo: string | null;
}

/** The company's current employees, safe columns only (company_directory), in the shape the organogram draws. */
export async function loadCompanyDirectory(): Promise<DirectoryEmployee[]> {
  const { data, error } = await supabase.rpc('company_directory');
  if (error) throw error;
  return ((data || []) as CompanyDirectoryRow[]).map((r) => {
    const firstName = (r.first_name || '').trim();
    const middleName = (r.middle_name || '').trim();
    const lastName = (r.last_name || '').trim();
    return {
      employeeNumber: (r.employee_number || '').trim(),
      firstName,
      middleName,
      lastName,
      fullName: [firstName, middleName, lastName].filter(Boolean).join(' ') || 'Unknown employee',
      jobTitle: (r.job_title || '').trim(),
      branch: '',
      town: '',
      email: '',
      id: String(r.id ?? ''),
      departmentId: r.department_id || null,
      department: (r.department || '').trim(),
      reportsToId: r.reports_to_id || null,
      photo: (r.photo || '').trim(),
      status: 'Active',
    };
  });
}
