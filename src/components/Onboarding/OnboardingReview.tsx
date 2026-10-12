import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, ClipboardCheck, FileCheck2, Loader2, Mail, Pencil, Printer, Undo2, X } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, SearchInput, StatusPill, TabBar } from '../UI';
import OnboardingSummary from './OnboardingSummary';
import DocumentsReview from './DocumentsReview';
import HealthReview from './HealthReview';
import RequiredDocumentsModal from './RequiredDocumentsModal';
import {
  type OnboardingRecord,
  type OverviewRow,
  STATUS_LABELS,
  approveOnboarding,
  errorMessage,
  inviteToOnboard,
  loadOnboardingForReview,
  loadOnboardingOverview,
  requestOnboardingChanges,
  statusLabel,
  statusTone,
} from '../../lib/onboarding';
import { ONBOARDING_STATUSES, type OnboardingStatus } from '../../lib/onboardingValidation';

// HR's onboarding page: where every employee is, what each still needs, inviting them, and reviewing what they
// submitted (approve, or send back with a comment). Only approved employees are paid.

const ACTION_LABELS: Record<string, string> = {
  invited: 'Invited',
  submitted: 'Submitted',
  resubmitted: 'Changed details after approval',
  approved: 'Approved',
  changes_requested: 'Sent back',
};

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : '');

function ReviewPanel({ row, onClose, onChanged }: { row: OverviewRow; onClose: () => void; onChanged: () => void }) {
  const [record, setRecord] = useState<OnboardingRecord | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'approve' | 'back' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const navigate = useNavigate();

  const reload = useCallback(() => {
    loadOnboardingForReview(row.id).then(setRecord, (err) => setProblem(errorMessage(err, 'Could not load the employee.')));
  }, [row.id]);

  useEffect(reload, [reload]);

  // a document accepted or rejected, or one asked for: what is missing changes here and in the list
  const documentsChanged = () => {
    reload();
    onChanged();
  };

  const decide = async (decision: 'approve' | 'back') => {
    setBusy(decision);
    setProblem(null);
    try {
      if (decision === 'approve') await approveOnboarding(row.id, comment);
      else await requestOnboardingChanges(row.id, comment);
      toast.success(decision === 'approve' ? `${row.name || row.employee_number} is approved` : 'Sent back to the employee');
      onChanged();
      onClose();
    } catch (err) {
      setProblem(errorMessage(err, 'That did not work.'));
    } finally {
      setBusy(null);
    }
  };

  const status = row.status;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-label={`Review ${row.name}`}>
      <div className="bg-white rounded-[10px] border border-border shadow-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink truncate">{row.name || row.employee_number}</h2>
            <p className="text-xs text-muted-foreground">
              {row.payroll_number} · {row.job_title || 'No position yet'}
              {row.submitted_at ? ` · submitted ${when(row.submitted_at)}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill label={statusLabel(status)} tone={statusTone(status)} />
            <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-muted-foreground hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {!record && !problem && <Loader2 className="h-5 w-5 animate-spin text-brand mx-auto" aria-label="Loading" />}
          {record && (
            <>
              {(record.missing.employee.length > 0 || record.missing.employer.length > 0) && (
                <div className="rounded-lg bg-orange-tint-alt px-3 py-2 text-sm text-ink space-y-1">
                  {record.missing.employee.length > 0 && (
                    <p><span className="font-medium">The employee still needs to give: </span>{record.missing.employee.join(', ')}</p>
                  )}
                  {record.missing.employer.length > 0 && (
                    <p><span className="font-medium">HR still needs to enter: </span>{record.missing.employer.join(', ')}</p>
                  )}
                </div>
              )}
              <OnboardingSummary record={record} />
              <section className="border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-ink mb-3">Documents and referees</h3>
                <DocumentsReview employeeId={row.id} onChanged={documentsChanged} />
              </section>
              <section className="border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-ink mb-3">Health</h3>
                <HealthReview employeeId={row.id} />
              </section>
              {record.history.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">History</h3>
                  <ul className="space-y-1 text-sm">
                    {record.history.map((h, i) => (
                      <li key={i} className="text-ink">
                        <span className="text-muted-foreground">{when(h.created_at)}</span> · {ACTION_LABELS[h.action] ?? h.action}
                        {h.comment ? `: “${h.comment}”` : ''}
                        {h.changed_fields?.length ? ` (${h.changed_fields.join(', ')})` : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border shrink-0 space-y-3">
          {(status === 'submitted' || status === 'approved') && (
            <label className="block">
              <span className="block text-xs font-medium text-ink mb-1">
                Comment {status === 'submitted' ? '(needed to send it back)' : '(needed to send it back for changes)'}
              </span>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="What should the employee change?" />
            </label>
          )}
          {problem && <p role="alert" className="text-sm text-status-danger">{problem}</p>}
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="ghost" icon={<Printer className="h-4 w-4" />} onClick={() => window.open(`/onboarding/${row.id}/print`, '_blank')}>
              Print
            </Button>
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => navigate(`/edit-employee/${encodeURIComponent(row.employee_number)}`)}>
              Edit HR details
            </Button>
            {(status === 'submitted' || status === 'approved') && (
              <Button variant="secondary" disabled={busy !== null} onClick={() => void decide('back')}
                icon={busy === 'back' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}>
                Send back
              </Button>
            )}
            {status === 'submitted' && (
              <Button disabled={busy !== null || !record || record.missing.employer.length > 0} onClick={() => void decide('approve')}
                icon={busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}>
                Approve
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type Filter = 'all' | OnboardingStatus;

export default function OnboardingReview() {
  const [rows, setRows] = useState<OverviewRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>('submitted');
  const [search, setSearch] = useState('');
  const [reviewing, setReviewing] = useState<OverviewRow | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const [settingDocuments, setSettingDocuments] = useState(false);

  const load = useCallback(() => {
    loadOnboardingOverview().then(setRows, (err) => {
      setRows([]);
      toast.error(errorMessage(err, 'Could not load onboarding.'));
    });
  }, []);

  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows?.length ?? 0 };
    for (const r of rows ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (filter === 'all' || r.status === filter) &&
        (!q || [r.name, r.employee_number, r.payroll_number, r.job_title, r.work_email].some((v) => String(v ?? '').toLowerCase().includes(q)))
    );
  }, [rows, filter, search]);

  const invite = async (r: OverviewRow) => {
    setInviting(r.id);
    const outcome = await inviteToOnboard(r.id, r.work_email);
    setInviting(null);
    if (outcome.status === 'sent') toast.success(`Invitation sent to ${outcome.email}`);
    else if (outcome.status === 'member') toast.success(`${outcome.email} already has access; they can open Onboarding in the staff portal`);
    else if (outcome.status === 'not-emailed') toast.error(`The email did not go out (${outcome.reason}). Send them this link: ${outcome.link}`, { duration: 15000 });
    else toast.error(outcome.reason);
    load();
  };

  const tabs = [{ id: 'all', label: `All (${counts.all})` }, ...ONBOARDING_STATUSES.map((s) => ({ id: s, label: `${STATUS_LABELS[s]} (${counts[s] ?? 0})` }))];

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader
        title="Onboarding"
        subtitle="Employees fill in their own details; you review and approve them. Only approved employees are paid."
        actions={<Button variant="secondary" icon={<FileCheck2 className="h-4 w-4" />} onClick={() => setSettingDocuments(true)}>Required documents</Button>}
      />

      <TabBar variant="pill" items={tabs} activeId={filter} onChange={(id) => setFilter(id as Filter)} />
      <div className="max-w-sm">
        <SearchInput placeholder="Search by name, number or position" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {rows === null ? (
        <Loader2 className="h-6 w-6 animate-spin text-brand mx-auto" aria-label="Loading" />
      ) : shown.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="Nobody here" description="No employees match this filter." />
      ) : (
        <div className="space-y-2">
          {shown.map((r) => (
            <Card key={r.id} padding="sm" className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm font-medium text-ink">{r.name || r.employee_number}</p>
                <p className="text-xs text-muted-foreground">
                  {r.payroll_number} · {r.job_title || 'No position yet'}
                  {r.work_email ? ` · ${r.work_email}` : ''}
                </p>
                {(r.employee_part.length > 0 || r.employer_part.length > 0) && r.status !== 'approved' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {r.employee_part.length > 0 && `Employee: ${r.employee_part.length} missing`}
                    {r.employee_part.length > 0 && r.employer_part.length > 0 && ' · '}
                    {r.employer_part.length > 0 && `HR: ${r.employer_part.join(', ')}`}
                  </p>
                )}
                {r.status === 'changes_requested' && r.review_comment && (
                  <p className="text-xs text-status-danger mt-1">Sent back: “{r.review_comment}”</p>
                )}
              </div>
              <StatusPill label={statusLabel(r.status)} tone={statusTone(r.status)} />
              {(r.status === 'draft' || r.status === 'invited') && (
                <Button variant="secondary" disabled={inviting !== null || !r.work_email} onClick={() => void invite(r)}
                  title={r.work_email ? undefined : 'Add a work email first'}
                  icon={inviting === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}>
                  {r.status === 'draft' ? 'Invite' : 'Resend invite'}
                </Button>
              )}
              <Button variant={r.status === 'submitted' ? 'primary' : 'secondary'} onClick={() => setReviewing(r)}>
                {r.status === 'submitted' ? 'Review' : 'View'}
              </Button>
            </Card>
          ))}
        </div>
      )}

      {reviewing && <ReviewPanel row={reviewing} onClose={() => setReviewing(null)} onChanged={load} />}
      {settingDocuments && <RequiredDocumentsModal onClose={() => { setSettingDocuments(false); load(); }} />}
    </div>
  );
}
