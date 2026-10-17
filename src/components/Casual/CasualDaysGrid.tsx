import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCheck, ChevronLeft, ChevronRight, Lock, Upload } from 'lucide-react';
import { Button, Card, EmptyState, TableScroll } from '../UI';
import { approveDays, loadDays, setDay } from '../../lib/casualApi';
import {
  addDays, casualName, dayTotals, formatKsh, onBooks, shortDay, today, weekDays, weekStart,
  type CasualDay, type CasualWorker, type DayPortion,
} from '../../lib/casualPay';
import CasualUploadModal from './CasualUploadModal';

// The week's register: a row per casual, a column per day, Full day / Half day / Absent in each cell. Supervisors
// and payroll fill it in; payroll's entries count at once, a supervisor's wait for payroll's approval. Days in an
// approved pay run are locked.

const PORTION_LABEL: Record<DayPortion, string> = { full: 'Full day', half: 'Half day', absent: 'Absent' };

interface Props {
  casuals: CasualWorker[];
  canApprove: boolean;
  onChanged?: () => void;
  /** days only, no daily rate or amounts (a supervisor in the staff portal) */
  hideMoney?: boolean;
}

export default function CasualDaysGrid({ casuals, canApprove, onChanged, hideMoney = false }: Props) {
  const [monday, setMonday] = useState(() => weekStart(today()));
  const [days, setDays] = useState<CasualDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const week = useMemo(() => weekDays(monday), [monday]);
  const now = today();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setDays(await loadDays(week[0], week[6]));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [week]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const byKey = useMemo(() => new Map(days.map((d) => [`${d.employee_number}|${d.work_date}`, d])), [days]);
  // this week's casuals: on the books for at least one of its days
  const rows = useMemo(() => casuals.filter((c) => week.some((d) => onBooks(c, d))), [casuals, week]);
  const waiting = days.filter((d) => d.status === 'submitted');

  const change = async (c: CasualWorker, day: string, value: string) => {
    const key = `${c.employee_number}|${day}`;
    setSaving(key);
    try {
      await setDay(c.employee_number, day, (value || null) as DayPortion | null, byKey.get(key));
      await reload();
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const approveWeek = async () => {
    try {
      await approveDays(waiting.map((d) => d.id));
      toast.success(`${waiting.length} ${waiting.length === 1 ? 'day' : 'days'} approved`);
      await reload();
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card padding="none">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border">
        <Button variant="secondary" aria-label="Previous week" onClick={() => setMonday(addDays(monday, -7))} icon={<ChevronLeft className="w-3.5 h-3.5" />}>
          <span className="sr-only">Previous week</span>
        </Button>
        <span className="text-[13px] font-semibold text-ink">Week of {shortDay(monday)}</span>
        <Button variant="secondary" aria-label="Next week" disabled={addDays(monday, 7) > now} onClick={() => setMonday(addDays(monday, 7))} icon={<ChevronRight className="w-3.5 h-3.5" />}>
          <span className="sr-only">Next week</span>
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {canApprove && waiting.length > 0 && (
            <Button icon={<CheckCheck className="w-3.5 h-3.5" />} onClick={() => void approveWeek()}>
              Approve {waiting.length} waiting {waiting.length === 1 ? 'day' : 'days'}
            </Button>
          )}
          <Button variant="secondary" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => setUploading(true)}>Upload days</Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<CheckCheck className="w-5 h-5" />} title={loading ? 'Loading...' : 'No casual workers this week'}
          description={loading ? undefined : 'Casuals show here from their start date until they finish.'} />
      ) : (
        <TableScroll>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                <th className="px-3 py-2 font-semibold">Casual worker</th>
                {week.map((d) => <th key={d} className="px-2 py-2 font-semibold whitespace-nowrap">{shortDay(d)}</th>)}
                <th className="px-3 py-2 font-semibold text-right">Week</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const mine = week.map((d) => byKey.get(`${c.employee_number}|${d}`)).filter((d): d is CasualDay => !!d);
                const t = dayTotals(mine);
                return (
                  <tr key={c.employee_number} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">{casualName(c)}</div>
                      {!hideMoney && <div className="text-[10.5px] text-subtle">{formatKsh(c.daily_rate)} a day</div>}
                    </td>
                    {week.map((d) => {
                      const key = `${c.employee_number}|${d}`;
                      const entry = byKey.get(key);
                      const locked = !!entry && (!!entry.pay_run_id || !!entry.paid_at);
                      const off = d > now || !onBooks(c, d);
                      return (
                        <td key={d} className="px-1.5 py-1.5">
                          <div className="flex items-center gap-1">
                            <select
                              aria-label={`${casualName(c)}, ${shortDay(d)}`}
                              value={entry?.portion ?? ''}
                              disabled={off || locked || saving === key}
                              onChange={(e) => void change(c, d, e.target.value)}
                              className={`w-[88px] rounded-md border px-1 py-1 text-[11px] disabled:bg-secondary ${
                                entry?.portion === 'full' ? 'border-brand text-brand' : entry?.portion === 'half' ? 'border-status-info text-status-info' : 'border-border text-ink'
                              }`}
                            >
                              <option value="">{off ? '' : '-'}</option>
                              {(['full', 'half', 'absent'] as const).map((p) => <option key={p} value={p}>{PORTION_LABEL[p]}</option>)}
                            </select>
                            {locked && <Lock className="w-3 h-3 text-subtle" aria-label="In a pay run" />}
                            {entry?.status === 'submitted' && (
                              <span className="w-1.5 h-1.5 rounded-full bg-orange" title="Waiting for payroll's approval" aria-label="Waiting for approval" />
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {!hideMoney && <div className="font-semibold text-ink">{formatKsh(t.amount)}</div>}
                      <div className="text-[10.5px] text-subtle">{t.full + t.half / 2} {t.full + t.half / 2 === 1 ? 'day' : 'days'}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
      <p className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
        An orange dot: waiting for payroll&apos;s approval. A lock: in an approved pay run, so it can&apos;t change.
      </p>

      {uploading && (
        <CasualUploadModal open kind="days" casuals={casuals} onClose={() => setUploading(false)} onDone={() => { void reload(); onChanged?.(); }} />
      )}
    </Card>
  );
}
