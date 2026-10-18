import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle, Info } from 'lucide-react';
import { Card, TableScroll } from '../../UI';
import { formatKsh, longDate } from '../../../lib/casualPay';
import { loadMyEarnings, loadMyPayouts } from '../../../lib/myWorkApi';
import { myPayoutTotals, type MyPayouts } from '../../../lib/piecePayouts';
import { formatQty } from '../../../lib/pieceRate';
import { EARNINGS_NOTE, earningsTotals, monthChoices, type MyEarnings as Earnings } from '../../../lib/myWork';
import { loadMyWorkSettlement, type MyWorkSettlement } from '../../../lib/workSettlementApi';

// What I have earned in a month: gross from approved work and approved jobs, with what is still waiting for approval
// kept apart, by kind of work and by week. Worked out by the database from my own rows (my_work_earnings). Before
// deductions: payouts (with their holdback) and the month-end payslip show what I take home. Also what payouts
// have paid me this month and what they held back (my_payouts, stage 4). Once the month's payroll is approved: that
// it was settled on my payslip, and what was paid at month end (my_work_settlement, stage 5).

export default function MyEarnings({ today }: { today: string }) {
  const months = useMemo(() => monthChoices(today, 12), [today]);
  const [month, setMonth] = useState(months[0].value);
  const [data, setData] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [payouts, setPayouts] = useState<MyPayouts | null>(null);
  const [settlement, setSettlement] = useState<MyWorkSettlement | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    loadMyEarnings(month)
      .then((d) => live && setData(d))
      .catch((err) => live && toast.error((err as Error).message))
      .finally(() => live && setLoading(false));
    setPayouts(null);
    // payouts during the month (stage 4); the earnings still show if this can't be read
    loadMyPayouts(month)
      .then((p) => live && setPayouts(p))
      .catch(() => live && setPayouts(null));
    // settled on my payslip? (stage 5); nothing shows if this can't be read
    setSettlement(null);
    Promise.resolve()
      .then(() => loadMyWorkSettlement(month))
      .then((st) => live && setSettlement(st))
      .catch(() => live && setSettlement(null));
    return () => {
      live = false;
    };
  }, [month]);

  const totals = earningsTotals(data);
  const paidOut = myPayoutTotals(payouts);
  const isThisMonth = month === months[0].value;

  return (
    <div className="space-y-3">
      <Card padding="sm">
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          Month
          <select aria-label="Month" className="rounded-lg border border-border px-2 py-1.5" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card padding="sm">
          <p className="m-0 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{isThisMonth ? 'Earned so far (approved)' : 'Earned (approved)'}</p>
          <p className="m-0 mt-1 text-[22px] font-bold text-ink" aria-label="Approved gross">{loading ? '...' : formatKsh(totals.approved)}</p>
          <p className="m-0 text-[11.5px] text-muted-foreground">Work {formatKsh(totals.work)} · Jobs {formatKsh(totals.jobs)}</p>
        </Card>
        <Card padding="sm">
          <p className="m-0 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Waiting for approval</p>
          <p className="m-0 mt-1 text-[22px] font-bold text-ink" aria-label="Waiting">{loading ? '...' : formatKsh(totals.waiting)}</p>
          <p className="m-0 text-[11.5px] text-muted-foreground">Not counted until your supervisor approves it</p>
        </Card>
      </div>

      <Card padding="sm">
        <p className="m-0 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Paid out</p>
        <p className="m-0 mt-1 text-[22px] font-bold text-ink" aria-label="Paid out">{formatKsh(paidOut.paid)}</p>
        <p className="m-0 text-[11.5px] text-muted-foreground" aria-label="Held back">
          {paidOut.count === 0
            ? 'Nothing paid out yet this month'
            : `${paidOut.count} ${paidOut.count === 1 ? 'payout' : 'payouts'} · ${formatKsh(paidOut.held)} held back, settled with your month-end pay`}
        </p>
      </Card>

      {settlement?.settled && (
        <div className="flex items-start gap-2 rounded-tile border border-brand/30 bg-green-tint p-3 text-[12px] text-ink" data-testid="work-settled">
          <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
          <span>
            <span className="font-semibold">Settled on your {months.find((m) => m.value === month)?.label.split(' ')[0] ?? ''} payslip.</span>{' '}
            {formatKsh(settlement.net_pay)} paid at month end
            {Number(settlement.paid_out) > 0 ? `, after ${formatKsh(settlement.paid_out)} paid out during the month` : ''}.
            {Number(settlement.arrears_carried_forward) > 0 && ` ${formatKsh(settlement.arrears_carried_forward)} is carried forward and taken from next month's pay.`}
          </span>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-tile border border-border bg-white p-3 text-[12px] text-ink">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-status-info" />
        <span>{EARNINGS_NOTE}</span>
      </div>

      {data && (
        <>
          <Card padding="none">
            <h3 className="m-0 px-3 pt-3 text-[12.5px] font-bold text-ink">By kind of work</h3>
            {data.by_type.length === 0 && Number(data.approved_jobs) === 0 ? (
              <p className="m-0 p-3 text-[12px] text-muted-foreground">Nothing recorded this month yet.</p>
            ) : (
              <TableScroll>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                      <th className="px-3 py-2 font-semibold">Work</th>
                      <th className="px-3 py-2 font-semibold text-right">Approved</th>
                      <th className="px-3 py-2 font-semibold text-right">Gross</th>
                      <th className="px-3 py-2 font-semibold text-right">Waiting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_type.map((t) => (
                      <tr key={t.work_type} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-semibold text-ink">{t.work_type}</td>
                        <td className="px-3 py-2 text-right">{formatQty(t.quantity)} {t.unit}</td>
                        <td className="px-3 py-2 text-right">{formatKsh(t.amount)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{Number(t.waiting_amount) ? formatKsh(t.waiting_amount) : '-'}</td>
                      </tr>
                    ))}
                    {(Number(data.approved_jobs) > 0 || Number(data.waiting_jobs) > 0) && (
                      <tr className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-semibold text-ink">Contract jobs</td>
                        <td className="px-3 py-2 text-right">{data.approved_job_count} {data.approved_job_count === 1 ? 'job' : 'jobs'}</td>
                        <td className="px-3 py-2 text-right">{formatKsh(data.approved_jobs)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{Number(data.waiting_jobs) ? formatKsh(data.waiting_jobs) : '-'}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>

          <Card padding="none">
            <h3 className="m-0 px-3 pt-3 text-[12.5px] font-bold text-ink">By week</h3>
            <ul className="list-none m-0 p-0 divide-y divide-border">
              {data.by_week.map((w) => (
                <li key={w.from} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12px]">
                  <span className="text-ink">{w.from === w.to ? longDate(w.from) : `${longDate(w.from)} to ${longDate(w.to)}`}</span>
                  <span className="ml-auto font-semibold text-ink">{formatKsh(Number(w.work) + Number(w.jobs))}</span>
                  {Number(w.waiting) > 0 && <span className="text-muted-foreground">+ {formatKsh(w.waiting)} waiting</span>}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
