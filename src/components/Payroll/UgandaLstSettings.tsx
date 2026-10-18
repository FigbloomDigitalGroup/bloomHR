import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../UI';
import { runErrorMessage } from '../../lib/payrollRuns';
import { type LstCollection, ugandaFinancialYear } from '../../lib/payroll/countries/uganda';
import { type LstPaidElsewhere, loadLstCollection, loadLstPaidElsewhere, saveLstCollection, saveLstPaidElsewhere } from '../../lib/payroll/ugandaApi';

// Uganda's Local Service Tax settings (FIG-905 stage 4): whether LST is taken in four instalments in July to October
// or all at once (company_payroll_settings.lst_collection), and LST an employee already paid this financial year with
// another employer or straight to the council (lst_years), so payroll takes only the rest.

export default function UgandaLstSettings({ payPeriod, canEdit, onChanged }: { payPeriod: string; canEdit: boolean; onChanged: () => void }) {
  const fy = ugandaFinancialYear(payPeriod);
  const [collection, setCollection] = useState<LstCollection | null>(null);
  const [paid, setPaid] = useState<LstPaidElsewhere[]>([]);
  const [draft, setDraft] = useState({ employee: '', amount: '', note: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([loadLstCollection(), loadLstPaidElsewhere(fy.start)]);
      setCollection(c);
      setPaid(p);
    } catch (err) {
      setCollection('instalments');
      toast.error(runErrorMessage(err, 'Could not load the LST settings.'));
    }
  }, [fy.start]);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (next: LstCollection) => {
    if (busy || next === collection) return;
    const before = collection;
    setCollection(next);
    setBusy(true);
    try {
      await saveLstCollection(next);
      toast.success(next === 'lump_sum' ? 'LST will be taken at once.' : 'LST will be taken in four instalments.');
      onChanged();
    } catch (err) {
      setCollection(before);
      toast.error(runErrorMessage(err, 'Could not save the setting.'));
    } finally {
      setBusy(false);
    }
  };

  const savePaid = async () => {
    setBusy(true);
    try {
      await saveLstPaidElsewhere({ employee_number: draft.employee, fy_start: fy.start, paid_elsewhere: Number(draft.amount), note: draft.note });
      toast.success('Saved. Recalculate draft months it affects.');
      setDraft({ employee: '', amount: '', note: '' });
      await load();
      onChanged();
    } catch (err) {
      toast.error(runErrorMessage(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="sm">
      <div className="space-y-3 text-xs">
        <div>
          <p className="font-semibold text-ink">Uganda local service tax (LST)</p>
          <p className="text-[11px] text-muted-foreground">
            Taken from staff in Uganda in July to October, by their monthly gross pay band, and paid to the local government where they work.
          </p>
        </div>
        <fieldset className="flex flex-wrap gap-4" disabled={!canEdit || busy || collection === null}>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="lst-collection" checked={collection === 'instalments'} onChange={() => void choose('instalments')} />
            Four instalments, July to October (default)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="lst-collection" checked={collection === 'lump_sum'} onChange={() => void choose('lump_sum')} />
            All at once, in the first month
          </label>
        </fieldset>

        <div>
          <p className="font-semibold text-ink">Paid elsewhere in {fy.label}</p>
          <p className="text-[11px] text-muted-foreground">LST someone already paid this year with another employer or straight to the council; payroll takes only the rest.</p>
          {paid.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {paid.map((p) => (
                <li key={p.employee_number}>
                  {p.employee_number}: USh {Math.round(p.paid_elsewhere).toLocaleString()}
                  {p.note ? <span className="text-muted-foreground"> ({p.note})</span> : null}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label>
                Employee number
                <input value={draft.employee} onChange={(e) => setDraft({ ...draft, employee: e.target.value })} className="block mt-1 w-32 rounded-lg border border-border px-2 py-1 text-sm" />
              </label>
              <label>
                Paid (USh)
                <input type="number" min={0} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} className="block mt-1 w-28 rounded-lg border border-border px-2 py-1 text-sm" />
              </label>
              <label className="flex-1 min-w-[160px]">
                Note
                <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="e.g. paid with previous employer" className="block mt-1 w-full rounded-lg border border-border px-2 py-1 text-sm" />
              </label>
              <button type="button" disabled={busy || !draft.employee.trim() || draft.amount === ''} onClick={() => void savePaid()}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                Save
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
