import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card } from '../UI';
import { loadDepartmentsAndGroups, loadOvertimeSettings, saveOvertimeSettings } from '../../lib/overtimeApi';
import { overtimeHourlyRate, settingsProblems, type OvertimeSettings } from '../../lib/overtimePay';

// Payroll settings: overtime on or off, the multipliers for each kind of day, the hours basic salary pays for, an
// optional monthly cap, and the departments and job groups that don't get overtime (company_payroll_settings.overtime_*).

interface Props {
  canEdit: boolean;
  /** after a save, so the month's figures are worked out again */
  onChanged?: () => void;
}

const field = 'w-20 rounded-lg border border-border px-2 py-1 text-xs text-ink disabled:bg-secondary';

export default function OvertimeSettingsCard({ canEdit, onChanged }: Props) {
  const [saved, setSaved] = useState<OvertimeSettings | null>(null);
  const [draft, setDraft] = useState<OvertimeSettings | null>(null);
  const [options, setOptions] = useState<{ departments: { id: string; name: string }[]; jobGroups: { id: string; code: string; name: string }[] }>({
    departments: [],
    jobGroups: [],
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadOvertimeSettings()
      .then((s) => {
        if (!live) return;
        setSaved(s);
        setDraft(s);
      })
      .catch((err) => console.error('Could not load the overtime settings:', err));
    loadDepartmentsAndGroups()
      .then((o) => live && setOptions(o))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!draft || !saved) return null;

  const set = (patch: Partial<OvertimeSettings>) => setDraft({ ...draft, ...patch });
  const numberInput = (label: string, value: number | null, onChange: (n: number | null) => void, opts: { step?: string; optional?: boolean } = {}) => (
    <label className="flex items-center justify-between gap-3 text-xs text-ink">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        step={opts.step ?? '0.25'}
        min="0"
        className={field}
        disabled={!canEdit || busy}
        value={value ?? ''}
        placeholder={opts.optional ? 'No cap' : undefined}
        onChange={(e) => onChange(e.target.value === '' ? (opts.optional ? null : 0) : Number(e.target.value))}
      />
    </label>
  );
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const problems = settingsProblems(draft);

  const save = async () => {
    if (problems.length) {
      toast.error(problems[0]);
      return;
    }
    setBusy(true);
    try {
      await saveOvertimeSettings(draft);
      setSaved(draft);
      toast.success('Overtime settings saved');
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message || 'Could not save the overtime settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-ink">Overtime</h2>
          <p className="text-[11.5px] text-muted-foreground mb-3 max-w-2xl">
            Approved overtime from the Overtime page is paid with the month&apos;s salary and taxed like other earnings: hours ×
            an hour&apos;s pay × the multiplier for the kind of day. An hour&apos;s pay is the employee&apos;s own overtime rate when
            payroll has set one, otherwise basic salary ÷ the monthly hours (e.g. KSh 40,000 ÷ {draft.monthlyHours} ={' '}
            KSh {overtimeHourlyRate(40000, draft.monthlyHours).toLocaleString('en-KE', { minimumFractionDigits: 2 })}).
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-ink">
          <input type="checkbox" checked={draft.enabled} disabled={!canEdit || busy} onChange={(e) => set({ enabled: e.target.checked })} />
          Pay overtime
        </label>
      </div>

      <div className={`grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 ${draft.enabled ? '' : 'opacity-60'}`}>
        {numberInput('Working day multiplier', draft.normalMultiplier, (n) => set({ normalMultiplier: n ?? 0 }))}
        {numberInput('Rest day multiplier', draft.restMultiplier, (n) => set({ restMultiplier: n ?? 0 }))}
        {numberInput('Public holiday multiplier', draft.holidayMultiplier, (n) => set({ holidayMultiplier: n ?? 0 }))}
        {numberInput('Hours basic salary pays for, a month', draft.monthlyHours, (n) => set({ monthlyHours: n ?? 0 }), { step: '1' })}
        {numberInput('Most overtime hours paid a month, per person', draft.monthlyCap, (n) => set({ monthlyCap: n }), { step: '1', optional: true })}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Defaults: 1.5 on a working day, 2 on a rest day or public holiday, 225 hours (45 a week), no cap. A rest day is a day
        off in the employee&apos;s work week (Time Off settings); a half day counts as a working day. Hours over the cap are not
        paid. Casual workers are paid by the day and get no overtime.
      </p>

      {(options.departments.length > 0 || options.jobGroups.length > 0) && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { title: 'Departments without overtime', items: options.departments.map((d) => ({ id: d.id, label: d.name })), key: 'excludedDepartments' as const },
            { title: 'Job groups without overtime', items: options.jobGroups.map((g) => ({ id: g.id, label: `${g.code} ${g.name}`.trim() })), key: 'excludedJobGroups' as const },
          ]
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <fieldset key={g.key} className="text-xs text-ink">
                <legend className="font-semibold mb-1">{g.title}</legend>
                <div className="max-h-36 overflow-y-auto space-y-1 rounded-lg border border-border p-2">
                  {g.items.map((item) => (
                    <label key={item.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        disabled={!canEdit || busy}
                        checked={draft[g.key].includes(item.id)}
                        onChange={() => set({ [g.key]: toggle(draft[g.key], item.id) } as Partial<OvertimeSettings>)}
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
        </div>
      )}

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={!changed || busy}>
            {busy ? 'Saving...' : 'Save overtime settings'}
          </Button>
          {changed && <span className="text-[11px] text-muted-foreground">Recalculate a draft month to apply the change to it.</span>}
          {problems.length > 0 && <span className="text-[11px] text-status-danger">{problems[0]}</span>}
        </div>
      )}
    </Card>
  );
}
