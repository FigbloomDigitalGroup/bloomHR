import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Sprout } from 'lucide-react';
import { Button, Card, EmptyState, Modal, StatusPill, TableScroll } from '../UI';
import { formatKsh, longDate, today } from '../../lib/casualPay';
import { saveWorkType, setWorkRate } from '../../lib/pieceRateApi';
import { UNIT_SUGGESTIONS, rateOn, rateStarts, type WorkRate, type WorkType } from '../../lib/pieceRate';

// The company's kinds of work and what one unit pays: "Tea picked, KSh 12 per kg". A rate changes from a date (work
// already recorded keeps the rate it was recorded at); a kind of work can be limited to dates (a season) or paused.

interface Props {
  types: WorkType[];
  rates: WorkRate[];
  onChanged: () => void;
}

interface Form {
  id?: string;
  name: string;
  unit: string;
  rate: string;
  active: boolean;
  effective_from: string;
  effective_to: string;
}

export default function WorkTypes({ types, rates, onChanged }: Props) {
  const [form, setForm] = useState<Form | null>(null);
  const [rateFor, setRateFor] = useState<WorkType | null>(null);
  const [newRate, setNewRate] = useState({ rate: '', from: today() });
  const [busy, setBusy] = useState(false);
  const now = today();

  const history = (t: WorkType) => rates.filter((r) => r.work_type_id === t.id);

  const save = async () => {
    if (!form) return;
    const rate = Number(form.rate.replace(/,/g, ''));
    if (!form.name.trim() || !form.unit.trim() || !(rate > 0)) {
      toast.error('Add a name, a unit and a rate of more than 0');
      return;
    }
    setBusy(true);
    try {
      await saveWorkType({
        name: form.name.trim(),
        unit: form.unit.trim(),
        rate,
        active: form.active,
        effective_from: form.effective_from || null,
        effective_to: form.effective_to || null,
      }, form.id);
      toast.success(form.id ? 'Saved' : `${form.name.trim()} added`);
      setForm(null);
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveRate = async () => {
    if (!rateFor) return;
    const rate = Number(newRate.rate.replace(/,/g, ''));
    if (!(rate > 0) || !newRate.from) {
      toast.error('Add a rate of more than 0 and the day it starts');
      return;
    }
    setBusy(true);
    try {
      await setWorkRate(rateFor.id, rate, newRate.from);
      toast.success(`${rateFor.name}: ${formatKsh(rate)} per ${rateFor.unit} from ${longDate(newRate.from)}`);
      setRateFor(null);
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="none">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border">
        <span className="text-[13px] font-semibold text-ink">Kinds of work and rates</span>
        <div className="ml-auto">
          <Button icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setForm({ name: '', unit: 'kg', rate: '', active: true, effective_from: '', effective_to: '' })}>
            Add a kind of work
          </Button>
        </div>
      </div>
      {types.length === 0 ? (
        <EmptyState icon={<Sprout className="w-5 h-5" />} title="No kinds of work yet"
          description="Add what people are paid for (tea picked per kg, crates packed, rows weeded) and what one unit pays." />
      ) : (
        <TableScroll>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                <th className="px-3 py-2 font-semibold">Kind of work</th>
                <th className="px-3 py-2 font-semibold">Unit</th>
                <th className="px-3 py-2 font-semibold text-right">Rate today</th>
                <th className="px-3 py-2 font-semibold">Rate history</th>
                <th className="px-3 py-2 font-semibold">Dates</th>
                <th className="px-3 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2">
                    <span className="font-semibold text-ink">{t.name}</span>{' '}
                    {!t.active && <StatusPill label="Paused" tone="warning" />}
                  </td>
                  <td className="px-3 py-2">{t.unit}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatKsh(rateOn(rates, t, now))}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {history(t).map((r) => (
                      <div key={r.id}>{formatKsh(r.rate)} {rateStarts(r.effective_from) ? `from ${longDate(r.effective_from)}` : 'from the start'}</div>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {t.effective_from || t.effective_to
                      ? `${t.effective_from ? longDate(t.effective_from) : 'Any time'} to ${t.effective_to ? longDate(t.effective_to) : 'no end'}`
                      : 'Any day'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button type="button" className="text-brand font-semibold mr-3" aria-label={`Change the rate of ${t.name}`}
                      onClick={() => { setRateFor(t); setNewRate({ rate: String(Number(t.rate)), from: now }); }}>
                      Change rate
                    </button>
                    <button type="button" className="text-brand font-semibold" aria-label={`Edit ${t.name}`}
                      onClick={() => setForm({ id: t.id, name: t.name, unit: t.unit, rate: String(Number(t.rate)), active: t.active, effective_from: t.effective_from ?? '', effective_to: t.effective_to ?? '' })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {form && (
        <Modal open onClose={() => setForm(null)} title={form.id ? `Edit ${form.name}` : 'Add a kind of work'} size="md" closeOnBackdrop={!busy}>
          <div className="space-y-3 text-xs text-ink">
            <label className="block">
              <span className="font-semibold">Name</span>
              <input aria-label="Name" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" placeholder="Tea picked" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="font-semibold">Unit</span>
                <input aria-label="Unit" list="work-units" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })} />
                <datalist id="work-units">{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
              </label>
              <label className="block">
                <span className="font-semibold">Rate per unit (KSh)</span>
                <input aria-label="Rate" inputMode="decimal" disabled={!!form.id} className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 disabled:bg-secondary" value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })} />
                {form.id && <span className="block mt-1 text-muted-foreground">Use Change rate to set a new rate from a date.</span>}
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="font-semibold">Recorded from (optional)</span>
                <input aria-label="Recorded from" type="date" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={form.effective_from}
                  onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
              </label>
              <label className="block">
                <span className="font-semibold">Until (optional)</span>
                <input aria-label="Until" type="date" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={form.effective_to}
                  onChange={(e) => setForm({ ...form, effective_to: e.target.value })} />
              </label>
            </div>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              In use (untick to pause it; work already recorded stays)
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setForm(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void save()} disabled={busy}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      {rateFor && (
        <Modal open onClose={() => setRateFor(null)} title={`Change the rate of ${rateFor.name}`} size="sm" closeOnBackdrop={!busy}>
          <div className="space-y-3 text-xs text-ink">
            <label className="block">
              <span className="font-semibold">New rate per {rateFor.unit} (KSh)</span>
              <input aria-label="New rate" inputMode="decimal" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={newRate.rate}
                onChange={(e) => setNewRate({ ...newRate, rate: e.target.value })} />
            </label>
            <label className="block">
              <span className="font-semibold">From</span>
              <input aria-label="From" type="date" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={newRate.from}
                onChange={(e) => setNewRate({ ...newRate, from: e.target.value })} />
            </label>
            <p className="m-0 text-muted-foreground">New work from that day takes this rate. Work already recorded keeps the rate it was recorded at.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRateFor(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void saveRate()} disabled={busy}>Save rate</Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
