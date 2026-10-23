import { useCallback, useEffect, useState } from 'react';
import { Card } from '../UI';
import ApprovalChain from './ApprovalChain';
import {
  MONEY_KIND_NOUN,
  loadApprovalChains,
  loadMoneyAwaitingMe,
  type ApprovalChain as Chain,
  type MoneyAwaitingMe as Waiting,
  type MoneyKind,
} from '../../lib/approvals';

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '');

/**
 * Loans, salary advances, expense claims and requisitions waiting on the signed-in person's decision (FIG-1210): a
 * line manager or named approver on the company's chain may not have the Loans or Salary Advance screens, so they
 * approve or reject here. Shows nothing when nothing is waiting.
 */
export default function MoneyAwaitingMe() {
  const [items, setItems] = useState<Waiting[]>([]);
  const [chains, setChains] = useState<Record<string, Chain>>({});

  const load = useCallback(async () => {
    try {
      const waiting = await loadMoneyAwaitingMe();
      setItems(waiting);
      const kinds = [...new Set(waiting.map((w) => w.kind))] as MoneyKind[];
      const loaded = await Promise.all(kinds.map((k) => loadApprovalChains(k, waiting.filter((w) => w.kind === k).map((w) => w.record_id))));
      setChains(Object.assign({}, ...loaded));
    } catch (e) {
      console.error('Could not load requests waiting on you:', e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!items.length) return null;

  return (
    <section className="mb-6" aria-labelledby="money-awaiting-me">
      <h2 id="money-awaiting-me" className="text-lg font-semibold text-gray-800 mb-3">Money requests waiting for your approval</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {items.map((w) => (
          <Card key={w.request_id} className="flex flex-col gap-3" data-testid={`money-awaiting-${w.request_id}`}>
            <div className="min-w-0">
              <p className="m-0 text-[11.5px] font-semibold text-muted-foreground">
                {MONEY_KIND_NOUN[w.kind]} · {w.step_label} · {day(w.created_at)}
              </p>
              <p className="m-0 mt-0.5 text-[13px] font-bold text-ink break-words">{w.summary}</p>
            </div>
            <ApprovalChain chain={chains[w.record_id]} onDecided={load} />
          </Card>
        ))}
      </div>
    </section>
  );
}
