import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardList, Lock, Pencil } from 'lucide-react';
import { Card, EmptyState, StatusPill } from '../../UI';
import { formatKsh, longDate } from '../../../lib/casualPay';
import { loadMyEntries } from '../../../lib/myWorkApi';
import { formatQty, monthOf, type WorkType } from '../../../lib/pieceRate';
import {
  MY_STATE_LABEL, MY_STATE_TONE, canEditEntry, dayWindow, entryLocked, entryState, groupByDay, monthChoices, type MyEntry,
} from '../../../lib/myWork';
import { LoaderBlock } from '../../UI/FigbloomLoader';

// My entries, by day, with where each stands: draft, waiting, approved, rejected (with the reason) or reopened.
// Drafts and rejected work can be corrected and sent again (in Record my work); approved work and anything in a month
// whose payroll is approved is read-only.

interface Props {
  employeeNumber: string;
  types: WorkType[];
  today: string;
  pastDays: number;
  closedMonths: string[];
  /** opens Record my work on this day */
  onEdit: (day: string) => void;
}

export default function MyEntries({ employeeNumber, types, today, pastDays, closedMonths, onEdit }: Props) {
  const months = useMemo(() => monthChoices(today, 12), [today]);
  const [month, setMonth] = useState(months[0].value);
  const [entries, setEntries] = useState<MyEntry[] | null>(null);
  const { min } = dayWindow(today, pastDays);

  useEffect(() => {
    let live = true;
    setEntries(null);
    const { from, to } = monthOf(month);
    loadMyEntries(employeeNumber, from, to)
      .then((e) => live && setEntries(e))
      .catch((err) => {
        if (!live) return;
        toast.error((err as Error).message);
        setEntries([]);
      });
    return () => {
      live = false;
    };
  }, [employeeNumber, month]);

  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const days = useMemo(() => groupByDay(entries ?? []), [entries]);

  return (
    <div className="space-y-3">
      <Card padding="sm">
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          Month
          <select aria-label="Month" className="rounded-lg border border-border px-2 py-1.5" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      </Card>

      {entries === null || days.length === 0 ? (
        <Card>
          {entries === null ? <LoaderBlock label="Loading" compact /> : <EmptyState icon={<ClipboardList className="w-5 h-5" />} title="No work recorded this month"
            description="Work you record, and work your supervisor records for you, shows here." />}
        </Card>
      ) : (
        <ul className="list-none m-0 p-0 space-y-3">
          {days.map((d) => {
            // a day's drafts and rejected work open in Record my work, while the day is still within the limit
            const editable = d.entries.some((e) => canEditEntry(e, closedMonths)) && d.day >= min && d.day <= today;
            return (
              <li key={d.day}>
                <Card padding="sm">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="text-[13px] font-bold text-ink">{longDate(d.day)}</span>
                    <span className="ml-auto text-[12px] text-ink">
                      {formatKsh(d.approved)} approved{d.waiting > 0 && <span className="text-muted-foreground"> · {formatKsh(d.waiting)} waiting</span>}
                    </span>
                  </div>
                  <ul className="list-none m-0 p-0 divide-y divide-border">
                    {d.entries.map((e) => {
                      const t = typeById.get(e.work_type_id);
                      const state = entryState(e);
                      const locked = entryLocked(e, closedMonths);
                      return (
                        <li key={e.id} className="py-1.5 text-[12.5px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-ink">{t?.name ?? 'Work'}</span>
                            <span className="text-muted-foreground">{formatQty(e.quantity)} {t?.unit ?? ''} × {formatKsh(e.rate)}</span>
                            {e.source !== 'self' && <span className="text-[11px] text-subtle">recorded for you</span>}
                            {(state === 'approved' || locked) && <Lock className="w-3 h-3 text-muted-foreground" aria-label="Read-only" />}
                            <span className="ml-auto font-semibold text-ink">{formatKsh(e.amount)}</span>
                            <StatusPill label={locked && e.paid_out_at ? 'Paid out' : MY_STATE_LABEL[state]} tone={MY_STATE_TONE[state]} />
                          </div>
                          {state === 'rejected' && e.rejection_reason && (
                            <p className="m-0 mt-0.5 text-[11.5px] text-status-danger">Not approved: {e.rejection_reason}</p>
                          )}
                          {state === 'reopened' && <p className="m-0 mt-0.5 text-[11.5px] text-muted-foreground">Payroll reopened this to correct it.</p>}
                        </li>
                      );
                    })}
                  </ul>
                  {editable && (
                    <div className="mt-1.5 text-right">
                      <button type="button" className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand" onClick={() => onEdit(d.day)}>
                        <Pencil className="w-3 h-3" /> Edit and submit
                      </button>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
