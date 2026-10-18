import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../UI';
import { loadDeductionCap, saveDeductionCap } from '../../lib/workSettlementApi';
import { runErrorMessage } from '../../lib/payrollRuns';

// Payroll settings: the Employment Act s.19(3) limit on a month-end settlement (FIG-812 stage 5;
// company_payroll_settings.deduction_cap, on by default). Deductions plus arrears above two-thirds of the month's wages
// carry forward to next month instead of coming off now; PAYE, NSSF, SHIF and AHL are always taken in full.

export default function DeductionCapSetting({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadDeductionCap()
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
      await saveDeductionCap(next);
      toast.success(next ? 'Deductions will stay within two-thirds of wages.' : 'The two-thirds limit is off.');
      onChanged();
    } catch (err) {
      setOn(!next);
      toast.error(runErrorMessage(err, 'Could not save the setting.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="sm">
      <label className={`flex items-start gap-2 text-xs ${canEdit ? 'cursor-pointer' : 'opacity-80'}`}>
        <input
          type="checkbox"
          className="mt-0.5"
          checked={on ?? true}
          disabled={!canEdit || busy || on === null}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          <span className="font-semibold text-ink">Keep deductions within two-thirds of wages</span>
          <span className="text-muted-foreground"> (default, Employment Act s.19(3))</span>
          <span className="block text-[11px] text-muted-foreground">
            For workers paid by piece rate or contract jobs: when a month&apos;s deductions and arrears are more than two-thirds of
            the month&apos;s wages, the rest carries forward to next month as an arrear. PAYE, NSSF, SHIF and AHL are always
            taken in full. Net pay is never below 0: anything more than is left to pay carries forward too.
          </span>
        </span>
      </label>
    </Card>
  );
}
