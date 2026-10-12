import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { type PolicyItem, loadPolicyChecklist } from '../../lib/companyPolicies';

// HR's view of which company policies an employee has accepted, and when (in the Onboarding review panel).

const date = (iso: string) => new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

export default function AgreementsReview({ employeeId }: { employeeId: string }) {
  const [items, setItems] = useState<PolicyItem[] | null>(null);

  useEffect(() => {
    loadPolicyChecklist(employeeId).then(setItems, () => setItems([]));
  }, [employeeId]);

  if (!items) return <Loader2 className="h-5 w-5 animate-spin text-brand" aria-label="Loading policies" />;
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No company policies yet. Add them with Policies on the Onboarding page.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {items.map((p) => (
        <li key={p.version_id} className="flex justify-between gap-3 border-b border-border/60 py-1">
          <span className="text-ink">{p.title} <span className="text-xs text-muted-foreground">v{p.version}{p.required ? '' : ', optional'}</span></span>
          {p.accepted_at
            ? <span className="text-xs text-status-success">Accepted {date(p.accepted_at)}</span>
            : <span className={`text-xs ${p.required ? 'text-status-danger' : 'text-muted-foreground'}`}>Not accepted</span>}
        </li>
      ))}
    </ul>
  );
}
