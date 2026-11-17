import { supabase } from './supabase';
import { moduleInfo } from './modules';

// Approval workflows each company sets up (migration 20261015800000, FIG-829): per kind of request, an ordered chain of
// approvers. The database decides who may approve (decide_approval); these helpers read and save the chains.
// Loans, salary advances, expense claims and requisitions joined leave in 20261025700000 (FIG-1216).

export type ApprovalKind = 'leave' | 'salary_advance' | 'bulk_import' | 'loan' | 'expense' | 'requisition';
/** The kinds of money request: their approval writes the item's approval, and it joins Payments to make. */
export type MoneyKind = 'loan' | 'salary_advance' | 'expense' | 'requisition';
export type ApproverType = 'leave_approver' | 'reports_to' | 'department_head' | 'role' | 'person' | 'module';
export type AlternateType = 'role' | 'person';

export const APPROVAL_KINDS: { id: ApprovalKind; label: string; inUse: boolean }[] = [
  { id: 'leave', label: 'Leave', inUse: true },
  { id: 'loan', label: 'Loans', inUse: true },
  { id: 'salary_advance', label: 'Salary advance', inUse: true },
  { id: 'expense', label: 'Expense claims', inUse: true },
  { id: 'requisition', label: 'Requisitions', inUse: true },
  { id: 'bulk_import', label: 'Bulk import', inUse: false },
];

/** What a money request is called ("Loan request"), as the database says it. */
export const MONEY_KIND_NOUN: Record<MoneyKind, string> = {
  loan: 'Loan request',
  salary_advance: 'Salary advance',
  expense: 'Expense claim',
  requisition: 'Requisition',
};

// the fixed roles today (user_profiles.role)
export const APPROVER_ROLES = ['ADMIN', 'HR', 'CHECKER', 'MANAGER', 'REGIONAL', 'OPERATIONS', 'STAFF'];

export const APPROVER_TYPES: { id: ApproverType; label: string; hint: string }[] = [
  { id: 'leave_approver', label: 'Employee’s leave approver', hint: 'The Leave Approver on their record (or their Alternate Approver)' },
  { id: 'reports_to', label: 'Line manager', hint: 'The manager they report to' },
  { id: 'department_head', label: 'Department head', hint: 'The head of their department' },
  { id: 'role', label: 'Anyone with a role', hint: 'For example HR' },
  { id: 'person', label: 'A named person', hint: 'For example the CTO' },
  { id: 'module', label: 'Anyone who can…', hint: 'Everyone whose role has this ticked, for example Staff loans' },
];

/** The modules a "Anyone who can…" step offers: the ones that manage money, then the rest. */
export const APPROVER_MODULES = ['loans', 'salaryadmin', 'expenses', 'requisitions', 'payments', 'payroll', 'employees', 'hr-admin'];

export interface ApprovalStep {
  label?: string | null;
  approver_type: ApproverType;
  approver_role?: string | null;
  /** for a module step: the module whose holders approve ('loans') */
  approver_module?: string | null;
  approver_employee_number?: string | null;
  approver_name?: string | null;
  alternate_type?: AlternateType | null;
  alternate_role?: string | null;
  alternate_employee_number?: string | null;
  alternate_name?: string | null;
  skip_if_requester?: boolean;
}

export interface ApprovalWorkflow {
  kind: ApprovalKind;
  admins_can_act: boolean;
  /** roles told when a request is finally approved or rejected, without being a step (FIG-878) */
  notify_roles?: string[];
  department_head_available: boolean;
  steps: ApprovalStep[];
}

export type ChainStepStatus = 'approved' | 'rejected' | 'skipped' | 'current' | 'upcoming' | 'not_reached';

export interface ChainStep {
  position: number;
  label: string;
  approver_type: ApproverType;
  status: ChainStepStatus;
  waiting_on: string | null;
  actor_name: string | null;
  acted_as: string | null;
  comment: string | null;
  acted_at: string | null;
}

export interface ApprovalChain {
  record_id: string;
  request_id: string;
  status: 'pending' | 'approved' | 'rejected';
  current_step: number;
  can_approve: boolean;
  can_reject: boolean;
  steps: ChainStep[];
  /** the signed-in person may send this approved leave back to pending (reopen-leave, before it starts) */
  can_reopen?: boolean;
  /** the last time it was sent back to pending; the steps show only what was decided since */
  reopened?: { actor_name: string | null; comment: string | null; acted_at: string | null } | null;
}

/** What a step is called: its own label, else what its approver is ("Line manager", "HR", "Jane Doe"). */
export function stepLabel(step: ApprovalStep): string {
  if (step.label?.trim()) return step.label.trim();
  switch (step.approver_type) {
    case 'leave_approver':
      return 'Leave approver';
    case 'reports_to':
      return 'Line manager';
    case 'department_head':
      return 'Department head';
    case 'role':
      return step.approver_role || 'Role';
    case 'person':
      return step.approver_name || step.approver_employee_number || 'Person';
    case 'module':
      return (step.approver_module && moduleInfo(step.approver_module)?.name) || step.approver_module || 'Module';
  }
}

/** "Leave: Line manager → HR → CTO" */
export function chainPreview(kind: ApprovalKind, steps: ApprovalStep[]): string {
  const name = APPROVAL_KINDS.find((k) => k.id === kind)?.label ?? kind;
  return `${name}: ${steps.length ? steps.map(stepLabel).join(' → ') : 'no steps'}`;
}

/** What is wrong with a step, or null. */
export function stepError(step: ApprovalStep): string | null {
  if (step.approver_type === 'role' && !step.approver_role) return 'Choose the role';
  if (step.approver_type === 'person' && !step.approver_employee_number) return 'Choose who approves';
  if (step.approver_type === 'module' && !step.approver_module) return 'Choose what the approvers can do';
  if (step.alternate_type === 'role' && !step.alternate_role) return 'Choose the alternate’s role';
  if (step.alternate_type === 'person' && !step.alternate_employee_number) return 'Choose the alternate';
  if ((step.label?.length ?? 0) > 60) return 'The name may be up to 60 characters';
  return null;
}

/** The company's workflow for a kind (today's chain until it is changed); null when it cannot be read. */
export async function loadApprovalWorkflow(kind: ApprovalKind): Promise<ApprovalWorkflow | null> {
  const { data, error } = await supabase.rpc('approval_workflow', { p_kind: kind });
  if (error || !data) return null;
  return data as ApprovalWorkflow;
}

/** Saves the steps in order. Throws with the reason when refused. */
export async function saveApprovalWorkflow(kind: ApprovalKind, steps: ApprovalStep[], adminsCanAct: boolean, notifyRoles: string[] = []): Promise<void> {
  const payload = steps.map((s) => ({
    label: s.label?.trim() || null,
    approver_type: s.approver_type,
    approver_role: s.approver_type === 'role' ? s.approver_role : null,
    approver_module: s.approver_type === 'module' ? s.approver_module : null,
    approver_employee_number: s.approver_type === 'person' ? s.approver_employee_number : null,
    alternate_type: s.alternate_type || null,
    alternate_role: s.alternate_type === 'role' ? s.alternate_role : null,
    alternate_employee_number: s.alternate_type === 'person' ? s.alternate_employee_number : null,
    skip_if_requester: s.skip_if_requester ?? true,
  }));
  const { error } = await supabase.rpc('save_approval_workflow', {
    p_kind: kind,
    p_steps: payload,
    p_admins_can_act: adminsCanAct,
    p_notify_roles: notifyRoles,
  });
  if (error) throw new Error(error.message);
}

/** The approval chain of each of these records, by record id (only the ones the signed-in person may see). */
export async function loadApprovalChains(kind: ApprovalKind, recordIds: string[]): Promise<Record<string, ApprovalChain>> {
  if (!recordIds.length) return {};
  const { data, error } = await supabase.rpc('approval_chains', { p_kind: kind, p_record_ids: recordIds });
  if (error) throw new Error(error.message);
  return Object.fromEntries(((data || []) as ApprovalChain[]).map((c) => [c.record_id, c]));
}

/** Approves or rejects the current step. Returns the request's status after it ('pending' while later steps remain). */
export async function decideApproval(requestId: string, decision: 'approved' | 'rejected', comment: string): Promise<'pending' | 'approved' | 'rejected'> {
  const { data, error } = await supabase.rpc('decide_approval', { p_request: requestId, p_decision: decision, p_comment: comment || null });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { status: 'pending' | 'approved' | 'rejected' } | null;
  return row?.status ?? 'pending';
}

/** Sends approved leave back to pending (a reason is required); the chain starts again. Throws with the reason when refused. */
export async function reopenLeave(leaveId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_leave', { p_application: leaveId, p_reason: reason });
  if (error) throw new Error(error.message);
}

export interface LeaveAwaitingMe {
  request_id: string;
  record_id: string;
  employee_number: string;
  name: string | null;
  leave_type: string | null;
  start_date: string | null;
  end_date: string | null;
  days: number | null;
  reason: string | null;
  step_label: string;
  time_added: string | null;
}

/** Leave waiting on the signed-in person's decision (as an approver, not just as an admin). */
export async function loadLeaveAwaitingMe(): Promise<LeaveAwaitingMe[]> {
  const { data, error } = await supabase.rpc('my_leave_approvals');
  if (error) throw new Error(error.message);
  return (data || []) as LeaveAwaitingMe[];
}

export interface MoneyAwaitingMe {
  request_id: string;
  kind: MoneyKind;
  record_id: string;
  employee_number: string | null;
  /** "Jane Doe's loan request of KES 30,000.00 over 6 months" */
  summary: string;
  step_label: string;
  created_at: string;
}

/** Loans, advances, expense claims and requisitions waiting on the signed-in person's decision (not just as an admin). */
export async function loadMoneyAwaitingMe(): Promise<MoneyAwaitingMe[]> {
  const { data, error } = await supabase.rpc('my_money_approvals');
  if (error) throw new Error(error.message);
  return (data || []) as MoneyAwaitingMe[];
}
