import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import StatusPill from '../UI/StatusPill';
import { addDays, nairobiToday } from '../../lib/attendance';
import {
  MISSED_SCAN_STATUS_LABEL,
  MISSED_SCAN_STATUS_TONE,
  cancelMissedScan,
  loadMissedScans,
  missedScanDayLabel,
  missedScanTimes,
  missedScanWaitingOn,
  type MissedScan,
} from '../../lib/missedScanApi';
import MissedScanForm from './MissedScanForm';

/** How many of the person's own recent requests show under the clock card. */
const SHOWN = 5;

/**
 * Under the staff portal's clock card (migration 20261025100000): "Forgot to scan?" and the person's own recent
 * missed-scan requests, waiting (with Cancel) or decided (with who decided and any comment).
 */
export default function MyMissedScans() {
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<MissedScan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await loadMissedScans({ from: addDays(nairobiToday(), -31) });
      setMine(all.filter((m) => m.mine && m.status !== 'cancelled').slice(0, SHOWN));
    } catch {
      setMine([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async (m: MissedScan) => {
    setBusy(m.id);
    try {
      await cancelMissedScan(m.id);
      toast.success('Request cancelled');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3">
      <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => setOpen(true)}>
        Forgot to scan?
      </button>
      {mine.length > 0 && (
        <ul className="mt-2 space-y-1.5 list-none p-0 m-0" aria-label="Your missed-scan requests">
          {mine.map((m) => (
            <li key={m.id} className="text-xs text-gray-600 flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusPill label={MISSED_SCAN_STATUS_LABEL[m.status]} tone={MISSED_SCAN_STATUS_TONE[m.status]} />
              <span>
                {missedScanDayLabel(m.day)}: {missedScanTimes(m)}
                {m.status === 'pending' && ` · waiting for ${missedScanWaitingOn(m)}`}
                {m.status !== 'pending' && m.decidedByName && ` · by ${m.decidedByName}`}
                {m.comment && ` · "${m.comment}"`}
              </span>
              {m.status === 'pending' && (
                <button
                  type="button"
                  className="font-semibold text-gray-500 hover:text-status-danger disabled:opacity-50"
                  disabled={busy === m.id}
                  aria-label={`Cancel missed-scan request for ${missedScanDayLabel(m.day)}`}
                  onClick={() => void cancel(m)}
                >
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <MissedScanForm open={open} onClose={() => setOpen(false)} onSent={load} />
    </div>
  );
}
