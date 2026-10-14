import { useCallback, useEffect, useState } from 'react';
import { Card } from '../UI';
import ApprovalChain from './ApprovalChain';
import { ApprovalChain as Chain, LeaveAwaitingMe as Waiting, loadApprovalChains, loadLeaveAwaitingMe } from '../../lib/approvals';

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '');

/**
 * Leave waiting on the signed-in person's decision (FIG-829): a line manager or named approver may not have the
 * Leave page, so they approve or reject here. Shows nothing when nothing is waiting.
 */
export default function LeaveAwaitingMe() {
  const [items, setItems] = useState<Waiting[]>([]);
  const [chains, setChains] = useState<Record<string, Chain>>({});

  const load = useCallback(async () => {
    try {
      const waiting = await loadLeaveAwaitingMe();
      setItems(waiting);
      setChains(await loadApprovalChains('leave', waiting.map((w) => w.record_id)));
    } catch (e) {
      console.error('Could not load leave waiting on you:', e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!items.length) return null;

  return (
    <section className="mb-6" aria-labelledby="leave-awaiting-me">
      <h2 id="leave-awaiting-me" className="text-lg font-semibold text-gray-800 mb-3">Waiting for your approval</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {items.map((w) => (
          <Card key={w.request_id} className="flex flex-col gap-3">
            <div className="min-w-0">
              <p className="m-0 text-[13px] font-bold text-ink break-words">{w.name || w.employee_number}</p>
              <p className="m-0 text-[11.5px] text-muted-foreground break-words">
                {w.leave_type || 'Leave'} · {w.days ?? 0} day{w.days === 1 ? '' : 's'} · {day(w.start_date)} to {day(w.end_date)}
              </p>
              {w.reason && <p className="m-0 mt-1 text-[11.5px] text-ink break-words">{w.reason}</p>}
            </div>
            <ApprovalChain chain={chains[w.record_id]} onDecided={load} />
          </Card>
        ))}
      </div>
    </section>
  );
}
