import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronUp, FileText, Loader2 } from 'lucide-react';
import { type PolicyItem, acceptPolicy, loadPolicyChecklist, openPolicyFile } from '../../lib/companyPolicies';

// The employee's agreements: each company policy with its own checkbox. Ticking it is their signature for that
// version; it can't be unticked. A new version of a policy is accepted again.

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const date = (iso: string) => new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

function Agreement({ p, onAccepted }: { p: PolicyItem; onAccepted: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      await acceptPolicy(p.version_id);
      onAccepted();
    } catch (err) {
      toast.error(errorText(err, 'Your acceptance was not saved.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 min-w-[200px] text-sm font-medium text-ink">
          {p.title}
          {p.required ? <span className="text-status-danger"> *</span> : <span className="text-xs text-muted-foreground font-normal"> (optional)</span>}
          <span className="text-xs text-muted-foreground font-normal"> · version {p.version}</span>
        </p>
        {p.body && (
          <button type="button" onClick={() => setOpen(!open)} className="text-xs text-brand inline-flex items-center gap-1">
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} {open ? 'Hide' : 'Read'}
          </button>
        )}
        {p.file_path && (
          <button type="button" className="text-xs text-brand inline-flex items-center gap-1"
            onClick={() => openPolicyFile(p.file_path as string).catch((err) => toast.error(errorText(err, 'The file could not be opened.')))}>
            <FileText className="h-3.5 w-3.5" /> {p.file_name || 'Open document'}
          </button>
        )}
      </div>
      {open && p.body && <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-secondary px-3 py-2 text-xs text-ink">{p.body}</div>}
      <label className="mt-2 flex items-start gap-2 text-sm text-ink">
        {busy ? <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-brand" /> : (
          <input type="checkbox" className="mt-1" checked={Boolean(p.accepted_at)} disabled={Boolean(p.accepted_at)} onChange={() => void accept()} />
        )}
        <span>
          I have read and agree to the {p.title}.
          {p.accepted_at && <span className="text-xs text-status-success"> Signed {date(p.accepted_at)}</span>}
        </span>
      </label>
    </li>
  );
}

export default function AgreementsSection({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<PolicyItem[] | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await loadPolicyChecklist());
    } catch (err) {
      setItems([]);
      toast.error(errorText(err, 'Could not load the company policies.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!items) return <Loader2 className="h-5 w-5 animate-spin text-brand" aria-label="Loading policies" />;
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Your company has no policies for you to accept.</p>;
  return (
    <ul className="space-y-2">
      {items.map((p) => (
        <Agreement key={p.version_id} p={p} onAccepted={() => { void load(); onChanged?.(); }} />
      ))}
    </ul>
  );
}
