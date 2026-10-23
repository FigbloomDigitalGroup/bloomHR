import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import Modal from '../UI/Modal';
import { Button } from '../UI';
import { inputClass, labelClass } from '../Perfomance/kpis/shared';
import { nairobiToday } from '../../lib/attendance';
import {
  loadMissedScanRules,
  missedScanDayLabel,
  missedScanDays,
  missedScanProblem,
  requestMissedScan,
  type MissedScanRules,
} from '../../lib/missedScanApi';

/**
 * "Forgot to scan?" (migration 20261025100000): the person picks the day (today or up to the company's days back), the
 * time they actually came in and/or left, and why. It goes to their manager, else HR; the form says which.
 */
export default function MissedScanForm({ open, onClose, onSent }: {
  open: boolean;
  onClose: () => void;
  onSent?: () => void | Promise<void>;
}) {
  const [rules, setRules] = useState<MissedScanRules | null>(null);
  const [day, setDay] = useState(() => nairobiToday());
  const [cameIn, setCameIn] = useState('');
  const [left, setLeft] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setDay(nairobiToday());
    setCameIn('');
    setLeft('');
    setReason('');
    setProblem(null);
    loadMissedScanRules()
      .then((r) => live && setRules(r))
      .catch((e) => {
        if (!live) return;
        setRules({ daysBack: 7, approver: 'hr', approverName: 'HR' });
        setProblem((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [open]);

  const today = nairobiToday();
  const days = missedScanDays(rules?.daysBack ?? 0, today);

  const send = async () => {
    const p = missedScanProblem({ day, cameIn, left, reason });
    if (p) return setProblem(p);
    setProblem(null);
    setBusy(true);
    try {
      await requestMissedScan({ day, cameIn, left, reason });
      toast.success(`Sent to ${rules?.approverName ?? 'HR'} for approval`);
      onClose();
      await onSent?.();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Forgot to scan?" size="sm" closeOnBackdrop={false}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Tell us when you actually came in or left. {rules ? `It goes to ${rules.approverName} for approval.` : ''}
        </p>
        <div className="min-w-0">
          <label htmlFor="missed-scan-day" className={labelClass}>Day</label>
          <select id="missed-scan-day" className={inputClass} value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => <option key={d} value={d}>{missedScanDayLabel(d, today)}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label htmlFor="missed-scan-in" className={labelClass}>Came in</label>
            <input id="missed-scan-in" type="time" className={inputClass} value={cameIn} onChange={(e) => setCameIn(e.target.value)} />
          </div>
          <div className="min-w-0">
            <label htmlFor="missed-scan-out" className={labelClass}>Left</label>
            <input id="missed-scan-out" type="time" className={inputClass} value={left} onChange={(e) => setLeft(e.target.value)} />
          </div>
        </div>
        <p className="text-[11.5px] text-muted-foreground -mt-1">Fill in one or both.</p>
        <div className="min-w-0">
          <label htmlFor="missed-scan-reason" className={labelClass}>Reason</label>
          <textarea id="missed-scan-reason" rows={2} maxLength={300} className={inputClass} value={reason}
            onChange={(e) => setReason(e.target.value)} placeholder="e.g. Forgot to scan on arrival" />
        </div>
        {problem && <p role="alert" className="text-[12px] text-status-danger">{problem}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !rules} onClick={() => void send()}>{busy ? 'Sending…' : 'Send request'}</Button>
        </div>
      </div>
    </Modal>
  );
}
