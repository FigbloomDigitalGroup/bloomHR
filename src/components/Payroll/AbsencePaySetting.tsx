import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { loadDeductAbsence, saveDeductAbsence } from '../../lib/leaveDisciplineApi';
import { runErrorMessage } from '../../lib/payrollRuns';

// Payroll settings: whether days of unexcused absence (recorded in Leave discipline, not excused) come off pay, at the
// same day's pay as unpaid leave (company_payroll_settings.deduct_unexcused_absence, FIG-881).

interface AbsencePaySettingProps {
  canEdit: boolean;
  onChanged: () => void;
}

export default function AbsencePaySetting({ canEdit, onChanged }: AbsencePaySettingProps) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadDeductAbsence()
      .then((v) => live && setOn(v))
      .catch(() => live && setOn(true));
    return () => {
      live = false;
    };
  }, []);

  const toggle = async (next: boolean) => {
    if (busy) return;
    setOn(next);
    setBusy(true);
    try {
      await saveDeductAbsence(next);
      toast.success(next ? 'Unexcused absences will come off pay.' : 'Unexcused absences will not come off pay.');
      onChanged();
    } catch (err) {
      setOn(!next);
      toast.error(runErrorMessage(err, 'Could not save the setting.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className={`mt-3 pt-3 border-t border-border flex items-start gap-2 text-xs ${canEdit ? 'cursor-pointer' : 'opacity-80'}`}>
      <input
        type="checkbox"
        className="mt-0.5"
        checked={on ?? true}
        disabled={!canEdit || busy || on === null}
        onChange={(e) => void toggle(e.target.checked)}
      />
      <span>
        <span className="font-semibold text-ink">Deduct unexcused absences</span>
        <span className="text-muted-foreground"> (default)</span>
        <span className="block text-[11px] text-muted-foreground">
          Days of unexcused absence recorded in Leave discipline, and not excused, come off pay at the same day&apos;s pay as
          unpaid leave. A failure to notify is a conduct record and is never deducted by itself.
        </span>
      </span>
    </label>
  );
}
