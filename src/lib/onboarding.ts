import { supabase } from './supabase';
import { NOT_SAVED_NOT_LINKED, requireUpdatedRows } from './requireUpdated';
import { chunks } from './fetchAll';
import { inviteEmployee, type InviteOutcome } from './employeeInvite';
import type { EmployeeRecord } from './profileCompleteness';
import type { OnboardingStatus } from './onboardingValidation';
import type { StatusTone } from '../components/UI';

// Onboarding (FIG-765): HR adds an employee and invites them; the employee fills in their part and submits; HR
// approves or sends it back with a comment. The rules live in the database (20261012100000, 20261012200000); this is
// how the screens talk to it.

export const STATUS_LABELS: Record<OnboardingStatus, string> = {
  draft: 'Not invited',
  invited: 'Invited',
  submitted: 'Waiting for review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
};

export const STATUS_TONES: Record<OnboardingStatus, StatusTone> = {
  draft: 'neutral',
  invited: 'info',
  submitted: 'warning',
  changes_requested: 'danger',
  approved: 'success',
};

export const statusLabel = (status: unknown) => STATUS_LABELS[status as OnboardingStatus] ?? 'Not invited';
export const statusTone = (status: unknown): StatusTone => STATUS_TONES[status as OnboardingStatus] ?? 'neutral';

/** The fields of the employee's part of the form, as the employees table names them. */
export const EMPLOYEE_FORM_FIELDS = [
  'Last Name', 'First Name', 'Middle Name', 'preferred_name', 'Date of Birth', 'Gender', 'nationality', 'Marital Status',
  'residential_address', 'permanent_address', 'Personal Email', 'Mobile Number', 'Alternative Mobile Number',
  'Type of Identification', 'ID Number', 'Tax PIN', 'SHIF Number', 'NSSF Number', 'kra_residency', 'is_pwd',
  'Disability Cert No', 'mortgage_interest', 'insurance_premium', 'Bank', 'Bank Branch', 'account_number_name',
  'Account Number', 'bank_code', 'branch_code', 'bank_paybill',
] as const;

/** HR's part, entered on the add and edit employee pages. */
export const EMPLOYER_PAY_FIELDS = [
  'kra_employee_type', 'other_cash_allowances', 'car_benefit', 'meals_benefit', 'non_cash_benefit', 'housing_benefit',
  'other_benefits', 'other_pension_contribution', 'post_retirement_medical_fund', 'nssf_voluntary_contribution',
] as const;

export interface Contact {
  full_name: string;
  relationship: string;
  phone_number: string;
  alternative_phone: string;
  email: string;
  physical_address: string;
}

export const emptyContact = (): Contact => ({ full_name: '', relationship: '', phone_number: '', alternative_phone: '', email: '', physical_address: '' });

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());

const toContact = (row: Record<string, unknown> | null | undefined): Contact => ({
  full_name: text(row?.full_name),
  relationship: text(row?.relationship),
  phone_number: text(row?.phone_number),
  alternative_phone: text(row?.alternative_phone),
  email: text(row?.email),
  physical_address: text(row?.physical_address),
});

const contactFilled = (c: Contact) => Boolean(c.full_name && c.phone_number);

/** Something the employee can give after approval (20261021700000): a detail, a referee, a policy or a document. */
export interface FollowUp {
  /** the item's key, as Settings names it (documents, referee, policies, sex...) */
  item_key: string;
  /** the item as the missing-lists name it, e.g. "Referee" or "Document: Updated CV" */
  item: string;
  /** where a document is: "waiting for HR" or "rejected, upload again" */
  note: string | null;
  /** HR's due date (YYYY-MM-DD) */
  due_date: string | null;
  overdue: boolean;
}

export interface MissingParts {
  /** everything the employee has not given yet (for display) */
  employee: string[];
  /** everything HR has not entered yet */
  employer: string[];
  /** required documents not yet uploaded and accepted */
  documentsOutstanding: string[];
  /** what blocks submitting: the company's essentials the employee has not given */
  essentialsEmployee: string[];
  /** what else blocks approving: HR's part (and documents to review, when the company makes documents essential) */
  essentialsEmployer: string[];
  /** what can follow later (on an approved record: everything still outstanding) */
  followUps: FollowUp[];
}

export interface ReviewEvent {
  action: string;
  comment: string | null;
  changed_fields: string[] | null;
  created_at: string;
}

export interface OnboardingRecord {
  employee: EmployeeRecord;
  emergency: Contact;
  nextOfKin: Contact;
  missing: MissingParts;
  history: ReviewEvent[];
}

/** The message a database error carries (they are plain objects, not Errors), or the fallback. */
export const errorMessage = (err: unknown, fallback: string): string => {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
};

const fail = (err: unknown, fallback: string): never => {
  throw new Error(errorMessage(err, fallback));
};

async function loadParts(employee: EmployeeRecord, employeeId: string | null): Promise<OnboardingRecord> {
  const number = text(employee['Employee Number']);
  const [emergency, nextOfKin, missing, history] = await Promise.all([
    supabase.from('emergency_contact').select('*').eq('Employee Number', number).maybeSingle(),
    supabase.from('next_of_kin').select('*').eq('Employee Number', number).maybeSingle(),
    supabase.rpc('onboarding_missing_for', employeeId ? { p_employee: employeeId } : {}),
    supabase
      .from('employee_onboarding_reviews')
      .select('action, comment, changed_fields, created_at')
      .eq('employee_id', String(employee['id']))
      .order('created_at', { ascending: false }),
  ]);
  for (const r of [emergency, nextOfKin, missing, history]) if (r.error) fail(r.error, 'Could not load the onboarding details.');
  const parts = (Array.isArray(missing.data) ? missing.data[0] : missing.data) as
    | {
        employee_part?: string[];
        employer_part?: string[];
        documents_outstanding?: string[];
        essentials_employee?: string[];
        essentials_employer?: string[];
        followups?: FollowUp[];
      }
    | null;
  return {
    employee,
    emergency: toContact(emergency.data),
    nextOfKin: toContact(nextOfKin.data),
    missing: {
      employee: parts?.employee_part ?? [],
      employer: parts?.employer_part ?? [],
      documentsOutstanding: parts?.documents_outstanding ?? [],
      essentialsEmployee: parts?.essentials_employee ?? [],
      essentialsEmployer: parts?.essentials_employer ?? [],
      followUps: parts?.followups ?? [],
    },
    history: (history.data ?? []) as ReviewEvent[],
  };
}

// ---------------------------------------------------------------------------------------------
// the employee
// ---------------------------------------------------------------------------------------------
/** The signed-in employee's own record (found by their login email, as the rest of the staff portal does). Null when not linked. */
export async function loadMyOnboarding(): Promise<OnboardingRecord | null> {
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return null;
  const { data, error } = await supabase.from('employees').select('*').eq('Work Email', email).maybeSingle();
  if (error) fail(error, 'Could not load your record.');
  if (!data) return null;
  return loadParts(data as EmployeeRecord, null);
}

const contactRow = (employeeNumber: string, c: Contact) => ({
  'Employee Number': employeeNumber,
  full_name: c.full_name.trim(),
  relationship: c.relationship.trim(),
  phone_number: c.phone_number.trim(),
  alternative_phone: c.alternative_phone.trim() || null,
  email: c.email.trim() || null,
  physical_address: c.physical_address.trim() || null,
});

/**
 * Saves the employee's part: only their own fields (the database refuses the rest), then the emergency contact and
 * next of kin. A contact without a name and phone number is not saved.
 */
export async function saveMyOnboarding(employeeNumber: string, values: EmployeeRecord, emergency: Contact, nextOfKin: Contact) {
  const changes: Record<string, unknown> = {};
  for (const field of EMPLOYEE_FORM_FIELDS) {
    if (!(field in values)) continue;
    const v = values[field];
    changes[field] = typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v;
  }
  const { data, error } = await supabase.from('employees').update(changes).eq('Employee Number', employeeNumber).select('"Employee Number"');
  if (error) fail(error, 'Your details were not saved.');
  requireUpdatedRows(data, NOT_SAVED_NOT_LINKED);

  if (contactFilled(emergency)) {
    const r = await supabase.from('emergency_contact').upsert(contactRow(employeeNumber, emergency), { onConflict: 'tenant_id,Employee Number' });
    if (r.error) fail(r.error, 'The emergency contact was not saved.');
  }
  if (contactFilled(nextOfKin)) {
    const r = await supabase.from('next_of_kin').upsert(contactRow(employeeNumber, nextOfKin), { onConflict: 'tenant_id,Employee Number' });
    if (r.error) fail(r.error, 'The next of kin was not saved.');
  }
}

/** Sends the signed-in employee's record to HR. The database says what is still missing if it can't. */
export async function submitMyOnboarding() {
  const { error } = await supabase.rpc('submit_onboarding', {});
  if (error) fail(error, 'Your details could not be submitted.');
}

// ---------------------------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------------------------
export interface OverviewRow {
  id: string;
  employee_number: string;
  payroll_number: string;
  name: string;
  job_title: string | null;
  work_email: string | null;
  status: OnboardingStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  employee_part: string[];
  employer_part: string[];
  documents_outstanding: string[];
  /** what still blocks approving (the employee's essentials and HR's part) */
  essentials_missing: string[];
  /** still to provide: what can follow later */
  followups: string[];
  /** how many of them are past HR's due date */
  followups_overdue: number;
}

export async function loadOnboardingOverview(): Promise<OverviewRow[]> {
  const { data, error } = await supabase.rpc('onboarding_overview');
  if (error) fail(error, 'Could not load onboarding.');
  return (data ?? []) as OverviewRow[];
}

/** One employee's record for HR to review. */
export async function loadOnboardingForReview(employeeId: string): Promise<OnboardingRecord> {
  const { data, error } = await supabase.from('employees').select('*').eq('id', employeeId).maybeSingle();
  if (error) fail(error, 'Could not load the employee.');
  if (!data) throw new Error('Employee not found.');
  return loadParts(data as EmployeeRecord, employeeId);
}

/** Marks the record as invited. Used after the invitation email is sent. */
export async function startOnboarding(employeeId: string) {
  const { error } = await supabase.rpc('start_onboarding', { p_employee: employeeId });
  if (error) fail(error, 'Could not start onboarding.');
}

/**
 * Emails the invitation to the employee's work email and marks the record invited. Never throws: the outcome says
 * what happened (an invitation that was made but not emailed still counts, the link can be sent by hand).
 */
export async function inviteToOnboard(
  employeeId: string,
  workEmail: string | null | undefined,
  as: { role: string; companyRoleId: string | null } = { role: 'STAFF', companyRoleId: null }
): Promise<InviteOutcome> {
  const outcome = await inviteEmployee(workEmail, as.role, as.companyRoleId);
  if (outcome.status === 'failed') return outcome;
  try {
    await startOnboarding(employeeId);
  } catch (err) {
    return { status: 'failed', email: outcome.email, reason: errorMessage(err, 'Could not start onboarding.') };
  }
  return outcome;
}

/** Work emails per start_onboarding_by_email call (the database takes up to 1000). */
export const START_ONBOARDING_BATCH_SIZE = 500;

/**
 * After invitations were queued for employees added in bulk: marks those still drafts as invited, found by work
 * email, a chunk at a time in one database call each (start_onboarding_by_email). Returns how many emails were in
 * chunks that could not be marked (those stay drafts and can be invited from the Onboarding page).
 */
export async function startOnboardingByEmail(emails: string[], batchSize = START_ONBOARDING_BATCH_SIZE): Promise<number> {
  let failed = 0;
  for (const chunk of chunks(emails, batchSize)) {
    const { error } = await supabase.rpc('start_onboarding_by_email', { p_emails: chunk });
    if (error) failed += chunk.length;
  }
  return failed;
}

export async function approveOnboarding(employeeId: string, comment?: string) {
  const { error } = await supabase.rpc('review_onboarding', { p_employee: employeeId, p_decision: 'approve', p_comment: comment?.trim() || null });
  if (error) fail(error, 'Could not approve.');
}

export async function requestOnboardingChanges(employeeId: string, comment: string) {
  if (!comment.trim()) throw new Error('Say what needs changing.');
  const { error } = await supabase.rpc('review_onboarding', { p_employee: employeeId, p_decision: 'request_changes', p_comment: comment.trim() });
  if (error) fail(error, 'Could not send it back.');
}

/** Removes an employee's photo (HR may remove one, never upload one). The employee then uploads a new one. */
export async function removeEmployeePhoto(employeeNumber: string) {
  const { data, error } = await supabase.from('employees').update({ 'Profile Image': null }).eq('Employee Number', employeeNumber).select('"Employee Number"');
  if (error) fail(error, 'The photo was not removed.');
  requireUpdatedRows(data, 'The photo was not removed: you may not change this employee.');
}

/** HR sets (or, with null, clears) the due date of an item still to provide. */
export async function setFollowUpDueDate(employeeId: string, item: string, dueDate: string | null) {
  const { error } = await supabase.rpc('set_onboarding_followup_due', { p_employee: employeeId, p_item: item, p_due: dueDate || null });
  if (error) fail(error, 'The due date was not saved.');
}

/** "Updated CV (due 30 Oct 2026, overdue)": one follow-up as a line of text. */
export function followUpText(f: FollowUp): string {
  const extras = [
    f.note,
    f.due_date ? `due ${new Date(`${f.due_date}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}` : null,
    f.overdue ? 'overdue' : null,
  ].filter(Boolean);
  return extras.length ? `${f.item} (${extras.join(', ')})` : f.item;
}

// ---------------------------------------------------------------------------------------------
// the company's essentials (Settings)
// ---------------------------------------------------------------------------------------------
export interface EssentialItem {
  item_key: string;
  label: string;
  section: string;
  essential: boolean;
  default_essential: boolean;
  /** why payroll needs it, when it does: Settings warns before it is made optional */
  payroll_note: string | null;
}

export interface OnboardingSettings {
  reminder_every_days: number;
  customised: boolean;
  items: EssentialItem[];
}

export async function loadOnboardingSettings(): Promise<OnboardingSettings> {
  const { data, error } = await supabase.rpc('onboarding_settings');
  if (error) fail(error, 'Could not load the onboarding settings.');
  return data as OnboardingSettings;
}

/** Saves which items are essential (the rest can follow later) and how often employees are reminded. */
export async function saveOnboardingSettings(essentialKeys: string[], reminderEveryDays: number): Promise<OnboardingSettings> {
  const { data, error } = await supabase.rpc('save_onboarding_settings', { p_essential_items: essentialKeys, p_reminder_every_days: reminderEveryDays });
  if (error) fail(error, 'The onboarding settings were not saved.');
  return data as OnboardingSettings;
}
