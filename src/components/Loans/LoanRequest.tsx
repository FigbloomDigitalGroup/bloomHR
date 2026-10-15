import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { HandCoins, Lock } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from '../UI';
import LoanSchedule, { LoanBalance, LoanStatusPill } from './LoanSchedule';
import { confirmDialog } from '../../lib/confirmDialog';
import {
  DEFAULT_LOAN_SETTINGS,
  addMonths,
  currentPeriod,
  formatKsh,
  interestMethodLabel,
  loanSchedule,
  maxLoanFor,
  maxMonthsFor,
  periodLabel,
  scheduleTotals,
  validateLoanRequest,
  type LoanProduct,
  type LoanRequestInput,
  type LoanSettings,
} from '../../lib/loans';
import { loadLoanProducts, loadLoanSettings, loadMyLoans, requestLoan, withdrawLoan, type LoanWithSchedule } from '../../lib/loansApi';
import { loadMyEmployee, type MyEmployee } from '../../lib/salaryAdvanceApi';

// Staff portal: apply for a loan, with what it costs worked out as they type, and follow their loans to repaid.

const inputClass =
  'w-full px-3 py-2 text-[13px] border border-border rounded-tile bg-white focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand disabled:bg-secondary disabled:cursor-not-allowed';

const dateText = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export default function LoanRequest() {
  const [employee, setEmployee] = useState<MyEmployee | null>(null);
  const [settings, setSettings] = useState<LoanSettings>(DEFAULT_LOAN_SETTINGS);
  const [products, setProducts] = useState<LoanProduct[]>([]);
  const [loans, setLoans] = useState<LoanWithSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [productId, setProductId] = useState('');
  const [form, setForm] = useState<LoanRequestInput>({ amount: '', months: 0, reason: '' });
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openSchedule, setOpenSchedule] = useState<string | null>(null);

  const refresh = useCallback(async (emp: MyEmployee | null) => {
    if (!emp?.employeeNumber) return;
    setLoans(await loadMyLoans(emp.employeeNumber));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [emp, s, p] = await Promise.all([loadMyEmployee(), loadLoanSettings(), loadLoanProducts()]);
        if (!live) return;
        setEmployee(emp);
        setSettings(s);
        setProducts(p.filter((x) => x.active));
        setForm((f) => ({ ...f, months: f.months || Math.min(Math.max(s.min_months, 12), s.max_months) }));
        if (emp?.employeeNumber) {
          const mine = await loadMyLoans(emp.employeeNumber);
          if (live) setLoans(mine);
        }
      } catch (error) {
        console.error('Error loading loans:', error);
        toast.error('Could not load your loans');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const product = products.find((p) => p.id === productId) ?? null;
  const rate = product?.annual_rate ?? settings.annual_rate;
  const method = product?.interest_method ?? settings.interest_method;
  const maxMonths = maxMonthsFor(settings, product);
  const maxAmount = maxLoanFor(settings, employee?.basicSalary);
  const errors = validateLoanRequest(form, { minMonths: settings.min_months, maxMonths, maxAmount });
  const amount = Number(form.amount) || 0;
  const firstMonth = addMonths(currentPeriod(), 1);
  const preview = useMemo(() => loanSchedule(amount, rate, form.months, method, firstMonth), [amount, rate, form.months, method, firstMonth]);
  const totals = scheduleTotals(preview);
  const waiting = loans.some((l) => l.status === 'requested');

  const blocked = !employee
    ? 'Your login is not linked to an employee record, so you cannot apply for a loan. Ask HR to check your work email.'
    : employee.terminated
      ? 'Your employment has ended, so you cannot apply for a loan.'
      : !settings.staff_can_apply
        ? 'Loan applications are closed. Please speak to HR.'
        : waiting
          ? 'You already have a loan request waiting for a decision.'
          : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTriedSubmit(true);
    if (blocked || !employee || Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      await requestLoan(employee, { productId: productId || null, amount, months: form.months, reason: form.reason });
      toast.success('Your loan request was sent for approval');
      setForm((f) => ({ ...f, amount: '', reason: '' }));
      setTriedSubmit(false);
      await refresh(employee);
    } catch (error) {
      console.error('Error requesting a loan:', error);
      toast.error((error as Error).message || 'Your request was not sent. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (loan: LoanWithSchedule) => {
    const ok = await confirmDialog({
      title: 'Withdraw this request?',
      message: `Your request for ${formatKsh(loan.principal)} will be cancelled. You can apply again afterwards.`,
      confirmLabel: 'Withdraw',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await withdrawLoan(loan.id);
      toast.success('Request withdrawn');
      await refresh(employee);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const showError = (field: keyof LoanRequestInput) =>
    (triedSubmit || (field === 'amount' && form.amount !== '')) && errors[field] ? (
      <p id={`loan-${field}-error`} className="mt-1 text-[11.5px] text-status-danger" role="alert">
        {errors[field]}
      </p>
    ) : null;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Loans" subtitle="Borrow from the company and repay it, with interest, through your pay." />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card>
          <h2 className="text-[15px] font-bold text-ink mb-3">Apply for a loan</h2>

          {loading ? (
            <p className="text-[12.5px] text-muted-foreground">Loading...</p>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-4">
              {blocked && (
                <div className="flex gap-2 p-3 rounded-tile bg-orange-tint text-[12px] text-status-danger" role="status">
                  <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{blocked}</span>
                </div>
              )}

              {products.length > 0 && (
                <div>
                  <label htmlFor="loan-product" className="block text-[12px] font-semibold text-ink mb-1">
                    Type of loan
                  </label>
                  <select
                    id="loan-product"
                    value={productId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setProductId(id);
                      // a shorter loan type brings the months within its longest term
                      const longest = maxMonthsFor(settings, products.find((p) => p.id === id));
                      setForm((f) => ({ ...f, months: Math.max(settings.min_months, Math.min(f.months, longest)) }));
                    }}
                    disabled={!!blocked}
                    className={inputClass}
                  >
                    <option value="">Staff loan ({settings.annual_rate}% a year)</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.annual_rate}% a year, up to {p.max_months} months)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="loan-amount" className="block text-[12px] font-semibold text-ink mb-1">
                  Amount (KSh)
                </label>
                <input
                  id="loan-amount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  disabled={!!blocked}
                  aria-invalid={!!errors.amount && (triedSubmit || form.amount !== '')}
                  className={inputClass}
                  placeholder="0"
                />
                {maxAmount !== null && (
                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    You can borrow up to <strong className="text-ink">{formatKsh(maxAmount)}</strong>.
                  </p>
                )}
                {showError('amount')}
              </div>

              <div>
                <label htmlFor="loan-months" className="block text-[12px] font-semibold text-ink mb-1">
                  Repay over (months)
                </label>
                <select
                  id="loan-months"
                  value={form.months}
                  onChange={(e) => setForm({ ...form, months: Number(e.target.value) })}
                  disabled={!!blocked}
                  className={inputClass}
                >
                  {Array.from({ length: Math.max(0, maxMonths - settings.min_months + 1) }, (_, i) => settings.min_months + i).map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'month' : 'months'}
                    </option>
                  ))}
                </select>
                {showError('months')}
              </div>

              <div>
                <label htmlFor="loan-reason" className="block text-[12px] font-semibold text-ink mb-1">
                  What is it for?
                </label>
                <textarea
                  id="loan-reason"
                  rows={3}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  disabled={!!blocked}
                  className={inputClass}
                  placeholder="For example: school fees for next term"
                />
                {showError('reason')}
              </div>

              {amount > 0 && !errors.amount && !errors.months && preview.length > 0 && (
                <div className="p-3 rounded-tile bg-secondary text-[12.5px]" data-testid="loan-preview" aria-live="polite">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-[11px] text-muted-foreground">Each month</div>
                      <div className="font-bold text-ink">{formatKsh(totals.instalment)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Total interest</div>
                      <div className="font-bold text-ink">{formatKsh(totals.totalInterest)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Total to repay</div>
                      <div className="font-bold text-ink">{formatKsh(totals.totalRepayable)}</div>
                    </div>
                  </div>
                  <p className="mt-2 mb-0 text-[11.5px] text-muted-foreground">
                    {rate}% a year, {interestMethodLabel(method).toLowerCase()}. If approved, repayments come off your pay from about{' '}
                    {periodLabel(firstMonth)}. HR confirms the start month.
                  </p>
                </div>
              )}

              <Button type="submit" disabled={!!blocked || saving} icon={<HandCoins className="w-4 h-4" />} className="w-full sm:w-auto justify-center">
                {saving ? 'Sending...' : 'Send request'}
              </Button>
            </form>
          )}
        </Card>

        <div>
          <h2 className="text-[15px] font-bold text-ink mb-3">My loans</h2>
          {!loading && loans.length === 0 ? (
            <Card>
              <EmptyState icon={<HandCoins className="w-5 h-5" />} title="No loans yet" description="Loans you apply for show here with where they stand." />
            </Card>
          ) : (
            <ul className="space-y-3">
              {loans.map((l) => (
                <li key={l.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <div className="text-[15px] font-bold text-ink">{formatKsh(l.principal)}</div>
                        <div className="text-[11.5px] text-muted-foreground">
                          {l.product_name || 'Staff loan'} · {l.months} months at {l.annual_rate}% · asked {dateText(l.created_at)}
                        </div>
                      </div>
                      <LoanStatusPill status={l.status} />
                    </div>
                    {l.monthly_instalment !== null && !['rejected', 'cancelled'].includes(l.status) && (
                      <p className="text-[12px] text-ink mb-2">
                        {formatKsh(l.monthly_instalment)} a month from {periodLabel(l.start_period)} to{' '}
                        {periodLabel(addMonths(l.start_period, l.months - 1))}.
                      </p>
                    )}
                    {['disbursed', 'repaying', 'completed'].includes(l.status) && <LoanBalance schedule={l.schedule} repayments={l.repayments} />}
                    {l.status === 'rejected' && (
                      <p className="mt-2 text-[12px] text-status-danger">
                        <strong>Reason:</strong> {l.decision_comment || 'No reason given.'}
                      </p>
                    )}
                    {l.status === 'approved' && <p className="mt-2 text-[12px] text-muted-foreground">Approved. Finance will pay it out to you.</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {l.schedule.length > 0 && !['rejected', 'cancelled'].includes(l.status) && (
                        <Button variant="secondary" onClick={() => setOpenSchedule(openSchedule === l.id ? null : l.id)}>
                          {openSchedule === l.id ? 'Hide schedule' : 'See schedule'}
                        </Button>
                      )}
                      {l.status === 'requested' && (
                        <Button variant="ghost" onClick={() => void withdraw(l)}>
                          Withdraw request
                        </Button>
                      )}
                    </div>
                    {openSchedule === l.id && (
                      <div className="mt-3">
                        <LoanSchedule schedule={l.schedule} repayments={l.repayments} />
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
