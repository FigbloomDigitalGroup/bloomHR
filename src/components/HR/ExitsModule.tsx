import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogOut, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, EmployeePicker, EmptyState, Modal, StatusPill, TabBar } from '../UI';
import { formatDay, parseDay } from '../../lib/contract';
import { DEFAULT_NOTICE_DAYS, OPEN_STATUSES, REASON_CATEGORIES, STATUS_LABEL, addDays, listExits, reasonLabel, startExit, today, type ExitKind, type ExitRecord } from '../../lib/exits';
import ExitDetail, { STATUS_TONE } from './ExitDetail';
import { LoaderBlock } from '../UI/FigbloomLoader';

const input = 'w-full border border-border rounded-xl px-3 py-2.5 text-[12.5px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/40';
const filters = [
  { id: 'open', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'all', label: 'All' },
];

function StartExitModal({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: (id: string) => void }) {
  const [kind, setKind] = useState<ExitKind>('termination');
  const [employee, setEmployee] = useState('');
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [noticeGiven, setNoticeGiven] = useState(today());
  const [noticeDays, setNoticeDays] = useState(String(DEFAULT_NOTICE_DAYS));
  const [lastDay, setLastDay] = useState(addDays(today(), DEFAULT_NOTICE_DAYS));
  const [noticePay, setNoticePay] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee || !lastDay || (kind === 'termination' && !category)) return;
    setBusy(true);
    try {
      const exit = await startExit({
        employee_number: employee,
        kind,
        reason_category: kind === 'termination' ? category : null,
        reason: reason.trim() || null,
        notice_given_on: noticeGiven,
        notice_days: noticeDays === '' ? null : Number(noticeDays),
        last_working_day: lastDay,
        notice_pay: kind === 'termination' && noticePay,
      });
      const what = kind === 'termination' ? 'Termination' : 'Resignation';
      toast.success(exit.status === 'approved' ? `${what} started and approved` : `${what} started: it now needs approval by HR`);
      onStarted(exit.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the exit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Start an exit" size="xl">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-2" role="radiogroup" aria-label="Kind of exit">
          {(['termination', 'resignation'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`flex-1 rounded-xl border px-3 py-2 text-[12.5px] font-semibold ${kind === k ? 'border-brand bg-green-tint text-brand' : 'border-border text-muted-foreground'}`}
            >
              {k === 'termination' ? 'Termination' : 'Resignation (on their behalf)'}
            </button>
          ))}
        </div>
        <EmployeePicker label="Employee" value={employee} onChange={(e) => setEmployee(e?.employeeNumber ?? '')} required />
        {kind === 'termination' && (
          <div>
            <label htmlFor="exit-category" className="block text-xs font-semibold text-ink mb-1">Reason</label>
            <select id="exit-category" className={input} value={category} onChange={(e) => setCategory(e.target.value)} required>
              <option value="">Choose…</option>
              {REASON_CATEGORIES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="exit-details" className="block text-xs font-semibold text-ink mb-1">Details</label>
          <textarea id="exit-details" rows={3} className={`${input} resize-none`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="exit-notice-given" className="block text-xs font-semibold text-ink mb-1">Notice given on</label>
            <input id="exit-notice-given" type="date" className={input} value={noticeGiven} onChange={(e) => setNoticeGiven(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="exit-notice-days" className="block text-xs font-semibold text-ink mb-1">Notice period (days)</label>
            <input id="exit-notice-days" type="number" min={0} max={365} className={input} value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} />
          </div>
          <div>
            <label htmlFor="exit-last-day" className="block text-xs font-semibold text-ink mb-1">Last working day</label>
            <input id="exit-last-day" type="date" className={input} min={noticeGiven} value={lastDay} onChange={(e) => setLastDay(e.target.value)} required />
          </div>
        </div>
        <Button type="button" variant="ghost" onClick={() => setLastDay(addDays(noticeGiven, Number(noticeDays) || 0))}>
          Last day = end of the notice period
        </Button>
        {kind === 'termination' && (
          <label className="flex items-start gap-2 text-[12.5px] text-ink">
            <input type="checkbox" className="mt-0.5" checked={noticePay} onChange={(e) => setNoticePay(e.target.checked)} />
            Pay in lieu of the notice they don’t work
          </label>
        )}
        <p className="m-0 text-[11px] text-subtle">Started by someone who can approve exits, it is approved at once; otherwise HR or an administrator approves it.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !employee || (kind === 'termination' && !category)}>{busy ? 'Starting…' : 'Start exit'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** HR Lifecycle > Exits: resignations and terminations, each through approval, clearance and final dues. */
export default function ExitsModule({ onRefresh }: { onRefresh?: () => void }) {
  const [exits, setExits] = useState<ExitRecord[] | null>(null);
  const [filter, setFilter] = useState('open');
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      setExits(await listExits());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load exits');
      setExits([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(
    () =>
      (exits ?? []).filter((x) =>
        filter === 'open' ? OPEN_STATUSES.includes(x.status) : filter === 'completed' ? x.status === 'completed' : true
      ),
    [exits, filter]
  );

  if (selected) {
    return (
      <ExitDetail
        exitId={selected}
        onBack={() => {
          setSelected(null);
          load();
        }}
        onChanged={onRefresh}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <TabBar items={filters} activeId={filter} onChange={setFilter} />
        <Button onClick={() => setStarting(true)} icon={<Plus className="w-3.5 h-3.5" />}>Start an exit</Button>
      </div>
      {exits === null ? (
        <LoaderBlock label="Loading exits" compact />
      ) : shown.length === 0 ? (
        <EmptyState icon={<LogOut className="w-4 h-4" />} title="No exits here" description="Resignations from the staff portal and terminations HR starts appear here." />
      ) : (
        <Card padding="none">
          <ul className="m-0 p-0 list-none divide-y divide-border">
            {shown.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => setSelected(x.id)} className="w-full text-left px-4 py-3 hover:bg-background flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-ink truncate">{x.employee_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {x.employee_number} · {reasonLabel(x)}
                    </div>
                  </div>
                  <div className="text-[11.5px] text-muted-foreground">Last day {formatDay(parseDay(x.last_working_day))}</div>
                  <StatusPill label={STATUS_LABEL[x.status]} tone={STATUS_TONE[x.status]} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <StartExitModal
        open={starting}
        onClose={() => setStarting(false)}
        onStarted={(id) => {
          setStarting(false);
          setSelected(id);
          onRefresh?.();
        }}
      />
    </div>
  );
}
