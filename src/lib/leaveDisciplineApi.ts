import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import type { AbsencePayRow } from './absencePay';
import type { AbsenceKind, AbsenceRecord, DisciplineAccess, DisciplineCounts, OverdueDocument, WarningDraft } from './leaveDiscipline';

// Leave discipline (FIG-881), the database calls. Every rule (who may record, excuse, warn) is checked in the
// database (supabase/migrations/20261018700000_leave_discipline.sql).

/** A database without migration 20261018700000 yet: nothing rather than an error. */
const notThereYet = (err: unknown) => ['PGRST202', '42883', '42703', 'PGRST204'].includes(String((err as { code?: string })?.code));

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export async function loadDisciplineAccess(): Promise<DisciplineAccess> {
  const { data, error } = await supabase.rpc('leave_discipline_access');
  if (error) {
    if (notThereYet(error)) return { manage: false, leaves: false, warn: false, supervised: [] };
    throw new Error(error.message);
  }
  const d = (data ?? {}) as Partial<DisciplineAccess>;
  return { manage: !!d.manage, leaves: !!d.leaves, warn: !!d.warn, supervised: Array.isArray(d.supervised) ? d.supervised : [] };
}

/** Absences from `since` (default: the last 12 months) that the signed-in user may see. */
export async function loadAbsences(since?: string): Promise<AbsenceRecord[]> {
  return fetchAll<AbsenceRecord>((from, to) => supabase.rpc('leave_absences_list', { p_since: since ?? null }).range(from, to));
}

export async function loadOverdueDocuments(): Promise<OverdueDocument[]> {
  return fetchAll<OverdueDocument>((from, to) => supabase.rpc('overdue_leave_documents').range(from, to));
}

/** Tells HR (once per application) about leave documents newly overdue; how many. Best effort. */
export async function checkOverdueDocuments(): Promise<number> {
  const { data, error } = await supabase.rpc('check_overdue_leave_documents');
  if (error) return 0;
  return Number(data) || 0;
}

export async function loadDisciplineCounts(): Promise<DisciplineCounts[]> {
  return fetchAll<DisciplineCounts>((from, to) => supabase.rpc('leave_discipline_counts').range(from, to));
}

export async function recordAbsence(input: { employeeNumber: string; kind: AbsenceKind; start: string; end: string; note: string }) {
  const { error } = await supabase.rpc('record_absence', {
    p_employee: input.employeeNumber, p_kind: input.kind, p_start: input.start, p_end: input.end, p_note: input.note || null,
  });
  fail(error);
}

export async function excuseAbsence(id: string, note: string, leaveType: string | null) {
  const { error } = await supabase.rpc('excuse_absence', { p_id: id, p_note: note || null, p_leave_type: leaveType || null });
  fail(error);
}

export async function deleteAbsence(id: string) {
  const { error } = await supabase.rpc('delete_absence', { p_id: id });
  fail(error);
}

export async function issueDisciplineWarning(draft: WarningDraft) {
  const { error } = await supabase.rpc('issue_discipline_warning', {
    p_absence: draft.absenceId, p_leave: draft.leaveId, p_type: draft.type, p_severity: draft.severity, p_message: draft.message,
  });
  fail(error);
}

/** The company's leave types (to turn an excused absence into leave). */
export async function loadLeaveTypeNames(): Promise<string[]> {
  const { data, error } = await supabase.from('leave_types').select('name').order('name');
  if (error) return [];
  return (data ?? []).map((t: { name: string }) => t.name);
}

/** Each employee's days of unexcused absence in the pay period ('YYYY-MM'), by employee number (payroll). */
export async function loadAbsencePay(period: string): Promise<Map<string, AbsencePayRow>> {
  try {
    const rows = await fetchAll<AbsencePayRow>((from, to) =>
      supabase.rpc('absence_pay_deductions', { p_period: period }).order('employee_number').range(from, to),
    );
    return new Map(rows.map((r) => [r.employee_number, r]));
  } catch (err) {
    if (notThereYet(err)) return new Map();
    throw err;
  }
}

/** Whether unexcused absences come off pay (company_payroll_settings.deduct_unexcused_absence; default on). */
export async function loadDeductAbsence(): Promise<boolean> {
  const { data, error } = await supabase.from('company_payroll_settings').select('deduct_unexcused_absence').maybeSingle();
  if (error) {
    if (notThereYet(error)) return true;
    throw error;
  }
  return data?.deduct_unexcused_absence !== false;
}

export async function saveDeductAbsence(on: boolean): Promise<void> {
  const { error } = await supabase
    .from('company_payroll_settings')
    .upsert({ deduct_unexcused_absence: on, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

/** The signed-in employee's own absence records (staff portal), newest first. */
export async function loadMyAbsences(): Promise<Pick<AbsenceRecord, 'id' | 'kind' | 'start_date' | 'end_date' | 'days' | 'note' | 'status' | 'excuse_note'>[]> {
  const { data: me, error: meError } = await supabase.rpc('current_employee_number');
  if (meError || !me) return [];
  const { data, error } = await supabase
    .from('leave_absences')
    .select('id, kind, start_date, end_date, days, note, status, excuse_note')
    .eq('employee_number', String(me))
    .order('start_date', { ascending: false })
    .limit(100);
  if (error) {
    if (notThereYet(error) || ['42P01', 'PGRST205'].includes(String(error.code))) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}
