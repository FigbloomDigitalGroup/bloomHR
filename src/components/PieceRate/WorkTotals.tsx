import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Sigma } from 'lucide-react';
import { Card, EmptyState, StatusPill, TableScroll } from '../UI';
import { formatKsh, today } from '../../lib/casualPay';
import { loadTotals } from '../../lib/pieceRateApi';
import { FREQUENCY_LABEL, KIND_LABEL, formatQty, monthOf, round2, type WorkTotal } from '../../lib/pieceRate';

// Running totals for a period, per worker: what they produced of each kind of work and its gross (approved work only),
// what is still waiting for approval, and approved contract jobs. Read-only: the payout and month-end stages pay from
// these. Gross is before any deductions or holdbacks.

export default function WorkTotals() {
  const [from, setFrom] = useState(() => monthOf(today()).from);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<WorkTotal[] | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    loadTotals(from, to)
      .then((r) => live && setRows(r))
      .catch((err) => {
        if (!live) return;
        toast.error((err as Error).message);
        setRows([]);
      });
    return () => {
      live = false;
    };
  }, [from, to]);

  const sum = (pick: (r: WorkTotal) => number | string) => round2((rows ?? []).reduce((s, r) => s + Number(pick(r)), 0));

  return (
    <Card padding="none">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border text-xs">
        <label className="inline-flex items-center gap-1.5">
          From <input type="date" aria-label="From" className="rounded-lg border border-border px-2 py-1" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="inline-flex items-center gap-1.5">
          to <input type="date" aria-label="To" className="rounded-lg border border-border px-2 py-1" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        {rows && rows.length > 0 && (
          <span className="ml-auto text-[12.5px] text-ink">
            Approved gross <strong>{formatKsh(sum((r) => r.approved_amount) + sum((r) => r.jobs_approved_amount))}</strong>
            {sum((r) => r.waiting_amount) > 0 && <span className="text-muted-foreground"> · {formatKsh(sum((r) => r.waiting_amount))} waiting</span>}
          </span>
        )}
      </div>
      {!rows || rows.length === 0 ? (
        <EmptyState icon={<Sigma className="w-5 h-5" />} title={rows ? 'No work in this period' : 'Loading...'} />
      ) : (
        <TableScroll>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                <th className="px-3 py-2 font-semibold">Worker</th>
                <th className="px-3 py-2 font-semibold">Work done (approved)</th>
                <th className="px-3 py-2 font-semibold text-right">Work gross</th>
                <th className="px-3 py-2 font-semibold text-right">Jobs approved</th>
                <th className="px-3 py-2 font-semibold text-right">Gross so far</th>
                <th className="px-3 py-2 font-semibold text-right">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_number} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink">{r.worker_name}</div>
                    <div className="flex flex-wrap items-center gap-1 text-[10.5px] text-subtle">
                      {r.employee_number}
                      {r.worker_kind === 'contractor' && <StatusPill label={KIND_LABEL.contractor} tone="info" />}
                      {r.pay_frequency && <span>· paid {FREQUENCY_LABEL[r.pay_frequency].toLowerCase()}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {r.lines.length === 0 ? <span className="text-muted-foreground">None yet</span> : (
                      <ul className="m-0 p-0 list-none">
                        {r.lines.map((l) => <li key={l.work_type}>{formatQty(l.quantity)} {l.unit} {l.work_type}</li>)}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatKsh(r.approved_amount)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatKsh(r.jobs_approved_amount)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">{formatKsh(Number(r.approved_amount) + Number(r.jobs_approved_amount))}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                    {Number(r.waiting_amount) > 0 ? `${formatKsh(r.waiting_amount)} (${r.waiting_entries})` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}
