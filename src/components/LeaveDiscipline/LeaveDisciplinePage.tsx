import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, FileWarning, Plus, UserX } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, StatusPill, TabBar, TableScroll } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import {
  ABSENCE_KIND_LABEL, dueText, formatDateRange, warningForAbsence, warningForDocument, workingDaysText,
  type AbsenceKind, type AbsenceRecord, type DisciplineAccess, type DisciplineCounts, type OverdueDocument, type WarningDraft,
} from '../../lib/leaveDiscipline';
import {
  checkOverdueDocuments, deleteAbsence, loadAbsences, loadDisciplineAccess, loadDisciplineCounts, loadLeaveTypeNames,
  loadOverdueDocuments,
} from '../../lib/leaveDisciplineApi';
import { DisciplineWarningModal, ExcuseAbsenceModal, RecordAbsenceModal } from './DisciplineDialogs';

// Leave discipline (FIG-881): HR's three failures of communication. Absences without leave (unpaid unless excused),
// failures to notify (a conduct record), and leave applied for without the required document. Each can be warned
// with the Disciplinary module's warnings, pre-filled from a template and linked to the record. HR sees everything;
// a supervisor records and sees their team's absences. The database decides who may do what.

type Tab = 'unexcused_absence' | 'failed_to_notify' | 'documents' | 'employees';

const th = 'text-left text-[10.5px] font-bold uppercase text-subtle px-3 py-2 whitespace-nowrap';
const td = 'px-3 py-2.5 text-xs text-ink align-top';

function WarnedPill({ count, last }: { count: number; last: string | null }) {
  if (!count) return <span className="text-muted-foreground">None</span>;
  return <StatusPill tone="danger" label={`${count} warning${count === 1 ? '' : 's'}${last ? `, last ${formatDateRange(last)}` : ''}`} />;
}

export default function LeaveDisciplinePage() {
  const [access, setAccess] = useState<DisciplineAccess | null>(null);
  const [absences, setAbsences] = useState<AbsenceRecord[]>([]);
  const [documents, setDocuments] = useState<OverdueDocument[]>([]);
  const [counts, setCounts] = useState<DisciplineCounts[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('unexcused_absence');
  const [recording, setRecording] = useState<AbsenceKind | null>(null);
  const [excusing, setExcusing] = useState<AbsenceRecord | null>(null);
  const [warning, setWarning] = useState<{ key: number; draft: WarningDraft } | null>(null);

  const reload = useCallback(async (a: DisciplineAccess) => {
    try {
      const [abs, docs, cnt] = await Promise.all([
        loadAbsences(),
        a.manage ? loadOverdueDocuments() : Promise.resolve([] as OverdueDocument[]),
        loadDisciplineCounts(),
      ]);
      setAbsences(abs);
      setDocuments(docs);
      setCounts(cnt);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const a = await loadDisciplineAccess();
        if (!live) return;
        setAccess(a);
        if (a.manage) {
          // tell HR (once per application) about documents that have become overdue, then list them
          await checkOverdueDocuments();
          if (a.leaves) setLeaveTypes(await loadLeaveTypeNames());
        }
        if (a.manage || a.supervised.length > 0) await reload(a);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [reload]);

  const changed = () => {
    setRecording(null);
    setExcusing(null);
    setWarning(null);
    if (access) void reload(access);
  };

  const remove = async (a: AbsenceRecord) => {
    if (!window.confirm(`Remove this ${ABSENCE_KIND_LABEL[a.kind].toLowerCase()} for ${a.employee_name}? Use this for a record made by mistake.`)) return;
    try {
      await deleteAbsence(a.id);
      toast.success('Removed.');
      changed();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const byKind = useMemo(() => ({
    unexcused_absence: absences.filter((a) => a.kind === 'unexcused_absence'),
    failed_to_notify: absences.filter((a) => a.kind === 'failed_to_notify'),
  }), [absences]);

  const tabs = useMemo(() => [
    { id: 'unexcused_absence', label: `Unexcused absences (${byKind.unexcused_absence.filter((a) => a.status === 'recorded').length})` },
    { id: 'failed_to_notify', label: `Failure to notify (${byKind.failed_to_notify.filter((a) => a.status === 'recorded').length})` },
    ...(access?.manage ? [{ id: 'documents', label: `Missing documents (${documents.length})` }] : []),
    { id: 'employees', label: 'By employee (12 months)' },
  ], [byKind, documents.length, access?.manage]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><FigbloomLoader label="Loading leave discipline" /></div>;
  }
  if (!access || (!access.manage && access.supervised.length === 0)) {
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="Leave discipline" />
        <EmptyState icon={<UserX size={20} />} title="Nothing to show" description="Leave discipline is for HR and for supervisors, for their team." />
      </div>
    );
  }

  const absenceTable = (list: AbsenceRecord[], kind: AbsenceKind) => (
    <Card padding="none" className="overflow-hidden">
      {list.length === 0 ? (
        <EmptyState
          className="py-10"
          icon={<UserX size={20} />}
          title={kind === 'unexcused_absence' ? 'No unexcused absences in the last 12 months' : 'No failures to notify in the last 12 months'}
        />
      ) : (
        <TableScroll>
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className={th}>Employee</th>
                <th className={th}>Dates</th>
                <th className={th}>Days</th>
                <th className={th}>Note</th>
                <th className={th}>Status</th>
                <th className={th}>Warnings</th>
                <th className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="border-b border-[#F1F5F2] last:border-b-0">
                  <td className={td}>
                    <div className="font-semibold">{a.employee_name}</div>
                    <div className="text-[11px] text-muted-foreground">{a.employee_number}</div>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{formatDateRange(a.start_date, a.end_date)}</td>
                  <td className={td}>{Number(a.days)}</td>
                  <td className={`${td} max-w-[260px]`}>
                    {a.note || <span className="text-muted-foreground">-</span>}
                    {a.recorded_by_name && <div className="text-[11px] text-muted-foreground">Recorded by {a.recorded_by_name}</div>}
                  </td>
                  <td className={td}>
                    {a.status === 'excused'
                      ? <StatusPill tone="success" label={a.leave_application_id ? 'Excused (leave)' : 'Excused'} />
                      : <StatusPill tone="warning" label={kind === 'unexcused_absence' ? 'Unpaid' : 'Recorded'} />}
                    {a.excuse_note && <div className="text-[11px] text-muted-foreground mt-1">{a.excuse_note}</div>}
                  </td>
                  <td className={td}><WarnedPill count={a.warnings} last={a.last_warning_at} /></td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <div className="flex justify-end gap-1.5">
                      {access.warn && (
                        <Button
                          variant="secondary"
                          aria-label={`Issue warning to ${a.employee_name}, ${formatDateRange(a.start_date, a.end_date)}`}
                          onClick={() => setWarning({ key: Date.now(), draft: warningForAbsence(a) })}
                          icon={<AlertTriangle className="w-3.5 h-3.5" />}
                        >
                          Issue warning
                        </Button>
                      )}
                      {access.manage && a.status === 'recorded' && (
                        <Button variant="secondary" aria-label={`Excuse ${a.employee_name}, ${formatDateRange(a.start_date, a.end_date)}`} onClick={() => setExcusing(a)}>
                          Excuse
                        </Button>
                      )}
                      {access.manage && (
                        <Button variant="ghost" aria-label={`Remove ${a.employee_name}, ${formatDateRange(a.start_date, a.end_date)}`} onClick={() => void remove(a)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Leave discipline"
        subtitle={<span>Absences without leave, failures to notify, and leave without the required document</span>}
        actions={
          <Button icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setRecording(tab === 'failed_to_notify' ? 'failed_to_notify' : 'unexcused_absence')}>
            Record absence
          </Button>
        }
      />

      <TabBar items={tabs} activeId={tab} onChange={(id) => setTab(id as Tab)} className="mb-4" />

      {tab === 'unexcused_absence' && (
        <>
          <p className="text-[11.5px] text-muted-foreground mt-0 mb-3">
            Days of unexcused absence come off pay like unpaid leave (Payroll can turn this off). Excuse an absence when there is
            a good reason, or record it as leave.
          </p>
          {absenceTable(byKind.unexcused_absence, 'unexcused_absence')}
        </>
      )}
      {tab === 'failed_to_notify' && (
        <>
          <p className="text-[11.5px] text-muted-foreground mt-0 mb-3">
            Not telling a supervisor or HR in time. A conduct record: not deducted from pay by itself.
          </p>
          {absenceTable(byKind.failed_to_notify, 'failed_to_notify')}
        </>
      )}
      {tab === 'documents' && access.manage && (
        <>
          <p className="text-[11.5px] text-muted-foreground mt-0 mb-3">
            Leave applications from the last 90 days whose required document (with the application, or due after the leave
            starts) is still missing. HR is notified once for each, the day it becomes overdue. Adding the document in Time Off
            takes it off the list.
          </p>
          <Card padding="none" className="overflow-hidden">
            {documents.length === 0 ? (
              <EmptyState className="py-10" icon={<FileWarning size={20} />} title="No overdue leave documents" />
            ) : (
              <TableScroll>
                <table className="w-full">
                  <thead className="border-b border-border">
                    <tr>
                      <th className={th}>Employee</th>
                      <th className={th}>Leave</th>
                      <th className={th}>Missing</th>
                      <th className={th}>Due</th>
                      <th className={th}>Warnings</th>
                      <th className={th}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((d) => (
                      <tr key={`${d.leave_id}-${d.document_kind}`} className="border-b border-[#F1F5F2] last:border-b-0">
                        <td className={td}>
                          <div className="font-semibold">{d.employee_name}</div>
                          <div className="text-[11px] text-muted-foreground">{d.employee_number}</div>
                        </td>
                        <td className={td}>
                          {d.leave_type}
                          <div className="text-[11px] text-muted-foreground">{formatDateRange(d.start_date, d.end_date)} · {d.leave_status}</div>
                        </td>
                        <td className={td}>{d.document_name || 'Document'}</td>
                        <td className={`${td} whitespace-nowrap`}>{dueText(d).replace(/^due /, '')}</td>
                        <td className={td}><WarnedPill count={d.warnings} last={d.last_warning_at} /></td>
                        <td className={`${td} text-right`}>
                          {access.warn && (
                            <Button
                              variant="secondary"
                              aria-label={`Issue warning to ${d.employee_name}, ${d.leave_type}`}
                              onClick={() => setWarning({ key: Date.now(), draft: warningForDocument(d) })}
                              icon={<AlertTriangle className="w-3.5 h-3.5" />}
                            >
                              Issue warning
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>
        </>
      )}
      {tab === 'employees' && (
        <Card padding="none" className="overflow-hidden">
          {counts.length === 0 ? (
            <EmptyState className="py-10" icon={<UserX size={20} />} title="Nothing in the last 12 months" />
          ) : (
            <TableScroll>
              <table className="w-full">
                <thead className="border-b border-border">
                  <tr>
                    <th className={th}>Employee</th>
                    <th className={th}>Unexcused absences</th>
                    <th className={th}>Failures to notify</th>
                    <th className={th}>Missing documents</th>
                    <th className={th}>Warnings (any)</th>
                  </tr>
                </thead>
                <tbody>
                  {counts.map((c) => (
                    <tr key={c.employee_number} className="border-b border-[#F1F5F2] last:border-b-0" aria-label={`Counts for ${c.employee_name}`}>
                      <td className={td}>
                        <div className="font-semibold">{c.employee_name}</div>
                        <div className="text-[11px] text-muted-foreground">{c.employee_number}</div>
                      </td>
                      <td className={td}>
                        {c.unexcused_absences}
                        {c.unexcused_absences > 0 && <span className="text-muted-foreground"> ({workingDaysText(c.unexcused_days)})</span>}
                      </td>
                      <td className={td}>{c.failed_to_notify}</td>
                      <td className={td}>{c.missing_documents}</td>
                      <td className={td}>{c.warnings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>
      )}

      {recording && (
        <RecordAbsenceModal
          open
          kind={recording}
          allowedNumbers={access.manage ? undefined : access.supervised}
          onClose={() => setRecording(null)}
          onSaved={changed}
        />
      )}
      <ExcuseAbsenceModal absence={excusing} leaveTypes={leaveTypes} canMakeLeave={access.leaves} onClose={() => setExcusing(null)} onSaved={changed} />
      {warning && <DisciplineWarningModal key={warning.key} draft={warning.draft} onClose={() => setWarning(null)} onSent={changed} />}
    </div>
  );
}
