import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, Plus, X } from 'lucide-react';
import { Card, StatusPill } from '../UI';
import { confirmDialog } from '../../lib/confirmDialog';
import {
  CONTRIBUTION_KINDS,
  EMPTY_FORM,
  KIND_EFFECT,
  KIND_LABELS,
  STATUS_LABELS,
  activeContributions,
  canStop,
  formProblems,
  ksh,
  monthLabel,
  monthsText,
  periodOf,
  statusTone,
  taxNoteFor,
  type Contribution,
  type ContributionForm,
  type ContributionKind,
} from '../../lib/contributions';
import { loadContributions, openContributionDocument, requestContribution, stopContribution } from '../../lib/contributionsApi';
import { LoaderBlock } from '../UI/FigbloomLoader';

// The staff portal's "My contributions" (FIG-898): ask payroll to take a contribution from your pay (pension AVC,
// SACCO, welfare, ...) or to count an insurance premium or mortgage interest for tax relief; see your requests and
// what is running, and stop one (from the next payroll month).

const input = 'w-full px-3 py-2 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-brand';
const label = 'block text-xs text-gray-600 mb-1';

const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export default function MyContributions() {
  const [list, setList] = useState<Contribution[] | null>(null);
  const [form, setForm] = useState<ContributionForm | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    loadContributions().then(setList, (err) => {
      setList([]);
      toast.error(message(err, 'Could not load your contributions.'));
    });
  }, []);

  useEffect(reload, [reload]);

  const set = (key: keyof ContributionForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => (f ? { ...f, [key]: e.target.value } : f));

  const submit = async () => {
    if (!form) return;
    const found = formProblems(form);
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    try {
      await requestContribution(form, file);
      toast.success('Sent to payroll. You will be told when they decide.');
      setForm(null);
      setFile(null);
      reload();
    } catch (err) {
      toast.error(message(err, 'The request was not sent.'));
    } finally {
      setBusy(false);
    }
  };

  const stop = async (c: Contribution) => {
    const pending = c.status === 'pending';
    const ok = await confirmDialog({
      title: pending ? `Withdraw your ${KIND_LABELS[c.kind]} request?` : `Stop your ${KIND_LABELS[c.kind]}?`,
      message: pending
        ? 'Payroll will not see it any more.'
        : `It stops from ${monthLabel(c.next_payroll_period)}. Payslips already approved keep it. Payroll is told.`,
      confirmLabel: pending ? 'Withdraw' : 'Stop it',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await stopContribution(c.id);
      toast.success(pending ? 'Request withdrawn.' : 'Stopped. Payroll has been told.');
      reload();
    } catch (err) {
      toast.error(message(err, 'It was not stopped.'));
    } finally {
      setBusy(false);
    }
  };

  const active = activeContributions(list ?? []);
  const requests = (list ?? []).filter((c) => c.status !== 'active');
  const kind = form?.kind as ContributionKind | '';

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-ink">My contributions</h2>
            <p className="text-[11.5px] text-muted-foreground mt-1">
              Pension top-ups, SACCO, welfare, or an insurance premium or mortgage interest to count for tax relief. Payroll approves each one.
            </p>
          </div>
          {!form && (
            <button type="button" onClick={() => { setForm({ ...EMPTY_FORM, start_period: periodOf() }); setProblems([]); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-white text-xs font-medium hover:bg-primary/90">
              <Plus className="w-3.5 h-3.5" /> Add a contribution
            </button>
          )}
        </div>

        {form && (
          <div className="mt-4 rounded border border-gray-200 p-4 space-y-3" role="form" aria-label="New contribution">
            <div className="flex items-center justify-between">
              <h3 className="m-0 text-xs font-bold text-ink">New contribution</h3>
              <button type="button" aria-label="Cancel" onClick={() => { setForm(null); setFile(null); }} className="text-gray-500 hover:text-gray-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="contribution-kind" className={label}>Kind</label>
                <select id="contribution-kind" value={form.kind} onChange={set('kind')} className={input}>
                  <option value="">Choose…</option>
                  {CONTRIBUTION_KINDS.map((k) => (
                    <option key={k} value={k}>{KIND_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="contribution-amount" className={label}>Amount a month (KSh)</label>
                <input id="contribution-amount" inputMode="decimal" value={form.amount} onChange={set('amount')} className={input} />
              </div>
              <div>
                <label htmlFor="contribution-from" className={label}>From month</label>
                <input id="contribution-from" type="month" min={periodOf()} value={form.start_period} onChange={set('start_period')} className={input} />
              </div>
              <div>
                <label htmlFor="contribution-until" className={label}>Until month (optional)</label>
                <input id="contribution-until" type="month" min={form.start_period || periodOf()} value={form.end_period} onChange={set('end_period')} className={input} />
              </div>
              <div>
                <label htmlFor="contribution-provider" className={label}>
                  {kind === 'other' ? 'Paid to' : 'Provider (scheme, SACCO, insurer, lender)'}
                </label>
                <input id="contribution-provider" value={form.provider} onChange={set('provider')} maxLength={200} className={input} />
              </div>
              <div>
                <label htmlFor="contribution-reference" className={label}>Member, policy or account number</label>
                <input id="contribution-reference" value={form.reference} onChange={set('reference')} maxLength={200} className={input} />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="contribution-note" className={label}>Note for payroll (optional)</label>
                <textarea id="contribution-note" rows={2} value={form.note} onChange={set('note')} maxLength={1000} className={input} />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="contribution-document" className={label}>Supporting document (optional: policy, statement, membership form)</label>
                <input id="contribution-document" type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
              </div>
            </div>
            {kind && (
              <div className="rounded bg-gray-50 px-3 py-2 text-[11.5px] text-gray-700" data-testid="contribution-effect">
                <p className="m-0">{KIND_EFFECT[kind]}</p>
                {taxNoteFor(kind) && <p className="m-0 mt-1 text-gray-500">{taxNoteFor(kind)}</p>}
              </div>
            )}
            {problems.length > 0 && (
              <ul role="alert" className="m-0 pl-4 text-[11.5px] text-status-danger">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setForm(null); setFile(null); }} className="px-3 py-1.5 border border-gray-300 text-xs font-medium rounded hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={() => void submit()} className="px-3 py-1.5 bg-primary text-white text-xs font-medium rounded hover:bg-primary/90 disabled:opacity-50">
                {busy ? 'Sending…' : 'Send to payroll'}
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="m-0 text-xs font-bold text-ink">Running now</h3>
        {list === null ? (
          <LoaderBlock label="Loading" compact />
        ) : active.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-2">None yet.</p>
        ) : (
          <ul className="m-0 mt-2 p-0 list-none space-y-2">
            {active.map((c) => (
              <ContributionRow key={c.id} c={c} busy={busy} onStop={stop} />
            ))}
          </ul>
        )}
      </Card>

      {requests.length > 0 && (
        <Card>
          <h3 className="m-0 text-xs font-bold text-ink">Requests</h3>
          <ul className="m-0 mt-2 p-0 list-none space-y-2">
            {requests.map((c) => (
              <ContributionRow key={c.id} c={c} busy={busy} onStop={stop} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ContributionRow({ c, busy, onStop }: { c: Contribution; busy: boolean; onStop: (c: Contribution) => void }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 border-b border-[#F1F5F2] last:border-b-0 pb-2">
      <div className="text-xs text-ink min-w-0">
        <div className="font-semibold">
          {KIND_LABELS[c.kind]}
          {c.provider ? ` · ${c.provider}` : ''} · {ksh(c.amount)} a month
        </div>
        <div className="text-muted-foreground">
          {monthsText(c.start_period, c.end_period)}
          {c.reference ? ` · ${c.reference}` : ''}
        </div>
        {c.status === 'declined' && c.decline_reason && <div className="text-status-danger">Reason: {c.decline_reason}</div>}
        {c.status === 'stopped' && c.stop_period && <div className="text-muted-foreground">Not taken from {monthLabel(c.stop_period)}</div>}
        {c.document_path && (
          <button type="button" className="inline-flex items-center gap-1 text-brand font-semibold mt-0.5"
            onClick={() => openContributionDocument(c.document_path as string).catch((err) => toast.error(message(err, 'Could not open the document')))}>
            <FileText className="w-3 h-3" /> Document
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone={statusTone(c.status)} label={STATUS_LABELS[c.status]} />
        {canStop(c) && (
          <button type="button" disabled={busy} onClick={() => onStop(c)} className="text-[11px] font-semibold text-status-danger disabled:opacity-50">
            {c.status === 'pending' ? 'Withdraw' : 'Stop'}
          </button>
        )}
      </div>
    </li>
  );
}
