import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card } from '../UI';
import ConsoleStatRow, { ConsoleStat } from './ConsoleStat';
import BarList from './BarList';
import { statusLabel, type School, type SchoolTotals } from '../../lib/platformSchools';
import {
  ATTENTION_LABELS, activeWithin, activityBuckets, countBy, newPerWeek, schoolsNeedingAttention, topSchoolsByStudents,
} from '../../lib/consoleAnalytics';

// The numbers and charts above the schools list, worked out from the list itself (consoleAnalytics.ts).

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const n = (v: number) => v.toLocaleString('en-KE');

/** "2 overdue · 1 stalled setup · 3 no admin", or "nothing to look at" */
function attentionSub(reasons: string[][]): string {
  const count = (r: string) => reasons.filter((rs) => rs.includes(r)).length;
  const parts = [
    [count('overdue'), 'overdue'],
    [count('setup_stalled'), 'stalled setup'],
    [count('no_admin'), 'no admin'],
    [count('never_active'), 'never signed in'],
  ].filter(([c]) => (c as number) > 0).map(([c, what]) => `${c} ${what}`);
  return parts.length ? parts.join(' · ') : 'nothing to look at';
}

export default function SchoolsAnalytics({ schools, totals, now }: { schools: School[]; totals: SchoolTotals; now?: Date }) {
  const at = useMemo(() => now ?? new Date(), [now]);
  const charts = useMemo(
    () => ({
      perWeek: newPerWeek(schools.map((s) => s.created_at), 12, at),
      byStatus: countBy(schools, (s) => s.status, statusLabel),
      activity: activityBuckets(schools.map((s) => s.last_activity_at), at),
      top: topSchoolsByStudents(schools, 5),
      attention: schoolsNeedingAttention(schools),
      newLast30: schools.filter((s) => activeWithin(s.created_at, 30, at)).length,
      activeLast7: schools.filter((s) => activeWithin(s.last_activity_at, 7, at)).length,
      teachers: schools.reduce((sum, s) => sum + (Number(s.teachers) || 0), 0),
      parents: schools.reduce((sum, s) => sum + (Number(s.parents) || 0), 0),
    }),
    [schools, at]
  );

  return (
    <div className="space-y-3">
      <ConsoleStatRow label="School totals">
        <ConsoleStat label="Schools" value={n(totals.schools)} sub={`${n(charts.newLast30)} new in the last 30 days`} />
        <ConsoleStat label="Active" value={n(totals.active)}
          sub={`${pct(totals.active, totals.schools)}% of schools · ${n(charts.activeLast7)} signed in this week`} />
        <ConsoleStat label="Suspended" value={n(totals.suspended)} sub={totals.suspended ? 'cannot use Figbloom Schools' : 'none'} />
        <ConsoleStat label="Students" value={n(totals.students)} sub={`${n(charts.teachers)} teachers · ${n(charts.parents)} parents`} />
        <ConsoleStat label="Needs attention" value={n(charts.attention.length)} alarming={charts.attention.length > 0}
          sub={attentionSub(charts.attention.map((a) => a.reasons))} />
      </ConsoleStatRow>

      <div className="grid gap-3 lg:grid-cols-3">
        <BarList title="New schools per week" bars={charts.perWeek} labelWidth="w-24" empty="No new schools in the last 12 weeks." />
        <div className="space-y-3">
          <BarList title="Schools by status" bars={charts.byStatus} empty="No schools yet." />
          <BarList title="Last sign-in" bars={charts.activity} labelWidth="w-36" empty="No schools yet." />
        </div>
        <div className="space-y-3">
          <Card>
            <h2 className="text-sm font-semibold text-ink mb-3">Top schools by students</h2>
            {charts.top.length === 0 ? (
              <p className="text-xs text-muted-foreground">No students yet.</p>
            ) : (
              <ol className="space-y-1.5 text-xs" aria-label="Top schools by students">
                {charts.top.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className="w-4 text-muted-foreground tabular-nums">{i + 1}.</span>
                    <span className="flex-1 min-w-0 truncate text-ink" title={s.name}>{s.name}</span>
                    <span className="font-semibold text-ink tabular-nums">{n(s.students)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card>
            <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-orange-text-alt" aria-hidden="true" />
              Needs attention
              <span className="ml-auto text-xs font-normal text-muted-foreground">{charts.attention.length}</span>
            </h2>
            {charts.attention.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing needs attention.</p>
            ) : (
              <ul className="space-y-2 text-xs max-h-64 overflow-y-auto" aria-label="Needs attention">
                {charts.attention.map(({ school, reasons }) => (
                  <li key={school.id}>
                    <span className="block font-semibold text-ink truncate" title={school.name}>{school.name}</span>
                    <span className="block text-muted-foreground">{reasons.map((r) => ATTENTION_LABELS[r]).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
