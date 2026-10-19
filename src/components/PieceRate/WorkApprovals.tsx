import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCheck, Hourglass } from 'lucide-react';
import { Button, Card, EmptyState, Modal, StatusPill, TableScroll } from '../UI';
import { formatKsh, longDate } from '../../lib/casualPay';
import { decideEntries, loadWaitingEntries } from '../../lib/pieceRateApi';
import { SOURCE_LABEL, formatQty, personName, round2, type WorkEntry, type WorkPerson, type WorkType } from '../../lib/pieceRate';
import { LoaderBlock } from '../UI/FigbloomLoader';

// Work waiting for a decision. A supervisor approves their workers' own submissions; payroll approves those and what
// supervisors entered (when the company asks payroll to check it). Approve one, several or all; a rejection needs a
// reason, which whoever submitted it is told. Approved work is locked (payroll can reopen it from the day's entry).

interface Props {
  people: WorkPerson[];
  types: WorkType[];
  canManage: boolean;
  onChanged?: () => void;
}

export default function WorkApprovals({ people, types, canManage, onChanged }: Props) {
  const [entries, setEntries] = useState<WorkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  const [reason, setReason] = useState('');

  const names = useMemo(() => new Map(people.map((p) => [p.employee_number, personName(p)])), [people]);
  const typeOf = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const reload = useCallback(async () => {
    try {
      setEntries(await loadWaitingEntries());
      setPicked(new Set());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // a supervisor decides their workers' own submissions; what they entered themselves waits for payroll
  const mine = entries.filter((e) => canManage || e.source === 'self');
  const forPayroll = entries.filter((e) => !canManage && e.source !== 'self');
  const total = round2(mine.reduce((s, e) => s + Number(e.amount), 0));

  const decide = async (ids: string[], decision: 'approved' | 'rejected', why?: string) => {
    setBusy(true);
    try {
      const out = await decideEntries(ids, decision, why);
      if (out.done) {
        toast.success(`${out.done} ${out.done === 1 ? 'entry' : 'entries'} ${decision === 'approved' ? 'approved' : 'rejected'}`);
      }
      if (out.problem) toast.error(out.problem);
      setRejecting(null);
      setReason('');
      await reload();
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allPicked = mine.length > 0 && mine.every((e) => picked.has(e.id));
  const pickedIds = mine.filter((e) => picked.has(e.id)).map((e) => e.id);

  const row = (e: WorkEntry, decidable: boolean) => {
    const t = typeOf.get(e.work_type_id);
    const who = names.get(e.employee_number) ?? e.employee_number;
    return (
      <tr key={e.id} className="border-b border-border last:border-0">
        {decidable && (
          <td className="px-3 py-2">
            <input type="checkbox" aria-label={`Pick ${who}, ${e.work_date}`} checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
          </td>
        )}
        <td className="px-3 py-2">
          <div className="font-semibold text-ink">{who}</div>
          <div className="text-[10.5px] text-subtle">{e.employee_number}</div>
        </td>
        <td className="px-3 py-2 whitespace-nowrap">{longDate(e.work_date)}</td>
        <td className="px-3 py-2">{t?.name ?? 'Kind of work'}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">{formatQty(e.quantity)} {t?.unit}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">{formatKsh(e.amount)}</td>
        <td className="px-3 py-2"><StatusPill label={e.source === 'self' ? 'Worker submitted' : SOURCE_LABEL[e.source]} tone={e.source === 'self' ? 'info' : 'neutral'} /></td>
        {decidable && (
          <td className="px-3 py-2 text-right whitespace-nowrap">
            <button type="button" className="text-brand font-semibold mr-3" disabled={busy} aria-label={`Approve ${who}, ${e.work_date}`} onClick={() => void decide([e.id], 'approved')}>
              Approve
            </button>
            <button type="button" className="text-status-danger font-semibold" disabled={busy} aria-label={`Reject ${who}, ${e.work_date}`} onClick={() => setRejecting([e.id])}>
              Reject
            </button>
          </td>
        )}
      </tr>
    );
  };

  return (
    <div className="space-y-3">
      <Card padding="none">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border">
          <span className="text-[13px] font-semibold text-ink">
            {mine.length} {mine.length === 1 ? 'entry' : 'entries'} waiting{mine.length > 0 && ` · ${formatKsh(total)}`}
          </span>
          {mine.length > 0 && (
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy || !pickedIds.length} onClick={() => setRejecting(pickedIds)}>
                Reject {pickedIds.length || ''}
              </Button>
              <Button icon={<CheckCheck className="w-3.5 h-3.5" />} disabled={busy}
                onClick={() => void decide(pickedIds.length ? pickedIds : mine.map((e) => e.id), 'approved')}>
                {pickedIds.length ? `Approve ${pickedIds.length}` : `Approve all ${mine.length}`}
              </Button>
            </div>
          )}
        </div>
        {mine.length === 0 ? (
          loading ? <LoaderBlock label="Loading" compact /> : <EmptyState icon={<CheckCheck className="w-5 h-5" />} title="Nothing waiting"
            description={canManage
              ? 'Work submitted by supervisors and workers shows here for approval.'
              : 'Work your team submits for themselves shows here for you to approve.'} />
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                  <th className="px-3 py-2">
                    <input type="checkbox" aria-label="Pick all" checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(mine.map((e) => e.id)))} />
                  </th>
                  <th className="px-3 py-2 font-semibold">Worker</th>
                  <th className="px-3 py-2 font-semibold">Day</th>
                  <th className="px-3 py-2 font-semibold">Kind of work</th>
                  <th className="px-3 py-2 font-semibold text-right">Quantity</th>
                  <th className="px-3 py-2 font-semibold text-right">Amount</th>
                  <th className="px-3 py-2 font-semibold">Recorded by</th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>{mine.map((e) => row(e, true))}</tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      {forPayroll.length > 0 && (
        <Card padding="none">
          <div className="flex items-center gap-2 p-3 border-b border-border">
            <Hourglass className="w-4 h-4 text-muted-foreground" />
            <span className="text-[13px] font-semibold text-ink">Waiting for payroll ({forPayroll.length})</span>
            <span className="text-[11.5px] text-muted-foreground">What you submitted; you can still change it in Record work until it is approved.</span>
          </div>
          <TableScroll>
            <table className="w-full text-xs">
              <tbody>{forPayroll.map((e) => row(e, false))}</tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      {rejecting && (
        <Modal open onClose={() => setRejecting(null)} title={`Reject ${rejecting.length === 1 ? 'this work' : `${rejecting.length} entries`}`} size="md" closeOnBackdrop={!busy}>
          <div className="space-y-3 text-xs text-ink">
            <p>Say why. Whoever submitted it sees the reason and can correct it and send it again.</p>
            <textarea aria-label="Reason" className="w-full rounded-lg border border-border p-2" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRejecting(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void decide(rejecting, 'rejected', reason)} disabled={busy || !reason.trim()}>Reject</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
