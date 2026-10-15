import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Ban, Banknote, CalendarClock, Check, CheckCircle2, HandCoins, Hourglass, Plus, RefreshCw, Wallet, X } from 'lucide-react';
import { Button, Card, EmployeePicker, EmptyState, Modal, PageHeader, StatCard, TabBar } from '../UI';
import LoanSchedule, { LoanBalance, LoanStatusPill } from './LoanSchedule';
import LoanSettingsCard from './LoanSettingsCard';
import { DemoTag } from '../SalaryAdvance/PayAdvanceModal';
import { confirmDialog, noticeDialog } from '../../lib/confirmDialog';
import { IN_APP_PAYMENTS, PAYMENTS_DEMO } from '../../lib/inAppPayments';
import { usePermissions } from '../../hooks/usePermissions';
import {
  DEFAULT_LOAN_SETTINGS,
  INTEREST_METHODS,
  addMonths,
  currentPeriod,
  formatKsh,
  interestMethodLabel,
  loanSchedule,
  maxMonthsFor,
  outstandingBalance,
  periodLabel,
  scheduleTotals,
  type InterestMethod,
  type LoanProduct,
  type LoanSettings,
} from '../../lib/loans';
import {
  approveLoan,
  cancelLoan,
  createLoan,
  declineLoan,
  loadAllLoans,
  loadLoanProducts,
  loadLoanSettings,
  loadSchedules,
  markLoanDisbursed,
  type EmployeeLoan,
} from '../../lib/loansApi';
import type { LoanInstalment, LoanRepayment } from '../../lib/loans';

// HR's loans page: decide on requests, set up a loan for an employee, record that finance paid it out, and follow
// each loan's schedule and balance. Payroll takes the instalments once a loan is marked disbursed.
//
//   * "Mark as disbursed" is the real step: finance paid the loan outside the app, and marking it is what starts the
//     payroll deductions.
//   * "Pay out (demo)" only appears for demos (PAYMENTS_DEMO while IN_APP_PAYMENTS is off). Nothing is sent or saved.

type Tab = 'requests' | 'approved' | 'active' | 'closed' | 'settings';

const TAB_OF: Record<EmployeeLoan['status'], Exclude<Tab, 'settings'>> = {
  requested: 'requests',
  approved: 'approved',
  disbursed: 'active',
  repaying: 'active',
  completed: 'closed',
  rejected: 'closed',
  cancelled: 'closed',
};

const showDemoPay = PAYMENTS_DEMO && !IN_APP_PAYMENTS;

const inputClass =
  'w-full px-3 py-2 text-[13px] border border-border rounded-tile bg-white focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand';

// the database's own reason ("Someone else must decide on your own loan"), or a general one
const failure = (error: unknown) => (error instanceof Error && error.message) || 'Not saved. Please try again.';

const dateText = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** The next twelve months to start repaying in, from this one. */
const startChoices = () => Array.from({ length: 12 }, (_, i) => addMonths(currentPeriod(), i));

interface NewLoanForm {
  employeeNumber: string;
  productId: string;
  amount: string;
  months: string;
  startPeriod: string;
  rate: string;
  /** '' = the loan type's or the company's */
  method: InterestMethod | '';
  reason: string;
}

export default function LoansAdmin() {
  const { userRole, hasPermission, loading: permissionsLoading } = usePermissions();
  const canManage = !permissionsLoading && (userRole === 'ADMIN' || userRole === 'HR' || hasPermission('payroll'));

  const [loans, setLoans] = useState<EmployeeLoan[]>([]);
  const [schedules, setSchedules] = useState<Record<string, LoanInstalment[]>>({});
  const [repayments, setRepayments] = useState<Record<string, LoanRepayment[]>>({});
  const [settings, setSettings] = useState<LoanSettings>(DEFAULT_LOAN_SETTINGS);
  const [products, setProducts] = useState<LoanProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('requests');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [approving, setApproving] = useState<EmployeeLoan | null>(null);
  const [approveStart, setApproveStart] = useState('');
  const [comment, setComment] = useState('');
  const [declining, setDeclining] = useState<EmployeeLoan | null>(null);
  const [declineTried, setDeclineTried] = useState(false);
  const [viewing, setViewing] = useState<EmployeeLoan | null>(null);
  const [creating, setCreating] = useState<NewLoanForm | null>(null);
  const [createTried, setCreateTried] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, s, p] = await Promise.all([loadAllLoans(), loadLoanSettings(), loadLoanProducts()]);
      setLoans(all);
      setSettings(s);
      setProducts(p);
      const loaded = await loadSchedules(all.filter((l) => ['disbursed', 'repaying', 'completed'].includes(l.status)).map((l) => l.id));
      setSchedules(loaded.schedules);
      setRepayments(loaded.repayments);
    } catch (error) {
      console.error('Error loading loans:', error);
      toast.error('Could not load loans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byTab = useMemo(() => {
    const out: Record<Exclude<Tab, 'settings'>, EmployeeLoan[]> = { requests: [], approved: [], active: [], closed: [] };
    for (const l of loans) out[TAB_OF[l.status]].push(l);
    return out;
  }, [loans]);

  const outstanding = byTab.active.reduce((s, l) => s + outstandingBalance(schedules[l.id] ?? [], repayments[l.id] ?? []), 0);
  const thisMonth = byTab.active.reduce((s, l) => s + ((schedules[l.id] ?? []).find((i) => i.period === currentPeriod())?.payment ?? 0), 0);

  const act = async (loan: EmployeeLoan, action: () => Promise<void>, done: string) => {
    setBusyId(loan.id);
    try {
      await action();
      toast.success(done);
      await load();
      return true;
    } catch (error) {
      console.error('Error saving loan:', error);
      toast.error(failure(error));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const openApprove = (loan: EmployeeLoan) => {
    setApproving(loan);
    setApproveStart(loan.start_period < currentPeriod() ? addMonths(currentPeriod(), 1) : loan.start_period);
    setComment('');
  };

  const confirmApprove = async () => {
    if (!approving) return;
    const loan = approving;
    if (await act(loan, () => approveLoan(loan.id, { comment, startPeriod: approveStart }), `Approved ${loan.employee_name}'s loan`)) setApproving(null);
  };

  const confirmDecline = async () => {
    setDeclineTried(true);
    if (!declining || !comment.trim()) return;
    const loan = declining;
    if (await act(loan, () => declineLoan(loan.id, comment), `Declined ${loan.employee_name}'s loan`)) setDeclining(null);
  };

  const markDisbursed = async (loan: EmployeeLoan) => {
    const ok = await confirmDialog({
      title: 'Mark as disbursed?',
      message: `Record that finance has paid ${loan.employee_name} ${formatKsh(loan.principal)} outside the app. This does not send any money. Payroll takes ${formatKsh(loan.monthly_instalment ?? 0)} a month from ${periodLabel(loan.start_period < currentPeriod() ? currentPeriod() : loan.start_period)}.`,
      confirmLabel: 'Mark as disbursed',
    });
    if (ok) await act(loan, () => markLoanDisbursed(loan.id), `Marked ${loan.employee_name}'s loan as disbursed. Payroll will take the instalments.`);
  };

  const demoPay = async (loan: EmployeeLoan) => {
    const ok = await confirmDialog({
      title: 'Pay out loan (demo)',
      message: `Pay ${formatKsh(loan.principal)} to ${loan.employee_name}? Demo mode: no money moves and nothing is saved.`,
      confirmLabel: `Pay ${formatKsh(loan.principal)}`,
    });
    if (!ok) return;
    await noticeDialog({
      title: 'Demo payment shown',
      message: `${formatKsh(loan.principal)} shown as sent to ${loan.employee_name}. Nothing was sent: use Mark as disbursed once finance has paid it.`,
    });
  };

  const cancel = async (loan: EmployeeLoan) => {
    const ok = await confirmDialog({
      title: 'Cancel this loan?',
      message: `${loan.employee_name}'s loan of ${formatKsh(loan.principal)} will be cancelled. It can't be undone.`,
      confirmLabel: 'Cancel loan',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (ok) await act(loan, () => cancelLoan(loan.id), 'Loan cancelled');
  };

  // ---- a new loan for an employee
  const newProduct = creating ? products.find((p) => p.id === creating.productId) ?? null : null;
  const newRate = creating ? (creating.rate.trim() === '' ? newProduct?.annual_rate ?? settings.annual_rate : Number(creating.rate)) : 0;
  const newMethod: InterestMethod = creating?.method || newProduct?.interest_method || settings.interest_method;
  const newPreview = creating ? scheduleTotals(loanSchedule(Number(creating.amount) || 0, newRate, Number(creating.months) || 0, newMethod, creating.startPeriod)) : null;
  const createProblem = !creating
    ? null
    : !creating.employeeNumber
      ? 'Choose the employee'
      : !(Number(creating.amount) > 0)
        ? 'Enter the amount'
        : !Number.isInteger(Number(creating.months)) || Number(creating.months) < 1 || Number(creating.months) > 120
          ? 'Repay over 1 to 120 months'
          : creating.rate.trim() !== '' && !(Number(creating.rate) >= 0 && Number(creating.rate) <= 100)
            ? 'The rate must be between 0% and 100%'
            : null;
  const createWarning =
    creating && !createProblem && Number(creating.months) > maxMonthsFor(settings, newProduct)
      ? `Longer than the ${maxMonthsFor(settings, newProduct)} months staff may ask for.`
      : null;

  const confirmCreate = async () => {
    setCreateTried(true);
    if (!creating || createProblem) return;
    setBusyId('new');
    try {
      await createLoan({
        employeeNumber: creating.employeeNumber,
        productId: creating.productId || null,
        amount: Number(creating.amount),
        months: Number(creating.months),
        startPeriod: creating.startPeriod,
        annualRate: creating.rate.trim() === '' ? null : Number(creating.rate),
        interestMethod: creating.method || null,
        reason: creating.reason,
      });
      toast.success('Loan set up and approved. Mark it disbursed once finance has paid it.');
      setCreating(null);
      await load();
    } catch (error) {
      toast.error(failure(error));
    } finally {
      setBusyId(null);
    }
  };

  const list = tab === 'settings' ? [] : byTab[tab];
  const viewingSchedule = viewing ? schedules[viewing.id] : undefined;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader
        title="Loans"
        subtitle="Staff loans with interest: approve requests, record payouts and follow repayments through payroll."
        actions={
          canManage ? (
            <Button
              icon={<Plus className="w-4 h-4" />}
              onClick={() => {
                setCreateTried(false);
                setCreating({
                  employeeNumber: '',
                  productId: '',
                  amount: '',
                  months: String(Math.min(12, settings.max_months)),
                  startPeriod: addMonths(currentPeriod(), 1),
                  rate: '',
                  method: '',
                  reason: '',
                });
              }}
            >
              New loan
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Waiting for approval" value={String(byTab.requests.length)} icon={<Hourglass className="w-4 h-4" />} tint="orange" />
        <StatCard label="Owed on active loans" value={formatKsh(outstanding)} icon={<Wallet className="w-4 h-4" />} />
        <StatCard label={`Due in ${periodLabel(currentPeriod())}`} value={formatKsh(thisMonth)} icon={<CalendarClock className="w-4 h-4" />} tint="info" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabBar
          variant="pill"
          items={[
            { id: 'requests', label: `Requests (${byTab.requests.length})` },
            { id: 'approved', label: `To pay out (${byTab.approved.length})` },
            { id: 'active', label: `Repaying (${byTab.active.length})` },
            { id: 'closed', label: `Closed (${byTab.closed.length})` },
            { id: 'settings', label: 'Settings' },
          ]}
          activeId={tab}
          onChange={(id) => setTab(id as Tab)}
        />
        <div className="flex items-center gap-2">
          {showDemoPay && tab === 'approved' && <DemoTag />}
          <Button variant="secondary" onClick={() => void load()} disabled={loading} icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}>
            Refresh
          </Button>
        </div>
      </div>

      {tab === 'settings' ? (
        <LoanSettingsCard canEdit={canManage} />
      ) : loading && loans.length === 0 ? (
        <Card>
          <p className="text-[12.5px] text-muted-foreground">Loading loans...</p>
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HandCoins className="w-5 h-5" />}
            title={tab === 'requests' ? 'Nothing waiting for approval' : tab === 'approved' ? 'Nothing to pay out' : tab === 'active' ? 'No loans being repaid' : 'No closed loans'}
            description={tab === 'requests' ? 'Loan requests from staff show here.' : undefined}
          />
        </Card>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {list.map((loan) => {
            const busy = busyId === loan.id;
            return (
              <li key={loan.id} data-testid={`loan-${loan.id}`}>
                <Card className="h-full flex flex-col">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-bold text-ink break-words">{loan.employee_name}</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {loan.employee_number} · {loan.product_name || 'Staff loan'} · asked {dateText(loan.created_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[15px] font-bold text-ink">{formatKsh(loan.principal)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {loan.months} months · {loan.annual_rate}% {interestMethodLabel(loan.interest_method).toLowerCase()}
                      </div>
                    </div>
                  </div>

                  {loan.reason && <p className="mt-2 text-[12px] text-ink break-words">“{loan.reason}”</p>}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <LoanStatusPill status={loan.status} />
                    {loan.monthly_instalment !== null && !['rejected', 'cancelled'].includes(loan.status) && (
                      <span className="text-[11.5px] text-muted-foreground">
                        {formatKsh(loan.monthly_instalment)} a month from {periodLabel(loan.start_period)} · {formatKsh(loan.total_interest ?? 0)} interest
                      </span>
                    )}
                  </div>

                  {loan.decided_by_email && tab !== 'requests' && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {loan.status === 'rejected' ? 'Declined' : 'Approved'} by {loan.decided_by_email} {dateText(loan.decided_at)}
                      {loan.decision_comment ? `: ${loan.decision_comment}` : ''}
                    </p>
                  )}
                  {loan.disbursed_at && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Paid out {dateText(loan.disbursed_at)}
                      {loan.disbursed_by_email ? ` · marked by ${loan.disbursed_by_email}` : ''}
                    </p>
                  )}

                  {['disbursed', 'repaying', 'completed'].includes(loan.status) && (
                    <div className="mt-3">
                      <LoanBalance schedule={schedules[loan.id] ?? []} repayments={repayments[loan.id] ?? []} />
                    </div>
                  )}

                  <div className="mt-auto pt-3 flex flex-wrap gap-2">
                    {!['rejected', 'cancelled'].includes(loan.status) && (
                      <Button variant="ghost" onClick={() => setViewing(loan)}>
                        Schedule
                      </Button>
                    )}
                    {canManage && loan.status === 'requested' && (
                      <>
                        <Button onClick={() => openApprove(loan)} disabled={busy} icon={<Check className="w-3.5 h-3.5" />}>
                          Approve
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setDeclining(loan);
                            setComment('');
                            setDeclineTried(false);
                          }}
                          disabled={busy}
                          icon={<X className="w-3.5 h-3.5" />}
                        >
                          Decline
                        </Button>
                      </>
                    )}
                    {canManage && loan.status === 'approved' && (
                      <>
                        {showDemoPay && (
                          <Button onClick={() => void demoPay(loan)} disabled={busy} icon={<Banknote className="w-3.5 h-3.5" />} title="Demo: nothing is sent">
                            Pay out (demo)
                          </Button>
                        )}
                        <Button
                          variant={showDemoPay ? 'secondary' : 'primary'}
                          onClick={() => void markDisbursed(loan)}
                          disabled={busy}
                          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                          title="Finance paid it outside the app"
                        >
                          Mark as disbursed
                        </Button>
                      </>
                    )}
                    {canManage && ['requested', 'approved'].includes(loan.status) && (
                      <Button variant="ghost" onClick={() => void cancel(loan)} disabled={busy} icon={<Ban className="w-3.5 h-3.5" />}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={!!approving} onClose={() => setApproving(null)} title="Approve loan" size="md">
        {approving && (
          <>
            <p className="text-[12.5px] text-ink mb-3">
              Approve {approving.employee_name}'s loan of {formatKsh(approving.principal)} over {approving.months} months? It is charged the current rate for
              {approving.product_name ? ` ${approving.product_name}` : ' staff loans'} ({(products.find((p) => p.id === approving.product_id)?.annual_rate ?? settings.annual_rate)}% a
              year).
            </p>
            <label htmlFor="approve-start" className="block text-[12px] font-semibold text-ink mb-1">
              First repayment from
            </label>
            <select id="approve-start" value={approveStart} onChange={(e) => setApproveStart(e.target.value)} className={inputClass}>
              {[...new Set([approveStart, ...startChoices()])].map((p) => (
                <option key={p} value={p}>
                  {periodLabel(p)} pay
                </option>
              ))}
            </select>
            <label htmlFor="approve-comment" className="block text-[12px] font-semibold text-ink mt-3 mb-1">
              Note to the employee (optional)
            </label>
            <textarea id="approve-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} className={inputClass} />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setApproving(null)}>
                Cancel
              </Button>
              <Button onClick={() => void confirmApprove()} disabled={busyId === approving.id}>
                Approve
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!declining} onClose={() => setDeclining(null)} title="Decline loan" size="md">
        {declining && (
          <>
            <p className="text-[12.5px] text-ink mb-3">
              Decline {declining.employee_name}'s request for {formatKsh(declining.principal)}? They will see the reason.
            </p>
            <label htmlFor="decline-reason" className="block text-[12px] font-semibold text-ink mb-1">
              Reason
            </label>
            <textarea
              id="decline-reason"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className={inputClass}
              placeholder="For example: a loan is still being repaid"
            />
            {declineTried && !comment.trim() && (
              <p className="mt-1 text-[11.5px] text-status-danger" role="alert">
                Give a reason so they know why.
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeclining(null)}>
                Cancel
              </Button>
              <Button onClick={() => void confirmDecline()} disabled={busyId === declining.id}>
                Decline
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `${viewing.employee_name}: ${formatKsh(viewing.principal)} loan` : 'Loan'} size="3xl">
        {viewing && (
          <>
            <p className="text-[12px] text-muted-foreground mb-3">
              {viewing.months} months at {viewing.annual_rate}% a year, {interestMethodLabel(viewing.interest_method).toLowerCase()}, from {periodLabel(viewing.start_period)}.
              {['requested', 'approved'].includes(viewing.status) ? ' The schedule may still change until the loan is paid out.' : ''}
            </p>
            <LoanSchedule
              schedule={viewingSchedule ?? loanSchedule(viewing.principal, viewing.annual_rate, viewing.months, viewing.interest_method, viewing.start_period)}
              repayments={repayments[viewing.id] ?? []}
            />
          </>
        )}
      </Modal>

      <Modal open={!!creating} onClose={() => setCreating(null)} title="New loan" size="lg">
        {creating && (
          <>
            <p className="text-[12px] text-muted-foreground mb-3">Set up a loan for an employee. It is approved straight away; mark it disbursed once finance has paid it.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-semibold text-ink mb-1">Employee</label>
                <EmployeePicker value={creating.employeeNumber} onChange={(emp) => setCreating({ ...creating, employeeNumber: emp?.employeeNumber ?? '' })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="block text-[12px] font-semibold text-ink mb-1">Type of loan</span>
                  <select className={inputClass} value={creating.productId} onChange={(e) => setCreating({ ...creating, productId: e.target.value })}>
                    <option value="">Staff loan</option>
                    {products
                      .filter((p) => p.active || p.id === creating.productId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-[12px] font-semibold text-ink mb-1">Amount (KSh)</span>
                  <input className={inputClass} type="number" min={1} value={creating.amount} onChange={(e) => setCreating({ ...creating, amount: e.target.value })} />
                </label>
                <label className="block">
                  <span className="block text-[12px] font-semibold text-ink mb-1">Repay over (months)</span>
                  <input className={inputClass} type="number" min={1} max={120} value={creating.months} onChange={(e) => setCreating({ ...creating, months: e.target.value })} />
                </label>
                <label className="block">
                  <span className="block text-[12px] font-semibold text-ink mb-1">First repayment from</span>
                  <select className={inputClass} value={creating.startPeriod} onChange={(e) => setCreating({ ...creating, startPeriod: e.target.value })}>
                    {startChoices().map((p) => (
                      <option key={p} value={p}>
                        {periodLabel(p)} pay
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-[12px] font-semibold text-ink mb-1">Interest rate (% a year)</span>
                  <input
                    className={inputClass}
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={creating.rate}
                    placeholder={`${newProduct?.annual_rate ?? settings.annual_rate} (the usual rate)`}
                    onChange={(e) => setCreating({ ...creating, rate: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="block text-[12px] font-semibold text-ink mb-1">How interest is charged</span>
                  <select className={inputClass} value={newMethod} onChange={(e) => setCreating({ ...creating, method: e.target.value as InterestMethod })}>
                    {INTEREST_METHODS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">What it is for (optional)</span>
                <input className={inputClass} value={creating.reason} onChange={(e) => setCreating({ ...creating, reason: e.target.value })} />
              </label>
              {newPreview && newPreview.totalRepayable > 0 && (
                <p className="m-0 p-3 rounded-tile bg-secondary text-[12.5px] text-ink" data-testid="new-loan-preview">
                  {formatKsh(newPreview.instalment)} a month · {formatKsh(newPreview.totalInterest)} interest · {formatKsh(newPreview.totalRepayable)} in all
                </p>
              )}
              {createWarning && <p className="m-0 text-[11.5px] text-orange-text-alt">{createWarning}</p>}
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
                Set up loan
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
