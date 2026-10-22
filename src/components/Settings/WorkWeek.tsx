import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import {
  DAY_NAMES,
  DAY_WORK_LABELS,
  DayWork,
  WorkWeek,
  daysPerWeek,
  describeWorkWeek,
  loadCompanyWorkWeek,
  saveCompanyWorkWeek,
  workWeekError,
} from '../../lib/workWeek';
import WorkDaysMismatch from '../Attendance/WorkDaysMismatch';

const selectClass = 'w-full rounded-tile border border-border bg-white px-2 py-1.5 text-[12px] text-ink outline-none focus:border-brand disabled:bg-secondary';

/** Seven day choices (full day / half day / day off), Monday first. */
export function WorkWeekPicker({ value, onChange, disabled = false }: { value: WorkWeek; onChange: (week: WorkWeek) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2" role="group" aria-label="Work week">
      {DAY_NAMES.map((name, i) => (
        <label key={name} className="block">
          <span className="block text-[11px] font-semibold text-ink mb-1">{name}</span>
          <select
            className={selectClass}
            value={String(value[i])}
            disabled={disabled}
            onChange={(e) => onChange(value.map((d, j) => (j === i ? (Number(e.target.value) as DayWork) : d)))}
            aria-label={name}
          >
            {([1, 0.5, 0] as DayWork[]).map((d) => (
              <option key={d} value={String(d)}>{DAY_WORK_LABELS[d]}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

/**
 * The company's work week. Leave in working days counts only these days, less public holidays; a department can
 * have its own (Settings → Departments). HR (Leave) and settings admins change it; everyone else sees it.
 */
export default function WorkWeekCard({ className = '' }: { className?: string }) {
  const { hasAnyPermission, loading: permissionsLoading } = usePermissions();
  const canEdit = !permissionsLoading && hasAnyPermission(['settings', 'leaves']);
  const [saved, setSaved] = useState<WorkWeek | null>(null);
  const [week, setWeek] = useState<WorkWeek | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadCompanyWorkWeek()
      .then((w) => {
        if (live) {
          setSaved(w);
          setWeek(w);
        }
      })
      .catch((e) => console.error('Could not load the work week:', e));
    return () => {
      live = false;
    };
  }, []);

  if (!saved || !week) return null;

  const problem = workWeekError(week);
  const changed = week.some((d, i) => d !== saved[i]);

  const save = async () => {
    setBusy(true);
    try {
      const w = await saveCompanyWorkWeek(week);
      setSaved(w);
      setWeek(w);
      toast.success('Work week saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={className}>
      <h2 className="m-0 text-[14px] font-bold text-ink">Work week</h2>
      <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">
        The days your company works. Leave counted in working days uses only these days, less public holidays; a half
        day counts half. A department can have its own (Settings → Departments).
      </p>
      <WorkWeekPicker value={week} onChange={setWeek} disabled={!canEdit} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[12.5px]" role="status" aria-live="polite">
          {problem ? (
            <span className="text-red-600">{problem}</span>
          ) : (
            <span className="text-ink">{describeWorkWeek(week)}: {daysPerWeek(week)} working days a week</span>
          )}
        </p>
        {canEdit && (
          <Button onClick={() => void save()} disabled={busy || !changed || !!problem}>
            {busy ? 'Saving...' : 'Save'}
          </Button>
        )}
      </div>
      <div className="mt-3">
        <WorkDaysMismatch
          refreshKey={saved}
          fixHint="Make them match (attendance schedules are on the Attendance page, Work schedule tab), unless the difference is intended."
        />
      </div>
    </Card>
  );
}
