import { DISCIPLINE_TEMPLATES, fillWarningTemplate, type DisciplineCase } from './warningTemplates';

// Leave discipline (FIG-881), the pure part: the records as the database gives them, and the warning each one
// pre-fills. The database calls are in leaveDisciplineApi; the rules are in
// supabase/migrations/20261018700000_leave_discipline.sql.

export type AbsenceKind = 'unexcused_absence' | 'failed_to_notify';

/** A row of leave_absences_list() */
export interface AbsenceRecord {
  id: string;
  employee_number: string;
  employee_name: string;
  kind: AbsenceKind;
  start_date: string;
  end_date: string;
  days: number | string;
  note: string | null;
  status: 'recorded' | 'excused';
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_at: string;
  excused_at: string | null;
  excuse_note: string | null;
  leave_application_id: string | null;
  warnings: number;
  last_warning_at: string | null;
}

/** A row of overdue_leave_documents() */
export interface OverdueDocument {
  leave_id: string;
  employee_number: string;
  employee_name: string;
  leave_type: string;
  start_date: string;
  end_date: string | null;
  leave_status: string;
  days: number | string;
  document_kind: 'main' | 'followup';
  document_name: string | null;
  due_date: string;
  warnings: number;
  last_warning_at: string | null;
}

/** A row of leave_discipline_counts(): the last 12 months */
export interface DisciplineCounts {
  employee_number: string;
  employee_name: string;
  unexcused_absences: number;
  unexcused_days: number | string;
  failed_to_notify: number;
  missing_documents: number;
  warnings: number;
}

export interface DisciplineAccess {
  /** HR: records, excuses, sees overdue documents */
  manage: boolean;
  /** can turn an excused absence into leave (the Leave module) */
  leaves: boolean;
  /** can issue warnings */
  warn: boolean;
  /** the employees the signed-in user supervises */
  supervised: string[];
}

export const ABSENCE_KIND_LABEL: Record<AbsenceKind, string> = {
  unexcused_absence: 'Unexcused absence',
  failed_to_notify: 'Failure to notify',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d };
};

/** "2 Oct 2026", "2 - 4 Oct 2026", "30 Sep - 2 Oct 2026", "30 Dec 2026 - 2 Jan 2027" */
export function formatDateRange(start: string, end?: string | null) {
  const a = parts(start);
  const b = parts(end || start);
  if (!a.y || !b.y) return start;
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `${a.d} ${MONTHS[a.m - 1]} ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${a.d} - ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m - 1]} - ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${a.d} ${MONTHS[a.m - 1]} ${a.y} - ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

/** "1 working day", "2.5 working days" */
export const workingDaysText = (days: number | string) => {
  const n = Number(days) || 0;
  return `${+n.toFixed(2)} working ${n === 1 ? 'day' : 'days'}`;
};

/** When an overdue document was due: "due with the application" or "due by 12 Oct 2026" */
export const dueText = (doc: Pick<OverdueDocument, 'document_kind' | 'due_date' | 'start_date'>) =>
  doc.document_kind === 'main' && doc.due_date <= doc.start_date ? 'due with the application' : `due by ${formatDateRange(doc.due_date)}`;

export interface WarningDraft {
  /** what the warning is for */
  case: DisciplineCase;
  absenceId: string | null;
  leaveId: string | null;
  employeeNumber: string;
  employeeName: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

/** The warning an absence record pre-fills: its template with the dates and days in. */
export function warningForAbsence(a: AbsenceRecord, previousWarnings = a.warnings): WarningDraft {
  const t = DISCIPLINE_TEMPLATES[a.kind];
  return {
    case: a.kind,
    absenceId: a.id,
    leaveId: null,
    employeeNumber: a.employee_number,
    employeeName: a.employee_name,
    type: t.type,
    // a repeat is more serious
    severity: previousWarnings > 0 ? 'high' : 'medium',
    message: fillWarningTemplate(t.message, { dates: formatDateRange(a.start_date, a.end_date), days: workingDaysText(a.days) }),
  };
}

/** The warning an overdue leave document pre-fills. */
export function warningForDocument(d: OverdueDocument): WarningDraft {
  const t = DISCIPLINE_TEMPLATES.missing_document;
  return {
    case: 'missing_document',
    absenceId: null,
    leaveId: d.leave_id,
    employeeNumber: d.employee_number,
    employeeName: d.employee_name,
    type: t.type,
    severity: d.warnings > 0 ? 'high' : 'low',
    message: fillWarningTemplate(t.message, {
      leave_type: d.leave_type,
      dates: formatDateRange(d.start_date, d.end_date),
      document: d.document_name || 'document',
      due: dueText(d),
    }),
  };
}
