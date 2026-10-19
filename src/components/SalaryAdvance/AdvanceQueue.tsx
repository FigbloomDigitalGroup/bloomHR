import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Banknote, Check, CheckCircle2, HandCoins, RefreshCw, X } from 'lucide-react';
import { Button, Card, EmptyState, Modal, TabBar } from '../UI';
import AdvanceTimeline, { AdvanceStagePill, RepaymentSummary } from './AdvanceTimeline';
import PayAdvanceModal, { DemoTag } from './PayAdvanceModal';
import { IN_APP_PAYMENTS, PAYMENTS_DEMO } from '../../lib/inAppPayments';
import { saveFailureMessage } from '../../lib/requireUpdated';
import {
  advanceAmount,
  advancePeriod,
  checkPayee,
  formatKsh,
  periodLabel,
  queueTab,
  repaymentMonths,
  repaymentSchedule,
  type AdvanceRow,
  type PayeeRecord,
  type QueueTab,
} from '../../lib/salaryAdvance';
import { approveAdvance, declineAdvance, loadAdvanceQueue, loadPayees, markAdvancePaid } from '../../lib/salaryAdvanceApi';
import { LoaderBlock } from '../UI/FigbloomLoader';

// The approver's queue for salary advances: approve or decline what is pending, then record the payment.
//
//   * "Mark as paid" is the real step: finance paid the advance outside the app (bank or M-Pesa bulk upload), and
//     marking it paid is what makes payroll take it back.
//   * "Pay advance" only appears for demos (PAYMENTS_DEMO while IN_APP_PAYMENTS is off). It walks through paying from
//     the platform without sending or saving anything.

const TABS: { id: QueueTab; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'paid', label: 'Paid' },
  { id: 'declined', label: 'Declined' },
];

const showDemoPay = PAYMENTS_DEMO && !IN_APP_PAYMENTS;

interface AdvanceQueueProps {
  /** may approve, decline and record payments (others see the queue only) */
  canDecide: boolean;
  /** something was saved; the older applications view reloads */
  onChanged?: () => void;
  /** how long the demo payment takes */
  demoDelayMs?: number;
}

const dateText = (value: unknown) =>
  value ? new Date(String(value)).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export default function AdvanceQueue({ canDecide, onChanged, demoDelayMs }: AdvanceQueueProps) {
  const [rows, setRows] = useState<AdvanceRow[]>([]);
  const [payees, setPayees] = useState<Record<string, PayeeRecord>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<QueueTab>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<AdvanceRow | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [declineTried, setDeclineTried] = useState(false);
  const [markingPaid, setMarkingPaid] = useState<AdvanceRow | null>(null);
  const [paying, setPaying] = useState<AdvanceRow | null>(null);
  // demo payments, in this screen only: id -> where it "went"
  const [demoSent, setDemoSent] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadAdvanceQueue();
      setRows(data);
      setPayees(await loadPayees(data.map((r) => String(r['Employee Number'] ?? ''))));
    } catch (error) {
      console.error('Error loading salary advance queue:', error);
      toast.error('Could not load salary advance requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byTab = useMemo(() => {
    const out: Record<QueueTab, AdvanceRow[]> = { pending: [], approved: [], paid: [], declined: [] };
    for (const r of rows) out[queueTab(r)].push(r);
    return out;
  }, [rows]);

  const act = async (row: AdvanceRow, action: () => Promise<void>, done: string) => {
    if (!row.id) return;
    setBusyId(row.id);
    try {
      await action();
      toast.success(done);
      await load();
      onChanged?.();
      return true;
    } catch (error) {
      console.error('Error saving salary advance:', error);
      toast.error(saveFailureMessage(error, 'Not saved. Please try again.'));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const confirmDecline = async () => {
    setDeclineTried(true);
    if (!declining || !declineReason.trim()) return;
    const row = declining;
    if (await act(row, () => declineAdvance(row.id!, declineReason), `Declined ${row['Full Name'] ?? 'the request'}'s advance`)) {
      setDeclining(null);
    }
  };

  const confirmMarkPaid = async () => {
    if (!markingPaid) return;
    const row = markingPaid;
    if (await act(row, () => markAdvancePaid(row.id!), `Marked ${row['Full Name'] ?? 'the advance'} as paid. Payroll will take it back.`)) {
      setMarkingPaid(null);
      setDemoSent((s) => {
        const next = { ...s };
        delete next[row.id!];
        return next;
      });
    }
  };

  const list = byTab[tab];
  const markPaidSchedule = markingPaid ? repaymentSchedule(advanceAmount(markingPaid), repaymentMonths(markingPaid), advancePeriod(markingPaid.time_added)) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabBar
          variant="pill"
          items={TABS.map((t) => ({ id: t.id, label: `${t.label} (${byTab[t.id].length})` }))}
          activeId={tab}
          onChange={(id) => setTab(id as QueueTab)}
        />
        <div className="flex items-center gap-2">
          {showDemoPay && <DemoTag />}
          <Button variant="secondary" onClick={load} disabled={loading} icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}>
            Refresh
          </Button>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <Card>
          <LoaderBlock label="Loading requests" compact />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HandCoins className="w-5 h-5" />}
            title={tab === 'pending' ? 'Nothing waiting for approval' : `No ${tab} advances`}
            description={tab === 'pending' ? 'New requests from staff show here.' : undefined}
          />
        </Card>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {list.map((row) => {
            const id = row.id!;
            const name = row['Full Name'] || String(row['Employee Number'] ?? '');
            const months = repaymentMonths(row);
            const busy = busyId === id;
            return (
              <li key={id} data-testid={`advance-${id}`}>
                <Card className="h-full flex flex-col">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-bold text-ink break-words">{name}</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {row['Employee Number']} · asked {dateText(row.time_added)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[15px] font-bold text-ink">{formatKsh(advanceAmount(row))}</div>
                      <div className="text-[11px] text-muted-foreground">{months === 1 ? 'repaid in one month' : `over ${months} months`}</div>
                    </div>
                  </div>

                  {row['Reason for Advance'] && <p className="mt-2 text-[12px] text-ink break-words">“{row['Reason for Advance']}”</p>}

                  <div className="mt-3">
                    <AdvanceTimeline row={row} />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <AdvanceStagePill row={row} />
                    {row.approved_by_email && tab !== 'pending' && tab !== 'declined' && (
                      <span className="text-[11px] text-muted-foreground">
                        Approved by {row.approved_by_email} {dateText(row.admin_approval_date)}
                      </span>
                    )}
                    {tab === 'paid' && (row.paid_by_email || row.payment_date) && (
                      <span className="text-[11px] text-muted-foreground">
                        Paid {dateText(row.payment_date)}
                        {row.paid_by_email ? ` · marked by ${row.paid_by_email}` : ''}
                      </span>
                    )}
                  </div>

                  {tab === 'declined' && (
                    <p className="mt-2 text-[12px] text-status-danger">
                      <strong>Reason:</strong> {row.admin_notes || 'No reason given.'}
                      {row.rejected_by_email ? ` (${row.rejected_by_email})` : ''}
                    </p>
                  )}

                  {tab === 'paid' && (
                    <div className="mt-3">
                      <RepaymentSummary row={row} />
                    </div>
                  )}

                  {demoSent[id] && (
                    <p className="mt-2 text-[11.5px] text-status-purple">
                      Demo payment shown to {demoSent[id]}. Nothing was sent: mark it paid once finance has paid it.
                    </p>
                  )}

                  {canDecide && tab === 'pending' && (
                    <div className="mt-auto pt-3 flex flex-wrap gap-2">
                      <Button
                        onClick={() => act(row, () => approveAdvance(id), `Approved ${name}'s advance`)}
                        disabled={busy}
                        icon={<Check className="w-3.5 h-3.5" />}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setDeclining(row);
                          setDeclineReason('');
                          setDeclineTried(false);
                        }}
                        disabled={busy}
                        icon={<X className="w-3.5 h-3.5" />}
                      >
                        Decline
                      </Button>
                    </div>
                  )}

                  {canDecide && tab === 'approved' && (
                    <div className="mt-auto pt-3 flex flex-wrap gap-2">
                      {showDemoPay && (
                        <Button onClick={() => setPaying(row)} disabled={busy} icon={<Banknote className="w-3.5 h-3.5" />} title="Demo: nothing is sent">
                          Pay advance (demo)
                        </Button>
                      )}
                      <Button
                        variant={showDemoPay ? 'secondary' : 'primary'}
                        onClick={() => setMarkingPaid(row)}
                        disabled={busy}
                        icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                        title="Finance paid it outside the app"
                      >
                        Mark as paid
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={!!declining} onClose={() => setDeclining(null)} title="Decline advance" size="md">
        {declining && (
          <>
            <p className="text-[12.5px] text-ink mb-3">
              Decline {declining['Full Name']}'s request for {formatKsh(advanceAmount(declining))}? They will see the reason.
            </p>
            <label htmlFor="decline-reason" className="block text-[12px] font-semibold text-ink mb-1">
              Reason
            </label>
            <textarea
              id="decline-reason"
              rows={3}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-border rounded-tile focus:outline-none focus:ring-2 focus:ring-brand/40"
              placeholder="For example: an advance from last month is still being repaid"
            />
            {declineTried && !declineReason.trim() && (
              <p className="mt-1 text-[11.5px] text-status-danger" role="alert">
                Give a reason so they know why.
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeclining(null)}>
                Cancel
              </Button>
              <Button onClick={confirmDecline} disabled={busyId === declining.id}>
                Decline
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!markingPaid} onClose={() => setMarkingPaid(null)} title="Mark as paid" size="md">
        {markingPaid && (
          <>
            <p className="text-[12.5px] text-ink">
              Record that finance has paid {markingPaid['Full Name']} {formatKsh(advanceAmount(markingPaid))} outside the app. This does not send any money.
            </p>
            <div className="mt-3 p-3 rounded-tile bg-secondary text-[12px] text-ink">
              <div className="font-semibold mb-1">Payroll will take it back:</div>
              <ul className="space-y-0.5">
                {markPaidSchedule.map((i) => (
                  <li key={i.period}>
                    {formatKsh(i.amount)} off {periodLabel(i.period)} pay
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setMarkingPaid(null)}>
                Cancel
              </Button>
              <Button onClick={confirmMarkPaid} disabled={busyId === markingPaid.id}>
                Mark as paid
              </Button>
            </div>
          </>
        )}
      </Modal>

      {showDemoPay && (
        <PayAdvanceModal
          advance={paying}
          payee={paying ? checkPayee(payees[String(paying['Employee Number'] ?? '')]) : null}
          onClose={() => setPaying(null)}
          onSent={(row, destination) => setDemoSent((s) => ({ ...s, [row.id!]: destination }))}
          delayMs={demoDelayMs}
        />
      )}
    </div>
  );
}
