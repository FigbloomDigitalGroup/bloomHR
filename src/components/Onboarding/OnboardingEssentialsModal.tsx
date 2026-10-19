import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { Button } from '../UI';
import { type EssentialItem, errorMessage, loadOnboardingSettings, saveOnboardingSettings } from '../../lib/onboarding';
import FigbloomLoader from '../UI/FigbloomLoader';

// Which onboarding items the company needs before an employee can be submitted and approved (and so paid). The rest
// can follow later: the employee is reminded until they are in. Ticking everything makes onboarding all or nothing.

export default function OnboardingEssentialsModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<EssentialItem[] | null>(null);
  const [days, setDays] = useState('7');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadOnboardingSettings().then(
      (s) => {
        setItems(s.items);
        setDays(String(s.reminder_every_days));
      },
      (err) => {
        setItems([]);
        toast.error(errorMessage(err, 'Could not load the settings.'));
      }
    );
  }, []);

  const sections = useMemo(() => [...new Set((items ?? []).map((i) => i.section))], [items]);
  // items payroll needs that are not essential: their numbers may be missing when the returns are filed
  const risky = (items ?? []).filter((i) => i.payroll_note && !i.essential);
  const allTicked = (items ?? []).length > 0 && (items ?? []).every((i) => i.essential);
  const daysNumber = Number(days);
  const daysOk = Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= 90;

  const toggle = (key: string, essential: boolean) =>
    setItems((list) => list?.map((i) => (i.item_key === key ? { ...i, essential } : i)) ?? list);
  const setAll = (fn: (i: EssentialItem) => boolean) => setItems((list) => list?.map((i) => ({ ...i, essential: fn(i) })) ?? list);

  const save = async () => {
    if (!items) return;
    setSaving(true);
    try {
      await saveOnboardingSettings(items.filter((i) => i.essential).map((i) => i.item_key), daysNumber);
      toast.success('Onboarding settings saved');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'The settings were not saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto" role="dialog" aria-label="Onboarding essentials">
      <div className="bg-white rounded-[10px] border border-border shadow-lg w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Onboarding essentials</h2>
            <p className="text-xs text-muted-foreground">
              Ticked items are needed before an employee can be submitted and approved (and paid). The rest can follow later.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-muted-foreground hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {!items && <FigbloomLoader label="Loading" size={48} />}
          {items && (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <button type="button" className="text-brand underline" onClick={() => setAll(() => true)}>Tick everything (all or nothing)</button>
                <button type="button" className="text-brand underline" onClick={() => setAll((i) => i.default_essential)}>Back to the default</button>
              </div>
              {sections.map((section) => (
                <section key={section}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{section}</h3>
                  <ul>
                    {items.filter((i) => i.section === section).map((i) => (
                      <li key={i.item_key}>
                        <label className="flex items-center gap-2 py-1 text-sm text-ink">
                          <input type="checkbox" checked={i.essential} onChange={(e) => toggle(i.item_key, e.target.checked)} />
                          {i.label}
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {allTicked && (
                <p className="text-xs text-muted-foreground">Everything is ticked: nobody can be submitted or approved until every item is in.</p>
              )}
              {risky.length > 0 && (
                <div role="alert" className="rounded-lg bg-orange-tint px-3 py-2 text-xs text-ink space-y-1">
                  <p className="flex items-center gap-1 font-medium"><AlertTriangle className="h-3.5 w-3.5" /> Payroll needs these, but they can follow later:</p>
                  <ul className="list-disc pl-5">
                    {risky.map((i) => <li key={i.item_key}>{i.label}: {i.payroll_note}</li>)}
                  </ul>
                  <p>Employees can be approved and paid without them, so chase them before you file the month’s returns.</p>
                </div>
              )}
              <label className="block text-sm text-ink">
                <span className="block text-xs font-medium mb-1">Remind employees of what is still to provide every</span>
                <span className="flex items-center gap-2">
                  <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Reminder interval in days"
                    className="w-20 rounded-lg border border-border px-2 py-1 text-sm" />
                  days
                </span>
                {!daysOk && <span className="block text-xs text-status-danger mt-1">Choose 1 to 90 days.</span>}
                <span className="block text-xs text-muted-foreground mt-1">They are also reminded when HR approves them and when an item’s due date comes; HR hears about overdue items.</span>
              </label>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!items || saving || !daysOk} onClick={() => void save()} icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
