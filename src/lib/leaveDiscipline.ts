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

// ---------------------------------------------------------------------------------------------
// possible absences: the days attendance counts as absent (migration 20261106100000)
// ---------------------------------------------------------------------------------------------

/** A row of possible_absences(): a run of working days with no clock-in, no leave and no holiday */
export interface PossibleAbsence {
  employee_number: string;
  employee_name: string;
  start_date: string;
  end_date: string;
  /** the absent working days in the run */
  days: number;
  absent_days: string[];
  /** a leave application not yet decided covers some of it */
  pending_leave: boolean;
  /** when the employee was sent a notice about it, and the day their reply is due */
  notified_on: string | null;
  reply_by: string | null;
}

export interface PossibleAbsenceSettings {
  lookback_days: number;
  notify_employees: boolean;
  /** the day the employee notice was switched on: only absences from then are noticed */
  notify_from: string | null;
  reply_working_days: number;
}

export const DEFAULT_POSSIBLE_ABSENCE_SETTINGS: PossibleAbsenceSettings = {
  lookback_days: 60, notify_employees: false, notify_from: null, reply_working_days: 2,
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay()];

/** "Mon 3 Nov" */
export function shortDay(iso: string) {
  const { m, d } = parts(iso);
  return `${weekday(iso)} ${d} ${MONTHS[m - 1]}`;
}

/** "Mon 3 Nov", "Mon 3 – Wed 5 Nov", "Fri 31 Oct – Mon 3 Nov", "Wed 31 Dec 2025 – Fri 2 Jan 2026" */
export function dayRange(start: string, end: string) {
  const a = parts(start);
  const b = parts(end);
  if (start.slice(0, 10) === end.slice(0, 10)) return shortDay(start);
  if (a.y !== b.y) return `${shortDay(start)} ${a.y} – ${shortDay(end)} ${b.y}`;
  if (a.m === b.m) return `${weekday(start)} ${a.d} – ${shortDay(end)}`;
  return `${shortDay(start)} – ${shortDay(end)}`;
}

/** "Mon 3 – Wed 5 Nov, 3 working days" */
export const possibleAbsenceText = (p: Pick<PossibleAbsence, 'start_date' | 'end_date' | 'days'>) =>
  `${dayRange(p.start_date, p.end_date)}, ${workingDaysText(p.days)}`;

/** "Notified Tue 4 Nov, reply due Thu 6 Nov" (with whether the reply is overdue on `today`), or null */
export function noticeText(p: Pick<PossibleAbsence, 'notified_on' | 'reply_by'>, today: string): { text: string; overdue: boolean } | null {
  if (!p.notified_on) return null;
  const due = p.reply_by ? `, reply due ${shortDay(p.reply_by)}` : '';
  return { text: `Employee notified ${shortDay(p.notified_on)}${due}`, overdue: !!p.reply_by && p.reply_by < today };
}

/** What is wrong with the settings form, or null */
export function possibleAbsenceSettingsProblem(s: Pick<PossibleAbsenceSettings, 'lookback_days' | 'reply_working_days'>): string | null {
  if (!Number.isInteger(s.lookback_days) || s.lookback_days < 7 || s.lookback_days > 180) return 'Look back between 7 and 180 days';
  if (!Number.isInteger(s.reply_working_days) || s.reply_working_days < 1 || s.reply_working_days > 10) return 'Give between 1 and 10 working days to reply';
  return null;
}
