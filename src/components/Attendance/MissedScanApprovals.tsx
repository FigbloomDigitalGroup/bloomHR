import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, ScanLine, X } from 'lucide-react';
import { Button, Card, EmptyState } from '../UI';
import { LoaderBlock } from '../UI/FigbloomLoader';
import { inputClass } from '../Perfomance/kpis/shared';
import {
  decideMissedScan,
  loadMissedScans,
  missedScanDayLabel,
  missedScanTimes,
  missedScanWaitingOn,
  type MissedScan,
} from '../../lib/missedScanApi';

/**
 * "Missed scans" (migration 20261025100000): the requests waiting for the signed-in person (a manager their reports',
 * HR everyone's), each approved in one tap or declined with a comment. Approving records the day as HR's correction.
 */
export default function MissedScanApprovals() {
  const [items, setItems] = useState<MissedScan[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const pending = await loadMissedScans({ status: 'pending' });
      setItems(pending.filter((m) => m.canDecide));
      setProblem(null);
    } catch (e) {
      setItems([]);
      setProblem((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!items) return <Card><LoaderBlock label="Loading" compact /></Card>;
  if (problem) return <Card><p role="alert" className="text-[12px] text-status-danger">{problem}</p></Card>;
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon={<ScanLine size={20} />} title="No missed scans waiting" description="When someone says they forgot to scan, it shows here for you to approve." />
      </Card>
    );
  }
  return (
    <ul className="space-y-3 list-none p-0 m-0" aria-label="Missed scans waiting">
      {items.map((m) => <MissedScanItem key={m.id} item={m} onDecided={load} />)}
    </ul>
  );
}

function MissedScanItem({ item, onDecided }: { item: MissedScan; onDecided: () => void | Promise<void> }) {
  const [declining, setDeclining] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const decide = async (decision: 'approve' | 'decline') => {
    if (decision === 'decline' && !comment.trim()) return setProblem('Add a comment saying why');
    setBusy(true);
    setProblem(null);
    try {
      await decideMissedScan(item.id, decision, decision === 'decline' ? comment : undefined);
      toast.success(decision === 'approve' ? `Approved: ${item.employeeName}'s day is corrected` : 'Declined');
      await onDecided();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li>
      <Card padding="sm" className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-bold text-ink break-words">{item.employeeName}</p>
            <p className="m-0 text-[12px] text-muted-foreground">
              {item.employeeNumber} · {missedScanDayLabel(item.day)} · <span className="text-ink font-semibold">{missedScanTimes(item)}</span>
            </p>
            <p className="m-0 mt-1 text-[12px] text-ink break-words">"{item.reason}"</p>
            {item.approver === 'manager' && <p className="m-0 text-[11px] text-subtle">Sent to {missedScanWaitingOn(item)}</p>}
          </div>
          {!declining && (
            <div className="flex gap-2">
              <Button icon={<Check size={14} />} disabled={busy} aria-label={`Approve ${item.employeeName}'s missed scan`} onClick={() => void decide('approve')}>
                Approve
              </Button>
              <Button variant="secondary" icon={<X size={14} />} disabled={busy} aria-label={`Decline ${item.employeeName}'s missed scan`}
                onClick={() => setDeclining(true)}>
                Decline
              </Button>
            </div>
          )}
        </div>
        {declining && (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-start">
            <textarea rows={2} maxLength={300} className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)}
              aria-label="Why it is declined" placeholder="Why it is declined (they'll see this)" />
            <div className="flex gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => { setDeclining(false); setComment(''); setProblem(null); }}>Back</Button>
              <Button disabled={busy} onClick={() => void decide('decline')}>Decline</Button>
            </div>
          </div>
        )}
        {problem && <p role="alert" className="text-[12px] text-status-danger m-0">{problem}</p>}
      </Card>
    </li>
  );
}
