import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { saveAs } from 'file-saver';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Plus, RefreshCw, Wallet } from 'lucide-react';
import { Button, Card, EmptyState, Modal, StatusPill, TableScroll, type StatusTone } from '../UI';
import { confirmDialog } from '../../lib/confirmDialog';
import {
  approveRun, createRun, deleteRun, loadRunLines, loadRuns, markRunPaid, refreshRun, reopenRun, saveAdjustment,
} from '../../lib/casualApi';
import {
  addDays, casualBankFile, casualMpesaFile, formatKsh, lineNet, periodLabel, runTotal, today, weekStart,
  type CasualPayLine, type CasualPayRun,
} from '../../lib/casualPay';
import { toCsv, type ExportFile } from '../../lib/payrollExports';
import { XLSX_TYPE, toXlsx } from '../../lib/xlsxExport';
import { casualRateShortfall, money, perDayMinimum } from '../../lib/minimumWage';
import { useMinimumWages } from '../../hooks/useMinimumWages';

// Paying casuals: pick a period (a day, a week or any dates), see each person's days x daily rate, add one-off
// additions or deductions with a note, approve (the lines are then fixed), download the M-Pesa or bank file, and
// mark the run paid. No PAYE, NSSF, SHIF or AHL is taken: casuals are not on the monthly payroll.

const STATUS: Record<CasualPayRun['status'], { label: string; tone: StatusTone }> = {
  draft: { label: 'Draft', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
};

const field = 'px-3 py-2 text-xs border border-border rounded-tile bg-white text-ink outline-none focus:border-brand';

type Mode = 'day' | 'week' | 'custom';

function NewRunModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const now = today();
  const [mode, setMode] = useState<Mode>('week');
  const [day, setDay] = useState(addDays(now, -1));
  const [start, setStart] = useState(addDays(now, -7));
  const [end, setEnd] = useState(addDays(now, -1));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const period = (): [string, string] => {
    if (mode === 'day') return [day, day];
    if (mode === 'week') {
      const monday = weekStart(day);
      const sunday = addDays(monday, 6);
      return [monday, sunday > now ? now : sunday];
    }
    return [start, end];
  };
  const [from, to] = period();

  const create = async () => {
    setBusy(true);
    setProblem(null);
    try {
      onCreated(await createRun(from, to));
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New pay run" size="md" closeOnBackdrop={!busy}>
      <div className="space-y-3 text-xs">
        <div className="flex gap-4">
          {(['day', 'week', 'custom'] as const).map((m) => (
            <label key={m} className="inline-flex items-center gap-1.5">
              <input type="radio" name="run-mode" checked={mode === m} onChange={() => setMode(m)} />
              {m === 'day' ? 'One day' : m === 'week' ? 'A week' : 'Other dates'}
            </label>
          ))}
        </div>
        {mode === 'custom' ? (
          <div className="flex flex-wrap gap-2 items-end">
            <label className="flex flex-col gap-1">First day<input type="date" className={field} value={start} max={now} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="flex flex-col gap-1">Last day<input type="date" className={field} value={end} max={now} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
        ) : (
          <label className="flex flex-col gap-1">
            {mode === 'day' ? 'The day' : 'Any day in the week'}
            <input type="date" className={field} value={day} max={now} onChange={(e) => setDay(e.target.value)} />
          </label>
        )}
        <p className="text-muted-foreground">Pays the approved days from {periodLabel(from, to)} that aren&apos;t in another run.</p>
        {problem && <p role="alert" className="text-status-danger">{problem}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void create()} disabled={busy || !from || !to}>{busy ? 'Working out...' : 'Work out pay'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function AdjustModal({ line, onClose, onSaved }: { line: CasualPayLine; onClose: () => void; onSaved: () => void }) {
  const [add, setAdd] = useState(String(Number(line.additions) || ''));
  const [ded, setDed] = useState(String(Number(line.deductions) || ''));
  const [note, setNote] = useState(line.adjustment_note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const additions = Number(add) || 0;
  const deductions = Number(ded) || 0;

  const save = async () => {
    if (additions < 0 || deductions < 0) return setProblem('Amounts can’t be below 0.');
    if ((additions || deductions) && !note.trim()) return setProblem('Say what the addition or deduction is for.');
    if (deductions > Number(line.days_amount) + additions) return setProblem('A deduction can’t be more than their pay.');
    try {
      await saveAdjustment(line.id, additions, deductions, note);
      onSaved();
      onClose();
    } catch (err) {
      setProblem((err as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Additions and deductions: ${line.worker_name}`} size="md">
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">Addition (KSh)<input className={field} inputMode="decimal" value={add} onChange={(e) => setAdd(e.target.value)} /></label>
          <label className="flex flex-col gap-1">Deduction (KSh)<input className={field} inputMode="decimal" value={ded} onChange={(e) => setDed(e.target.value)} /></label>
        </div>
        <label className="flex flex-col gap-1">What for<input className={field} value={note} placeholder="Transport, overtime, a lost tool..." onChange={(e) => setNote(e.target.value)} /></label>
        <p className="text-muted-foreground">
          Days {formatKsh(line.days_amount)} + {formatKsh(additions)} - {formatKsh(deductions)} ={' '}
          <span className="font-semibold text-ink">{formatKsh(lineNet({ days_amount: line.days_amount, additions, deductions }))}</span>
        </p>
        {problem && <p role="alert" className="text-status-danger">{problem}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

const saveFile = (f: ExportFile, name: string, format: 'csv' | 'xlsx', sheet: string) =>
  format === 'xlsx'
    ? saveAs(new Blob([toXlsx(f.headers, f.rows, sheet)], { type: XLSX_TYPE }), `${name}.xlsx`)
    : saveAs(new Blob([toCsv(f.headers, f.rows)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);

function RunDetail({ run, onBack, onChanged }: { run: CasualPayRun; onBack: () => void; onChanged: () => void }) {
  const [lines, setLines] = useState<CasualPayLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState<CasualPayLine | null>(null);
  const [paidOn, setPaidOn] = useState(today());
  const [busy, setBusy] = useState(false);
  const draft = run.status === 'draft';
  // daily rates below the per-day minimum wage on the run's last day (FIG-812 stage 6): a warning, never a block
  const wages = useMinimumWages(run.period_end);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setLines(await loadRunLines(run.id));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [run.id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      onChanged();
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const files = useMemo(() => ({ mpesa: casualMpesaFile(lines, run), bank: casualBankFile(lines, run) }), [lines, run]);
  const total = runTotal(lines);
  const belowMinimum = lines
    .map((l) => ({ line: l, minimum: wages.minimumFor(l.employee_number), short: casualRateShortfall(l.daily_rate, wages.minimumFor(l.employee_number), wages.settings) }))
    .filter((x) => x.short !== null && x.minimum?.monthly);
  const slug = `casual-pay-${run.period_start}${run.period_start === run.period_end ? '' : `-to-${run.period_end}`}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={onBack}>All pay runs</Button>
        <h2 className="text-[15px] font-bold text-ink">{periodLabel(run.period_start, run.period_end)}</h2>
        <StatusPill label={STATUS[run.status].label} tone={STATUS[run.status].tone} />
        {run.paid_on && <span className="text-xs text-muted-foreground">paid {periodLabel(run.paid_on, run.paid_on)}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {draft && (
            <>
              <Button variant="secondary" disabled={busy} icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => void act(() => refreshRun(run.id), 'Worked out again')}>
                Work out again
              </Button>
              <Button variant="secondary" disabled={busy} onClick={async () => {
                if (await confirmDialog({ title: 'Delete this draft pay run?', confirmLabel: 'Delete', tone: 'danger' })) {
                  await act(() => deleteRun(run.id), 'Deleted');
                  onBack();
                }
              }}>Delete</Button>
              <Button disabled={busy || lines.length === 0} icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={async () => {
                if (await confirmDialog({
                  title: 'Approve this pay run?',
                  message: `${lines.length} ${lines.length === 1 ? 'person' : 'people'}, ${formatKsh(total)}. The amounts and the days in it will be locked.`,
                  confirmLabel: 'Approve',
                })) await act(() => approveRun(run.id), 'Approved');
              }}>Approve</Button>
            </>
          )}
          {run.status === 'approved' && (
            <Button variant="secondary" disabled={busy} onClick={async () => {
              if (await confirmDialog({ title: 'Undo the approval?', message: 'The run goes back to draft and its days can be changed again.', confirmLabel: 'Undo approval' })) {
                await act(() => reopenRun(run.id), 'Back to draft');
              }
            }}>Undo approval</Button>
          )}
        </div>
      </div>

      {belowMinimum.length > 0 && (
        <Card padding="sm" data-testid="casual-run-minimum-wage">
          <div className="flex items-start gap-2 text-xs text-ink">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-orange-text-alt shrink-0" />
            <div>
              <p className="m-0 font-semibold">
                {belowMinimum.length} {belowMinimum.length === 1 ? 'person has' : 'people have'} a daily rate below the minimum wage
              </p>
              <ul className="m-0 mt-1 space-y-0.5 text-muted-foreground">
                {belowMinimum.map(({ line, minimum, short }) => (
                  <li key={line.id}>
                    <span className="font-semibold text-ink">{line.worker_name}</span>: {formatKsh(line.daily_rate ?? 0)} a day, the minimum in{' '}
                    {minimum!.country} is {money(perDayMinimum(minimum!.monthly as number, wages.settings.daysPerMonth), minimum!.currency)} (short by{' '}
                    {money(short as number, minimum!.currency)} a day)
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-1 text-muted-foreground">A warning only: you can still approve and pay this run.</p>
            </div>
          </div>
        </Card>
      )}

      <Card padding="none">
        <TableScroll>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                <th className="px-3 py-2 font-semibold">Casual worker</th>
                <th className="px-3 py-2 font-semibold text-right">Full days</th>
                <th className="px-3 py-2 font-semibold text-right">Half days</th>
                <th className="px-3 py-2 font-semibold text-right">Daily rate</th>
                <th className="px-3 py-2 font-semibold text-right">Days</th>
                <th className="px-3 py-2 font-semibold text-right">Additions</th>
                <th className="px-3 py-2 font-semibold text-right">Deductions</th>
                <th className="px-3 py-2 font-semibold text-right">To pay</th>
                <th className="px-3 py-2 font-semibold">Paid by</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink">{l.worker_name}</div>
                    {l.adjustment_note && <div className="text-[10.5px] text-subtle">{l.adjustment_note}</div>}
                  </td>
                  <td className="px-3 py-2 text-right">{l.full_days}</td>
                  <td className="px-3 py-2 text-right">{l.half_days}</td>
                  <td className="px-3 py-2 text-right">{l.daily_rate ? formatKsh(l.daily_rate) : ''}</td>
                  <td className="px-3 py-2 text-right">{formatKsh(l.days_amount)}</td>
                  <td className="px-3 py-2 text-right">{Number(l.additions) ? formatKsh(l.additions) : '-'}</td>
                  <td className="px-3 py-2 text-right">{Number(l.deductions) ? formatKsh(l.deductions) : '-'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-ink">{formatKsh(lineNet(l))}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {l.payment_method === 'Bank Transfer' ? 'Bank' : 'M-Pesa'}
                    {draft && (
                      <button type="button" className="ml-2 text-brand font-semibold" onClick={() => setAdjusting(l)}>Add or deduct</button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && lines.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-4 text-center text-muted-foreground">No approved days to pay in this period.</td></tr>
              )}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t border-border font-semibold text-ink">
                  <td className="px-3 py-2" colSpan={7}>{lines.length} {lines.length === 1 ? 'person' : 'people'}</td>
                  <td className="px-3 py-2 text-right">{formatKsh(total)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </TableScroll>
      </Card>

      {!draft && (
        <Card>
          <h3 className="text-sm font-semibold text-ink mb-1">Payout files</h3>
          <p className="text-xs text-muted-foreground mb-3">Upload these to M-Pesa bulk pay or the bank. Nothing is sent from here.</p>
          <div className="space-y-2">
            {([['mpesa', 'M-Pesa bulk pay', 'mpesa'], ['bank', 'Bank bulk pay', 'bank']] as const).map(([key, label, name]) => {
              const f = files[key];
              return (
                <div key={key} className="flex flex-wrap items-center gap-3 rounded-tile border border-border px-3 py-2">
                  <div className="flex-1 min-w-[160px]">
                    <p className="text-sm font-medium text-ink">{label}</p>
                    <p className="text-xs text-muted-foreground">{f.rows.length} {f.rows.length === 1 ? 'row' : 'rows'}</p>
                  </div>
                  {f.problems.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-text-alt" title={f.problems.map((p) => `${p.name}: ${p.missing.join(', ')}`).join('\n')}>
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {f.problems.length} missing details
                    </span>
                  )}
                  {(['csv', 'xlsx'] as const).map((format) => (
                    <Button key={format} variant="secondary" disabled={f.rows.length === 0} icon={<Download className="w-3 h-3" />}
                      aria-label={`${label} ${format === 'csv' ? 'CSV' : 'Excel'}`}
                      onClick={() => saveFile(f, `${slug}-${name}`, format, label)}>
                      {format === 'csv' ? 'CSV' : 'Excel'}
                    </Button>
                  ))}
                </div>
              );
            })}
          </div>
          {run.status === 'approved' && (
            <div className="flex flex-wrap items-end gap-2 mt-4 pt-3 border-t border-border text-xs">
              <label className="flex flex-col gap-1">
                Paid on
                <input type="date" className={field} value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} />
              </label>
              <Button disabled={busy || !paidOn} icon={<Wallet className="w-3.5 h-3.5" />} onClick={() => void act(() => markRunPaid(run.id, paidOn), 'Marked paid')}>
                Mark paid
              </Button>
            </div>
          )}
        </Card>
      )}

      {adjusting && <AdjustModal line={adjusting} onClose={() => setAdjusting(null)} onSaved={() => { void reload(); onChanged(); }} />}
    </div>
  );
}

export default function CasualPayRuns() {
  const [runs, setRuns] = useState<CasualPayRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    try {
      setRuns(await loadRuns());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const open = runs.find((r) => r.id === openId);
  if (open) return <RunDetail run={open} onBack={() => setOpenId(null)} onChanged={() => void reload()} />;

  return (
    <Card padding="none">
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <p className="text-xs text-muted-foreground flex-1">Days x daily rate, with no PAYE, NSSF, SHIF or AHL taken.</p>
        <Button icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setCreating(true)}>New pay run</Button>
      </div>
      {runs.length === 0 ? (
        <EmptyState icon={<Wallet className="w-5 h-5" />} title={loading ? 'Loading...' : 'No pay runs yet'}
          description={loading ? undefined : 'Start one for a day, a week or any dates.'} />
      ) : (
        <ul>
          {runs.map((r) => (
            <li key={r.id} className="border-b border-border last:border-0">
              <button type="button" onClick={() => setOpenId(r.id)} className="w-full flex flex-wrap items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary">
                <span className="text-[13px] font-semibold text-ink flex-1">{periodLabel(r.period_start, r.period_end)}</span>
                <span className="text-xs text-ink">{formatKsh(r.total)}</span>
                <StatusPill label={STATUS[r.status].label} tone={STATUS[r.status].tone} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <NewRunModal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void reload().then(() => setOpenId(id)); }} />
      )}
    </Card>
  );
}
