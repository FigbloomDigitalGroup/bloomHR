import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Ban, Check, CheckCircle2, ClipboardList, Hourglass, Plus, RefreshCw, Wallet, WalletCards, X } from 'lucide-react';
import { Button, Card, EmployeePicker, EmptyState, Modal, PageHeader, StatCard, StatusPill, TabBar } from '../UI';
import type { StatusTone } from '../UI/StatusPill';
import { LoaderBlock } from '../UI/FigbloomLoader';
import { confirmDialog } from '../../lib/confirmDialog';
import { formatKsh } from '../../lib/loans';
import { usePermissions } from '../../hooks/usePermissions';
import { useEmployeeDirectory } from '../../hooks/useEmployeeDirectory';
import {
  PAID_VIA,
  REQUISITION_CATEGORIES,
  SOURCE_LABEL,
  approveRequisition,
  cancelRequisition,
  createRequisition,
  declineRequisition,
  loadPayees,
  loadPayments,
  loadRequisitions,
  paidViaLabel,
  payeeLine,
  recordPayment,
  type NewRequisition,
  type PaidVia,
  type Payee,
  type PaymentRequest,
  type Requisition,
  type RequisitionStatus,
} from '../../lib/paymentsApi';

// Payments to make (FIG-1209): what HR approved, for finance to pay. The app can't move money yet, so finance pays
// each item outside it (bank, M-Pesa, another app, cash, cheque) and records how, with the reference; recording it
// marks the advance, loan, expense or requisition paid and tells the employee. HR raises and approves requisitions
// (any other payment) on the third tab.
//
//   * To pay / Paid: the 'payments' module (finance). Administrators hold every module.
//   * Requisitions: the 'requisitions' module approves and raises them; finance sees them read-only.

type Tab = 'to_pay' | 'paid' | 'requisitions';

const inputClass =
  'w-full px-3 py-2 text-[13px] border border-border rounded-tile bg-white focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand';

// the database's own reason ("Enter the payment reference..."), or a general one
const failure = (error: unknown) => (error instanceof Error && error.message) || 'Not saved. Please try again.';

const dateText = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** Today in the browser's time zone, as the date input wants it (YYYY-MM-DD). */
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const REQUISITION_STATUS: Record<RequisitionStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved, to pay', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  rejected: { label: 'Turned down', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

interface RecordForm {
  via: PaidVia;
  reference: string;
  paidOn: string;
  note: string;
}

const emptyRequisition = (): NewRequisition => ({
  payeeType: 'employee',
  employeeNumber: '',
  payeeName: '',
  payeeDetails: '',
  category: '',
  amount: 0,
  purpose: '',
  neededBy: '',
  approve: true,
});

export default function PaymentsToMake() {
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canPay = !permissionsLoading && hasPermission('payments');
  const canApprove = !permissionsLoading && hasPermission('requisitions');
  const { employees } = useEmployeeDirectory();
  const nameOf = useCallback((number: string | null) => (number ? employees.find((e) => e.employeeNumber === number)?.fullName || number : ''), [employees]);

  const [searchParams, setSearchParams] = useSearchParams();
  const asked = searchParams.get('tab') as Tab | null;
  const tabs: Tab[] = canPay ? ['to_pay', 'paid', 'requisitions'] : ['requisitions'];
  const tab: Tab = asked && tabs.includes(asked) ? asked : tabs[0];
  const setTab = (id: Tab) => setSearchParams((p) => ({ ...Object.fromEntries(p), tab: id }), { replace: true });

  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [payees, setPayees] = useState<Record<string, Payee>>({});
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [recording, setRecording] = useState<PaymentRequest | null>(null);
  const [form, setForm] = useState<RecordForm>({ via: 'bank', reference: '', paidOn: todayIso(), note: '' });
  const [recordTried, setRecordTried] = useState(false);
  const [creating, setCreating] = useState<(NewRequisition & { amountText: string }) | null>(null);
  const [createTried, setCreateTried] = useState(false);
  const [deciding, setDeciding] = useState<{ req: Requisition; decision: 'approve' | 'decline' } | null>(null);
  const [comment, setComment] = useState('');
  const [declineTried, setDeclineTried] = useState(false);

  const load = useCallback(async () => {
    if (permissionsLoading) return;
    setLoading(true);
    try {
      const [p, r, who] = await Promise.all([loadPayments(), loadRequisitions(), canPay ? loadPayees() : Promise.resolve({})]);
      setPayments(p);
      setRequisitions(r);
      setPayees(who);
    } catch (error) {
      console.error('Error loading payments:', error);
      toast.error('Could not load payments');
    } finally {
      setLoading(false);
    }
  }, [permissionsLoading, canPay]);

  useEffect(() => {
    void load();
  }, [load]);

  const toPay = useMemo(() => payments.filter((p) => p.status === 'to_pay'), [payments]);
  const paid = useMemo(() => payments.filter((p) => p.status === 'paid').sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? '')), [payments]);
  const thisMonth = todayIso().slice(0, 7);
  const paidThisMonth = paid.filter((p) => (p.paid_on ?? '').startsWith(thisMonth)).reduce((s, p) => s + p.amount, 0);
  const waitingRequisitions = requisitions.filter((r) => r.status === 'pending');

  // ---- recording a payment
  const openRecord = (p: PaymentRequest) => {
    setRecording(p);
    setRecordTried(false);
    setForm({ via: 'bank', reference: '', paidOn: todayIso(), note: '' });
  };
  const recordProblem =
    form.via !== 'cash' && !form.reference.trim()
      ? 'Enter the reference, so the payment can be traced'
      : !form.paidOn || form.paidOn > todayIso()
        ? 'Enter the date it was paid (not a future date)'
        : null;
  const confirmRecord = async () => {
    setRecordTried(true);
    if (!recording || recordProblem) return;
    setBusyId(recording.id);
    try {
      await recordPayment(recording.id, form);
      toast.success(`Recorded ${formatKsh(recording.amount)} paid to ${recording.payee_name}`);
      setRecording(null);
      await load();
    } catch (error) {
      toast.error(failure(error));
    } finally {
      setBusyId(null);
    }
  };

  // ---- requisitions
  const act = async (id: string, action: () => Promise<void>, done: string) => {
    setBusyId(id);
    try {
      await action();
      toast.success(done);
      await load();
      return true;
    } catch (error) {
      console.error('Error saving requisition:', error);
      toast.error(failure(error));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const confirmDecision = async () => {
    if (!deciding) return;
    const { req, decision } = deciding;
    if (decision === 'decline') {
      setDeclineTried(true);
      if (!comment.trim()) return;
      if (await act(req.id, () => declineRequisition(req.id, comment), 'Requisition turned down')) setDeciding(null);
    } else if (await act(req.id, () => approveRequisition(req.id, comment), 'Approved and sent to finance to pay')) {
      setDeciding(null);
    }
  };

  const cancel = async (req: Requisition) => {
    const ok = await confirmDialog({
      title: 'Cancel this requisition?',
      message: `${formatKsh(req.amount)} to ${req.payee_name} will come off finance's list. It can't be undone.`,
      confirmLabel: 'Cancel requisition',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (ok) await act(req.id, () => cancelRequisition(req.id), 'Requisition cancelled');
  };

  const createProblem = !creating
    ? null
    : creating.payeeType === 'employee' && !creating.employeeNumber
      ? 'Choose who is paid'
      : creating.payeeType === 'other' && !creating.payeeName.trim()
        ? 'Enter who is paid'
        : !(Number(creating.amountText) > 0)
          ? 'Enter the amount'
          : !creating.purpose.trim()
            ? 'Say what it is for'
            : null;
  const confirmCreate = async () => {
    setCreateTried(true);
    if (!creating || createProblem) return;
    setBusyId('new');
    try {
      await createRequisition({ ...creating, amount: Number(creating.amountText) });
      toast.success(creating.approve ? 'Requisition approved and sent to finance to pay' : 'Requisition saved, waiting for approval');
      setCreating(null);
      await load();
    } catch (error) {
      toast.error(failure(error));
    } finally {
      setBusyId(null);
    }
  };

  const howToPay = (p: PaymentRequest) => (p.employee_number ? payeeLine(payees[p.employee_number]) : p.payee_details ?? '');
  const via = PAID_VIA.find((v) => v.id === form.via) ?? PAID_VIA[0];

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader
        title="Payments to make"
        subtitle="Approved salary advances, loans, expense claims and requisitions. Pay each one by bank, M-Pesa or another app, then record it here."
        actions={
          canApprove ? (
            <Button
              icon={<Plus className="w-4 h-4" />}
              onClick={() => {
                setCreateTried(false);
                setCreating({ ...emptyRequisition(), amountText: '' });
              }}
            >
              New requisition
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {canPay ? (
          <>
            <StatCard label="Waiting to be paid" value={String(toPay.length)} icon={<Hourglass className="w-4 h-4" />} tint="orange" />
            <StatCard label="Total to pay" value={formatKsh(toPay.reduce((s, p) => s + p.amount, 0))} icon={<Wallet className="w-4 h-4" />} />
            <StatCard label="Paid this month" value={formatKsh(paidThisMonth)} icon={<CheckCircle2 className="w-4 h-4" />} tint="info" />
          </>
        ) : (
          <StatCard label="Requisitions waiting" value={String(waitingRequisitions.length)} icon={<Hourglass className="w-4 h-4" />} tint="orange" />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabBar
          variant="pill"
          items={[
            ...(canPay
              ? [
                  { id: 'to_pay', label: `To pay (${toPay.length})` },
                  { id: 'paid', label: `Paid (${paid.length})` },
                ]
              : []),
            { id: 'requisitions', label: `Requisitions${waitingRequisitions.length ? ` (${waitingRequisitions.length} waiting)` : ''}` },
          ]}
          activeId={tab}
          onChange={(id) => setTab(id as Tab)}
        />
        <Button variant="secondary" onClick={() => void load()} disabled={loading} icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}>
          Refresh
        </Button>
      </div>

      {loading && payments.length === 0 && requisitions.length === 0 ? (
        <Card>
          <LoaderBlock label="Loading payments" compact />
        </Card>
      ) : tab === 'to_pay' ? (
        toPay.length === 0 ? (
          <Card>
            <EmptyState icon={<WalletCards className="w-5 h-5" />} title="Nothing to pay" description="When HR approves an advance, loan, expense or requisition, it shows here." />
          </Card>
        ) : (
          <ul className="grid gap-3 xl:grid-cols-2">
            {toPay.map((p) => (
              <li key={p.id} data-testid={`payment-${p.id}`}>
                <Card className="h-full flex flex-col">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-bold text-ink break-words">{p.payee_name}</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {p.employee_number ? `${p.employee_number} · ` : ''}
                        {SOURCE_LABEL[p.source]}
                      </div>
                    </div>
                    <div className="text-[15px] font-bold text-ink">{formatKsh(p.amount)}</div>
                  </div>
                  {p.purpose && <p className="mt-2 text-[12px] text-ink break-words">{p.purpose}</p>}
                  {howToPay(p) && (
                    <p className="mt-1 text-[12px] text-ink break-words">
                      <span className="font-semibold">Pay to:</span> {howToPay(p)}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Approved {dateText(p.approved_at)}
                    {p.approved_by_email ? ` by ${p.approved_by_email}` : ''}
                  </p>
                  <div className="mt-auto pt-3 flex flex-wrap gap-2">
                    <Button onClick={() => openRecord(p)} disabled={busyId === p.id} icon={<CheckCircle2 className="w-3.5 h-3.5" />} title="You paid it outside the app">
                      Record payment
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : tab === 'paid' ? (
        paid.length === 0 ? (
          <Card>
            <EmptyState icon={<CheckCircle2 className="w-5 h-5" />} title="Nothing paid yet" />
          </Card>
        ) : (
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="px-3 py-2 font-semibold">Paid to</th>
                  <th className="px-3 py-2 font-semibold">For</th>
                  <th className="px-3 py-2 font-semibold text-right">Amount</th>
                  <th className="px-3 py-2 font-semibold">How</th>
                  <th className="px-3 py-2 font-semibold">Reference</th>
                  <th className="px-3 py-2 font-semibold">Paid on</th>
                  <th className="px-3 py-2 font-semibold">Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {paid.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-3 py-2 font-semibold text-ink">{p.payee_name}</td>
                    <td className="px-3 py-2 text-ink">
                      {SOURCE_LABEL[p.source]}
                      {p.payment_note && <div className="text-[11px] text-muted-foreground">{p.payment_note}</div>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatKsh(p.amount)}</td>
                    <td className="px-3 py-2">{paidViaLabel(p.paid_via)}</td>
                    <td className="px-3 py-2">{p.payment_reference ?? ''}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dateText(p.paid_on)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.paid_by_email ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      ) : requisitions.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList className="w-5 h-5" />}
            title="No requisitions"
            description="A requisition asks for money for anything else: supplies, travel, repairs, a supplier's invoice."
          />
        </Card>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {requisitions.map((r) => {
            const busy = busyId === r.id;
            const status = REQUISITION_STATUS[r.status];
            return (
              <li key={r.id} data-testid={`requisition-${r.id}`}>
                <Card className="h-full flex flex-col">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-bold text-ink break-words">{r.payee_name}</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {r.category || 'Requisition'}
                        {r.requested_by ? ` · asked by ${nameOf(r.requested_by)}` : ''} · {dateText(r.created_at)}
                      </div>
                    </div>
                    <div className="text-[15px] font-bold text-ink">{formatKsh(r.amount)}</div>
                  </div>
                  <p className="mt-2 text-[12px] text-ink break-words">{r.purpose}</p>
                  {r.payee_details && <p className="mt-1 text-[12px] text-ink break-words">Pay to: {r.payee_details}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusPill label={status.label} tone={status.tone} />
                    {r.needed_by && r.status === 'pending' && <span className="text-[11.5px] text-muted-foreground">needed by {dateText(r.needed_by)}</span>}
                  </div>
                  {r.decided_by_email && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {r.status === 'rejected' ? 'Turned down' : 'Approved'} by {r.decided_by_email} {dateText(r.decided_at)}
                      {r.decision_comment ? `: ${r.decision_comment}` : ''}
                    </p>
                  )}
                  {canApprove && (r.status === 'pending' || r.status === 'approved') && (
                    <div className="mt-auto pt-3 flex flex-wrap gap-2">
                      {r.status === 'pending' && (
                        <>
                          <Button
                            onClick={() => {
                              setDeciding({ req: r, decision: 'approve' });
                              setComment('');
                            }}
                            disabled={busy}
                            icon={<Check className="w-3.5 h-3.5" />}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setDeciding({ req: r, decision: 'decline' });
                              setComment('');
                              setDeclineTried(false);
                            }}
                            disabled={busy}
                            icon={<X className="w-3.5 h-3.5" />}
                          >
                            Turn down
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" onClick={() => void cancel(r)} disabled={busy} icon={<Ban className="w-3.5 h-3.5" />}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={!!recording} onClose={() => setRecording(null)} title="Record payment" size="md">
        {recording && (
          <>
            <p className="text-[12.5px] text-ink mb-3">
              Record that {formatKsh(recording.amount)} was paid to {recording.payee_name} ({SOURCE_LABEL[recording.source].toLowerCase()}). This does not send any money.
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">How it was paid</span>
                <select className={inputClass} value={form.via} onChange={(e) => setForm({ ...form, via: e.target.value as PaidVia })}>
                  {PAID_VIA.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">{via.reference}</span>
                <input className={inputClass} value={form.reference} maxLength={120} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              </label>
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">Date paid</span>
                <input className={inputClass} type="date" max={todayIso()} value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} />
              </label>
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">Note (optional)</span>
                <textarea className={inputClass} rows={2} maxLength={1000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </label>
              {recordTried && recordProblem && (
                <p className="m-0 text-[11.5px] text-status-danger" role="alert">
                  {recordProblem}
                </p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setRecording(null)}>
                Cancel
              </Button>
              <Button onClick={() => void confirmRecord()} disabled={busyId === recording.id}>
                Record payment
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!deciding} onClose={() => setDeciding(null)} title={deciding?.decision === 'decline' ? 'Turn down requisition' : 'Approve requisition'} size="md">
        {deciding && (
          <>
            <p className="text-[12.5px] text-ink mb-3">
              {deciding.decision === 'decline'
                ? `Turn down ${formatKsh(deciding.req.amount)} to ${deciding.req.payee_name}? The person who asked will see the reason.`
                : `Approve ${formatKsh(deciding.req.amount)} to ${deciding.req.payee_name}? Finance is told to pay it.`}
            </p>
            <label htmlFor="decision-comment" className="block text-[12px] font-semibold text-ink mb-1">
              {deciding.decision === 'decline' ? 'Reason' : 'Note (optional)'}
            </label>
            <textarea id="decision-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} className={inputClass} />
            {deciding.decision === 'decline' && declineTried && !comment.trim() && (
              <p className="mt-1 text-[11.5px] text-status-danger" role="alert">
                Give a reason so they know why.
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeciding(null)}>
                Cancel
              </Button>
              <Button onClick={() => void confirmDecision()} disabled={busyId === deciding.req.id}>
                {deciding.decision === 'decline' ? 'Turn down' : 'Approve'}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!creating} onClose={() => setCreating(null)} title="New requisition" size="lg">
        {creating && (
          <>
            <p className="text-[12px] text-muted-foreground mb-3">Money for anything else: supplies, travel, repairs, a supplier's invoice. Once approved, finance is told to pay it.</p>
            <div className="space-y-3">
              <fieldset>
                <legend className="block text-[12px] font-semibold text-ink mb-1">Who is paid</legend>
                <div className="flex flex-wrap gap-4 text-[12.5px]">
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" name="payee-type" checked={creating.payeeType === 'employee'} onChange={() => setCreating({ ...creating, payeeType: 'employee' })} />
                    An employee
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" name="payee-type" checked={creating.payeeType === 'other'} onChange={() => setCreating({ ...creating, payeeType: 'other' })} />
                    Someone else (a supplier...)
                  </label>
                </div>
              </fieldset>
              {creating.payeeType === 'employee' ? (
                <EmployeePicker value={creating.employeeNumber} onChange={(emp) => setCreating({ ...creating, employeeNumber: emp?.employeeNumber ?? '' })} />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="block text-[12px] font-semibold text-ink mb-1">Name</span>
                    <input className={inputClass} maxLength={120} value={creating.payeeName} onChange={(e) => setCreating({ ...creating, payeeName: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="block text-[12px] font-semibold text-ink mb-1">How to pay them</span>
                    <input
                      className={inputClass}
                      maxLength={500}
                      placeholder="Bank and account, M-Pesa number, till..."
                      value={creating.payeeDetails}
                      onChange={(e) => setCreating({ ...creating, payeeDetails: e.target.value })}
                    />
                  </label>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="block text-[12px] font-semibold text-ink mb-1">Amount (KSh)</span>
                  <input className={inputClass} type="number" min={1} value={creating.amountText} onChange={(e) => setCreating({ ...creating, amountText: e.target.value })} />
                </label>
                <label className="block">
                  <span className="block text-[12px] font-semibold text-ink mb-1">Category</span>
                  <input className={inputClass} list="requisition-categories" maxLength={60} value={creating.category} onChange={(e) => setCreating({ ...creating, category: e.target.value })} />
                  <datalist id="requisition-categories">
                    {REQUISITION_CATEGORIES.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </label>
                <label className="block">
                  <span className="block text-[12px] font-semibold text-ink mb-1">Needed by (optional)</span>
                  <input className={inputClass} type="date" value={creating.neededBy} onChange={(e) => setCreating({ ...creating, neededBy: e.target.value })} />
                </label>
              </div>
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">What it is for</span>
                <textarea className={inputClass} rows={2} maxLength={1000} value={creating.purpose} onChange={(e) => setCreating({ ...creating, purpose: e.target.value })} />
              </label>
              <label className="inline-flex items-center gap-2 text-[12.5px] text-ink">
                <input type="checkbox" checked={creating.approve} onChange={(e) => setCreating({ ...creating, approve: e.target.checked })} />
                Approve it now and send it to finance
              </label>
              {createTried && createProblem && (
                <p className="m-0 text-[11.5px] text-status-danger" role="alert">
                  {createProblem}
                </p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreating(null)}>
                Cancel
              </Button>
              <Button onClick={() => void confirmCreate()} disabled={busyId === 'new'}>
                {creating.approve ? 'Approve requisition' : 'Save requisition'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
