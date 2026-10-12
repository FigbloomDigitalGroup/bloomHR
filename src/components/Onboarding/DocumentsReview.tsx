import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Eye, FileText, Loader2, X } from 'lucide-react';
import { StatusPill } from '../UI';
import {
  type ChecklistItem,
  DOCUMENT_STATUS_LABELS,
  type DocumentSection,
  type EmployeeDocument,
  type Referee,
  SECTION_TITLES,
  acceptDocument,
  loadChecklist,
  loadDocuments,
  loadEmployeeRequirements,
  loadReferees,
  openDocument,
  rejectDocument,
  setEmployeeRequirement,
} from '../../lib/employeeDocuments';

// HR's view of an employee's documents and referees (in the Onboarding review panel): open each file, accept it or
// reject it with a reason, and ask this employee for role-specific documents.

const STATUS_TONE = { pending: 'warning', accepted: 'success', rejected: 'danger' } as const;
const SECTIONS: DocumentSection[] = ['core', 'qualifications', 'role', 'claims'];
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

function FileLine({ doc, onChanged }: { doc: EmployeeDocument; onChanged: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setRejecting(false);
      onChanged();
    } catch (err) {
      toast.error(errorText(err, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-ink truncate max-w-[240px]">{doc.file_name}</span>
        <StatusPill label={DOCUMENT_STATUS_LABELS[doc.status]} tone={STATUS_TONE[doc.status]} />
        <button type="button" className="inline-flex items-center gap-1 text-brand"
          onClick={() => openDocument(doc).catch((err) => toast.error(errorText(err, 'The file could not be opened.')))}>
          <Eye className="h-3.5 w-3.5" /> View
        </button>
        {doc.status !== 'accepted' && (
          <button type="button" disabled={busy} onClick={() => void act(() => acceptDocument(doc.id))}
            className="inline-flex items-center gap-1 text-status-success font-semibold">
            <Check className="h-3.5 w-3.5" /> Accept
          </button>
        )}
        {doc.status !== 'rejected' && !rejecting && (
          <button type="button" disabled={busy} onClick={() => setRejecting(true)} className="inline-flex items-center gap-1 text-status-danger font-semibold">
            <X className="h-3.5 w-3.5" /> Reject
          </button>
        )}
      </div>
      {doc.status === 'rejected' && doc.review_note && <p className="ml-5 mt-0.5 text-status-danger">Rejected: “{doc.review_note}”</p>}
      {rejecting && (
        <div className="ml-5 mt-1 flex flex-wrap gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? The employee sees this"
            className="flex-1 min-w-[200px] rounded-lg border border-border px-2 py-1 text-xs" aria-label={`Reason for rejecting ${doc.file_name}`} />
          <button type="button" disabled={busy || !reason.trim()} onClick={() => void act(() => rejectDocument(doc.id, reason))}
            className="rounded-lg bg-status-danger px-2 py-1 text-white font-semibold disabled:opacity-50">Reject</button>
          <button type="button" onClick={() => setRejecting(false)} className="text-muted-foreground">Cancel</button>
        </div>
      )}
    </li>
  );
}

export default function DocumentsReview({ employeeId, onChanged }: { employeeId: string; onChanged: () => void }) {
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [files, setFiles] = useState<EmployeeDocument[]>([]);
  const [asked, setAsked] = useState<string[]>([]);
  const [referees, setReferees] = useState<Referee[]>([]);

  const load = useCallback(async () => {
    try {
      const [c, f, a, r] = await Promise.all([loadChecklist(employeeId), loadDocuments(employeeId), loadEmployeeRequirements(employeeId), loadReferees(employeeId)]);
      setChecklist(c);
      setFiles(f);
      setAsked(a);
      setReferees(r);
    } catch (err) {
      setChecklist([]);
      toast.error(errorText(err, 'Could not load the documents.'));
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = () => {
    void load();
    onChanged();
  };

  const toggleAsk = async (code: string, on: boolean) => {
    try {
      await setEmployeeRequirement(employeeId, code, on);
      changed();
    } catch (err) {
      toast.error(errorText(err, 'The change was not saved.'));
    }
  };

  if (!checklist) return <Loader2 className="h-5 w-5 animate-spin text-brand" aria-label="Loading documents" />;

  // role-specific types the company does not already require: HR may ask this employee for them
  const askable = checklist.filter((i) => i.section === 'role' && (!i.required || asked.includes(i.code)));

  return (
    <div className="space-y-5">
      {SECTIONS.map((section) => {
        const items = checklist.filter((i) => i.section === section && (i.required || files.some((f) => f.code === i.code)));
        if (items.length === 0) return null;
        return (
          <section key={section} className="break-inside-avoid">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{SECTION_TITLES[section]}</h3>
            <ul className="space-y-2">
              {items.map((item) => {
                const mine = files.filter((f) => f.code === item.code);
                return (
                  <li key={item.code} className="border-b border-border/60 pb-2">
                    <p className="text-sm text-ink">
                      {item.label}
                      {item.required && <span className="text-xs text-muted-foreground"> · required</span>}
                    </p>
                    {mine.length === 0 ? (
                      <p className="text-xs text-status-danger">Not uploaded yet</p>
                    ) : (
                      <ul className="mt-1 space-y-1">{mine.map((d) => <FileLine key={d.id} doc={d} onChanged={changed} />)}</ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {askable.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Also ask this employee for</h3>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {askable.map((i) => (
              <label key={i.code} className="inline-flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={asked.includes(i.code)} onChange={(e) => void toggleAsk(i.code, e.target.checked)} />
                {i.label}
              </label>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Referees</h3>
        {referees.length === 0 ? (
          <p className="text-xs text-status-danger">None given yet</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {referees.map((r) => (
              <li key={r.id} className="text-ink">
                <span className="font-medium">{r.full_name}</span>
                {[r.position, r.organisation].filter(Boolean).length ? `, ${[r.position, r.organisation].filter(Boolean).join(', ')}` : ''}
                {r.relationship ? ` (${r.relationship})` : ''}
                <span className="text-muted-foreground"> · {[r.phone, r.email].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
