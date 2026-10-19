import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Lock, Save, Send, Sprout } from 'lucide-react';
import { Button, Card, EmptyState, StatusPill } from '../../UI';
import { addDays, formatKsh, longDate } from '../../../lib/casualPay';
import { saveDayCells, submitEntries, type CellChange } from '../../../lib/pieceRateApi';
import { loadMyEntries } from '../../../lib/myWorkApi';
import { entryAmount, parseQuantity, rateOn, round2, typeOpenOn, type WorkRate, type WorkType } from '../../../lib/pieceRate';
import {
  MY_STATE_LABEL, MY_STATE_TONE, canEditEntry, dayProblem, dayWindow, entryState, type MyEntry,
} from '../../../lib/myWork';
import { LoaderBlock } from '../../UI/FigbloomLoader';

// Record my work, phone first: pick the day (today by default; back to the company's limit, never a future day), type
// how much of each kind of work I did and see what it pays as I type, at the rate for that day. Save it as a draft or
// submit it: it counts once my supervisor approves it (submit_work_entries tells them). Drafts and rejected work can
// be corrected and sent again; waiting and approved work is shown but can't be changed here.

interface Props {
  employeeNumber: string;
  types: WorkType[];
  rates: WorkRate[];
  today: string;
  pastDays: number;
  closedMonths: string[];
  initialDay?: string;
  onChanged?: () => void;
}

const shown = (q: number | string) => String(Number(q));

export default function RecordMyWork({ employeeNumber, types, rates, today, pastDays, closedMonths, initialDay, onChanged }: Props) {
  const { min, max } = dayWindow(today, pastDays);
  const [day, setDay] = useState(initialDay && initialDay >= min && initialDay <= max ? initialDay : today);
  const [entries, setEntries] = useState<MyEntry[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const problem = dayProblem(day, today, pastDays, closedMonths);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await loadMyEntries(employeeNumber, day, day));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [employeeNumber, day]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // per kind of work: the one entry I can still change (draft or rejected), and what is already sent or recorded for me
  const perType = useMemo(() => {
    const m = new Map<string, { editable?: MyEntry; fixed: MyEntry[] }>();
    for (const e of entries) {
      const slot = m.get(e.work_type_id) ?? { fixed: [] };
      if (!slot.editable && canEditEntry(e, closedMonths)) slot.editable = e;
      else if (e.status !== 'rejected') slot.fixed.push(e);
      m.set(e.work_type_id, slot);
    }
    return m;
  }, [entries, closedMonths]);

  const original = useMemo(() => {
    const o: Record<string, string> = {};
    for (const [type, slot] of perType) if (slot.editable) o[type] = shown(slot.editable.quantity);
    return o;
  }, [perType]);

  useEffect(() => {
    setValues(original);
  }, [original]);

  const dayTypes = useMemo(
    () => types.filter((t) => typeOpenOn(t, day) || entries.some((e) => e.work_type_id === t.id)),
    [types, day, entries]
  );

  const rateFor = (t: WorkType) => {
    const editable = perType.get(t.id)?.editable;
    return editable ? Number(editable.rate) : rateOn(rates, t, day);
  };
  const dirty = Object.keys({ ...original, ...values }).filter((k) => (values[k] ?? '').trim() !== (original[k] ?? ''));
  const invalid = dirty.filter((k) => (values[k] ?? '').trim() !== '' && parseQuantity(values[k]) === null);
  const sendable = entries.filter((e) => canEditEntry(e, closedMonths));
  const total = round2(dayTypes.reduce((s, t) => {
    const slot = perType.get(t.id);
    const fixed = (slot?.fixed ?? []).reduce((x, e) => x + Number(e.amount), 0);
    return s + fixed + entryAmount(parseQuantity(values[t.id]), rateFor(t));
  }, 0));

  const save = async (): Promise<boolean> => {
    if (invalid.length) {
      toast.error('Quantities must be numbers more than 0; clear a box to remove it');
      return false;
    }
    const changes: CellChange[] = dirty.map((type) => ({
      employee_number: employeeNumber, work_type_id: type, quantity: parseQuantity(values[type]), existing: perType.get(type)?.editable,
    }));
    if (changes.length) await saveDayCells(day, changes);
    return true;
  };

  const saveDraft = async () => {
    setBusy(true);
    try {
      if (await save()) {
        toast.success('Saved as a draft. Submit it when you are ready.');
        await reload();
        onChanged?.();
      }
    } catch (err) {
      toast.error((err as Error).message);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (!(await save())) return;
      const fresh = await loadMyEntries(employeeNumber, day, day);
      const ids = fresh.filter((e) => canEditEntry(e, closedMonths)).map((e) => e.id);
      if (!ids.length) {
        toast.success('Nothing to submit');
      } else {
        const out = await submitEntries(ids);
        if (out.problem) toast.error(out.problem);
        if (out.submitted) toast.success(`Sent to your supervisor for approval (${out.submitted} ${out.submitted === 1 ? 'entry' : 'entries'})`);
      }
      await reload();
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Previous day" className="rounded-md border border-border p-2 disabled:opacity-40"
            disabled={day <= min} onClick={() => setDay(addDays(day, -1))}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input type="date" aria-label="Day" className="rounded-lg border border-border px-2 py-2 text-[14px]"
            value={day} min={min} max={max} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <button type="button" aria-label="Next day" className="rounded-md border border-border p-2 disabled:opacity-40"
            disabled={day >= max} onClick={() => setDay(addDays(day, 1))}>
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-[12px] text-muted-foreground">{day === today ? 'Today' : longDate(day)}</span>
        </div>
        <p className="m-0 mt-1.5 text-[11.5px] text-muted-foreground">
          {pastDays === 0 ? 'You can record today’s work.' : `You can record work from the last ${pastDays} days.`} Older work is recorded by your supervisor.
        </p>
        {problem && <p role="alert" className="m-0 mt-1.5 text-[12px] text-status-danger">{problem}</p>}
      </Card>

      {dayTypes.length === 0 ? (
        <Card>
          {loading ? <LoaderBlock label="Loading" compact /> : <EmptyState icon={<Sprout className="w-5 h-5" />} title="No kinds of work yet"
            description="Payroll sets up the kinds of work and their rates." />}
        </Card>
      ) : (
        <Card padding="sm">
          <ul className="list-none m-0 p-0 divide-y divide-border">
            {dayTypes.map((t) => {
              const slot = perType.get(t.id);
              const editable = slot?.editable;
              const rate = rateFor(t);
              const q = parseQuantity(values[t.id]);
              const bad = (values[t.id] ?? '').trim() !== '' && q === null;
              const canType = !problem && (typeOpenOn(t, day) || !!editable);
              return (
                <li key={t.id} className="py-2.5">
                  <div className="flex items-center gap-2">
                    <label htmlFor={`my-${t.id}`} className="flex-1 min-w-0 text-[13px] text-ink">
                      <span className="font-semibold">{t.name}</span>
                      <span className="block text-[11.5px] text-muted-foreground">{formatKsh(rate)} per {t.unit}</span>
                    </label>
                    {canType ? (
                      <input id={`my-${t.id}`} inputMode="decimal" aria-label={t.name} aria-invalid={bad || undefined} placeholder={t.unit}
                        className={`w-24 rounded-lg border px-2 py-2 text-right text-[15px] ${bad ? 'border-status-danger' : 'border-border'}`}
                        value={values[t.id] ?? ''}
                        onChange={(e) => {
                          const typed = e.target.value;
                          setValues((v) => ({ ...v, [t.id]: typed }));
                        }} />
                    ) : (
                      <span className="w-24" />
                    )}
                    <span className="w-24 text-right text-[13px] font-semibold text-ink" aria-label={`${t.name} amount`}>{formatKsh(entryAmount(q, rate))}</span>
                  </div>
                  {editable?.status === 'rejected' && editable.rejection_reason && (
                    <p className="m-0 mt-1 text-[11.5px] text-status-danger">Not approved: {editable.rejection_reason}. Correct it and submit again.</p>
                  )}
                  {editable?.status === 'draft' && <p className="m-0 mt-1 text-[11px] text-muted-foreground">Draft: not sent yet</p>}
                  {(slot?.fixed ?? []).map((e) => {
                    const state = entryState(e);
                    return (
                      <div key={e.id} className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        <Lock className="w-3 h-3" />
                        <span>{shown(e.quantity)} {t.unit} · {formatKsh(e.amount)}</span>
                        {e.source !== 'self' && <span>· recorded for you</span>}
                        <StatusPill label={MY_STATE_LABEL[state]} tone={MY_STATE_TONE[state]} />
                      </div>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {dayTypes.length > 0 && (
        <div className="sticky bottom-0 z-10 rounded-tile border border-border bg-white p-3 flex flex-wrap items-center gap-2 shadow-sm">
          <span className="text-[13px] text-ink">
            Day total <strong aria-label="Day total">{formatKsh(total)}</strong>
            {dirty.length > 0 && <span className="text-muted-foreground"> · {dirty.length} unsaved</span>}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" icon={<Save className="w-3.5 h-3.5" />} disabled={busy || !!problem || !dirty.length} onClick={() => void saveDraft()}>
              Save draft
            </Button>
            <Button icon={<Send className="w-3.5 h-3.5" />} disabled={busy || !!problem || (!dirty.length && !sendable.length)} onClick={() => void submit()}>
              Submit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
