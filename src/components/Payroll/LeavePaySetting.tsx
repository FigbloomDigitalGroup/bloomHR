import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../UI';
import { LEAVE_RATE_BASES, type LeaveRateBasis } from '../../lib/leavePay';
import { loadLeaveRateBasis, saveLeaveRateBasis } from '../../lib/leavePayDb';
import { runErrorMessage } from '../../lib/payrollRuns';

// Payroll settings: how a day's pay is worked out when unpaid leave and half-pay leave days come off a payslip
// (company_payroll_settings.leave_daily_rate_basis, lib/leavePay).

interface LeavePaySettingProps {
  /** whether this person may change it (payroll access) */
  canEdit: boolean;
  /** after a change, so the month's figures are worked out again */
  onChanged: () => void;
  draftNotice: string | null;
}

export default function LeavePaySetting({ canEdit, onChanged, draftNotice }: LeavePaySettingProps) {
  const [basis, setBasis] = useState<LeaveRateBasis | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadLeaveRateBasis()
      .then((b) => live && setBasis(b))
      .catch(() => live && setBasis('basic_30'));
    return () => {
      live = false;
    };
  }, []);

  const choose = async (next: LeaveRateBasis) => {
    if (next === basis || busy) return;
    const before = basis;
    setBasis(next);
    setBusy(true);
    try {
      await saveLeaveRateBasis(next);
      toast.success('Saved how a day of leave is deducted.');
      onChanged();
    } catch (err) {
      setBasis(before);
      toast.error(runErrorMessage(err, 'Could not save the setting.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="text-sm font-bold text-ink">Unpaid and half-pay leave</h2>
      <p className="text-[11.5px] text-muted-foreground mb-3">
        Approved unpaid leave, and leave at half pay (such as sick leave once its full-pay days are used), comes off the
        payslip automatically: a day's pay for each unpaid day, half a day's pay for each half-pay day, before tax. A day's
        pay is:
      </p>
      <div className="space-y-2" role="radiogroup" aria-label="A day's pay for leave deductions">
        {LEAVE_RATE_BASES.map((b) => (
          <label key={b.value} className={`flex items-start gap-2 text-xs ${canEdit ? 'cursor-pointer' : 'opacity-80'}`}>
            <input
              type="radio"
              name="leave-daily-rate"
              className="mt-0.5"
              checked={basis === b.value}
              disabled={!canEdit || busy || basis === null}
              onChange={() => void choose(b.value)}
            />
            <span>
              <span className="font-semibold text-ink">{b.label}</span>
              {b.value === 'basic_30' && <span className="text-muted-foreground"> (default)</span>}
              <span className="block text-[11px] text-muted-foreground">{b.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {draftNotice && (
        <div className="mt-3 rounded-tile bg-orange-tint-alt text-orange-text-alt text-[11.5px] font-semibold px-3 py-2">{draftNotice}</div>
      )}
    </Card>
  );
}
