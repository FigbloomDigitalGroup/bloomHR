import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
import { LeaveDocumentRule, leaveDocuments } from './leaveDocuments';

const sick: LeaveDocumentRule = {
  leave_type: 'Sick Leave', name: 'Medical report', when: 'with_application', within_days: 0, if_longer_than: 0,
  followup_name: null, followup_within_days: 14,
};
const maternity: LeaveDocumentRule = {
  leave_type: 'Maternity Leave', name: 'Due date report', when: 'with_application', within_days: 0, if_longer_than: 0,
  followup_name: 'Birth notification', followup_within_days: 30,
};
const app = (extra: Record<string, unknown> = {}) => ({ id: 'L1', 'Leave Type': 'Sick Leave', 'Start Date': '2026-11-02', days: 2, status: 'pending', ...extra });

describe('leaveDocuments', () => {
  it('shows an attached document, and a missing one needed with the application as overdue', () => {
    expect(leaveDocuments(app({ document_path: 't/u/x.pdf', document_name: 'x.pdf' }), sick, '2026-11-01')).toEqual([
      { kind: 'main', label: 'Medical report', path: 't/u/x.pdf', fileName: 'x.pdf', due: null, overdue: false },
    ]);
    expect(leaveDocuments(app(), sick, '2026-11-01')[0].overdue).toBe(true);
  });

  it('a document due after the leave starts is due by that day, overdue only after it', () => {
    const rule = { ...sick, when: 'after' as const, within_days: 7 };
    expect(leaveDocuments(app(), rule, '2026-11-09')[0]).toMatchObject({ due: '2026-11-09', overdue: false });
    expect(leaveDocuments(app(), rule, '2026-11-10')[0].overdue).toBe(true);
  });

  it('the follow-up document is due within its days of the leave starting', () => {
    const docs = leaveDocuments(app({ 'Leave Type': 'Maternity Leave', document_path: 't/u/due.pdf' }), maternity, '2026-12-03');
    expect(docs.map((d) => [d.label, d.due, d.overdue])).toEqual([
      ['Due date report', null, false],
      ['Birth notification', '2026-12-02', true],
    ]);
  });

  it('nothing is overdue on a rejected application, or for leave shorter than the rule asks', () => {
    expect(leaveDocuments(app({ status: 'Rejected' }), sick, '2026-12-01')[0].overdue).toBe(false);
    expect(leaveDocuments(app({ days: 1 }), { ...sick, if_longer_than: 2 }, '2026-12-01')).toEqual([]);
  });

  it('a file added where none was asked for still shows', () => {
    expect(leaveDocuments(app({ document_path: 't/u/x.pdf' }), undefined, '2026-12-01')[0]).toMatchObject({ label: 'Document', overdue: false });
  });
});
