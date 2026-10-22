import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card } from '../UI';
import { LoaderBlock } from '../UI/FigbloomLoader';
import { inputClass, labelClass } from '../Perfomance/kpis/shared';
import { WEEK_DAYS, clockLabel, workDaysLabel } from '../../lib/attendance';
import {
  DEFAULT_SCHEDULE,
  loadSchedules,
  removeSchedule,
  saveSchedule,
  type WorkSchedule,
  type WorkScheduleInput,
} from '../../lib/attendanceApi';
import { loadBranches, type Branch } from '../../lib/branches';
import WorkDaysMismatch from './WorkDaysMismatch';

/**
 * The work schedule tab: the company's (the working days, start and end time and grace before someone is late) and a
 * branch's own, which overrides it for that branch's staff. Without one the company works Monday to Friday, 08:00 to
 * 17:00, late after 08:30.
 */
export default function WorkSchedules() {
  const [schedules, setSchedules] = useState<WorkSchedule[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [adding, setAdding] = useState('');

  const reload = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([loadSchedules(), loadBranches().catch(() => [] as Branch[])]);
      setSchedules(s);
      setBranches(b);
    } catch (e) {
      toast.error((e as Error).message);
      setSchedules((x) => x ?? []);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (!schedules) return <LoaderBlock label="Loading" compact />;

  const company = schedules.find((s) => s.branch_id === null) ?? null;
  const companyFields: WorkScheduleInput = company ?? DEFAULT_SCHEDULE;
  const overrides = schedules.filter((s) => s.branch_id !== null);
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? 'A branch';
  const withoutOwn = branches.filter((b) => b.active && !overrides.some((o) => o.branch_id === b.id));

  return (
    <div className="space-y-4">
      <WorkDaysMismatch
        refreshKey={schedules}
        fixHint="Make them match (the leave and payroll work week is in Settings → Company profile → Work week), unless the difference is intended."
      />
      <ScheduleForm
        title="Company schedule"
        hint={company ? undefined : 'Not set yet: the company works Monday to Friday, 8:00 am to 5:00 pm.'}
        initial={companyFields}
        onSave={async (f) => {
          await saveSchedule(company?.id ?? null, null, f);
          toast.success('Work schedule saved');
          await reload();
        }}
      />

      {overrides.map((o) => (
        <ScheduleForm
          key={o.id}
          title={`${branchName(o.branch_id)}'s own schedule`}
          initial={o}
          onSave={async (f) => {
            await saveSchedule(o.id, o.branch_id, f);
            toast.success('Work schedule saved');
            await reload();
          }}
          onRemove={async () => {
            await removeSchedule(o.id);
            toast.success(`${branchName(o.branch_id)} follows the company schedule again`);
            await reload();
          }}
        />
      ))}

      {withoutOwn.length > 0 && (
        <Card padding="sm">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <div className="min-w-0">
              <label htmlFor="schedule-branch" className={labelClass}>Give a branch its own schedule</label>
              <select id="schedule-branch" className={inputClass} value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Choose a branch</option>
                {withoutOwn.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <Button
              variant="secondary"
              disabled={!adding}
              onClick={async () => {
                try {
                  await saveSchedule(null, adding, {
                    work_days: companyFields.work_days,
                    start_time: companyFields.start_time,
                    end_time: companyFields.end_time,
                    grace_minutes: companyFields.grace_minutes,
                  });
                  setAdding('');
                  await reload();
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Add
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

export function ScheduleForm({ title, hint, initial, onSave, onRemove }: {
  title: string;
  hint?: string;
  initial: WorkScheduleInput;
  onSave: (fields: WorkScheduleInput) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const [days, setDays] = useState<number[]>(initial.work_days);
  const [start, setStart] = useState(initial.start_time);
  const [end, setEnd] = useState(initial.end_time);
  const [grace, setGrace] = useState(String(initial.grace_minutes));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = title.replace(/\W+/g, '-').toLowerCase();

  const toggle = (d: number) => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort((a, b) => a - b)));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const g = Number(grace);
    if (days.length === 0) return setProblem('Choose at least one working day');
    if (!start || !end || end <= start) return setProblem('The end time must be after the start time');
    if (!Number.isInteger(g) || g < 0 || g > 240) return setProblem('Grace must be a whole number of minutes from 0 to 240');
    void run(() => onSave({ work_days: days, start_time: start, end_time: end, grace_minutes: g }));
  };

  const lateAfter = (() => {
    const [h, m] = start.split(':').map(Number);
    const total = h * 60 + m + (Number(grace) || 0);
    return Number.isNaN(total) ? '' : clockLabel(`${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`);
  })();

  return (
    <Card padding="sm" className="space-y-3" aria-label={title}>
      <div>
        <div className="text-[13px] font-semibold text-ink">{title}</div>
        <div className="text-[11.5px] text-muted-foreground">
          {hint ?? `${workDaysLabel(days)}, ${clockLabel(start)} to ${clockLabel(end)}`}
          {lateAfter && ` · late after ${lateAfter}`}
        </div>
      </div>
      <fieldset>
        <legend className={labelClass}>Working days</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEK_DAYS.map((d) => {
            const on = days.includes(d.iso);
            return (
              <button
                key={d.iso}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(d.iso)}
                className={`px-3 py-1.5 rounded-pill text-[12px] font-semibold border transition-colors ${
                  on ? 'bg-brand text-white border-brand' : 'bg-white text-muted-foreground border-border hover:text-ink'
                }`}
              >
                {d.short}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="min-w-0">
          <label htmlFor={`${id}-start`} className={labelClass}>Start time</label>
          <input id={`${id}-start`} type="time" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-end`} className={labelClass}>End time</label>
          <input id={`${id}-end`} type="time" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-grace`} className={labelClass}>Grace (minutes before late)</label>
          <input id={`${id}-grace`} type="number" min={0} max={240} className={inputClass} value={grace} onChange={(e) => setGrace(e.target.value)} />
        </div>
      </div>
      {problem && <p role="alert" className="text-[12px] text-status-danger">{problem}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        {onRemove && <Button variant="ghost" disabled={busy} onClick={() => void run(onRemove)}>Use the company schedule</Button>}
        <Button disabled={busy} onClick={save}>Save</Button>
      </div>
    </Card>
  );
}
