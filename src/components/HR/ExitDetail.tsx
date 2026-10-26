import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Download, FileText, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, StatusPill, type StatusTone } from '../UI';
import { formatDay, parseDay } from '../../lib/contract';
import { openPrivateFile } from '../../lib/privateFiles';
import { downloadStatementCsv, downloadStatementPdf, duesTotals, money, periodOf, type FinalDuesLine } from '../../lib/finalDues';
import {
  DEFAULT_INTERVIEW_QUESTIONS,
  STAGES,
  STATUS_LABEL,
  addClearanceItem,
  cancelExit,
  completeExit,
  decideExit,
  loadClearance,
  loadExit,
  loadFinalDues,
  loadInterview,
  reasonLabel,
  saveClearanceItem,
  saveFinalDues,
  saveInterview,
  workOutFinalDues,
  type ClearanceItem,
  type ExitInterview,
  type ExitRecord,
  type ExitStatus,
  type FinalDuesRecord,
} from '../../lib/exits';
import { LoaderBlock } from '../UI/FigbloomLoader';
import ExitLetters from './ExitLetters';

export const STATUS_TONE: Record<ExitStatus, StatusTone> = {
  requested: 'warning',
  approved: 'info',
  clearance: 'purple',
  completed: 'success',
  declined: 'danger',
  cancelled: 'neutral',
};

const input = 'w-full border border-border rounded-xl px-3 py-2 text-[12.5px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/40';
const day = (d: string | null | undefined) => formatDay(parseDay(d)) || '—';
const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

function Stepper({ status }: { status: ExitStatus }) {
  if (status === 'declined' || status === 'cancelled') return <StatusPill label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />;
  const at = STAGES.findIndex((s) => s.id === status);
  return (
    <ol className="m-0 p-0 list-none flex flex-wrap items-center gap-1.5" aria-label="Stage">
      {STAGES.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1.5">
          <span
            aria-current={i === at ? 'step' : undefined}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              i < at ? 'bg-green-tint text-status-success' : i === at ? 'bg-brand text-white' : 'bg-secondary text-muted-foreground'
            }`}
          >
            {i < at && <Check className="w-3 h-3" />}
            {s.label}
          </span>
          {i < STAGES.length - 1 && <span className="w-3 h-px bg-border" />}
        </li>
      ))}
    </ol>
  );
}

function Checklist({ exit, items, onChanged }: { exit: ExitRecord; items: ClearanceItem[]; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const editable = exit.status === 'approved' || exit.status === 'clearance';
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  const save = async (id: string, changes: Partial<ClearanceItem>) => {
    try {
      await saveClearanceItem(id, changes);
      onChanged();
    } catch (err) {
      toast.error(message(err, 'Could not save'));
    }
  };
  const add = async () => {
    if (!title.trim()) return;
    try {
      await addClearanceItem(exit.id, title, owner, items.length + 1);
      setTitle('');
      setOwner('');
      onChanged();
    } catch (err) {
      toast.error(message(err, 'Could not add the item'));
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[13px] font-bold text-ink">Clearance</div>
        <div className="text-[11.5px] text-muted-foreground">
          {done} of {items.length} done
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden mb-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Clearance progress">
        <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      {items.length === 0 ? (
        <p className="m-0 text-[12px] text-muted-foreground">The checklist is added when the exit is approved.</p>
      ) : (
        <ul className="m-0 p-0 list-none divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="py-2.5 flex flex-col sm:flex-row sm:items-start gap-2">
              <label className="flex items-start gap-2 flex-1 min-w-0 text-[12.5px] text-ink">
                <input type="checkbox" className="mt-0.5" checked={item.done} disabled={!editable} onChange={(e) => save(item.id, { done: e.target.checked })} />
                <span className={item.done ? 'line-through text-muted-foreground' : ''}>
                  {item.title}
                  {item.owner && <span className="ml-1.5 text-[10.5px] font-semibold text-subtle no-underline">· {item.owner}</span>}
                </span>
              </label>
              <input
                aria-label={`Notes: ${item.title}`}
                className={`${input} sm:max-w-[240px]`}
                placeholder="Notes"
                defaultValue={item.notes ?? ''}
                disabled={!editable}
                onBlur={(e) => e.target.value !== (item.notes ?? '') && save(item.id, { notes: e.target.value || null })}
              />
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <input aria-label="New item" className={input} placeholder="Add an item" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input aria-label="Owner" className={`${input} sm:max-w-[160px]`} placeholder="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <Button variant="secondary" onClick={add} icon={<Plus className="w-3.5 h-3.5" />}>
            Add
          </Button>
        </div>
      )}
    </Card>
  );
}

function Interview({ exit, interview, onSaved }: { exit: ExitRecord; interview: ExitInterview | null; onSaved: () => void }) {
  const [form, setForm] = useState<ExitInterview>(
    () =>
      interview ?? {
        interview_date: null,
        interviewer: null,
        is_completed: false,
        answers: DEFAULT_INTERVIEW_QUESTIONS.map((question) => ({ question, answer: '' })),
      }
  );
  const [busy, setBusy] = useState(false);
  const locked = exit.status === 'completed' && !!interview?.is_completed;

  const setAnswer = (i: number, answer: string) => setForm((f) => ({ ...f, answers: f.answers.map((a, j) => (j === i ? { ...a, answer } : a)) }));
  const save = async (completed: boolean) => {
    setBusy(true);
    try {
      await saveInterview(exit, { ...form, is_completed: completed });
      toast.success('Exit interview saved');
      onSaved();
    } catch (err) {
      toast.error(message(err, 'Could not save the interview'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-[13px] font-bold text-ink">Exit interview</div>
        {interview?.is_completed && <StatusPill label="Done" tone="success" />}
      </div>
      <p className="mt-0 mb-3 text-[11.5px] text-muted-foreground">Confidential to HR: the employee and their manager don’t see it.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label htmlFor="interview-date" className="block text-xs font-semibold text-ink mb-1">Date</label>
          <input id="interview-date" type="date" className={input} disabled={locked} value={(form.interview_date ?? '').slice(0, 10)} onChange={(e) => setForm({ ...form, interview_date: e.target.value || null })} />
        </div>
        <div>
          <label htmlFor="interview-by" className="block text-xs font-semibold text-ink mb-1">Interviewer</label>
          <input id="interview-by" className={input} disabled={locked} value={form.interviewer ?? ''} onChange={(e) => setForm({ ...form, interviewer: e.target.value })} />
        </div>
      </div>
      <div className="space-y-3">
        {form.answers.map((a, i) => (
          <div key={a.question}>
            <label htmlFor={`answer-${i}`} className="block text-xs font-semibold text-ink mb-1">{a.question}</label>
            <textarea id={`answer-${i}`} rows={2} className={`${input} resize-none`} disabled={locked} value={a.answer} onChange={(e) => setAnswer(i, e.target.value)} />
          </div>
        ))}
      </div>
      {!locked && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => save(false)}>Save</Button>
          <Button disabled={busy} onClick={() => save(true)}>Save as done</Button>
        </div>
      )}
    </Card>
  );
}

function FinalDues({ exit, dues, onSaved }: { exit: ExitRecord; dues: FinalDuesRecord | null; onSaved: () => void }) {
  const [lines, setLines] = useState<FinalDuesLine[]>(dues?.lines ?? []);
  const [notes, setNotes] = useState<string[]>([]);
  const [period, setPeriod] = useState(dues?.payroll_period ?? periodOf(exit.last_working_day));
  const [busy, setBusy] = useState(false);
  const status = dues?.status ?? 'draft';
  const included = status === 'included';
  const editable = !included && exit.status !== 'completed' && exit.status !== 'declined' && exit.status !== 'cancelled';
  const totals = duesTotals(lines);
  const heading = {
    employeeName: exit.employee_name ?? exit.employee_number,
    employeeNumber: exit.employee_number,
    lastWorkingDay: day(exit.last_working_day),
    kind: reasonLabel(exit),
    payrollPeriod: dues?.payroll_period,
  };

  const workOut = async () => {
    setBusy(true);
    try {
      const result = await workOutFinalDues(exit);
      setLines(result.lines);
      setNotes(result.notes);
    } catch (err) {
      toast.error(message(err, 'Could not work out the final dues'));
    } finally {
      setBusy(false);
    }
  };
  const save = async (next: FinalDuesRecord['status'], payrollPeriod: string | null = null) => {
    setBusy(true);
    try {
      await saveFinalDues(exit, { id: dues?.id, lines, status: next, payroll_period: payrollPeriod });
      toast.success(next === 'included' ? `Marked as included in payroll ${payrollPeriod}` : 'Final dues saved');
      onSaved();
    } catch (err) {
      toast.error(message(err, 'Could not save the final dues'));
    } finally {
      setBusy(false);
    }
  };
  const setLine = (i: number, changes: Partial<FinalDuesLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...changes } : l)));

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="text-[13px] font-bold text-ink">Final dues</div>
        {dues && <StatusPill label={included ? `Included in payroll ${dues.payroll_period}` : status === 'reviewed' ? 'Reviewed' : 'Draft'} tone={included ? 'success' : status === 'reviewed' ? 'info' : 'neutral'} />}
      </div>
      <p className="mt-0 mb-3 text-[11.5px] text-muted-foreground">Before tax and statutory deductions, which the payroll run works out.</p>
      {lines.length === 0 ? (
        <Button variant="secondary" disabled={busy || !editable} onClick={workOut}>
          {busy ? 'Working out…' : 'Work out final dues'}
        </Button>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[480px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-2">Item</th>
                  <th className="py-1.5 pr-2 text-right">Earning</th>
                  <th className="py-1.5 pr-2 text-right">Deduction</th>
                  {editable && <th className="py-1.5 w-8"><span className="sr-only">Remove</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-2 align-top">
                      {editable && l.code === 'manual' ? (
                        <input aria-label="Item" className={input} value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} />
                      ) : (
                        <div className="text-ink font-semibold">{l.label}</div>
                      )}
                      {l.detail && <div className="text-[10.5px] text-subtle">{l.detail}</div>}
                    </td>
                    {(['earning', 'deduction'] as const).map((kind) => (
                      <td key={kind} className="py-1.5 pr-2 text-right align-top">
                        {l.kind === kind &&
                          (editable ? (
                            <input
                              aria-label={`${l.label} amount`}
                              type="number"
                              min={0}
                              step="0.01"
                              className={`${input} text-right max-w-[130px] ml-auto`}
                              value={l.amount}
                              onChange={(e) => setLine(i, { amount: Math.max(0, Number(e.target.value) || 0) })}
                            />
                          ) : (
                            money(l.amount)
                          ))}
                      </td>
                    ))}
                    {editable && (
                      <td className="py-1.5 align-top">
                        <button type="button" aria-label={`Remove ${l.label}`} className="p-1 text-subtle hover:text-status-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold text-ink border-t border-border">
                  <td className="py-2 pr-2">Total</td>
                  <td className="py-2 pr-2 text-right">{money(totals.earnings)}</td>
                  <td className="py-2 pr-2 text-right">{money(totals.deductions)}</td>
                  {editable && <td />}
                </tr>
                <tr className="font-bold text-ink">
                  <td className="py-1 pr-2">Net final dues</td>
                  <td className="py-1 pr-2 text-right" data-testid="dues-net">{money(totals.net)}</td>
                  <td colSpan={editable ? 2 : 1} />
                </tr>
              </tfoot>
            </table>
          </div>
          {notes.length > 0 && (
            <ul className="mt-2 mb-0 pl-4 text-[11.5px] text-orange-text-alt">
              {notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {editable && (
              <>
                <Button variant="ghost" onClick={() => setLines((ls) => [...ls, { code: 'manual', label: 'Other', kind: 'earning', amount: 0 }])} icon={<Plus className="w-3.5 h-3.5" />}>
                  Add earning
                </Button>
                <Button variant="ghost" onClick={() => setLines((ls) => [...ls, { code: 'manual', label: 'Other', kind: 'deduction', amount: 0 }])} icon={<Plus className="w-3.5 h-3.5" />}>
                  Add deduction
                </Button>
                <Button variant="ghost" disabled={busy} onClick={workOut}>Work out again</Button>
                <Button variant="secondary" disabled={busy} onClick={() => save('draft')}>Save draft</Button>
                <Button disabled={busy} onClick={() => save('reviewed')}>Mark reviewed</Button>
              </>
            )}
            <Button variant="secondary" onClick={() => downloadStatementPdf(heading, lines)} icon={<Download className="w-3.5 h-3.5" />}>PDF</Button>
            <Button variant="secondary" onClick={() => downloadStatementCsv(heading, lines)} icon={<Download className="w-3.5 h-3.5" />}>CSV</Button>
          </div>
          {status === 'reviewed' && !included && exit.status !== 'completed' && (
            <div className="mt-3 flex flex-col sm:flex-row sm:items-end gap-2">
              <div>
                <label htmlFor="dues-period" className="block text-xs font-semibold text-ink mb-1">Included in payroll month</label>
                <input id="dues-period" type="month" className={input} value={period} onChange={(e) => setPeriod(e.target.value)} />
              </div>
              <Button disabled={busy || !/^\d{4}-\d{2}$/.test(period)} onClick={() => save('included', period)}>Mark as included</Button>
            </div>
          )}
          {included && exit.status !== 'completed' && (
            <div className="mt-3">
              <Button variant="ghost" disabled={busy} onClick={() => save('reviewed')}>Take out of payroll {dues?.payroll_period}</Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** One exit, for HR: decide it, send their letter, clear them, interview them, settle their final dues, and complete it. */
export default function ExitDetail({ exitId, onBack, onChanged }: { exitId: string; onBack: () => void; onChanged?: () => void }) {
  const [exit, setExit] = useState<ExitRecord | null>(null);
  const [items, setItems] = useState<ClearanceItem[]>([]);
  const [interview, setInterview] = useState<ExitInterview | null | undefined>(undefined);
  const [dues, setDues] = useState<FinalDuesRecord | null | undefined>(undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [x, c, i, d] = await Promise.all([loadExit(exitId), loadClearance(exitId), loadInterview(exitId), loadFinalDues(exitId)]);
      setExit(x);
      setItems(c);
      setInterview(i);
      setDues(d);
      setError(null);
    } catch (err) {
      setError(message(err, 'Could not load this exit'));
    }
  }, [exitId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      setNote('');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(message(err, 'Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Card><p className="m-0 text-[12.5px] text-status-danger">{error}</p><Button variant="ghost" onClick={onBack}>Back</Button></Card>;
  if (!exit || interview === undefined || dues === undefined) return <LoaderBlock label="Loading the exit" />;

  const open = exit.status === 'requested' || exit.status === 'approved' || exit.status === 'clearance';
  const allClear = items.length > 0 && items.every((i) => i.done);
  const facts: [string, string][] = [
    ['Type', reasonLabel(exit)],
    ['Notice given', day(exit.notice_given_on)],
    ['Notice period', `${exit.notice_days} days`],
    ['Last working day', day(exit.last_working_day)],
    ['Notice pay', exit.kind === 'termination' ? (exit.notice_pay ? 'Yes, for notice not worked' : 'No') : '—'],
    ['Access', exit.access_ended_at ? `Ended ${day(exit.access_ended_at.slice(0, 10))}` : 'Until the last working day'],
  ];

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-ink">
        <ArrowLeft className="w-3.5 h-3.5" /> All exits
      </button>
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h2 className="m-0 text-[16px] font-bold text-ink">{exit.employee_name}</h2>
            <div className="text-[11.5px] text-muted-foreground">
              {exit.employee_number} · {exit.kind === 'resignation' ? 'Resignation' : 'Termination'}
            </div>
          </div>
          <Stepper status={exit.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="m-0 mt-0.5 text-[12.5px] text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        {exit.reason && <p className="mt-3 mb-0 text-[12.5px] text-ink whitespace-pre-wrap"><span className="font-semibold">Details: </span>{exit.reason}</p>}
        {exit.decision_note && <p className="mt-2 mb-0 text-[12.5px] text-ink whitespace-pre-wrap"><span className="font-semibold">Decision note: </span>{exit.decision_note}</p>}
        {exit.letter_path && (
          <Button
            variant="ghost"
            className="mt-2"
            icon={<FileText className="w-3.5 h-3.5" />}
            onClick={() => openPrivateFile('documents', exit.letter_path as string).catch((err) => toast.error(message(err, 'Could not open the letter')))}
          >
            Resignation letter
          </Button>
        )}

        {exit.status === 'requested' && (
          <div className="mt-4 border-t border-border pt-4">
            <label htmlFor="decision-note" className="block text-xs font-semibold text-ink mb-1">Note (needed to decline)</label>
            <textarea id="decision-note" rows={2} className={`${input} resize-none`} value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="mt-1 mb-2 text-[11px] text-subtle">HR or an administrator approves; not the person who started it, when someone else can.</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => act(() => decideExit(exit.id, 'approved', note), 'Exit approved')}>Approve</Button>
              <Button variant="secondary" disabled={busy || !note.trim()} onClick={() => act(() => decideExit(exit.id, 'declined', note), 'Exit declined')}>Decline</Button>
            </div>
          </div>
        )}
        {open && (
          <div className="mt-4 flex flex-wrap gap-2">
            {exit.status !== 'requested' && (
              <Button disabled={busy || !allClear} onClick={() => act(() => completeExit(exit.id), 'Exit completed: their access has ended')} title={allClear ? undefined : 'Finish the clearance checklist first'}>
                Complete exit
              </Button>
            )}
            {!exit.access_ended_at && (
              <Button variant="ghost" disabled={busy} onClick={() => act(() => cancelExit(exit.id), 'Exit cancelled')}>Cancel exit</Button>
            )}
          </div>
        )}
        {open && exit.status !== 'requested' && !allClear && (
          <p className="mt-2 mb-0 text-[11px] text-subtle">Finish the clearance checklist to complete the exit. Their access ends on the day after their last working day either way.</p>
        )}
      </Card>

      {exit.status !== 'requested' && exit.status !== 'declined' && exit.status !== 'cancelled' && (
        <>
          <ExitLetters exit={exit} />
          <Checklist exit={exit} items={items} onChanged={load} />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <Interview exit={exit} interview={interview} onSaved={load} />
            <FinalDues key={dues?.id ?? 'new'} exit={exit} dues={dues} onSaved={load} />
          </div>
        </>
      )}
    </div>
  );
}
