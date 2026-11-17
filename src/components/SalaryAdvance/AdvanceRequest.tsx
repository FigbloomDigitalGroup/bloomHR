import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { HandCoins, Lock } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from '../UI';
import AdvanceTimeline, { AdvanceStagePill, RepaymentSummary } from './AdvanceTimeline';
import {
  ADVANCE_LIMIT_SHARE,
  advanceAmount,
  advancePeriod,
  currentPeriod,
  formatKsh,
  maxAdvanceFor,
  repaymentMonths,
  repaymentNote,
  validateAdvanceRequest,
  type AdvanceRequestInput,
  type AdvanceRow,
} from '../../lib/salaryAdvance';
import {
  loadAdvanceWindow,
  loadMyAdvances,
  loadMyEmployee,
  requestAdvance,
  watchMyAdvances,
  type AdvanceWindow,
  type MyEmployee,
} from '../../lib/salaryAdvanceApi';
import { LoaderBlock } from '../UI/FigbloomLoader';

// Staff portal: ask for a salary advance and follow it from request to repaid.

const inputClass =
  'w-full px-3 py-2 text-[13px] border border-border rounded-tile bg-white focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand disabled:bg-secondary disabled:cursor-not-allowed';

export default function AdvanceRequest() {
  const [employee, setEmployee] = useState<MyEmployee | null>(null);
  const [advanceWindow, setAdvanceWindow] = useState<AdvanceWindow>({ open: true, message: '' });
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<AdvanceRequestInput>({ amount: '', reason: '' });
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async (emp: MyEmployee | null) => {
    if (!emp?.employeeNumber) return;
    setAdvances(await loadMyAdvances(emp.employeeNumber));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [emp, win] = await Promise.all([loadMyEmployee(), loadAdvanceWindow()]);
        if (!live) return;
        setEmployee(emp);
        setAdvanceWindow(win);
        if (emp?.employeeNumber) {
          const rows = await loadMyAdvances(emp.employeeNumber);
          if (live) setAdvances(rows);
        }
      } catch (error) {
        console.error('Error loading salary advances:', error);
        toast.error('Could not load your salary advances');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // the request moves on while they watch (approved, paid)
  useEffect(() => {
    if (!employee?.employeeNumber) return;
    return watchMyAdvances(employee.employeeNumber, () => {
      refresh(employee).catch((error) => console.error('Error refreshing salary advances:', error));
    });
  }, [employee, refresh]);

  const maxAmount = maxAdvanceFor(employee?.basicSalary);
  const errors = validateAdvanceRequest(form, maxAmount);
  const thisMonth = currentPeriod();
  // one request a month; a declined one does not count
  const requestedThisMonth = advances.some(
    (a) => advancePeriod(a.time_added) === thisMonth && !['rejected', 'declined'].includes(String(a.status ?? '').toLowerCase()),
  );
  const blocked = !employee
    ? 'Your login is not linked to an employee record, so you cannot ask for an advance. Ask HR to check your work email.'
    : employee.terminated
      ? 'Your employment has ended, so you cannot ask for an advance.'
      : !advanceWindow.open
        ? advanceWindow.message
        : requestedThisMonth
          ? 'You have already asked for an advance this month. You can ask again next month.'
          : null;

  const amount = Number(form.amount) || 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTriedSubmit(true);
    if (blocked || !employee || Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      await requestAdvance(employee, { amount, reason: form.reason });
      toast.success('Your advance request was sent for approval');
      setForm({ amount: '', reason: '' });
      setTriedSubmit(false);
      await refresh(employee);
    } catch (error) {
      console.error('Error requesting salary advance:', error);
      toast.error('Your request was not sent. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const showError = (field: keyof AdvanceRequestInput) =>
    (triedSubmit || (field === 'amount' && form.amount !== '')) && errors[field] ? (
      <p id={`advance-${field}-error`} className="mt-1 text-[11.5px] text-status-danger" role="alert">
        {errors[field]}
      </p>
    ) : null;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Salary advance" subtitle="Get part of your salary early. It comes back off your pay through payroll." />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card>
          <h2 className="text-[15px] font-bold text-ink mb-3">Ask for an advance</h2>

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

              <div>
                <label htmlFor="advance-amount" className="block text-[12px] font-semibold text-ink mb-1">
                  Amount (KSh)
                </label>
                <input
                  id="advance-amount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={maxAmount}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  disabled={!!blocked}
                  aria-invalid={!!errors.amount && (triedSubmit || form.amount !== '')}
                  aria-describedby="advance-amount-hint"
                  className={inputClass}
                  placeholder="0"
                />
                <p id="advance-amount-hint" className="mt-1 text-[11.5px] text-muted-foreground">
                  You can ask for up to <strong className="text-ink">{formatKsh(maxAmount)}</strong> ({ADVANCE_LIMIT_SHARE * 100}% of your basic
                  salary of {formatKsh(parseFloat(employee?.basicSalary ?? '') || 0)}). The whole amount comes off your next pay.
                </p>
                {showError('amount')}
              </div>

              <div>
                <label htmlFor="advance-reason" className="block text-[12px] font-semibold text-ink mb-1">
                  Reason
                </label>
                <textarea
                  id="advance-reason"
                  rows={3}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  disabled={!!blocked}
                  className={inputClass}
                  placeholder="For example: school fees for next term"
                />
                {showError('reason')}
              </div>

              {amount > 0 && !errors.amount && (
                <p className="text-[11.5px] text-muted-foreground" data-testid="advance-plan">
                  {repaymentNote(amount, thisMonth)}
                </p>
              )}

              <Button type="submit" disabled={!!blocked || saving} icon={<HandCoins className="w-4 h-4" />} className="w-full sm:w-auto justify-center">
                {saving ? 'Sending...' : 'Send request'}
              </Button>
            </form>
          )}
        </Card>

        <div>
          <h2 className="text-[15px] font-bold text-ink mb-3">My requests</h2>
          {!loading && advances.length === 0 ? (
            <Card>
              <EmptyState icon={<HandCoins className="w-5 h-5" />} title="No requests yet" description="Requests you send show here with where they stand." />
            </Card>
          ) : (
            <ul className="space-y-3">
              {advances.map((a) => (
                <li key={a.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <div className="text-[15px] font-bold text-ink">{formatKsh(advanceAmount(a))}</div>
                        <div className="text-[11.5px] text-muted-foreground">
                          Asked {a.time_added ? new Date(a.time_added).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                          {' · '}
                          {repaymentMonths(a) === 1 ? 'repaid in full on the next pay' : `repaid over ${repaymentMonths(a)} months`}
                        </div>
                      </div>
                      <AdvanceStagePill row={a} />
                    </div>
                    <AdvanceTimeline row={a} />
                    {String(a.status ?? '').toLowerCase() === 'rejected' && (
                      <p className="mt-3 text-[12px] text-status-danger">
                        <strong>Reason:</strong> {a.admin_notes || 'No reason given.'}
                      </p>
                    )}
                    <div className="mt-3">
                      <RepaymentSummary row={a} />
                    </div>
                    {a['Reason for Advance'] && <p className="mt-2 text-[11.5px] text-muted-foreground break-words">For: {a['Reason for Advance']}</p>}
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
