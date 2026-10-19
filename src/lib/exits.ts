import { supabase } from './supabase';
import { currentUserAndTenant, randomFileName } from './privateFiles';
import { deductionsForPeriod, type DeductionType, type EmployeeDeduction } from './voluntaryDeductions';
import { finalDuesLines, leaveDaysOutstanding, periodOf, type FinalDuesInput, type FinalDuesLine } from './finalDues';

/**
 * Exits (FIG-832): resignations and terminations (table employee_exits, see 20261016400000_exits.sql). The database
 * enforces who may do what; these are the screens' reads and writes.
 */

export type ExitKind = 'resignation' | 'termination';
export type ExitStatus = 'requested' | 'approved' | 'clearance' | 'completed' | 'declined' | 'cancelled';

export interface ExitRecord {
  id: string;
  employee_number: string;
  kind: ExitKind;
  reason_category: string | null;
  reason: string | null;
  notice_given_on: string;
  notice_days: number;
  last_working_day: string;
  notice_pay: boolean;
  letter_path: string | null;
  status: ExitStatus;
  decision_note: string | null;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  access_ended_at: string | null;
  completed_at: string | null;
  created_at: string;
  /** filled in from the directory */
  employee_name?: string;
}

export interface ClearanceItem {
  id: string;
  exit_id: string;
  category: 'assets' | 'it' | 'finance' | 'handover' | 'other';
  title: string;
  owner: string | null;
  asset_id: string | null;
  done: boolean;
  done_at: string | null;
  notes: string | null;
  sort_order: number;
}

export interface InterviewAnswer {
  question: string;
  answer: string;
}

export interface ExitInterview {
  id?: number;
  interview_date: string | null;
  interviewer: string | null;
  answers: InterviewAnswer[];
  is_completed: boolean;
}

export interface FinalDuesRecord {
  id: string;
  exit_id: string;
  lines: FinalDuesLine[];
  earnings: number;
  deductions: number;
  net: number;
  status: 'draft' | 'reviewed' | 'included';
  payroll_period: string | null;
}

export const OPEN_STATUSES: ExitStatus[] = ['requested', 'approved', 'clearance'];

export const STAGES: { id: ExitStatus; label: string }[] = [
  { id: 'requested', label: 'Requested' },
  { id: 'approved', label: 'Approved' },
  { id: 'clearance', label: 'Clearance' },
  { id: 'completed', label: 'Completed' },
];

export const STATUS_LABEL: Record<ExitStatus, string> = {
  requested: 'Awaiting approval',
  approved: 'Approved',
  clearance: 'Clearance',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

/** A resignation still under way: sent and waiting for HR, accepted, or serving notice through clearance. */
export const OPEN_EXIT_STATUSES: readonly ExitStatus[] = ['requested', 'approved', 'clearance'];

/** The one exit still under way (the newest), if any; withdrawn, declined and completed ones are history. */
export const findOpenExit = (exits: ExitRecord[]): ExitRecord | undefined => exits.find((x) => OPEN_EXIT_STATUSES.includes(x.status));

export const REASON_CATEGORIES: { id: string; label: string }[] = [
  { id: 'misconduct', label: 'Misconduct' },
  { id: 'poor_performance', label: 'Poor performance' },
  { id: 'redundancy', label: 'Redundancy' },
  { id: 'contract_end', label: 'End of contract' },
  { id: 'medical', label: 'Medical / incapacity' },
  { id: 'mutual_agreement', label: 'Mutual agreement' },
  { id: 'other', label: 'Other' },
];

export const reasonLabel = (exit: Pick<ExitRecord, 'kind' | 'reason_category'>) =>
  exit.kind === 'resignation' ? 'Resignation' : REASON_CATEGORIES.find((r) => r.id === exit.reason_category)?.label ?? 'Termination';

/** The notice period when the contract doesn't say (Employment Act s.35: 28 days for monthly pay); the database agrees. */
export const DEFAULT_NOTICE_DAYS = 28;

export const DEFAULT_INTERVIEW_QUESTIONS = [
  'What is your main reason for leaving?',
  'What did you enjoy most about working here?',
  'What could we have done better?',
  'How was your relationship with your manager?',
  'Would you recommend us as an employer? Why or why not?',
  'Would you consider coming back in the future?',
];

/** YYYY-MM-DD, n days after a YYYY-MM-DD day. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The earliest last working day a resignation given today may have. */
export const earliestLastDay = (noticeDays: number | null | undefined, from = today()) => addDays(from, noticeDays ?? DEFAULT_NOTICE_DAYS);

const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

const EXIT_COLUMNS =
  'id, employee_number, kind, reason_category, reason, notice_given_on, notice_days, last_working_day, notice_pay, letter_path, status, decision_note, requested_by, decided_by, decided_at, access_ended_at, completed_at, created_at';

async function withNames(exits: ExitRecord[]): Promise<ExitRecord[]> {
  const numbers = [...new Set(exits.map((x) => x.employee_number))];
  if (!numbers.length) return exits;
  const { data } = await supabase.from('employee_directory').select('"Employee Number", "First Name", "Last Name"').in('"Employee Number"', numbers);
  const names = new Map(
    ((data ?? []) as Record<string, string | null>[]).map((r) => [
      String(r['Employee Number']),
      [r['First Name'], r['Last Name']].filter(Boolean).join(' '),
    ])
  );
  return exits.map((x) => ({ ...x, employee_name: names.get(x.employee_number) || x.employee_number }));
}

// ---------------------------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------------------------
/** Every exit in the company, newest first. Also ends access for anyone whose last day has passed. */
export async function listExits(): Promise<ExitRecord[]> {
  await supabase.rpc('end_due_exit_access');
  const { data, error } = await supabase.from('employee_exits').select(EXIT_COLUMNS).order('created_at', { ascending: false });
  if (error) fail(error, 'Could not load exits.');
  return withNames((data ?? []) as ExitRecord[]);
}

export async function loadExit(id: string): Promise<ExitRecord> {
  const { data, error } = await supabase.from('employee_exits').select(EXIT_COLUMNS).eq('id', id).maybeSingle();
  if (error || !data) fail(error, 'Could not load this exit.');
  return (await withNames([data as ExitRecord]))[0];
}

export interface NewExit {
  employee_number: string;
  kind: ExitKind;
  reason_category?: string | null;
  reason?: string | null;
  notice_given_on?: string;
  notice_days?: number | null;
  last_working_day: string;
  notice_pay?: boolean;
  letter_path?: string | null;
}

export async function startExit(exit: NewExit): Promise<ExitRecord> {
  const { data, error } = await supabase.from('employee_exits').insert(exit).select(EXIT_COLUMNS).single();
  if (error) fail(error, 'Could not start the exit.');
  return data as ExitRecord;
}

export async function updateExit(id: string, changes: Partial<Pick<ExitRecord, 'reason' | 'reason_category' | 'last_working_day' | 'notice_days' | 'notice_pay' | 'notice_given_on'>>) {
  const { error } = await supabase.from('employee_exits').update(changes).eq('id', id);
  if (error) fail(error, 'Could not save the exit.');
}

/**
 * Approve or decline. The built-in approval (HR or an administrator, not whoever started it) is checked by the
 * database's exit_decision_refusal(); when approval workflows arrive, route this through them instead.
 */
export async function decideExit(id: string, decision: 'approved' | 'declined', note: string) {
  const { error } = await supabase.from('employee_exits').update({ status: decision, decision_note: note.trim() || null }).eq('id', id);
  if (error) fail(error, 'Could not save the decision.');
}

export async function cancelExit(id: string) {
  const { error } = await supabase.from('employee_exits').update({ status: 'cancelled' }).eq('id', id);
  if (error) fail(error, 'Could not cancel the exit.');
}

/** Ends their access (if it hasn't ended) and closes the exit; the checklist must be done. */
export async function completeExit(id: string) {
  const { error } = await supabase.rpc('complete_exit', { p_exit: id });
  if (error) fail(error, 'Could not complete the exit.');
}

export async function loadClearance(exitId: string): Promise<ClearanceItem[]> {
  const { data, error } = await supabase
    .from('employee_exit_clearance_items')
    .select('id, exit_id, category, title, owner, asset_id, done, done_at, notes, sort_order')
    .eq('exit_id', exitId)
    .order('sort_order');
  if (error) fail(error, 'Could not load the checklist.');
  return (data ?? []) as ClearanceItem[];
}

export async function saveClearanceItem(id: string, changes: Partial<Pick<ClearanceItem, 'done' | 'notes' | 'owner'>>) {
  const { error } = await supabase.from('employee_exit_clearance_items').update(changes).eq('id', id);
  if (error) fail(error, 'Could not save the checklist item.');
}

export async function addClearanceItem(exitId: string, title: string, owner: string, sortOrder: number) {
  const { error } = await supabase
    .from('employee_exit_clearance_items')
    .insert({ exit_id: exitId, category: 'other', title: title.trim(), owner: owner.trim() || null, sort_order: sortOrder });
  if (error) fail(error, 'Could not add the item.');
}

export async function loadInterview(exitId: string): Promise<ExitInterview | null> {
  const { data, error } = await supabase
    .from('hr_termination_interviews')
    .select('id, interview_date, interviewer, answers, is_completed')
    .eq('exit_id', exitId)
    .maybeSingle();
  if (error) fail(error, 'Could not load the exit interview.');
  return (data as ExitInterview | null) ?? null;
}

export async function saveInterview(exit: Pick<ExitRecord, 'id' | 'employee_number'>, interview: ExitInterview) {
  const row = {
    interview_date: interview.interview_date || null,
    interviewer: interview.interviewer || null,
    answers: interview.answers,
    is_completed: interview.is_completed,
    updated_at: new Date().toISOString(),
  };
  const { error } = interview.id
    ? await supabase.from('hr_termination_interviews').update(row).eq('id', interview.id)
    : await supabase.from('hr_termination_interviews').insert({ ...row, exit_id: exit.id, 'Employee Number': exit.employee_number });
  if (error) fail(error, 'Could not save the exit interview.');
}

export async function loadFinalDues(exitId: string): Promise<FinalDuesRecord | null> {
  const { data, error } = await supabase
    .from('employee_exit_final_dues')
    .select('id, exit_id, lines, earnings, deductions, net, status, payroll_period')
    .eq('exit_id', exitId)
    .maybeSingle();
  if (error) fail(error, 'Could not load the final dues.');
  return (data as FinalDuesRecord | null) ?? null;
}

export async function saveFinalDues(
  exit: Pick<ExitRecord, 'id' | 'employee_number'>,
  dues: Pick<FinalDuesRecord, 'lines' | 'status' | 'payroll_period'> & { id?: string }
) {
  const row = { lines: dues.lines, status: dues.status, payroll_period: dues.status === 'included' ? dues.payroll_period : null };
  const { error } = dues.id
    ? await supabase.from('employee_exit_final_dues').update(row).eq('id', dues.id)
    : await supabase.from('employee_exit_final_dues').insert({ ...row, exit_id: exit.id, employee_number: exit.employee_number });
  if (error) fail(error, 'Could not save the final dues.');
}

const sum = (rows: unknown[] | null | undefined, pick: (r: Record<string, unknown>) => unknown) =>
  (rows ?? []).reduce<number>((s, r) => s + Math.max(0, Number(pick(r as Record<string, unknown>)) || 0), 0);

/**
 * What the statement is worked out from: their basic salary and start date, their annual leave balance for the year
 * they leave in, the salary advances and loans they still owe, and their voluntary deductions for the last month.
 * Anything HR can't read (a module they don't have) counts as nothing, with a note, and can be added by hand.
 */
export async function gatherFinalDuesInput(exit: ExitRecord): Promise<{ input: FinalDuesInput; notes: string[] }> {
  const notes: string[] = [];
  const period = periodOf(exit.last_working_day);
  const [year, month] = period.split('-').map(Number);

  const { data: emp, error: empError } = await supabase
    .from('employees')
    .select('"Basic Salary", "Start Date"')
    .eq('"Employee Number"', exit.employee_number)
    .maybeSingle();
  if (empError || !emp) fail(empError, 'Could not load the employee’s salary.');
  const e = emp as Record<string, unknown>;

  // annual leave: the deductible leave type called "Annual...", its yearly (month 0) balance
  let leaveDays = 0;
  const { data: types } = await supabase.from('leave_types').select('id, name').eq('is_deductible', true).ilike('name', 'annual%').limit(1);
  const annual = (types ?? [])[0] as { id: string } | undefined;
  if (annual) {
    const [{ data: balance }, { data: policy }] = await Promise.all([
      supabase
        .from('leave_balances')
        .select('accrued_days, carried_over_days, used_days')
        .eq('employee_number', exit.employee_number)
        .eq('leave_type_id', annual.id)
        .eq('year', year)
        .eq('month', 0)
        .maybeSingle(),
      supabase.from('current_leave_policies').select('accrual_method').eq('leave_type_id', annual.id).maybeSingle(),
    ]);
    if (balance) {
      const b = balance as Record<string, unknown>;
      leaveDays = leaveDaysOutstanding({
        accrued: Number(b.accrued_days),
        carried: Number(b.carried_over_days),
        used: Number(b.used_days),
        method: (policy as { accrual_method?: string } | null)?.accrual_method,
        month,
      });
    } else notes.push(`No ${year} annual leave balance on record: leave days count as 0.`);
  } else notes.push('No annual leave type set up: leave days count as 0.');

  // advances: HR's advance records still owed, and advances paid out in the last month (taken back from that pay)
  const [hrAdvances, paidAdvances, loans, deductionTypes, deductions] = await Promise.all([
    supabase.from('hr_salary_advances').select('remaining_balance').eq('"Employee Number"', exit.employee_number).eq('is_completed', false),
    supabase
      .from('salary_advance')
      .select('"Amount Requested", admin_adjusted_amount')
      .eq('"Employee Number"', exit.employee_number)
      .eq('status', 'paid')
      .gte('time_added', `${period}-01`)
      .lte('time_added', `${exit.last_working_day}T23:59:59`),
    supabase.from('staff_loans').select('total_repayable, amount_deducted, status').eq('employee_number', exit.employee_number),
    supabase.from('deduction_types').select('id, name, active'),
    supabase.from('employee_deductions').select('id, employee_number, deduction_type_id, amount, start_period, end_period, notes').eq('employee_number', exit.employee_number),
  ]);
  if (hrAdvances.error || paidAdvances.error) notes.push('Some salary advances could not be read: check and add them by hand.');
  if (loans.error) notes.push('Loans could not be read: check and add them by hand.');
  if (deductionTypes.error || deductions.error) notes.push('Voluntary deductions could not be read: check and add them by hand.');

  const advances =
    sum(hrAdvances.data, (r) => r.remaining_balance) + sum(paidAdvances.data, (r) => r.admin_adjusted_amount ?? r['Amount Requested']);
  const activeLoans = (loans.data ?? []).filter((l) => /approved|disbursed|active/i.test(String((l as Record<string, unknown>).status ?? '')));
  const owed = sum(activeLoans, (r) => Number(r.total_repayable) - Number(r.amount_deducted || 0));
  const voluntary =
    deductionsForPeriod((deductionTypes.data ?? []) as DeductionType[], (deductions.data ?? []) as EmployeeDeduction[], period).get(exit.employee_number) ?? [];

  return {
    input: {
      basicSalary: Number(e['Basic Salary']) || 0,
      lastWorkingDay: exit.last_working_day,
      startDate: (e['Start Date'] as string | null) ?? null,
      noticeGivenOn: exit.notice_given_on,
      noticeDays: exit.notice_days,
      noticePay: exit.notice_pay,
      leaveDays,
      advances,
      loans: owed,
      voluntary,
    },
    notes,
  };
}

export async function workOutFinalDues(exit: ExitRecord): Promise<{ lines: FinalDuesLine[]; notes: string[] }> {
  const { input, notes } = await gatherFinalDuesInput(exit);
  return { lines: finalDuesLines(input), notes };
}

// ---------------------------------------------------------------------------------------------
// the employee (staff portal)
// ---------------------------------------------------------------------------------------------
export interface MyExitState {
  employeeNumber: string | null;
  noticeDays: number;
  exits: ExitRecord[];
}

export async function loadMyExit(): Promise<MyExitState> {
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return { employeeNumber: null, noticeDays: DEFAULT_NOTICE_DAYS, exits: [] };
  const { data: emp, error } = await supabase.from('employees').select('"Employee Number", notice_days').eq('"Work Email"', email).maybeSingle();
  if (error) fail(error, 'Could not load your record.');
  if (!emp) return { employeeNumber: null, noticeDays: DEFAULT_NOTICE_DAYS, exits: [] };
  const number = String((emp as Record<string, unknown>)['Employee Number']);
  const { data, error: exitsError } = await supabase
    .from('employee_exits')
    .select(EXIT_COLUMNS)
    .eq('employee_number', number)
    .order('created_at', { ascending: false });
  if (exitsError) fail(exitsError, 'Could not load your resignation.');
  return {
    employeeNumber: number,
    noticeDays: Number((emp as Record<string, unknown>).notice_days ?? DEFAULT_NOTICE_DAYS) || DEFAULT_NOTICE_DAYS,
    exits: (data ?? []) as ExitRecord[],
  };
}

/** Uploads the letter (if any) to the private documents bucket under the employee's own folder, then resigns. */
export async function submitResignation(employeeNumber: string, form: { lastWorkingDay: string; reason: string; letter?: File | null }) {
  let letterPath: string | null = null;
  if (form.letter) {
    const { userId, tenantId } = await currentUserAndTenant();
    letterPath = `${tenantId}/${userId}/resignation_${randomFileName(form.letter.name)}`;
    const { error } = await supabase.storage.from('documents').upload(letterPath, form.letter, { upsert: false });
    if (error) fail(error, 'Could not upload your letter.');
  }
  await startExit({
    employee_number: employeeNumber,
    kind: 'resignation',
    reason: form.reason.trim() || null,
    last_working_day: form.lastWorkingDay,
    letter_path: letterPath,
  });
}

export async function withdrawResignation(id: string) {
  await cancelExit(id);
}
