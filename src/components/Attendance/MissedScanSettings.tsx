import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card } from '../UI';
import { inputClass, labelClass } from '../Perfomance/kpis/shared';
import {
  DEFAULT_MISSED_SCAN_SETTINGS,
  MAX_MISSED_SCAN_DAYS_BACK,
  loadMissedScanSettings,
  saveMissedScanSettings,
  type MissedScanApprover,
  type MissedScanSettings as Settings,
} from '../../lib/missedScanApi';

/** Work schedule tab: how far back a missed-scan request may go, and who approves it (migration 20261025100000). */
export default function MissedScanSettings() {
  const [saved, setSaved] = useState<Settings | undefined>(undefined);
  const [daysBack, setDaysBack] = useState('');
  const [approver, setApprover] = useState<MissedScanApprover>('manager');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadMissedScanSettings()
      .catch(() => DEFAULT_MISSED_SCAN_SETTINGS)
      .then((s) => {
        if (!live) return;
        setSaved(s);
        setDaysBack(String(s.daysBack));
        setApprover(s.approver);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!saved) return null;

  const n = Number(daysBack);
  const valid = daysBack.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= MAX_MISSED_SCAN_DAYS_BACK;
  const changed = !valid || n !== saved.daysBack || approver !== saved.approver;

  const save = async () => {
    if (!valid) return setProblem(`Choose 0 to ${MAX_MISSED_SCAN_DAYS_BACK} days`);
    setProblem(null);
    setBusy(true);
    try {
      const next = { daysBack: n, approver };
      await saveMissedScanSettings(next);
      setSaved(next);
      toast.success('Saved');
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="sm">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div className="min-w-0">
          <label htmlFor="missed-scan-days" className={labelClass}>Missed-scan requests: up to … days back</label>
          <input id="missed-scan-days" type="number" min={0} max={MAX_MISSED_SCAN_DAYS_BACK} step={1} className={inputClass}
            value={daysBack} onChange={(e) => setDaysBack(e.target.value)} />
        </div>
        <div className="min-w-0">
          <label htmlFor="missed-scan-approver" className={labelClass}>Approved by</label>
          <select id="missed-scan-approver" className={inputClass} value={approver} onChange={(e) => setApprover(e.target.value as MissedScanApprover)}>
            <option value="manager">Their manager, else HR</option>
            <option value="hr">HR only</option>
          </select>
        </div>
        <Button disabled={busy || !changed} onClick={() => void save()}>Save</Button>
      </div>
      <p className="text-[11.5px] text-muted-foreground mt-1">
        Staff who forgot to scan can ask for today or up to this many days back (0 = today only). Approving records the day as an HR correction.
      </p>
      {problem && <p role="alert" className="text-[12px] text-status-danger mt-1">{problem}</p>}
    </Card>
  );
}
