import { describe, expect, it } from 'vitest';
import { leavePayFor, leaveLineLabel, leaveLineWorking, leaveLinesText, payslipLeaveLines, type LeavePayRow } from './leavePay';
import { withAbsencePay, type AbsencePayRow } from './absencePay';
import { dueText, formatDateRange, warningForAbsence, warningForDocument, workingDaysText, type AbsenceRecord, type OverdueDocument } from './leaveDiscipline';
import { DISCIPLINE_TEMPLATES, WARNING_TEMPLATES, fillWarningTemplate } from './warningTemplates';

const absenceRow = (days: number, working = 22): AbsencePayRow => ({
  employee_number: 'E1', absence_days: days, month_working_days: working,
  absences: [{ id: 'a1', start_date: '2026-03-05', end_date: '2026-03-09', days_in_month: days }],
});

describe('unexcused absence on the payslip', () => {
  it('adds a line at the same day’s pay as unpaid leave (basic / 30): 30,000 basic, 3 days = 3,000', () => {
    const pay = withAbsencePay(leavePayFor(undefined, 30000, 'basic_30'), absenceRow(3), 30000, 'basic_30');
    expect(pay.total).toBe(3000);
    expect(pay.items).toEqual([expect.objectContaining({ name: 'Unexcused absence', kind: 'absence', days: 3, daily_rate: 1000, amount: 3000 })]);
    expect(leaveLineLabel(pay.items[0])).toBe('Unexcused absence: 3 days');
    expect(leaveLineWorking(pay.items[0])).toBe('3 × KSh 1,000.00');
  });

  it("uses the month's working days when the company chooses that basis", () => {
    const pay = withAbsencePay(leavePayFor(undefined, 22000, 'working_days'), absenceRow(2, 22), 22000, 'working_days');
    expect(pay.total).toBe(2000);
  });

  it('comes after the leave lines, and leave and absence together never exceed the basic', () => {
    const leave: LeavePayRow = {
      employee_number: 'E1', unpaid_days: 28, half_pay_days: 0, month_working_days: 22,
      applications: [{ id: 'l1', leave_type: 'Unpaid Leave', start_date: '2026-03-01', end_date: '2026-03-28', days_in_month: 28, unpaid_days: 28, half_pay_days: 0 }],
    };
    const pay = withAbsencePay(leavePayFor(leave, 30000, 'basic_30'), absenceRow(3), 30000, 'basic_30');
    expect(pay.items.map((i) => [i.name, i.amount])).toEqual([['Unpaid Leave', 28000], ['Unexcused absence', 2000]]);
    expect(pay.total).toBe(30000);
  });

  it('no row or no days: nothing changes', () => {
    const leave = leavePayFor(undefined, 30000, 'basic_30');
    expect(withAbsencePay(leave, undefined, 30000, 'basic_30')).toBe(leave);
    expect(withAbsencePay(leave, absenceRow(0), 30000, 'basic_30')).toBe(leave);
  });

  it('saved payslips keep the absence line (PDF, register and exports read the same lines)', () => {
    const items = [{ name: 'Unexcused absence', kind: 'absence', days: 2, daily_rate: 1000, amount: 2000 }];
    expect(payslipLeaveLines({ leave_items: items })[0].kind).toBe('absence');
    expect(leaveLinesText({ leave_items: items })).toBe('Unexcused absence: 2 days -2000');
  });
});

describe('dates and days', () => {
  it('formats ranges', () => {
    expect(formatDateRange('2026-10-02')).toBe('2 Oct 2026');
    expect(formatDateRange('2026-10-02', '2026-10-04')).toBe('2 - 4 Oct 2026');
    expect(formatDateRange('2026-09-30', '2026-10-02')).toBe('30 Sep - 2 Oct 2026');
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('30 Dec 2026 - 2 Jan 2027');
    expect(workingDaysText(1)).toBe('1 working day');
    expect(workingDaysText('2.5')).toBe('2.5 working days');
  });
});

const absence = (patch: Partial<AbsenceRecord> = {}): AbsenceRecord => ({
  id: 'a1', employee_number: 'E1', employee_name: 'Wanjiru One', kind: 'unexcused_absence', start_date: '2026-10-05',
  end_date: '2026-10-06', days: 2, note: null, status: 'recorded', recorded_by: null, recorded_by_name: null,
  recorded_at: '2026-10-07T08:00:00Z', excused_at: null, excuse_note: null, leave_application_id: null, warnings: 0,
  last_warning_at: null, ...patch,
});
const doc = (patch: Partial<OverdueDocument> = {}): OverdueDocument => ({
  leave_id: 'l1', employee_number: 'E2', employee_name: 'Otieno Two', leave_type: 'Sick Leave', start_date: '2026-10-01',
  end_date: '2026-10-02', leave_status: 'approved', days: 2, document_kind: 'main',
  document_name: 'Report from a registered medical practitioner', due_date: '2026-10-01', warnings: 0, last_warning_at: null, ...patch,
});

describe('warnings pre-filled from the templates', () => {
  it('an unexcused absence: dates and days in, medium (high when warned before), linked to the absence', () => {
    const d = warningForAbsence(absence());
    expect(d).toMatchObject({ case: 'unexcused_absence', absenceId: 'a1', leaveId: null, type: 'Unexcused absence', severity: 'medium' });
    expect(d.message).toContain('absence from work on 5 - 6 Oct 2026 (2 working days) without permission');
    expect(warningForAbsence(absence({ warnings: 1 })).severity).toBe('high');
  });

  it('a failure to notify', () => {
    const d = warningForAbsence(absence({ kind: 'failed_to_notify', start_date: '2026-10-05', end_date: '2026-10-05' }));
    expect(d.type).toBe('Failure to notify');
    expect(d.message).toContain('would not be at work on 5 Oct 2026');
  });

  it('a leave application without its document: linked to the application', () => {
    const d = warningForDocument(doc());
    expect(d).toMatchObject({ case: 'missing_document', absenceId: null, leaveId: 'l1', type: 'Leave without the required document', severity: 'low' });
    expect(d.message).toContain('your Sick Leave on 1 - 2 Oct 2026: the required Report from a registered medical practitioner was not provided (due with the application)');
    expect(dueText(doc({ due_date: '2026-10-31', document_kind: 'followup' }))).toBe('due by 31 Oct 2026');
  });

  it('the Disciplinary module offers the three new templates too, placeholders filled generically', () => {
    expect(WARNING_TEMPLATES.map((t) => t.type)).toEqual(expect.arrayContaining(Object.values(DISCIPLINE_TEMPLATES).map((t) => t.type)));
    expect(new Set(WARNING_TEMPLATES.map((t) => t.id)).size).toBe(WARNING_TEMPLATES.length);
    expect(fillWarningTemplate(DISCIPLINE_TEMPLATES.missing_document.message, {})).not.toMatch(/\{/);
  });
});
