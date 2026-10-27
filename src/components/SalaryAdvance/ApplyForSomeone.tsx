import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { HandCoins } from 'lucide-react';
import { Button, Modal } from '../UI';
import EmployeePicker from '../UI/EmployeePicker';
import { ADVANCE_LIMIT_SHARE, currentPeriod, formatKsh, maxAdvanceFor, repaymentNote, validateAdvanceRequest } from '../../lib/salaryAdvance';
import { type MyEmployee, loadEmployeeForAdvance, requestAdvanceFor } from '../../lib/salaryAdvanceApi';

// An admin applies for a salary advance on someone's behalf: for a person who asked in person, by phone or on paper.
// It goes to the company's approvers like any request; with "Approve it now" the admin also approves the step it
// waits on, when they may decide it. Payroll takes it back in full on the next payday.

const inputClass =
  'w-full px-3 py-2 text-[13px] border border-border rounded-tile bg-white focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand';

export default function ApplyForSomeone({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [employeeNumber, setEmployeeNumber] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [approveNow, setApproveNow] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  // the chosen person's record: their limit is 30% of their basic salary
  const [employee, setEmployee] = useState<MyEmployee | null>(null);

  useEffect(() => {
    setEmployee(null);
    if (!employeeNumber) return;
    let live = true;
    loadEmployeeForAdvance(employeeNumber)
      .then((e) => live && setEmployee(e))
      .catch(() => live && toast.error('Could not load this employee.'));
    return () => {
      live = false;
    };
  }, [employeeNumber]);

  const maxAmount = maxAdvanceFor(employee?.basicSalary);
  const errors = validateAdvanceRequest({ amount, reason }, maxAmount);
  const value = Number(amount) || 0;
  const show = (message: string | undefined) =>
    tried && message ? (
      <p className="mt-1 text-[11.5px] text-status-danger" role="alert">
        {message}
      </p>
    ) : null;

  const close = () => {
    setEmployeeNumber(null);
    setAmount('');
    setReason('');
    setApproveNow(false);
    setTried(false);
    onClose();
  };

  const save = async () => {
    setTried(true);
    if (!employeeNumber || !employee || Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      if (employee.terminated) throw new Error(`${employee.fullName || 'This person'}'s employment has ended.`);
      const status = await requestAdvanceFor(employee, { amount: value, reason, approveNow });
      toast.success(
        status === 'approved'
          ? `Advance for ${employee.fullName} approved. Pay it from Payments to make.`
          : status === 'your-step-approved'
            ? `Advance for ${employee.fullName}: your step is approved. It now goes to the next approver.`
            : approveNow
              ? `Advance for ${employee.fullName} sent for approval: you can't decide its first step.`
              : `Advance for ${employee.fullName} sent for approval`,
      );
      onSaved();
      close();
    } catch (error) {
      toast.error((error as { message?: string } | null)?.message || 'The advance was not saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Apply for someone" size="md">
      <div className="space-y-4">
        <p className="m-0 text-[12.5px] text-muted-foreground">
          For someone who asked in person, by phone or on paper. They see it in their salary advances.
        </p>
        <div>
          <EmployeePicker
            label="Employee"
            value={employeeNumber}
            onChange={(e) => setEmployeeNumber(e ? String(e.employeeNumber) : null)}
            filter={(e) => !e.status || String(e.status).toLowerCase() === 'active'}
            required
          />
          {show(employeeNumber ? undefined : 'Choose who the advance is for.')}
          {employee && (
            <p className="mt-1 text-[11.5px] text-muted-foreground" data-testid="apply-limit">
              Up to <strong className="text-ink">{formatKsh(maxAmount)}</strong> ({ADVANCE_LIMIT_SHARE * 100}% of {employee.fullName}'s basic salary of{' '}
              {formatKsh(parseFloat(employee.basicSalary) || 0)}).
            </p>
          )}
        </div>
        <div>
          <label htmlFor="apply-amount" className="block text-[12px] font-semibold text-ink mb-1">
            Amount (KSh)
          </label>
          <input
            id="apply-amount"
            type="number"
            inputMode="numeric"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
            placeholder="0"
          />
          {(tried || (amount !== '' && employee)) && errors.amount ? (
            <p className="mt-1 text-[11.5px] text-status-danger" role="alert">
              {errors.amount}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="apply-reason" className="block text-[12px] font-semibold text-ink mb-1">
            Reason
          </label>
          <textarea id="apply-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          {show(errors.reason)}
        </div>
        {value > 0 && !errors.amount && (
          <p className="m-0 text-[11.5px] text-muted-foreground" data-testid="apply-plan">
            {repaymentNote(value, currentPeriod())}
          </p>
        )}
        <label className="flex items-start gap-2 text-[12.5px] text-ink">
          <input type="checkbox" checked={approveNow} onChange={(e) => setApproveNow(e.target.checked)} className="mt-0.5 accent-[rgb(var(--brand))]" />
          <span>
            Approve it now
            <span className="block text-[11.5px] text-muted-foreground">
              Approves the first step for you when you are one of its approvers. Any later steps still go to their approvers.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} icon={<HandCoins className="w-3.5 h-3.5" />}>
            {saving ? 'Saving…' : 'Apply'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
