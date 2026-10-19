import { useCallback, useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, EmptyState, PageHeader, StatusPill } from '../UI';
import { EXIT_TONE } from './ResignationCards';
import { formatDay, parseDay } from '../../lib/contract';
import {
  STATUS_LABEL,
  earliestLastDay,
  findOpenExit,
  loadMyExit,
  submitResignation,
  withdrawResignation,
  type ExitRecord,
  type MyExitState,
} from '../../lib/exits';

const input = 'w-full border border-border rounded-xl px-3 py-2.5 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/40';
const MAX_LETTER_BYTES = 10 * 1024 * 1024;

function ResignationStatus({ exit, onWithdraw, busy }: { exit: ExitRecord; onWithdraw: () => void; busy: boolean }) {
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-bold text-ink">Your resignation</div>
        <StatusPill label={STATUS_LABEL[exit.status]} tone={EXIT_TONE[exit.status]} />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        <div>
          <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Submitted</dt>
          <dd className="mt-0.5 text-[13.5px] text-ink">{formatDay(parseDay(exit.notice_given_on))}</dd>
        </div>
        <div>
          <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Last working day</dt>
          <dd className="mt-0.5 text-[13.5px] text-ink">{formatDay(parseDay(exit.last_working_day))}</dd>
        </div>
        {exit.reason && (
          <div className="sm:col-span-2">
            <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Reason</dt>
            <dd className="mt-0.5 text-[13.5px] text-ink whitespace-pre-wrap">{exit.reason}</dd>
          </div>
        )}
        {exit.decision_note && (
          <div className="sm:col-span-2">
            <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">HR’s note</dt>
            <dd className="mt-0.5 text-[13.5px] text-ink whitespace-pre-wrap">{exit.decision_note}</dd>
          </div>
        )}
      </dl>
      {exit.status === 'requested' && (
        <div className="mt-4">
          <Button variant="secondary" onClick={onWithdraw} disabled={busy}>
            Withdraw my resignation
          </Button>
        </div>
      )}
      {(exit.status === 'approved' || exit.status === 'clearance') && (
        <p className="mt-4 mb-0 text-[12px] text-muted-foreground">
          HR will take you through clearance (returning company property, handover) before your last day.
        </p>
      )}
    </Card>
  );
}

/** The staff portal's Resignation page: resign (giving at least the notice in your contract), then follow it. */
export default function MyResignation() {
  const [state, setState] = useState<MyExitState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastDay, setLastDay] = useState('');
  const [reason, setReason] = useState('');
  const [letter, setLetter] = useState<File | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await loadMyExit();
      setState(next);
      setLastDay((d) => d || earliestLastDay(next.noticeDays));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your resignation');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <EmptyState icon={<LogOut className="w-4 h-4" />} title="Could not load your resignation" description={error} />;
  if (!state) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  if (!state.employeeNumber) {
    return <EmptyState icon={<LogOut className="w-4 h-4" />} title="No employee record yet" description="Ask HR to add you to the company’s employee list with your work email." />;
  }

  const open = findOpenExit(state.exits);
  const earliest = earliestLastDay(state.noticeDays);
  const tooEarly = !!lastDay && lastDay < earliest;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirm || tooEarly || !lastDay) return;
    if (letter && letter.size > MAX_LETTER_BYTES) {
      toast.error('The letter is larger than 10 MB');
      return;
    }
    setBusy(true);
    try {
      await submitResignation(state.employeeNumber as string, { lastWorkingDay: lastDay, reason, letter });
      toast.success('Your resignation was sent to HR');
      setReason('');
      setLetter(null);
      setConfirm(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send your resignation');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    setBusy(true);
    try {
      await withdrawResignation(id);
      toast.success('Your resignation was withdrawn');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not withdraw your resignation');
    } finally {
      setBusy(false);
    }
  };

  const past = state.exits.filter((x) => x !== open);

  return (
    <div className="p-0 sm:p-6">
      <PageHeader title="Resignation" subtitle="Give notice that you are leaving, and follow it until your last day." />
      {open ? (
        <ResignationStatus exit={open} busy={busy} onWithdraw={() => withdraw(open.id)} />
      ) : (
        <Card className="mb-4">
          <form onSubmit={submit} className="space-y-4" aria-label="Resign">
            <p className="m-0 text-[12.5px] text-muted-foreground">
              Your notice period is <strong>{state.noticeDays} days</strong>, so your last working day can be{' '}
              <strong>{formatDay(parseDay(earliest))}</strong> at the earliest. HR may agree to an earlier day.
            </p>
            <div>
              <label htmlFor="resign-last-day" className="block text-xs font-semibold text-ink mb-1">
                Last working day
              </label>
              <input id="resign-last-day" type="date" className={input} min={earliest} value={lastDay} onChange={(e) => setLastDay(e.target.value)} required />
              {tooEarly && <p className="mt-1 mb-0 text-[11.5px] text-status-danger">That is within your notice period. Pick {formatDay(parseDay(earliest))} or later.</p>}
            </div>
            <div>
              <label htmlFor="resign-reason" className="block text-xs font-semibold text-ink mb-1">
                Reason (optional)
              </label>
              <textarea id="resign-reason" rows={4} className={`${input} resize-none`} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div>
              <label htmlFor="resign-letter" className="block text-xs font-semibold text-ink mb-1">
                Resignation letter (optional, PDF or image)
              </label>
              <input
                id="resign-letter"
                type="file"
                accept=".pdf,.doc,.docx,image/*"
                className="block w-full text-[12.5px] text-ink"
                onChange={(e) => setLetter(e.target.files?.[0] ?? null)}
              />
              <p className="mt-1 mb-0 text-[11px] text-subtle">Only you and HR can open it.</p>
            </div>
            <label className="flex items-start gap-2 text-[12.5px] text-ink">
              <input type="checkbox" className="mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              I am resigning from my job. HR will review it and let me know.
            </label>
            <Button type="submit" disabled={busy || !confirm || tooEarly || !lastDay}>
              {busy ? 'Sending…' : 'Send my resignation'}
            </Button>
          </form>
        </Card>
      )}
      {past.length > 0 && (
        <Card>
          <div className="text-[13px] font-bold text-ink mb-2">Earlier</div>
          <ul className="m-0 p-0 list-none space-y-2">
            {past.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-ink">
                <span>
                  Resignation of {formatDay(parseDay(x.notice_given_on))}, last day {formatDay(parseDay(x.last_working_day))}
                </span>
                <StatusPill label={STATUS_LABEL[x.status]} tone={EXIT_TONE[x.status]} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
