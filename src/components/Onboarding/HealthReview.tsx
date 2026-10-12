import { useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, FileText, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '../UI';
import { HEALTH_KIND_LABELS, type HealthInfo, loadHealth, openHealthFile } from '../../lib/employeeHealth';

// HR's view of an employee's health information, in the Onboarding review panel. It loads only when HR asks, because
// every look is recorded.

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export default function HealthReview({ employeeId }: { employeeId: string }) {
  const [info, setInfo] = useState<HealthInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const show = async () => {
    setBusy(true);
    try {
      setInfo(await loadHealth(employeeId));
    } catch (err) {
      toast.error(errorText(err, 'Could not load the health information.'));
    } finally {
      setBusy(false);
    }
  };

  if (!info) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">
          Health information is private. It is shown only when you ask, and each time you look is recorded.
        </p>
        <Button variant="secondary" icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
          disabled={busy} onClick={() => void show()}>
          Show health information
        </Button>
      </div>
    );
  }

  if (!info.consent_given_at) return <p className="text-sm text-muted-foreground">The employee has not shared any health information.</p>;
  if (info.records.length === 0) return <p className="text-sm text-muted-foreground">The employee consented but has not added anything.</p>;

  return (
    <ul className="space-y-2">
      {info.records.map((r) => (
        <li key={r.id} className="rounded-lg border border-border px-3 py-2 text-sm">
          <p className="font-medium text-ink">{r.title} <span className="text-xs text-muted-foreground font-normal">· {HEALTH_KIND_LABELS[r.kind]}</span></p>
          <p className="text-xs text-muted-foreground">{[r.institution, r.diagnosed_on].filter(Boolean).join(' · ')}</p>
          {r.details && <p className="text-xs text-ink mt-1">{r.details}</p>}
          {(r.files ?? []).map((f) => (
            <button key={f.id} type="button" className="mt-1 mr-3 inline-flex items-center gap-1 text-xs text-brand"
              onClick={() => openHealthFile(f).catch((err) => toast.error(errorText(err, 'The document could not be opened.')))}>
              <FileText className="h-3.5 w-3.5" /> {f.file_name} <Eye className="h-3.5 w-3.5" />
            </button>
          ))}
        </li>
      ))}
    </ul>
  );
}
