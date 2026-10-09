import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Banknote, Loader, RotateCcw, Send, Smartphone } from 'lucide-react';
import { Card } from '../UI';
import type { PayrollRun } from '../../lib/payrollRuns';
import {
  inProgress,
  loadRunPayments,
  queueRunPayments,
  retryFailedPayments,
  summarisePayments,
  type ChannelSummary,
  type PayrollPayment,
  type SkippedEmployee,
} from '../../lib/payrollPayments';

const REFRESH_MS = 10000;

const money = (n: number) => `KSh ${Math.round(n).toLocaleString()}`;

const button =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile text-[11.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

/** One channel's progress: paid, on the way, and what needs attention. */
function ChannelRow({ label, icon, summary }: { label: string; icon: JSX.Element; summary: ChannelSummary }) {
  if (summary.total === 0) return null;
  const { count, amount } = summary;
  const waiting = count.queued + count.sending;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink">
      <span className="inline-flex items-center gap-1.5 font-bold w-20">
        {icon}
        {label}
      </span>
      <span>
        <strong>{count.paid}</strong> of {summary.total} paid <span className="text-subtle">({money(amount.paid)})</span>
      </span>
      {count.sent > 0 && <span className="text-muted-foreground">{count.sent} sent, waiting for confirmation</span>}
      {waiting > 0 && <span className="text-muted-foreground">{waiting} queued</span>}
      {count.failed > 0 && <span className="text-status-danger font-semibold">{count.failed} failed</span>}
      {count.unknown > 0 && <span className="text-orange-text-alt font-semibold">{count.unknown} to check</span>}
    </div>
  );
}

/**
 * Paying an approved run (FIG-744): queue everyone paid by M-Pesa or bank, then follow the payments as the server
 * sends them. The page can be closed: the server keeps going.
 */
export default function RunPaymentsPanel({ run }: { run: PayrollRun }) {
  const [payments, setPayments] = useState<PayrollPayment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<SkippedEmployee[]>([]);

  const load = useCallback(async () => {
    try {
      setPayments(await loadRunPayments(run.id));
    } catch (err) {
      console.error('Could not load payments:', err);
    }
  }, [run.id]);

  useEffect(() => {
    setPayments(null);
    setSkipped([]);
    load();
  }, [load]);

  // follow payments on their way
  useEffect(() => {
    if (!payments || !inProgress(payments)) return;
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [payments, load]);

  const summary = useMemo(() => summarisePayments(payments ?? []), [payments]);
  const failed = (payments ?? []).filter((p) => p.status === 'failed');
  const unknown = (payments ?? []).filter((p) => p.status === 'unknown');
  const stillQueued = (payments ?? []).filter((p) => p.status === 'queued');

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the payments.');
    } finally {
      setBusy(false);
    }
  };

  const queue = () =>
    act(async () => {
      const result = await queueRunPayments(run.id);
      setSkipped(result.skipped);
      if (result.queued) toast.success(`${result.queued} payment(s) queued. The server sends them in batches; you can leave this page.`);
      else toast.success('Everyone who can be paid is already queued.');
    });

  const retry = () =>
    act(async () => {
      const { requeued } = await retryFailedPayments(run.id);
      toast.success(`${requeued} failed payment(s) queued again.`);
    });

  if (payments === null) {
    return (
      <Card className="text-[12px] text-muted-foreground flex items-center gap-2">
        <Loader className="w-3.5 h-3.5 animate-spin" /> Loading payments…
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[240px]">
          <div className="text-[13px] font-bold text-ink">Pay staff</div>
          <div className="text-[11.5px] text-muted-foreground">
            {payments.length === 0
              ? 'Sends each person their net pay by M-Pesa or to their bank account, from the server. Cash and Airtel staff are paid outside the app.'
              : 'The server sends payments in batches and records each one. You can close this page; it keeps going.'}
          </div>
        </div>
        <button type="button" onClick={queue} disabled={busy} className={`${button} bg-brand text-white hover:bg-brand-dark`}>
          {busy ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          {payments.length === 0 ? 'Pay staff' : 'Queue anyone not yet queued'}
        </button>
        {failed.length > 0 && (
          <button type="button" onClick={retry} disabled={busy} className={`${button} border border-border bg-white text-ink hover:bg-secondary`}>
            <RotateCcw className="w-3.5 h-3.5" />
            Retry {failed.length} failed
          </button>
        )}
      </div>

      {payments.length > 0 && (
        <div className="space-y-1.5">
          <ChannelRow label="M-Pesa" icon={<Smartphone className="w-3.5 h-3.5" />} summary={summary.mpesa} />
          <ChannelRow label="Bank" icon={<Banknote className="w-3.5 h-3.5" />} summary={summary.bank} />
        </div>
      )}

      {stillQueued.length > 0 && (
        <p className="text-[11px] text-subtle">
          Queued payments go out once the payment server is running with M-Pesa and bank access set up. Until then they wait here.
        </p>
      )}

      {failed.length > 0 && (
        <details className="text-[11.5px]">
          <summary className="cursor-pointer font-semibold text-status-danger">Failed ({failed.length}): safe to retry once fixed</summary>
          <ul className="mt-1 max-h-32 overflow-y-auto list-disc pl-5 text-ink">
            {failed.map((p) => (
              <li key={p.id}>
                {p.employee_name || p.employee_number} ({money(p.amount)}): {p.result_desc || 'failed'}
              </li>
            ))}
          </ul>
        </details>
      )}

      {unknown.length > 0 && (
        <details className="text-[11.5px]" open>
          <summary className="cursor-pointer font-semibold text-orange-text-alt">
            To check ({unknown.length}): these may have been paid, so they are never sent again automatically
          </summary>
          <ul className="mt-1 max-h-32 overflow-y-auto list-disc pl-5 text-ink">
            {unknown.map((p) => (
              <li key={p.id}>
                {p.employee_name || p.employee_number} ({money(p.amount)}, {p.channel === 'mpesa' ? p.phone : `${p.bank_name} ${p.account_number}`}):{' '}
                {p.result_desc}
              </li>
            ))}
          </ul>
        </details>
      )}

      {skipped.length > 0 && (
        <details className="text-[11.5px]">
          <summary className="cursor-pointer font-semibold text-muted-foreground">Not paid from here ({skipped.length})</summary>
          <ul className="mt-1 max-h-32 overflow-y-auto list-disc pl-5 text-ink">
            {skipped.map((s) => (
              <li key={s.employee_number}>
                {s.employee_name || s.employee_number}: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
