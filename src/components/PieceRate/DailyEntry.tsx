import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Lock, Send, Save, Sprout } from 'lucide-react';
import { Button, Card, EmptyState, SearchInput, StatusPill } from '../UI';
import { addDays, formatKsh, longDate, today } from '../../lib/casualPay';
import { loadEntries, reopenEntries, saveDayCells, submitEntries, type CellChange } from '../../lib/pieceRateApi';
import {
  KIND_LABEL, STATUS_LABEL, entryAmount, parseQuantity, personName, rateOn, round2, typeOpenOn,
  type WorkEntry, type WorkPerson, type WorkRate, type WorkStatus, type WorkType,
} from '../../lib/pieceRate';
import { LoaderBlock } from '../UI/FigbloomLoader';

// A day's work, phone first: pick the day, then for each worker type how much of each kind of work they did. Amounts
// show as you type. Save as a draft (only you, payroll and the supervisor see it) or submit it; it can be changed
// until it is approved. Approved work is locked: payroll reopens it if it needs correcting.

interface Props {
  people: WorkPerson[];
  types: WorkType[];
  rates: WorkRate[];
  /** payroll: records for everyone, reopens approved work */
  canManage: boolean;
  onChanged?: () => void;
}

const TONE: Record<WorkStatus, 'neutral' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral', submitted: 'warning', approved: 'success', rejected: 'danger',
};
const key = (emp: string, type: string) => `${emp}|${type}`;
const shown = (q: number | string) => String(Number(q));

export default function DailyEntry({ people, types, rates, canManage, onChanged }: Props) {
  const [day, setDay] = useState(today);
  const [entries, setEntries] = useState<WorkEntry[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const now = today();

  const workers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => p.pay_basis === 'work')
      .filter((p) => !q || [personName(p), p.employee_number, p.department].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [people, query]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await loadEntries(day, day));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // a cell's entries (normally one; rejected ones only when nothing else is there)
  const cells = useMemo(() => {
    const m = new Map<string, WorkEntry[]>();
    for (const e of entries) {
      const k = key(e.employee_number, e.work_type_id);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    for (const [k, list] of m) {
      const live = list.filter((e) => e.status !== 'rejected');
      m.set(k, live.length ? live : list.slice(-1));
    }
    return m;
  }, [entries]);

  // what the cells start with: the recorded quantities
  const original = useMemo(() => {
    const o: Record<string, string> = {};
    for (const [k, list] of cells) if (list.length === 1) o[k] = shown(list[0].quantity);
    return o;
  }, [cells]);

  useEffect(() => {
    setValues(original);
  }, [original]);

  const dayTypes = useMemo(
    () => types.filter((t) => typeOpenOn(t, day) || entries.some((e) => e.work_type_id === t.id)),
    [types, day, entries]
  );

  const locked = (list: WorkEntry[] | undefined) => !!list && (list.length > 1 || list.some((e) => e.status === 'approved' || e.paid_out_at));
  const rateFor = (t: WorkType, list: WorkEntry[] | undefined) => (list?.length === 1 ? Number(list[0].rate) : rateOn(rates, t, day));

  const dirty = Object.keys({ ...original, ...values }).filter((k) => (values[k] ?? '').trim() !== (original[k] ?? ''));
  const invalid = dirty.filter((k) => (values[k] ?? '').trim() !== '' && parseQuantity(values[k]) === null);

  const workerTotal = (p: WorkPerson) =>
    round2(dayTypes.reduce((sum, t) => {
      const k = key(p.employee_number, t.id);
      const list = cells.get(k);
      if (locked(list)) return sum + (list ?? []).filter((e) => e.status !== 'rejected').reduce((s, e) => s + Number(e.amount), 0);
      return sum + entryAmount(parseQuantity(values[k]), rateFor(t, list));
    }, 0));
  const dayTotal = round2(workers.reduce((s, p) => s + workerTotal(p), 0));

  const save = async (): Promise<boolean> => {
    if (invalid.length) {
      toast.error('Quantities must be numbers more than 0; clear a box to remove it');
      return false;
    }
    const changes: CellChange[] = dirty.map((k) => {
      const [emp, type] = k.split('|');
      const list = cells.get(k);
      return { employee_number: emp, work_type_id: type, quantity: parseQuantity(values[k]), existing: list?.length === 1 ? list[0] : undefined };
    });
    if (changes.length) await saveDayCells(day, changes);
    return true;
  };

  const saveDraft = async () => {
    setBusy(true);
    try {
      if (!dirty.length) {
        toast.success('Nothing changed');
        return;
      }
      if (await save()) {
        toast.success('Saved as a draft');
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
      const fresh = await loadEntries(day, day);
      const mine = new Set(workers.map((w) => w.employee_number));
      const ids = fresh.filter((e) => mine.has(e.employee_number) && (e.status === 'draft' || e.status === 'rejected')).map((e) => e.id);
      if (!ids.length) {
        toast.success(dirty.length ? 'Saved' : 'Nothing to submit');
      } else {
        const out = await submitEntries(ids);
        if (out.problem) toast.error(out.problem);
        if (out.approved) toast.success(`${out.approved} ${out.approved === 1 ? 'entry' : 'entries'} recorded and approved`);
        if (out.submitted) toast.success(`${out.submitted} ${out.submitted === 1 ? 'entry' : 'entries'} sent for approval`);
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

  const reopen = async (ids: string[]) => {
    setBusy(true);
    try {
      const out = await reopenEntries(ids);
      if (out.problem) toast.error(out.problem);
      else toast.success('Reopened: it can be corrected and approved again');
      await reload();
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Previous day" className="rounded-md border border-border p-1.5" onClick={() => setDay(addDays(day, -1))}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="date"
            aria-label="Day"
            className="rounded-lg border border-border px-2 py-1.5 text-[13px]"
            value={day}
            max={now}
            onChange={(e) => e.target.value && setDay(e.target.value)}
          />
          <button type="button" aria-label="Next day" className="rounded-md border border-border p-1.5 disabled:opacity-40" disabled={day >= now} onClick={() => setDay(addDays(day, 1))}>
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-[12px] text-muted-foreground">{longDate(day)}</span>
          {people.filter((p) => p.pay_basis === 'work').length > 8 && (
            <div className="w-full sm:w-auto sm:ml-auto">
              <SearchInput placeholder="Find a worker" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
        </div>
      </Card>

      {dayTypes.length === 0 ? (
        <Card>
          <EmptyState icon={<Sprout className="w-5 h-5" />} title="No kinds of work yet"
            description={canManage ? 'Add the kinds of work and their rates under Work types first.' : 'Payroll sets up the kinds of work and their rates.'} />
        </Card>
      ) : workers.length === 0 ? (
        <Card>
          {loading ? <LoaderBlock label="Loading" compact /> : <EmptyState icon={<Sprout className="w-5 h-5" />} title="No workers paid by work"
            description={canManage
              ? 'Set people to be paid by work under Workers. Casual workers paid a daily rate are on the Casual workers page.'
              : 'People on your team who are paid for their work show here.'} />}
        </Card>
      ) : (
        <ul className="list-none m-0 p-0 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {workers.map((p) => {
            const statuses = [...new Set(entries.filter((e) => e.employee_number === p.employee_number).map((e) => e.status))];
            const rejected = entries.filter((e) => e.employee_number === p.employee_number && e.status === 'rejected' && e.rejection_reason);
            const approvedIds = entries.filter((e) => e.employee_number === p.employee_number && e.status === 'approved' && !e.paid_out_at).map((e) => e.id);
            return (
              <li key={p.employee_number}>
                <Card padding="sm">
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    <span className="text-[13px] font-bold text-ink">{personName(p)}</span>
                    <span className="text-[11px] text-subtle">{p.employee_number}</span>
                    {p.worker_kind === 'contractor' && <StatusPill label={KIND_LABEL.contractor} tone="info" />}
                    {statuses.map((s) => <StatusPill key={s} label={STATUS_LABEL[s]} tone={TONE[s]} />)}
                    <span className="ml-auto text-[12.5px] font-semibold text-ink" aria-label={`${personName(p)} total`}>{formatKsh(workerTotal(p))}</span>
                  </div>
                  {rejected.map((e) => (
                    <p key={e.id} className="m-0 mb-1.5 text-[11.5px] text-status-danger">Rejected: {e.rejection_reason}</p>
                  ))}
                  <div className="space-y-1.5">
                    {dayTypes.map((t) => {
                      const k = key(p.employee_number, t.id);
                      const list = cells.get(k);
                      const isLocked = locked(list);
                      const rate = rateFor(t, list);
                      const q = isLocked ? (list ?? []).reduce((s, e) => s + (e.status === 'rejected' ? 0 : Number(e.quantity)), 0) : parseQuantity(values[k]);
                      const bad = !isLocked && (values[k] ?? '').trim() !== '' && q === null;
                      return (
                        <div key={t.id} className="flex items-center gap-2">
                          <label htmlFor={`q-${k}`} className="flex-1 min-w-0 text-[12px] text-ink">
                            <span className="font-semibold">{t.name}</span>
                            <span className="text-muted-foreground"> · {formatKsh(rate)}/{t.unit}</span>
                          </label>
                          {isLocked ? (
                            <span className="inline-flex items-center gap-1 w-24 justify-end text-[12.5px] text-ink" title={list && list.length > 1 ? 'Several entries: change them in the list' : 'Approved'}>
                              <Lock className="w-3 h-3 text-muted-foreground" />
                              {String(q)} {t.unit}
                            </span>
                          ) : (
                            <input
                              id={`q-${k}`}
                              inputMode="decimal"
                              aria-label={`${personName(p)} ${t.name}`}
                              aria-invalid={bad || undefined}
                              placeholder={t.unit}
                              className={`w-24 rounded-lg border px-2 py-1.5 text-right text-[13px] ${bad ? 'border-status-danger' : 'border-border'}`}
                              value={values[k] ?? ''}
                              onChange={(e) => {
                                const typed = e.target.value;
                                setValues((v) => ({ ...v, [k]: typed }));
                              }}
                            />
                          )}
                          <span className="w-20 text-right text-[12px] text-muted-foreground">{formatKsh(entryAmount(q, rate))}</span>
                        </div>
                      );
                    })}
                  </div>
                  {canManage && approvedIds.length > 0 && (
                    <div className="mt-2 text-right">
                      <button type="button" className="text-[11.5px] font-semibold text-brand" disabled={busy} onClick={() => void reopen(approvedIds)}>
                        Reopen approved work
                      </button>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {workers.length > 0 && dayTypes.length > 0 && (
        <div className="sticky bottom-0 z-10 rounded-tile border border-border bg-white p-3 flex flex-wrap items-center gap-2 shadow-sm">
          <span className="text-[12.5px] text-ink">
            Day total <strong>{formatKsh(dayTotal)}</strong>
            {dirty.length > 0 && <span className="text-muted-foreground"> · {dirty.length} unsaved</span>}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" icon={<Save className="w-3.5 h-3.5" />} disabled={busy || !dirty.length} onClick={() => void saveDraft()}>
              Save draft
            </Button>
            <Button icon={<Send className="w-3.5 h-3.5" />} disabled={busy} onClick={() => void submit()}>
              Submit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
