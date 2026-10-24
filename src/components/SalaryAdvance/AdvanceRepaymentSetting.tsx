import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarClock } from 'lucide-react';
import { Button, Card } from '../UI';
import { MAX_REPAYMENT_MONTHS, REPAYMENT_MONTHS_LIMIT } from '../../lib/salaryAdvance';
import { loadMaxRepaymentMonths, saveMaxRepaymentMonths } from '../../lib/salaryAdvanceApi';

// The longest a person may take to repay an advance. At one month the request form offers no choice: the advance
// comes off the pay of the month it was asked for. Requests already made keep their terms.

const choices = Array.from({ length: REPAYMENT_MONTHS_LIMIT }, (_, i) => i + 1);

export default function AdvanceRepaymentSetting() {
  const [saved, setSaved] = useState<number | null>(null);
  const [months, setMonths] = useState(MAX_REPAYMENT_MONTHS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadMaxRepaymentMonths()
      .then((n) => {
        setSaved(n);
        setMonths(n);
      })
      .catch((error) => {
        console.error('Error loading the advance repayment setting:', error);
        toast.error('Could not load the repayment setting');
      });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveMaxRepaymentMonths(months);
      setSaved(months);
      toast.success(months === 1 ? 'Advances are now repaid in one month' : `Staff can now spread an advance over up to ${months} months`);
    } catch (error) {
      console.error('Error saving the advance repayment setting:', error);
      toast.error('Not saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start gap-3">
        <CalendarClock className="w-5 h-5 text-brand shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-bold text-ink">Repayment</h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            The longest staff may take to repay an advance. At one month, the whole advance comes off the pay of the month it was asked for.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-[12px] font-semibold text-ink">
              Repaid within
              <select
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                disabled={saved === null}
                className="ml-2 px-2 py-1.5 text-[12.5px] border border-border rounded-tile bg-white"
              >
                {choices.map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? 'one month' : `${n} months`}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={save} disabled={saving || saved === null || months === saved}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
