import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import {
  DEFAULT_OVERTIME_SETTINGS, settingsFromRow, settingsToRow,
  type DayType, type OvertimeMonth, type OvertimeMonthRow, type OvertimeSettings, type SheetOvertime,
} from './overtimePay';

// The overtime page's, the staff portal's and payroll's reads and writes (lib/overtimePay has the sums). The database
// decides who may do what (supabase/migrations/20261018200000_overtime.sql).

export type OvertimeStatus = 'submitted' | 'approved' | 'rejected';

export interface OvertimeEntry {
  id: string;
  employee_number: string;
  work_date: string;
  hours: number | string;
  day_type: DayType;
  note: string | null;
  status: OvertimeStatus;
  source: 'payroll' | 'upload' | 'supervisor' | 'self';
  rejection_reason: string | null;
  decided_at: string | null;
}

export interface OvertimePerson {
  employee_number: string;
  name: string | null;
  department: string | null;
  job_group: string | null;
  /** why they get no overtime (an excluded department or job group); null when they do */
  excluded_reason: string | null;
}

/** A database without migration 20261018200000 yet: no overtime rather than no payroll. */
const notThereYet = (err: unknown) =>
  ['PGRST202', '42883', '42703', 'PGRST204', '42P01', 'PGRST205'].includes(String((err as { code?: string })?.code));

const fail = (error: { message?: string } | null) => {
  if (error) throw new Error(error.message || 'Something went wrong');
};

const ENTRY_COLUMNS = 'id, employee_number, work_date, hours, day_type, note, status, source, rejection_reason, decided_at';

export async function loadOvertimeSettings(): Promise<OvertimeSettings> {
  const { data, error } = await supabase.from('company_payroll_settings').select('*').maybeSingle();
  if (error) {
    if (notThereYet(error)) return { ...DEFAULT_OVERTIME_SETTINGS };
    throw error;
  }
  return settingsFromRow(data as Record<string, unknown> | null);
}

export async function saveOvertimeSettings(settings: OvertimeSettings): Promise<void> {
  const { error } = await supabase
    .from('company_payroll_settings')
    .upsert({ ...settingsToRow(settings), updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  fail(error);
}

/** Each employee's approved overtime in the pay period ('YYYY-MM'), by employee number, and the company's settings. */
export async function loadOvertimeMonth(period: string): Promise<OvertimeMonth> {
  const settings = await loadOvertimeSettings();
  try {
    const rows = await fetchAll<OvertimeMonthRow>((from, to) =>
      supabase.rpc('overtime_month', { p_period: period }).order('employee_number').range(from, to),
    );
    return { rows: new Map(rows.map((r) => [r.employee_number, r])), settings };
  } catch (err) {
    if (notThereYet(err)) return { rows: new Map(), settings };
    throw err;
  }
}

export async function loadOvertimePeople(): Promise<OvertimePerson[]> {
  const { data, error } = await supabase.rpc('overtime_people');
  if (error && notThereYet(error)) return [];
  fail(error);
  return (data ?? []) as OvertimePerson[];
}

/** Entries the signed-in user may see between two days (the database shows payroll everyone, a supervisor their team). */
export async function loadOvertime(from: string, to: string): Promise<OvertimeEntry[]> {
  const { data, error } = await supabase
    .from('overtime_entries')
    .select(ENTRY_COLUMNS)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date')
    .limit(10000);
  fail(error);
  return (data ?? []) as OvertimeEntry[];
}

/** Requests waiting for approval (any month still open) */
export async function loadWaitingOvertime(): Promise<OvertimeEntry[]> {
  const { data, error } = await supabase
    .from('overtime_entries')
    .select(ENTRY_COLUMNS)
    .eq('status', 'submitted')
    .order('work_date')
    .limit(2000);
  fail(error);
  return (data ?? []) as OvertimeEntry[];
}

/** Set one day's hours: a number records (or changes) it, null removes it. */
export async function setOvertimeHours(employeeNumber: string, day: string, hours: number | null, existing?: OvertimeEntry) {
  if (hours === null) {
    if (!existing) return;
    const { error } = await supabase.from('overtime_entries').delete().eq('id', existing.id);
    fail(error);
    return;
  }
  if (existing) {
    const { error } = await supabase.from('overtime_entries').update({ hours }).eq('id', existing.id);
    fail(error);
    return;
  }
  const { error } = await supabase.from('overtime_entries').insert({ employee_number: employeeNumber, work_date: day, hours });
  fail(error);
}

/** Rows from a spreadsheet: each added or changed; returns the ones the database refused, with why. */
export async function uploadOvertime(entries: SheetOvertime[]) {
  if (!entries.length) return [];
  const dates = entries.map((d) => d.work_date).sort();
  const existing = await loadOvertime(dates[0], dates[dates.length - 1]);
  const byKey = new Map(existing.map((d) => [`${d.employee_number}|${d.work_date}`, d]));
  const refused: { entry: SheetOvertime; problem: string }[] = [];
  for (const entry of entries) {
    const old = byKey.get(`${entry.employee_number}|${entry.work_date}`);
    const { error } = old
      ? await supabase.from('overtime_entries').update({ hours: entry.hours, note: entry.note }).eq('id', old.id)
      : await supabase.from('overtime_entries').insert({ ...entry, source: 'upload' });
    if (error) refused.push({ entry, problem: error.message });
  }
  return refused;
}

export async function approveOvertime(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from('overtime_entries').update({ status: 'approved' }).in('id', ids);
  fail(error);
}

export async function rejectOvertime(id: string, reason: string) {
  const { error } = await supabase.from('overtime_entries').update({ status: 'rejected', rejection_reason: reason.trim() }).eq('id', id);
  fail(error);
}

export async function setOvertimeRate(employeeNumber: string, rate: number | null) {
  const { error } = await supabase.rpc('set_overtime_rate', { p_employee: employeeNumber, p_rate: rate });
  fail(error);
}

/** Basic salary and own hourly rate per employee, for the month's amounts (payroll reads employee records). */
export async function loadPayBasis(): Promise<Map<string, { basic: number; ownRate: number | null }>> {
  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    supabase.from('employees').select('"Employee Number", "Basic Salary", "Overtime Rate"').order('"Employee Number"').range(from, to),
  );
  return new Map(
    rows.map((r) => [
      String(r['Employee Number'] ?? ''),
      { basic: Number(r['Basic Salary']) || 0, ownRate: Number(r['Overtime Rate']) > 0 ? Number(r['Overtime Rate']) : null },
    ]),
  );
}

export async function loadDepartmentsAndGroups() {
  const [deps, groups] = await Promise.all([
    supabase.from('departments').select('id, name').order('name').limit(2000),
    supabase.from('job_groups').select('id, code, name').order('code').limit(2000),
  ]);
  return {
    departments: ((deps.data ?? []) as { id: string; name: string }[]),
    jobGroups: ((groups.data ?? []) as { id: string; code: string; name: string }[]),
  };
}

// ---------------------------------------------------------------------------------------------
// the staff portal: an employee's own overtime
// ---------------------------------------------------------------------------------------------
export async function loadMyOvertime(employeeNumber: string): Promise<OvertimeEntry[]> {
  const { data, error } = await supabase
    .from('overtime_entries')
    .select(ENTRY_COLUMNS)
    .eq('employee_number', employeeNumber)
    .order('work_date', { ascending: false })
    .limit(500);
  if (error && notThereYet(error)) return [];
  fail(error);
  return (data ?? []) as OvertimeEntry[];
}

export async function myEmployeeNumber(): Promise<string | null> {
  const { data, error } = await supabase.rpc('current_employee_number');
  fail(error);
  return data ? String(data) : null;
}

/** Ask for overtime (it waits for the supervisor's or payroll's approval); the database fills in who. */
export async function requestOvertime(day: string, hours: number, note: string) {
  const { error } = await supabase.from('overtime_entries').insert({ work_date: day, hours, note: note.trim() || null });
  fail(error);
}

export async function withdrawOvertime(id: string) {
  const { error } = await supabase.from('overtime_entries').delete().eq('id', id);
  fail(error);
}
