import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { HandCoins, Lock } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from '../UI';
import LoanSchedule, { LoanBalance, LoanStatusPill } from './LoanSchedule';
import LoanFormPanel from './LoanFormPanel';
import GuaranteeRequests from './GuaranteeRequests';
import WitnessRequests from './WitnessRequests';
import { confirmDialog } from '../../lib/confirmDialog';
import {
  DEFAULT_LOAN_SETTINGS,
  addMonths,
  currentPeriod,
  formatKsh,
  interestMethodLabel,
  loanSchedule,
  rateText,
  maxLoanFor,
  maxMonthsFor,
  periodLabel,
  scheduleTotals,
  validateLoanRequest,
  type LoanProduct,
  type LoanRequestInput,
  type LoanSettings,
} from '../../lib/loans';
import {
  loadFirstOpenPeriod,
  loadLoanProducts,
  loadLoanSettings,
  loadMyLoans,
  requestLoan,
  withdrawLoan,
  type LoanApplicationDetails,
  type LoanWithSchedule,
} from '../../lib/loansApi';
import { loadGuarantorChoices, loadGuarantors, loadLoanFormSettings, loadLoanForms, loadWitnesses, setGuarantor, setWitness } from '../../lib/loanFormApi';
import { formHoldsPayout, type LoanForm, type LoanGuarantor, type LoanWitness } from '../../lib/loanForm';
import { loadMyEmployee, type MyEmployee } from '../../lib/salaryAdvanceApi';
import { LoaderBlock } from '../UI/FigbloomLoader';

// Staff portal: apply for a loan, with what it costs worked out as they type, and follow their loans to repaid.

const inputClass =
  'w-full px-3 py-2 text-[13px] border border-border rounded-tile bg-white focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand disabled:bg-secondary disabled:cursor-not-allowed';

const EMPTY_DETAILS: LoanApplicationDetails = { residentialAddress: '', otherLoanRepayments: '', disbursementAccount: '' };

/** A loan paid out to them before this one makes this one a renewal on the form. */
const isRenewal = (loan: LoanWithSchedule, all: LoanWithSchedule[]) =>
  all.some((o) => o.id !== loan.id && o.created_at < loan.created_at && ['disbursed', 'repaying', 'completed'].includes(o.status));

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
  const [details, setDetails] = useState<LoanApplicationDetails>(EMPTY_DETAILS);
  const [forms, setForms] = useState<Record<string, LoanForm>>({});
  const [guarantors, setGuarantors] = useState<Record<string, LoanGuarantor>>({});
  const [witnesses, setWitnesses] = useState<Record<string, LoanWitness>>({});
  const [witnessPick, setWitnessPick] = useState('');
  const [choices, setChoices] = useState<{ employee_number: string; name: string }[]>([]);
  const [guarantorNeeded, setGuarantorNeeded] = useState(true);
  const [guarantor, setGuarantorPick] = useState('');
  // the earliest month repayments can start in, and the one chosen (next month unless they pick this one)
  const [firstOpen, setFirstOpen] = useState(addMonths(currentPeriod(), 1));
  const [startPeriod, setStartPeriod] = useState(addMonths(currentPeriod(), 1));

  const loadMine = useCallback(async (employeeNumber: string) => {
    const mine = await loadMyLoans(employeeNumber);
    const ids = mine.map((l) => l.id);
    const [myForms, myGuarantors, myWitnesses] = await Promise.all([
      loadLoanForms(ids).catch(() => ({})),
      loadGuarantors(ids).catch(() => ({})),
      loadWitnesses(ids).catch(() => ({})),
    ]);
    return { mine, myForms, myGuarantors, myWitnesses };
  }, []);

  const refresh = useCallback(async (emp: MyEmployee | null) => {
    if (!emp?.employeeNumber) return;
    const { mine, myForms, myGuarantors, myWitnesses } = await loadMine(emp.employeeNumber);
    setLoans(mine);
    setForms(myForms);
    setGuarantors(myGuarantors);
    setWitnesses(myWitnesses);
  }, [loadMine]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [emp, s, p, open] = await Promise.all([loadMyEmployee(), loadLoanSettings(), loadLoanProducts(), loadFirstOpenPeriod()]);
        if (!live) return;
        setFirstOpen(open);
        setStartPeriod((chosen) => (chosen < open ? open : chosen));
        setEmployee(emp);
        setSettings(s);
        setProducts(p.filter((x) => x.active));
        setForm((f) => ({ ...f, months: f.months || Math.min(Math.max(s.min_months, 12), s.max_months) }));
        if (emp?.employeeNumber) {
          const [{ mine, myForms, myGuarantors, myWitnesses }, colleagues, formSettings] = await Promise.all([
            loadMine(emp.employeeNumber),
            loadGuarantorChoices().catch(() => []),
            loadLoanFormSettings().catch(() => null),
          ]);
          if (live) {
            setLoans(mine);
            setForms(myForms);
            setGuarantors(myGuarantors);
            setWitnesses(myWitnesses);
            setChoices(colleagues);
            setGuarantorNeeded(formSettings?.require_signed_form ?? true);
          }
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
  }, [loadMine]);

  const product = products.find((p) => p.id === productId) ?? null;
  const rate = product?.annual_rate ?? settings.annual_rate;
  const method = product?.interest_method ?? settings.interest_method;
  const maxMonths = maxMonthsFor(settings, product);
  const maxAmount = maxLoanFor(settings, employee?.basicSalary);
  const otherRepayments = details.otherLoanRepayments.trim();
  const errors: Partial<Record<keyof LoanRequestInput | 'otherLoanRepayments' | 'guarantor', string>> = {
    ...validateLoanRequest(form, { minMonths: settings.min_months, maxMonths, maxAmount }),
    ...(otherRepayments !== '' && !(Number(otherRepayments) >= 0) ? { otherLoanRepayments: 'Enter an amount in KSh, or leave it empty.' } : {}),
    ...(guarantorNeeded && !guarantor ? { guarantor: 'Choose a colleague to guarantee your loan.' } : {}),
  };
  const amount = Number(form.amount) || 0;
  const firstMonth = startPeriod;
  const startOptions = [...new Set([firstOpen, addMonths(firstOpen, 1)])];
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
      const loanId = await requestLoan(employee, { productId: productId || null, amount, months: form.months, reason: form.reason, details, startPeriod });
      toast.success('Your loan request was sent for approval');
      if (guarantor) {
        // the request is in either way; a guarantor not asked can be chosen again on the loan
        await setGuarantor(loanId, guarantor).catch((error) => toast.error((error as Error).message || 'Your guarantor was not asked. Choose them again on the loan.'));
      }
      if (witnessPick) {
        await setWitness(loanId, witnessPick).catch((error) => toast.error((error as Error).message || 'Your witness was not asked. Choose them again on the loan.'));
      }
      setForm((f) => ({ ...f, amount: '', reason: '' }));
      setDetails(EMPTY_DETAILS);
      setGuarantorPick('');
      setWitnessPick('');
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

  const showError = (field: keyof LoanRequestInput | 'otherLoanRepayments' | 'guarantor') =>
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
            <LoaderBlock label="Loading" compact />
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
                    <option value="">Staff loan ({rateText(settings.annual_rate, settings.interest_method)})</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({rateText(p.annual_rate, p.interest_method)}, up to {p.max_months} months)
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
                <label htmlFor="loan-start" className="block text-[12px] font-semibold text-ink mb-1">
                  Start repaying from
                </label>
                <select id="loan-start" value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)} disabled={!!blocked} className={inputClass}>
                  {startOptions.map((p) => (
                    <option key={p} value={p}>
                      {periodLabel(p)} pay{p === currentPeriod() ? ' (this month)' : ''}
                    </option>
                  ))}
                </select>
                {firstOpen === currentPeriod() && (
                  <p className="mt-1 mb-0 text-[11.5px] text-muted-foreground">
                    This month is possible while its payroll isn’t approved yet. If it is approved before your loan is, you start the month after.
                  </p>
                )}
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

              <fieldset className="space-y-3">
                <legend className="text-[12px] font-semibold text-ink mb-1">For the loan form</legend>
                <div>
                  <label htmlFor="loan-address" className="block text-[12px] text-ink mb-1">
                    Where you live (residential address)
                  </label>
                  <input
                    id="loan-address"
                    value={details.residentialAddress}
                    maxLength={300}
                    onChange={(e) => setDetails({ ...details, residentialAddress: e.target.value })}
                    disabled={!!blocked}
                    className={inputClass}
                    placeholder="For example: Kileleshwa, Nairobi"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="loan-other" className="block text-[12px] text-ink mb-1">
                      Other loan repayments a month (KSh)
                    </label>
                    <input
                      id="loan-other"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={details.otherLoanRepayments}
                      onChange={(e) => setDetails({ ...details, otherLoanRepayments: e.target.value })}
                      disabled={!!blocked}
                      className={inputClass}
                      placeholder="0"
                    />
                    {showError('otherLoanRepayments')}
                  </div>
                  <div>
                    <label htmlFor="loan-account" className="block text-[12px] text-ink mb-1">
                      Pay the loan to (M-Pesa number or account)
                    </label>
                    <input
                      id="loan-account"
                      value={details.disbursementAccount}
                      maxLength={100}
                      onChange={(e) => setDetails({ ...details, disbursementAccount: e.target.value })}
                      disabled={!!blocked}
                      className={inputClass}
                      placeholder="For example: 0712 345 678"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="loan-guarantor" className="block text-[12px] text-ink mb-1">
                    Guarantor (a colleague at the company){guarantorNeeded ? '' : ', optional'}
                  </label>
                  <select id="loan-guarantor" value={guarantor} onChange={(e) => setGuarantorPick(e.target.value)} disabled={!!blocked} className={inputClass}>
                    <option value="">Choose a colleague…</option>
                    {choices.map((c) => (
                      <option key={c.employee_number} value={c.employee_number}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 mb-0 text-[11.5px] text-muted-foreground">They are asked to read the loan’s terms and sign as guarantor in their staff portal.</p>
                  {showError('guarantor')}
                </div>
                <div>
                  <label htmlFor="loan-witness" className="block text-[12px] text-ink mb-1">
                    Witness (a colleague), optional now
                  </label>
                  <select id="loan-witness" value={witnessPick} onChange={(e) => setWitnessPick(e.target.value)} disabled={!!blocked} className={inputClass}>
                    <option value="">Choose later…</option>
                    {choices
                      .filter((c) => c.employee_number !== guarantor)
                      .map((c) => (
                        <option key={c.employee_number} value={c.employee_number}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                  <p className="mt-1 mb-0 text-[11.5px] text-muted-foreground">They witness your signature from their portal once the loan is approved and you have signed.</p>
                </div>
              </fieldset>

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
                    {method === 'upfront' && (
                      <>
                        You receive <strong className="text-ink">{formatKsh(totals.paidOut)}</strong>: the interest is taken off when the loan is paid
                        out, and you repay {formatKsh(totals.totalRepayable)}.{' '}
                      </>
                    )}
                    {rateText(rate, method)}, {interestMethodLabel(method).toLowerCase()}. If approved, repayments come off your{' '}
                    {periodLabel(firstMonth)} pay. HR confirms the start month.
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
                    {l.status === 'approved' && (
                      <p className="mt-2 text-[12px] text-muted-foreground">
                        {formHoldsPayout(forms[l.id])
                          ? 'Approved. Sign the loan form below: finance pays it out once HR accepts the signed copy.'
                          : 'Approved. Finance will pay it out to you.'}
                      </p>
                    )}
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
                    <LoanFormPanel
                      loan={{ ...l, employee_name: employee?.fullName }}
                      form={forms[l.id]}
                      mode="staff"
                      schedule={l.schedule}
                      renewal={isRenewal(l, loans)}
                      guarantor={guarantors[l.id]}
                      witness={witnesses[l.id]}
                      onChanged={() => refresh(employee)}
                    />
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {employee?.employeeNumber && <GuaranteeRequests employeeNumber={employee.employeeNumber} />}
          {employee?.employeeNumber && <WitnessRequests employeeNumber={employee.employeeNumber} />}
        </div>
      </div>
    </div>
  );
}
