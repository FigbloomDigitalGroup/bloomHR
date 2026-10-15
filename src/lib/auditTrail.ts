import { supabase } from './supabase';

// The audit trail: audit_log rows written by the audit_row_change() trigger (only the fields that changed on an update,
// the whole row on an insert or delete), plus a VIEW row whenever someone opens another person's health records.
// ADMIN and people with Settings read every row (RLS module_read); nobody edits them.

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'VIEW';

export interface AuditEntry {
  id: string;
  performed_at: string;
  performed_by: string | null;
  action_type: string | null;
  table_name: string | null;
  record_id: string | null;
  record_key: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

export interface AuditFilters {
  table?: string;
  action?: AuditAction | '';
  /** yyyy-mm-dd, inclusive */
  from?: string;
  /** yyyy-mm-dd, inclusive */
  to?: string;
  /** an employee number or record id */
  record?: string;
}

export const AUDIT_PAGE_SIZE = 50;

/** What each audited table is called on screen; anything not listed shows its table name tidied up. */
export const AUDIT_TABLE_LABELS: Record<string, string> = {
  employees: 'Employee record',
  emergency_contact: 'Emergency contact',
  next_of_kin: 'Next of kin',
  employee_documents: 'Employee document',
  employee_referees: 'Referee',
  employee_document_requirements: 'Document requirement',
  employee_health_records: 'Health record',
  employee_health_files: 'Health file',
  employee_health_consents: 'Health consent',
  employee_onboarding_reviews: 'Onboarding review',
  employee_deductions: 'Deduction',
  employee_exits: 'Exit',
  employee_exit_clearance_items: 'Exit clearance',
  employee_exit_final_dues: 'Final dues',
  company_profile: 'Company profile',
  company_logo: 'Company logo',
  company_payroll_settings: 'Payroll settings',
  company_policies: 'Company policy',
  company_policy_versions: 'Policy version',
  policy_acceptances: 'Policy acceptance',
  careers_settings: 'Careers page',
  departments: 'Department',
  job_groups: 'Job group',
  job_group_rates: 'Job group pay',
  statutory_rates: 'Statutory rate',
  payroll_runs: 'Payroll run',
  salary_history: 'Salary change',
  salary_advance: 'Salary advance',
  loan_requests: 'Staff loan',
  expenses: 'Expense',
  work_types: 'Piece-rate work type',
  work_entries: 'Piece-rate work',
  contract_jobs: 'Contract job',
  leave_application: 'Leave application',
  hr_leave_schedules: 'Leave schedule',
  hr_lifecycle_history: 'Lifecycle event',
  hr_suspensions: 'Suspension',
  warnings: 'Warning',
  incident_reports: 'Incident report',
  phone_number_change_requests: 'Phone number change',
  job_postings: 'Job posting',
  job_applications: 'Job application',
  job_offers: 'Job offer',
  recruitment_stages: 'Recruitment stage',
  recruitment_interviews: 'Interview',
  interview_panelists: 'Interview panelist',
  interview_scorecards: 'Interview scorecard',
  interview_transcripts: 'Interview transcript',
  scorecard_ratings: 'Scorecard rating',
  orientation_templates: 'Orientation template',
  required_training: 'Required training',
  quizzes: 'Quiz',
  assets: 'Asset',
  todos: 'Task',
  tenants: 'Company',
};

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  INSERT: 'Added',
  UPDATE: 'Changed',
  DELETE: 'Deleted',
  VIEW: 'Viewed',
};

export const tableLabel = (t: string | null) => {
  if (!t) return 'Unknown';
  if (AUDIT_TABLE_LABELS[t]) return AUDIT_TABLE_LABELS[t];
  const words = t.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const actionLabel = (a: string | null) => AUDIT_ACTION_LABELS[(a ?? '').toUpperCase() as AuditAction] ?? (a || 'Unknown');

// bookkeeping columns nobody needs to see in a change
const HIDDEN_FIELDS = new Set(['id', 'tenant_id', 'created_at', 'updated_at']);

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** The fields an entry touched, in a stable order: before and after for a change, one side for an add or delete. */
export function fieldChanges(e: Pick<AuditEntry, 'old_data' | 'new_data'>): FieldChange[] {
  const keys = new Set([...Object.keys(e.old_data ?? {}), ...Object.keys(e.new_data ?? {})]);
  return [...keys]
    .filter((k) => !HIDDEN_FIELDS.has(k))
    .sort((a, b) => a.localeCompare(b))
    .map((k) => ({ field: k, before: e.old_data?.[k] ?? null, after: e.new_data?.[k] ?? null }));
}

/** A field name as people read it: employee_number and "Employee Number" both become "Employee number". */
export const fieldLabel = (f: string) => {
  const words = f.replace(/_/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A stored value as text: blank for nothing, Yes/No for flags, JSON for anything structured. */
export const valueText = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** One page of the company's audit trail, newest first, and whether there is another page after it. */
export async function loadAuditTrail(filters: AuditFilters, page: number): Promise<{ rows: AuditEntry[]; more: boolean }> {
  let q = supabase
    .from('audit_log')
    .select('id, performed_at, performed_by, action_type, table_name, record_id, record_key, old_data, new_data')
    .order('performed_at', { ascending: false })
    .order('id', { ascending: false });
  if (filters.table) q = q.eq('table_name', filters.table);
  if (filters.action) q = q.eq('action_type', filters.action);
  if (filters.from) q = q.gte('performed_at', new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    q = q.lt('performed_at', end.toISOString());
  }
  const record = filters.record?.trim();
  if (record) q = q.ilike('record_key', `%${record.replace(/[%_]/g, (c) => `\\${c}`)}%`);

  // one extra row says whether there is a next page
  const start = page * AUDIT_PAGE_SIZE;
  const { data, error } = await q.range(start, start + AUDIT_PAGE_SIZE);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AuditEntry[];
  return { rows: rows.slice(0, AUDIT_PAGE_SIZE), more: rows.length > AUDIT_PAGE_SIZE };
}

/** Names for the people who made the changes, by their sign-in id. */
export async function loadAuditPeople(ids: string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return {};
  const { data, error } = await supabase.from('user_profiles').select('user_id, full_name, email').in('user_id', wanted);
  if (error) return {};
  const names: Record<string, string> = {};
  for (const p of (data ?? []) as { user_id: string; full_name: string | null; email: string | null }[]) {
    names[p.user_id] = p.full_name || p.email || 'Unknown user';
  }
  return names;
}
