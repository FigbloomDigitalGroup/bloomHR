import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AbsenceRecord, DisciplineAccess, DisciplineCounts, OverdueDocument } from '../../lib/leaveDiscipline';

const api = vi.hoisted(() => ({
  access: { manage: true, leaves: true, warn: true, supervised: [] } as DisciplineAccess,
  absences: [] as AbsenceRecord[],
  documents: [] as OverdueDocument[],
  counts: [] as DisciplineCounts[],
  checkOverdueDocuments: vi.fn(),
  issueDisciplineWarning: vi.fn(),
  excuseAbsence: vi.fn(),
  recordAbsence: vi.fn(),
  deleteAbsence: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../UI/EmployeePicker', () => ({
  default: ({ label, onChange, allowedNumbers }: { label: string; onChange: (e: { employeeNumber: string } | null) => void; allowedNumbers?: string[] }) => (
    <label>
      {label}
      <select aria-label={label} data-allowed={(allowedNumbers ?? ['all']).join(',')} onChange={(e) => onChange(e.target.value ? { employeeNumber: e.target.value } : null)}>
        <option value="">-</option>
        <option value="E1">E1</option>
      </select>
    </label>
  ),
}));
vi.mock('../../lib/leaveDisciplineApi', () => ({
  loadDisciplineAccess: () => Promise.resolve(api.access),
  loadAbsences: () => Promise.resolve(api.absences),
  loadOverdueDocuments: () => Promise.resolve(api.documents),
  loadDisciplineCounts: () => Promise.resolve(api.counts),
  loadLeaveTypeNames: () => Promise.resolve(['Annual Leave', 'Sick Leave']),
  checkOverdueDocuments: api.checkOverdueDocuments,
  issueDisciplineWarning: api.issueDisciplineWarning,
  excuseAbsence: api.excuseAbsence,
  recordAbsence: api.recordAbsence,
  deleteAbsence: api.deleteAbsence,
}));

import LeaveDisciplinePage from './LeaveDisciplinePage';

const absence = (id: string, patch: Partial<AbsenceRecord> = {}): AbsenceRecord => ({
  id, employee_number: 'E1', employee_name: 'Wanjiru One', kind: 'unexcused_absence', start_date: '2026-10-05',
  end_date: '2026-10-06', days: 2, note: 'No call', status: 'recorded', recorded_by: null, recorded_by_name: 'Sam Sup',
  recorded_at: '2026-10-07T08:00:00Z', excused_at: null, excuse_note: null, leave_application_id: null, warnings: 0,
  last_warning_at: null, ...patch,
});

beforeEach(() => {
  api.access = { manage: true, leaves: true, warn: true, supervised: [] };
  api.absences = [
    absence('a1'),
    absence('a2', { kind: 'failed_to_notify', employee_name: 'Otieno Two', employee_number: 'E2', start_date: '2026-10-08', end_date: '2026-10-08', days: 1 }),
  ];
  api.documents = [{
    leave_id: 'l1', employee_number: 'E3', employee_name: 'Achieng Three', leave_type: 'Sick Leave', start_date: '2026-10-01',
    end_date: '2026-10-02', leave_status: 'approved', days: 2, document_kind: 'main', document_name: 'Medical report',
    due_date: '2026-10-01', warnings: 1, last_warning_at: '2026-10-03',
  }];
  api.counts = [{ employee_number: 'E1', employee_name: 'Wanjiru One', unexcused_absences: 1, unexcused_days: 2, failed_to_notify: 0, missing_documents: 0, warnings: 3 }];
  for (const fn of [api.checkOverdueDocuments, api.issueDisciplineWarning, api.excuseAbsence, api.recordAbsence, api.deleteAbsence]) {
    fn.mockReset();
    fn.mockResolvedValue(undefined);
  }
});

afterEach(cleanup);

describe('Leave discipline page', () => {
  it('HR: checks overdue documents on opening and lists the three cases', async () => {
    render(<LeaveDisciplinePage />);
    expect(await screen.findByText('Wanjiru One')).toBeTruthy();
    expect(api.checkOverdueDocuments).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Unexcused absences (1)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Failure to notify (1)' }));
    expect(await screen.findByText('Otieno Two')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Missing documents (1)' }));
    expect(await screen.findByText('Achieng Three')).toBeTruthy();
    expect(screen.getByText('with the application')).toBeTruthy();
    expect(screen.getByText('1 warning, last 3 Oct 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'By employee (12 months)' }));
    const row = await screen.findByRole('row', { name: 'Counts for Wanjiru One' });
    expect(within(row).getByText('(2 working days)')).toBeTruthy();
    expect(within(row).getByText('3')).toBeTruthy();
  });

  it('issues a warning pre-filled from the template, linked to the absence', async () => {
    render(<LeaveDisciplinePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue warning to Wanjiru One, 5 - 6 Oct 2026' }));
    const dialog = screen.getByRole('dialog');
    const message = within(dialog).getByLabelText('Message') as HTMLTextAreaElement;
    expect(message.value).toContain('absence from work on 5 - 6 Oct 2026 (2 working days)');
    fireEvent.click(within(dialog).getByLabelText('high'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send warning' }));
    await waitFor(() => expect(api.issueDisciplineWarning).toHaveBeenCalledWith(
      expect.objectContaining({ absenceId: 'a1', leaveId: null, type: 'Unexcused absence', severity: 'high' })));
  });

  it('issues a warning for a missing document, linked to the application', async () => {
    render(<LeaveDisciplinePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Missing documents (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Issue warning to Achieng Three, Sick Leave' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send warning' }));
    await waitFor(() => expect(api.issueDisciplineWarning).toHaveBeenCalledWith(
      expect.objectContaining({ absenceId: null, leaveId: 'l1', type: 'Leave without the required document', severity: 'high' })));
  });

  it('excuses an absence, optionally as leave', async () => {
    render(<LeaveDisciplinePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Excuse Wanjiru One, 5 - 6 Oct 2026' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Why/), { target: { value: 'Doctor’s note' } });
    fireEvent.change(within(dialog).getByLabelText(/Record the days as leave/), { target: { value: 'Sick Leave' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excuse' }));
    await waitFor(() => expect(api.excuseAbsence).toHaveBeenCalledWith('a1', 'Doctor’s note', 'Sick Leave'));
  });

  it('records an absence', async () => {
    render(<LeaveDisciplinePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record absence' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Employee'), { target: { value: 'E1' } });
    fireEvent.click(within(dialog).getByLabelText(/Failure to notify/));
    fireEvent.change(within(dialog).getByLabelText('First day'), { target: { value: '2026-10-01' } });
    fireEvent.change(within(dialog).getByLabelText('Last day'), { target: { value: '2026-10-02' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(api.recordAbsence).toHaveBeenCalledWith(
      { employeeNumber: 'E1', kind: 'failed_to_notify', start: '2026-10-01', end: '2026-10-02', note: '' }));
  });

  it('a supervisor records for their team only and cannot excuse, warn or see documents', async () => {
    api.access = { manage: false, leaves: false, warn: false, supervised: ['E1'] };
    render(<LeaveDisciplinePage />);
    expect(await screen.findByText('Wanjiru One')).toBeTruthy();
    expect(api.checkOverdueDocuments).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Missing documents/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Issue warning/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Excuse/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Record absence' }));
    expect(within(screen.getByRole('dialog')).getByLabelText('Employee').getAttribute('data-allowed')).toBe('E1');
  });

  it('others see nothing', async () => {
    api.access = { manage: false, leaves: false, warn: false, supervised: [] };
    render(<LeaveDisciplinePage />);
    expect(await screen.findByText('Nothing to show')).toBeTruthy();
  });
});
