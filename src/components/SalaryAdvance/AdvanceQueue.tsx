import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, HandCoins, RefreshCw, X } from 'lucide-react';
import { Button, Card, EmptyState, Modal, TabBar } from '../UI';
import AdvanceTimeline, { AdvanceStagePill, RepaymentSummary } from './AdvanceTimeline';
import RecordPaymentLink from '../Payments/RecordPaymentLink';
import { saveFailureMessage } from '../../lib/requireUpdated';
import { advanceAmount, formatKsh, queueTab, repaymentMonths, type AdvanceRow, type QueueTab } from '../../lib/salaryAdvance';
import { approveAdvance, declineAdvance, loadAdvanceQueue } from '../../lib/salaryAdvanceApi';
import { LoaderBlock } from '../UI/FigbloomLoader';
import ApprovalChain from '../Approvals/ApprovalChain';
import { decideApproval, loadApprovalChains, type ApprovalChain as Chain } from '../../lib/approvals';

// The approver's queue for salary advances: approve or decline what is pending, then follow it to paid.
//
//   * A request goes through the company's salary advance approvals (Settings > Approval workflows): Approve and
//     Decline decide the step it is waiting on, for whoever may decide it, and the chain shows under it. A request
//     with no chain (made before chains) is decided directly, by those who may decide.
//   * An approved advance is paid from Payments to make: finance pays it outside the app (bank or M-Pesa) and records
//     it there with its reference, which marks it paid and makes payroll take it back.

const TABS: { id: QueueTab; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'paid', label: 'Paid' },
  { id: 'declined', label: 'Declined' },
];

interface AdvanceQueueProps {
  /** may approve and decline (others see the queue only) */
  canDecide: boolean;
  /** something was saved; the older applications view reloads */
  onChanged?: () => void;
}

const dateText = (value: unknown) =>
  value ? new Date(String(value)).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export default function AdvanceQueue({ canDecide, onChanged }: AdvanceQueueProps) {
  const [rows, setRows] = useState<AdvanceRow[]>([]);
  const [chains, setChains] = useState<Record<string, Chain>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<QueueTab>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<AdvanceRow | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [declineTried, setDeclineTried] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadAdvanceQueue();
      setRows(data);
      const pending = data.filter((r) => queueTab(r) === 'pending' && r.id).map((r) => r.id!);
      setChains(await loadApprovalChains('salary_advance', pending).catch(() => ({})));
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
    const chain = chains[row.id!];
    const decline = chain ? () => decideApproval(chain.request_id, 'rejected', declineReason.trim()).then(() => undefined) : () => declineAdvance(row.id!, declineReason);
    if (await act(row, decline, `Declined ${row['Full Name'] ?? 'the request'}'s advance`)) {
      setDeclining(null);
    }
  };

  const list = byTab[tab];

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
            const chain = chains[id];
            // the chain says who may decide its step; without one, those who may decide on this screen
            const mayDecide = chain ? chain.can_approve : canDecide;
            const mayDecline = chain ? chain.can_reject : canDecide;
            const approve = async () => {
              if (!chain) return approveAdvance(id);
              const status = await decideApproval(chain.request_id, 'approved', '');
              if (status === 'pending') toast('Your step is approved. It now goes to the next approver.');
            };
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
                        {row.paid_by_email ? ` · recorded by ${row.paid_by_email}` : ''}
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

                  {tab === 'pending' && chain && (
                    <div className="mt-2">
                      <ApprovalChain chain={chain} compact />
                    </div>
                  )}

                  {tab === 'pending' && (mayDecide || mayDecline) && (
                    <div className="mt-auto pt-3 flex flex-wrap gap-2">
                      {mayDecide && (
                        <Button onClick={() => act(row, approve, `Approved ${name}'s advance`)} disabled={busy} icon={<Check className="w-3.5 h-3.5" />}>
                          Approve
                        </Button>
                      )}
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
                      <RecordPaymentLink />
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

    </div>
  );
}
