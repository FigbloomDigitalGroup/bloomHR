import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, FileText, Loader, X } from 'lucide-react';
import { Card, StatusPill, TableScroll } from '../UI';
import { confirmDialog } from '../../lib/confirmDialog';
import {
  KIND_LABELS,
  KIND_PAYROLL_INPUT,
  STATUS_LABELS,
  canStop,
  ksh,
  monthLabel,
  monthsText,
  statusTone,
  type Contribution,
} from '../../lib/contributions';
import {
  decideContribution,
  loadContributions,
  openContributionDocument,
  stopContribution,
  syncContributions,
} from '../../lib/contributionsApi';

// Payroll → Deductions: contributions staff asked for from the staff portal (FIG-898). Approve (it becomes the payroll
// input it belongs to: a voluntary deduction, or the employee's pension / PRMF / insurance / mortgage amount) or
// decline with a reason; see what is running and stop it.

interface Props {
  /** called after a change, so the payroll figures are worked out again */
  onChanged?: () => void;
}

const button =
  'inline-flex items-center gap-1 px-2.5 py-1 rounded-tile text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

type View = 'pending' | 'active' | 'all';

export default function ContributionRequests({ onChanged }: Props) {
  const [list, setList] = useState<Contribution[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState<{ id: string; reason: string } | null>(null);
  const [view, setView] = useState<View>('pending');

  const reload = useCallback(async () => {
    try {
      setList(await loadContributions());
    } catch (err) {
      setList([]);
      toast.error(message(err, 'Could not load contribution requests.'));
    }
  }, []);

  useEffect(() => {
    // bring employee amounts up to the next payroll month first (best effort), then list
    syncContributions().catch(() => undefined).finally(() => void reload());
  }, [reload]);

  const act = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      await reload();
      onChanged?.();
      return true;
    } catch (err) {
      toast.error(message(err, 'Could not save the change.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const approve = (c: Contribution) => act(() => decideContribution(c.id, true), `${KIND_LABELS[c.kind]} approved for ${c.employee_name}.`);

  const decline = async () => {
    if (!declining) return;
    if (!declining.reason.trim()) return toast.error('Give the employee a reason.');
    const c = list?.find((x) => x.id === declining.id);
    if (await act(() => decideContribution(declining.id, false, declining.reason), `Declined${c ? ` for ${c.employee_name}` : ''}.`)) setDeclining(null);
  };

  const stop = async (c: Contribution) => {
    const ok = await confirmDialog({
      title: `Stop ${c.employee_name}'s ${KIND_LABELS[c.kind]}?`,
      message: `It stops from ${monthLabel(c.next_payroll_period)}. Payslips already approved keep it. The employee is told.`,
      confirmLabel: 'Stop it',
      tone: 'danger',
    });
    if (ok) await act(() => stopContribution(c.id), 'Stopped.');
  };

  const pending = useMemo(() => (list ?? []).filter((c) => c.status === 'pending'), [list]);
  const shown = useMemo(
    () => (list ?? []).filter((c) => (view === 'pending' ? c.status === 'pending' : view === 'active' ? c.status === 'active' : true)),
    [list, view],
  );

  if (list === null) {
    return (
      <Card padding="sm">
        <p className="text-xs text-muted-foreground">Loading contribution requests…</p>
      </Card>
    );
  }
  if (list.length === 0) return null;

  return (
    <Card padding="none">
      <div className="px-4 sm:px-5 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink">
            Contributions staff asked for {pending.length > 0 && <span className="text-orange-text-alt">({pending.length} to review)</span>}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            From the staff portal. Approving adds it to payroll from its first month (or the next payroll month if that has passed).
          </p>
        </div>
        <div className="flex items-center gap-1" role="tablist" aria-label="Show">
          {(['pending', 'active', 'all'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`${button} ${view === v ? 'bg-brand text-white' : 'border border-border bg-white text-ink hover:bg-secondary'}`}>
              {v === 'pending' ? 'To review' : v === 'active' ? 'Running' : 'All'}
            </button>
          ))}
          {busy && <Loader className="w-3.5 h-3.5 animate-spin text-subtle" aria-label="Saving" />}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="px-4 sm:px-5 py-4 text-xs text-muted-foreground">{view === 'pending' ? 'Nothing to review.' : 'None.'}</p>
      ) : (
        <TableScroll>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase text-subtle border-b border-border">
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Contribution</th>
                <th className="px-3 py-2 text-right">A month</th>
                <th className="px-3 py-2">Months</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="border-b border-[#F1F5F2] last:border-0 text-ink align-top">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{c.employee_name}</div>
                    <div className="text-[10px] text-subtle">{c.employee_number}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{KIND_LABELS[c.kind]}{c.provider ? ` · ${c.provider}` : ''}</div>
                    {c.reference && <div className="text-[10px] text-subtle">Ref {c.reference}</div>}
                    <div className="text-[10px] text-muted-foreground">{KIND_PAYROLL_INPUT[c.kind]}</div>
                    {c.note && <div className="text-[10px] text-muted-foreground">“{c.note}”</div>}
                    {c.document_path && (
                      <button type="button" className="inline-flex items-center gap-1 text-[10.5px] text-brand font-semibold"
                        onClick={() => openContributionDocument(c.document_path as string).catch((err) => toast.error(message(err, 'Could not open the document')))}>
                        <FileText className="w-3 h-3" /> Document
                      </button>
                    )}
                    {c.status === 'declined' && c.decline_reason && <div className="text-[10px] text-status-danger">Reason: {c.decline_reason}</div>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{ksh(c.amount)}</td>
                  <td className="px-3 py-2">{monthsText(c.start_period, c.end_period)}</td>
                  <td className="px-3 py-2"><StatusPill tone={statusTone(c.status)} label={STATUS_LABELS[c.status]} /></td>
                  <td className="px-3 py-2">
                    {c.status === 'pending' && declining?.id !== c.id && (
                      <div className="flex gap-1.5 justify-end">
                        <button type="button" disabled={busy} onClick={() => void approve(c)} className={`${button} bg-brand text-white hover:bg-brand-dark`}>
                          <Check className="w-3 h-3" /> Approve
                        </button>
                        <button type="button" disabled={busy} onClick={() => setDeclining({ id: c.id, reason: '' })}
                          className={`${button} border border-border bg-white text-ink hover:bg-secondary`}>
                          <X className="w-3 h-3" /> Decline
                        </button>
                      </div>
                    )}
                    {declining?.id === c.id && (
                      <div className="flex flex-col gap-1.5 min-w-[200px]">
                        <label htmlFor={`decline-${c.id}`} className="text-[10px] font-bold uppercase text-subtle">Reason for the employee</label>
                        <input id={`decline-${c.id}`} value={declining.reason} maxLength={1000}
                          onChange={(e) => setDeclining({ id: c.id, reason: e.target.value })}
                          className="w-full px-2 py-1 rounded-tile border border-border text-xs" />
                        <div className="flex gap-1.5 justify-end">
                          <button type="button" onClick={() => setDeclining(null)} className={`${button} border border-border bg-white text-ink`}>Cancel</button>
                          <button type="button" disabled={busy} onClick={() => void decline()} className={`${button} bg-status-danger text-white`}>Decline</button>
                        </div>
                      </div>
                    )}
                    {c.status === 'active' && canStop(c) && (
                      <div className="flex justify-end">
                        <button type="button" disabled={busy} onClick={() => void stop(c)} className={`${button} border border-border bg-white text-status-danger`}>
                          Stop
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}
