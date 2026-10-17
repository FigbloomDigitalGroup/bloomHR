import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import { MONTH_NAMES, leaveYearLabel } from '../../lib/leaveAccrual';
import { DEFAULT_LEAVE_YEAR, LeaveYearSettings, loadLeaveYearSettings, saveLeaveYearStart } from '../../lib/leaveYearDb';

/**
 * The company's leave year (FIG-877): the month it starts in, or the same as the fiscal year. Balances, the yearly
 * reset, year-end reminders and carried days' deadlines all follow it.
 */
export default function LeaveYearSetting({ onChange }: { onChange?: (startMonth: number) => void }) {
  const [settings, setSettings] = useState<LeaveYearSettings>(DEFAULT_LEAVE_YEAR);
  const [month, setMonth] = useState(1);
  const [sameAsFiscal, setSameAsFiscal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadLeaveYearSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setMonth(s.leave_year_start_month);
        setSameAsFiscal(s.same_as_fiscal_year);
      })
      .catch((err) => console.error('Error loading the leave year:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const startMonth = sameAsFiscal ? settings.fiscal_year_start_month : month;
  const changed = sameAsFiscal !== settings.same_as_fiscal_year || (!sameAsFiscal && month !== settings.leave_year_start_month);

  const save = async () => {
    setSaving(true);
    try {
      const s = await saveLeaveYearStart(month, sameAsFiscal);
      setSettings(s);
      onChange?.(s.start_month);
      toast.success(`The leave year now starts in ${MONTH_NAMES[s.start_month - 1]}.`);
    } catch (err) {
      toast.error((err as { message?: string })?.message || 'Could not save the leave year.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="text-lg font-base text-gray-900 mb-2">Leave year</h3>
      <p className="text-xs text-gray-500 mb-4">
        When yearly leave starts again: balances, the yearly reset (on the 1st of this month), year-end reminders and the deadline for
        carried-over days all follow it. Best changed at the turn of a leave year, as this year's balances are read against it.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Starts in</label>
          <select
            value={month}
            disabled={sameAsFiscal}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-gray-100 disabled:text-gray-400"
          >
            {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
          </select>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-gray-700 pb-2">
          <input type="checkbox" checked={sameAsFiscal} onChange={(e) => setSameAsFiscal(e.target.checked)} />
          Same as the fiscal year ({MONTH_NAMES[settings.fiscal_year_start_month - 1]}, from Settings &gt; Company profile)
        </label>
        <button
          onClick={save}
          disabled={saving || !changed}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-lg text-xs font-medium"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        This leave year: {leaveYearLabel(settings.current_year, settings.start_month)}
        {startMonth !== settings.start_month && ` (after saving, leave years start in ${MONTH_NAMES[startMonth - 1]})`}.
      </p>
    </div>
  );
}
