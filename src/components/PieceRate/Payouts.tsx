import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { saveAs } from 'file-saver';
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Download, Plus, RefreshCw, Send, Wallet } from 'lucide-react';
import { Button, Card, EmptyState, Modal, StatusPill, TableScroll } from '../UI';
import { confirmDialog } from '../../lib/confirmDialog';
import { formatKsh, periodLabel, today } from '../../lib/casualPay';
import { moneyRounded } from '../../lib/payroll/currency';
import { loadBranches } from '../../lib/branches';
import { tidyCountry } from '../../lib/payroll/countries';
import { toCsv, type ExportFile } from '../../lib/payrollExports';
import { XLSX_TYPE, toXlsx } from '../../lib/xlsxExport';
import { myUserId } from '../../lib/pieceRateApi';
import { personName, type WorkPerson, type WorkSettings } from '../../lib/pieceRate';
import {
  PAYOUT_KIND_LABEL, PAYOUT_STATUS_LABEL, PAYOUT_STATUS_TONE, cashLines, defaultPeriod, lineHeld, payoutBankFile, payoutEquityFile,
  payoutFileSlug, payoutMpesaFile, type PayoutBatch, type PayoutKind, type PayoutLine,
} from '../../lib/piecePayouts';
import {
  approvePayoutBatch, cancelPayoutBatch, createPayoutBatch, loadEquityDebitAccount, loadPayoutBatches, loadPayoutLines,
  markPayoutExported, refreshPayoutDetails, removePayoutLine,
} from '../../lib/piecePayoutsApi';
import { LoaderBlock } from '../UI/FigbloomLoader';

// Payouts (FIG-812 stage 4), payroll only: pay daily and weekly workers (and finished contract jobs) during the month.
// Each payout holds back AHL and the reserve from employees and withholding tax from contractors; the month-end payroll
// settles the rest. Approve (by a second person, by default), then download the bank or M-Pesa file and upload it to the
// bank. Nothing is sent from here. The database works out and checks everything (20261020200000).

const field = 'px-2 py-1.5 text-xs border border-border rounded-lg bg-white text-ink';

/** An amount in a payout's currency (FIG-905): KSh as before, TSh or USh for a Tanzania or Uganda payout. */
const payoutMoney = (n: number | string, currency?: string | null) =>
  !currency || currency === 'KES' ? formatKsh(n) : moneyRounded(Number(n), currency);
const KINDS: PayoutKind[] = ['daily', 'weekly', 'job', 'ad_hoc'];
const KIND_HINT: Record<PayoutKind, string> = {
  daily: 'Workers paid daily: their approved work in these days, plus approved contract jobs not yet paid.',
  weekly: 'Workers paid weekly: their approved work in these days, plus approved contract jobs not yet paid.',
  job: 'Workers paid per job: their approved contract jobs not yet paid.',
  ad_hoc: 'The workers you pick: their approved work in these days, plus approved contract jobs not yet paid.',
};

function NewPayoutModal({ people, onClose, onCreated }: { people: WorkPerson[]; onClose: () => void; onCreated: (id: string) => void }) {
  const now = today();
  const [kind, setKind] = useState<PayoutKind>('daily');
  const [from, setFrom] = useState(defaultPeriod('daily', now).from);
  const [to, setTo] = useState(defaultPeriod('daily', now).to);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // a payout is in one currency (FIG-905): with branches in more than one country, payroll picks the country
  const [countries, setCountries] = useState<string[]>([]);
  const [country, setCountry] = useState('');
  useEffect(() => {
    let live = true;
    loadBranches()
      .then((bs) => {
        const cs = [...new Set(bs.filter((b) => b.active !== false).map((b) => tidyCountry(b.country) || 'Kenya'))].sort((a, b) => (a === 'Kenya' ? -1 : b === 'Kenya' ? 1 : a.localeCompare(b)));
        if (!live) return;
        setCountries(cs.length > 1 ? cs : []);
        setCountry(cs.length > 1 ? cs[0] : '');
      })
      .catch(() => {
        // one country: the database still refuses a payout that would mix currencies
      });
    return () => {
      live = false;
    };
  }, []);
  const workers = people.filter((p) => p.pay_basis === 'work' || p.pay_frequency === 'per_job');

  const pickKind = (k: PayoutKind) => {
    setKind(k);
    const d = defaultPeriod(k, now);
    setFrom(d.from);
    setTo(d.to);
  };

  const create = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const who = kind === 'ad_hoc' ? picked : null;
      onCreated(await (country ? createPayoutBatch(kind, from, to, who, country) : createPayoutBatch(kind, from, to, who)));
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New payout" size="md" closeOnBackdrop={!busy}>
      <div className="space-y-3 text-xs text-ink">
        <label className="block">
          <span className="font-semibold">Kind</span>
          <select aria-label="Kind" className={`mt-1 w-full ${field}`} value={kind} onChange={(e) => pickKind(e.target.value as PayoutKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{PAYOUT_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <p className="m-0 text-muted-foreground">{KIND_HINT[kind]}</p>
        {countries.length > 1 && (
          <label className="block">
            <span className="font-semibold">Country</span>
            <select aria-label="Country" className={`mt-1 w-full ${field}`} value={country} onChange={(e) => setCountry(e.target.value)}>
              {countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="mt-1 block text-muted-foreground">A payout is paid in one currency: make one for each country.</span>
          </label>
        )}
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            {kind === 'job' ? 'Month from' : 'From'}
            <input type="date" aria-label="From" className={field} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            To
            <input type="date" aria-label="To" className={field} value={to} min={from} max={now} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </label>
        </div>
        <p className="m-0 text-muted-foreground">A payout stays within one month, so the month-end payroll can settle it.</p>
        {kind === 'ad_hoc' && (
          <fieldset className="max-h-48 overflow-y-auto rounded-lg border border-border p-2">
            <legend className="px-1 font-semibold">Who to pay</legend>
            {workers.length === 0 && <p className="m-0 text-muted-foreground">Nobody is paid by work yet.</p>}
            {workers.map((p) => (
              <label key={p.employee_number} className="flex items-center gap-1.5 py-0.5">
                <input type="checkbox" checked={picked.includes(p.employee_number)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, p.employee_number] : picked.filter((n) => n !== p.employee_number))} />
                {personName(p)} <span className="text-subtle">{p.employee_number}</span>
              </label>
            ))}
          </fieldset>
        )}
        {problem && <p role="alert" className="m-0 text-status-danger">{problem}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void create()} disabled={busy || (kind === 'ad_hoc' && picked.length === 0)}>Make payout</Button>
        </div>
      </div>
    </Modal>
  );
}

const saveFile = (f: ExportFile, name: string, format: 'csv' | 'xlsx', sheet: string) =>
  format === 'xlsx'
    ? saveAs(new Blob([toXlsx(f.headers, f.rows, sheet)], { type: XLSX_TYPE }), `${name}.xlsx`)
    : saveAs(new Blob([toCsv(f.headers, f.rows)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);

function PayoutDetail({ batch, settings, me, onBack, onChanged }: {
  batch: PayoutBatch; settings: WorkSettings; me: string | null; onBack: () => void; onChanged: () => void;
}) {
  const [lines, setLines] = useState<PayoutLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [debit, setDebit] = useState('');
  const draft = batch.status === 'draft';
  const paying = batch.status === 'approved' || batch.status === 'exported';
  const madeByMe = Boolean(me) && batch.created_by === me;
  const needsOther = draft && settings.payout_needs_second_approver && madeByMe;
  const flagged = lines.filter((l) => l.problem).length;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setLines(await loadPayoutLines(batch.id));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [batch.id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!paying) return;
    loadEquityDebitAccount().then(setDebit).catch(() => setDebit(''));
  }, [paying]);

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

  const files = useMemo(() => ({
    bank: payoutBankFile(lines, batch),
    equity: payoutEquityFile(lines, debit),
    mpesa: payoutMpesaFile(lines, batch),
  }), [lines, batch, debit]);
  const cash = cashLines(lines);
  const slug = payoutFileSlug(batch);
  // amounts in the payout's currency; the M-Pesa and Equity files are Kenya's, so another currency gets the bank file only
  const currency = batch.currency || 'KES';
  const fmt = (n: number | string) => payoutMoney(n, currency);
  const sum = (pick: (l: PayoutLine) => number | string) => lines.reduce((s, l) => s + Number(pick(l)), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={onBack}>All payouts</Button>
        <h2 className="text-[15px] font-bold text-ink">{PAYOUT_KIND_LABEL[batch.kind]} · {periodLabel(batch.period_from, batch.period_to)}</h2>
        <StatusPill label={PAYOUT_STATUS_LABEL[batch.status]} tone={PAYOUT_STATUS_TONE[batch.status]} />
        <div className="ml-auto flex flex-wrap gap-2">
          {draft && (
            <>
              <Button variant="secondary" disabled={busy} icon={<RefreshCw className="w-3.5 h-3.5" />}
                onClick={() => void act(() => refreshPayoutDetails(batch.id), 'Payment details copied again')}>
                Refresh payment details
              </Button>
              <Button disabled={busy || lines.length === 0 || needsOther || flagged > 0} icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                onClick={async () => {
                  if (await confirmDialog({
                    title: 'Approve this payout?',
                    message: `${lines.length} ${lines.length === 1 ? 'worker' : 'workers'}, ${fmt(sum((l) => l.net))} to pay. The work in it is marked paid out and can't be paid again.`,
                    confirmLabel: 'Approve',
                  })) await act(() => approvePayoutBatch(batch.id), 'Approved');
                }}>
                Approve
              </Button>
            </>
          )}
          {batch.status === 'approved' && (
            <Button disabled={busy} icon={<Send className="w-3.5 h-3.5" />} onClick={async () => {
              if (await confirmDialog({ title: 'Mark as exported?', message: 'Do this once the file is uploaded to the bank. It can no longer be cancelled.', confirmLabel: 'Mark exported' })) {
                await act(() => markPayoutExported(batch.id), 'Marked exported');
              }
            }}>Mark exported</Button>
          )}
          {(draft || batch.status === 'approved') && (
            <Button variant="secondary" disabled={busy} icon={<Ban className="w-3.5 h-3.5" />} onClick={async () => {
              if (await confirmDialog({
                title: 'Cancel this payout?',
                message: draft ? 'Nothing has been paid. The work in it can go in another payout.' : 'The work in it is released to be paid in another payout, and the workers are told.',
                confirmLabel: 'Cancel payout', cancelLabel: 'Keep it', tone: 'danger',
              })) await act(() => cancelPayoutBatch(batch.id, null), 'Cancelled');
            }}>Cancel payout</Button>
          )}
        </div>
      </div>

      {needsOther && (
        <p className="m-0 rounded-tile border border-border bg-white p-3 text-xs text-ink">
          You made this payout, so someone else in payroll must approve it. They have been told. (Payroll can switch this off under Workers.)
        </p>
      )}
      {draft && flagged > 0 && (
        <p role="alert" className="m-0 flex items-start gap-2 rounded-tile border border-border bg-white p-3 text-xs text-ink">
          <AlertTriangle className="w-4 h-4 shrink-0 text-orange-text-alt" />
          {flagged} {flagged === 1 ? 'worker has' : 'workers have'} payment details missing. Fix their records and refresh, or remove them from this payout.
        </p>
      )}

      <Card padding="none">
        <TableScroll>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                <th className="px-3 py-2 font-semibold">Worker</th>
                <th className="px-3 py-2 font-semibold text-right">Gross</th>
                <th className="px-3 py-2 font-semibold text-right">AHL</th>
                <th className="px-3 py-2 font-semibold text-right">Reserve</th>
                <th className="px-3 py-2 font-semibold text-right">WHT</th>
                <th className="px-3 py-2 font-semibold text-right">To pay</th>
                <th className="px-3 py-2 font-semibold">Paid by</th>
                {draft && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink">{l.worker_name}</div>
                    <div className="text-[10.5px] text-subtle">
                      {l.employee_number}{l.worker_kind === 'contractor' ? ' · contractor' : ''}
                      {Number(l.jobs_amount) > 0 ? ` · jobs ${fmt(l.jobs_amount)}` : ''}
                    </div>
                    {l.problem && <div className="text-[10.5px] font-semibold text-status-danger">{l.problem}</div>}
                  </td>
                  <td className="px-3 py-2 text-right">{fmt(l.gross)}</td>
                  <td className="px-3 py-2 text-right">{Number(l.ahl) ? fmt(l.ahl) : '-'}</td>
                  <td className="px-3 py-2 text-right">{Number(l.reserve) ? fmt(l.reserve) : '-'}</td>
                  <td className="px-3 py-2 text-right">{Number(l.wht) ? fmt(l.wht) : '-'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-ink" aria-label={`${l.worker_name} to pay`}>{fmt(l.net)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {l.payment_kind === 'bank' ? `Bank${l.bank ? ` (${l.bank})` : ''}` : l.payment_kind === 'cash' ? 'Cash' : l.payment_method || 'M-Pesa'}
                  </td>
                  {draft && (
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="text-brand font-semibold" aria-label={`Remove ${l.worker_name}`} disabled={busy}
                        onClick={() => void act(() => removePayoutLine(l.id), `${l.worker_name} removed`)}>
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!loading && lines.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-4 text-center text-muted-foreground">Nobody to pay: no approved, unpaid work or jobs for these days.</td></tr>
              )}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t border-border font-semibold text-ink">
                  <td className="px-3 py-2">{lines.length} {lines.length === 1 ? 'worker' : 'workers'}</td>
                  <td className="px-3 py-2 text-right">{fmt(sum((l) => l.gross))}</td>
                  <td className="px-3 py-2 text-right">{fmt(sum((l) => l.ahl))}</td>
                  <td className="px-3 py-2 text-right">{fmt(sum((l) => l.reserve))}</td>
                  <td className="px-3 py-2 text-right">{fmt(sum((l) => l.wht))}</td>
                  <td className="px-3 py-2 text-right" aria-label="Total to pay">{fmt(sum((l) => l.net))}</td>
                  <td className="px-3 py-2 text-muted-foreground font-normal" colSpan={draft ? 2 : 1}>
                    {fmt(sum((l) => lineHeld(l)))} held to the month end
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </TableScroll>
      </Card>

      {paying && (
        <Card>
          <h3 className="text-sm font-semibold text-ink mb-1">Payout files</h3>
          <p className="text-xs text-muted-foreground mb-3">Upload one of these to the bank or M-Pesa bulk payments. Nothing is sent from here.</p>
          <div className="space-y-2">
            {([
              ['bank', 'Bank bulk payment', 'bank', 'everyone paid by bank'],
              ['equity', 'Equity Bank (Eazzy Biz)', 'equity-eazzy-biz', 'everyone paid by bank or M-Pesa, from the company’s Equity account'],
              ['mpesa', 'M-Pesa bulk (B2C)', 'mpesa-b2c', 'everyone paid by M-Pesa'],
            ] as const).filter(([key]) => currency === 'KES' || key === 'bank').map(([key, label, name, what]) => {
              const f = files[key];
              const blocked = key === 'equity' && !debit;
              return (
                <div key={key} className="rounded-tile border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[160px]">
                      <p className="m-0 text-sm font-medium text-ink">{label}</p>
                      <p className="m-0 text-xs text-muted-foreground">{what} · {f.rows.length} {f.rows.length === 1 ? 'row' : 'rows'}</p>
                    </div>
                    {(['csv', 'xlsx'] as const).map((format) => (
                      <Button key={format} variant="secondary" disabled={f.rows.length === 0 || blocked} icon={<Download className="w-3 h-3" />}
                        aria-label={`${label} ${format === 'csv' ? 'CSV' : 'Excel'}`}
                        onClick={() => saveFile(f, `${slug}-${name}`, format, label)}>
                        {format === 'csv' ? 'CSV' : 'Excel'}
                      </Button>
                    ))}
                  </div>
                  {blocked && <p className="m-0 mt-1 text-xs text-muted-foreground">Set the company&apos;s Equity account on Payroll &gt; Exports first.</p>}
                  {f.problems.length > 0 && (
                    <ul className="m-0 mt-2 list-none p-0 text-xs text-orange-text-alt" aria-label={`${label} problems`}>
                      {f.problems.map((p) => (
                        <li key={p.employeeNumber} className="flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {p.name}: {p.missing.join(', ')}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          {cash.length > 0 && (
            <p className="m-0 mt-3 text-xs text-muted-foreground">
              Paid in cash, so in no file: {cash.map((l) => `${l.worker_name} (${fmt(l.net)})`).join(', ')}.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

export default function Payouts({ people, settings }: { people: WorkPerson[]; settings: WorkSettings }) {
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setBatches(await loadPayoutBatches());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    myUserId().then(setMe).catch(() => setMe(null));
  }, [reload]);

  const open = batches.find((b) => b.id === openId);
  if (open) {
    return <PayoutDetail batch={open} settings={settings} me={me} onBack={() => setOpenId(null)} onChanged={() => void reload()} />;
  }

  return (
    <div className="space-y-3">
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink">
          <Wallet className="w-4 h-4 text-status-info" />
          <span className="flex-1 min-w-[200px]">
            Pay daily and weekly workers, and finished contract jobs, during the month. Each payout holds back AHL and the{' '}
            {Math.round(settings.payout_reserve_rate * 100)}% reserve from employees, and withholding tax from contractors; the
            month-end payroll settles the rest.
          </span>
          <Button icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setCreating(true)}>New payout</Button>
        </div>
      </Card>

      <Card padding="none">
        {batches.length === 0 ? (
          loading ? <LoaderBlock label="Loading" compact /> : <EmptyState icon={<Wallet className="w-5 h-5" />} title="No payouts yet" />
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                  <th className="px-3 py-2 font-semibold">Payout</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold text-right">Workers</th>
                  <th className="px-3 py-2 font-semibold text-right">Gross</th>
                  <th className="px-3 py-2 font-semibold text-right">To pay</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">{PAYOUT_KIND_LABEL[b.kind]} · {periodLabel(b.period_from, b.period_to)}</div>
                      <div className="text-[10.5px] text-subtle">made {periodLabel(b.created_at.slice(0, 10), b.created_at.slice(0, 10))}</div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill label={PAYOUT_STATUS_LABEL[b.status]} tone={PAYOUT_STATUS_TONE[b.status]} />
                      {b.status === 'draft' && b.flagged_count > 0 && <span className="ml-1 text-[10.5px] text-status-danger">{b.flagged_count} missing details</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{b.worker_count}</td>
                    <td className="px-3 py-2 text-right">{payoutMoney(b.gross_total, b.currency)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{payoutMoney(b.net_total, b.currency)}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="text-brand font-semibold" onClick={() => setOpenId(b.id)}
                        aria-label={`Open ${PAYOUT_KIND_LABEL[b.kind]} payout ${periodLabel(b.period_from, b.period_to)}`}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      {creating && (
        <NewPayoutModal people={people} onClose={() => setCreating(false)} onCreated={(id) => {
          setCreating(false);
          void reload().then(() => setOpenId(id));
        }} />
      )}
    </div>
  );
}
