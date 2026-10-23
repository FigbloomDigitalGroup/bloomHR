import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlarmClock, CalendarClock, Clock, LogIn, Plane, UserX } from 'lucide-react';
import { Button, Card, EmptyState, StatCard } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { dayLabel, nairobiToday, type AttendanceDay } from '../../lib/attendance';
import { loadAttendanceAccess, loadAttendanceDays } from '../../lib/attendanceApi';
import { loadEmployeeDirectory, type DirectoryEmployee } from '../../lib/employeeDirectory';
import {
  attendanceAnalytics,
  dashboardRange,
  hasAnyClockIn,
  minutesLabel,
  todaySnapshot,
} from '../../lib/attendanceStats';
import { BarList, ChartHeading, Sparkline } from './DashboardCharts';

// Attendance on the dashboard (FIG-1203): today's card on Overview and an Attendance section on Analytics, from one
// read of attendance_days. Only for people who can see attendance: HR and Reports see the company, a manager their team.

export type AttendanceDashboardData =
  | { state: 'hidden' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; scope: 'company' | 'team'; today: string; days: AttendanceDay[]; people: DirectoryEmployee[] };

/**
 * The dashboard's attendance data. `canOpen` is the Attendance screen's own module check (canOpenScreen('/attendance'));
 * then attendance_my_access decides: everyone's days (sees_attendance), a manager's team, or nothing to show.
 */
export function useAttendanceDashboard(canOpen: boolean): AttendanceDashboardData {
  const [data, setData] = useState<AttendanceDashboardData>({ state: 'hidden' });
  useEffect(() => {
    if (!canOpen) {
      setData({ state: 'hidden' });
      return;
    }
    let live = true;
    setData({ state: 'loading' });
    (async () => {
      const access = await loadAttendanceAccess();
      const scope = access.seesAll ? 'company' : access.team.length > 0 ? 'team' : null;
      if (!scope) {
        if (live) setData({ state: 'hidden' });
        return;
      }
      const today = nairobiToday();
      const range = dashboardRange(today);
      const [days, people] = await Promise.all([
        loadAttendanceDays(range.from, range.to),
        loadEmployeeDirectory().catch(() => [] as DirectoryEmployee[]),
      ]);
      if (live) setData({ state: 'ready', scope, today, days, people });
    })().catch((e) => {
      if (live) setData({ state: 'error', message: (e as Error).message || "Attendance couldn't be loaded" });
    });
    return () => {
      live = false;
    };
  }, [canOpen]);
  return data;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Before anyone has clocked in: how to start. */
function NoAttendanceYet() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={<CalendarClock className="w-[18px] h-[18px]" strokeWidth={2} />}
      title="No attendance yet"
      description="Once people clock in with a door scanner or the app, who arrived when shows here."
      action={<Button variant="secondary" onClick={() => navigate('/attendance')}>Set up attendance</Button>}
    />
  );
}

/** Overview: today's attendance at a glance, linking to the Attendance page's Today view. */
export function AttendanceTodayCard({ data }: { data: AttendanceDashboardData }) {
  const navigate = useNavigate();
  const snap = useMemo(() => (data.state === 'ready' ? todaySnapshot(data.days, data.today) : null), [data]);
  if (data.state === 'hidden') return null;
  const team = data.state === 'ready' && data.scope === 'team';
  return (
    <Card data-testid="attendance-today-card">
      <ChartHeading
        title={team ? 'Your team: attendance today' : 'Attendance today'}
        subtitle={snap ? (snap.averageArrival === null ? 'Nobody has arrived yet' : `Average arrival ${minutesLabel(snap.averageArrival)}`) : undefined}
        action={
          <button type="button" onClick={() => navigate('/attendance')} className="text-[12px] font-semibold text-brand hover:underline whitespace-nowrap">
            Open attendance →
          </button>
        }
      />
      {data.state === 'loading' ? (
        <div className="flex justify-center py-6"><FigbloomLoader label="Loading" compact /></div>
      ) : data.state === 'error' ? (
        <p role="alert" className="text-[12px] text-status-danger">{data.message}</p>
      ) : !hasAnyClockIn(data.days) ? (
        <NoAttendanceYet />
      ) : snap && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard label="In" value={snap.in.toLocaleString()} icon={<LogIn className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="green" />
          <StatCard label="Late" value={snap.late.toLocaleString()} icon={<AlarmClock className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="orange" />
          <StatCard label="Not in yet" value={snap.notIn.toLocaleString()} icon={<UserX className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="danger" />
          <StatCard label="On leave" value={snap.leave.toLocaleString()} icon={<Plane className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="info" />
        </div>
      )}
    </Card>
  );
}

/** Analytics: the attendance rate, punctuality, arrival times, late arrivals and departments. */
export function AttendanceAnalyticsSection({ data }: { data: AttendanceDashboardData }) {
  const ready = data.state === 'ready' ? data : null;
  const byNumber = useMemo(() => new Map((ready?.people ?? []).map((p) => [p.employeeNumber, p])), [ready]);
  const stats = useMemo(
    () => (ready ? attendanceAnalytics(ready.days, ready.today, (emp) => byNumber.get(emp)?.department) : null),
    [ready, byNumber]
  );
  if (data.state === 'hidden') return null;
  const team = ready?.scope === 'team';

  const heading = (
    <div className="lg:col-span-2 pt-2">
      <h2 className="text-[14px] font-bold text-ink">Attendance{team ? ': your team' : ''}</h2>
      <p className="text-[11.5px] text-muted-foreground mt-0.5">
        {team ? 'You and the people who report to you. ' : ''}Rates count working days only: days off, holidays, leave and days before attendance counts are left out.
      </p>
    </div>
  );

  if (!ready || !stats) {
    return (
      <section className="lg:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch" aria-label="Attendance" data-testid="attendance-analytics">
        {heading}
        <Card className="lg:col-span-2">
          {data.state === 'error'
            ? <p role="alert" className="text-[12px] text-status-danger">{data.message}</p>
            : <div className="h-24 flex items-center justify-center"><FigbloomLoader label="Loading" compact /></div>}
        </Card>
      </section>
    );
  }

  if (!hasAnyClockIn(ready.days)) {
    return (
      <section className="lg:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch" aria-label="Attendance" data-testid="attendance-analytics">
        {heading}
        <Card className="lg:col-span-2"><NoAttendanceYet /></Card>
      </section>
    );
  }

  const nameOf = (emp: string) => byNumber.get(emp)?.fullName || emp;
  const firstDay = stats.daily[0];
  const lastDay = stats.daily[stats.daily.length - 1];
  const firstArrival = stats.arrivalTrend[0];
  const lastArrival = stats.arrivalTrend[stats.arrivalTrend.length - 1];
  const pThis = stats.punctualityThisMonth;
  const pLast = stats.punctualityLastMonth;
  const pointsChange = pThis.share !== null && pLast.share !== null ? pThis.share - pLast.share : null;
  const lateTotal = stats.lateByWeekday.reduce((t, r) => t + r.value, 0);

  return (
    <section className="lg:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch" aria-label="Attendance" data-testid="attendance-analytics">
      {heading}

      <Card>
        <ChartHeading title="Attendance rate, last 30 days" subtitle="Working days people came in, not counting today" />
        {stats.rate.rate === null ? (
          <p className="text-[12px] text-muted-foreground">No working days in the last 30 days.</p>
        ) : (
          <>
            <p className="text-[12px] text-muted-foreground mb-2">
              <span className="text-2xl font-bold text-ink mr-1.5">{stats.rate.rate}%</span>
              {plural(stats.rate.attended, 'day', 'days')} attended of {plural(stats.rate.working, 'working day', 'working days')}
            </p>
            {firstDay && lastDay && stats.daily.length > 1 && (
              <Sparkline
                values={stats.daily.map((d) => d.rate ?? 0)}
                label={`Attendance rate each working day: ${firstDay.rate}% on ${dayLabel(firstDay.day)}, ${lastDay.rate}% on ${dayLabel(lastDay.day)}`}
              />
            )}
            {lastDay && <p className="text-[11.5px] text-muted-foreground mt-1">Latest working day ({dayLabel(lastDay.day)}): {lastDay.rate}%</p>}
          </>
        )}
      </Card>

      <Card>
        <ChartHeading title="Punctuality" subtitle="Arrivals on time, this month against last month" />
        {pThis.share === null && pLast.share === null ? (
          <p className="text-[12px] text-muted-foreground">No arrivals this month or last month.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[11.5px] font-semibold text-muted-foreground">This month</dt>
              <dd className="text-2xl font-bold text-ink">{pThis.share === null ? '—' : `${pThis.share}%`}</dd>
              <dd className="text-[11.5px] text-muted-foreground">{plural(pThis.onTime, 'arrival', 'arrivals')} on time of {pThis.arrivals.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] font-semibold text-muted-foreground">Last month</dt>
              <dd className="text-2xl font-bold text-ink">{pLast.share === null ? '—' : `${pLast.share}%`}</dd>
              <dd className="text-[11.5px] text-muted-foreground">{plural(pLast.onTime, 'arrival', 'arrivals')} on time of {pLast.arrivals.toLocaleString()}</dd>
            </div>
          </dl>
        )}
        {pointsChange !== null && (
          <p className="mt-2 text-[12px] text-gray-700">
            {pointsChange === 0 ? 'The same as last month.'
              : `${Math.abs(pointsChange)} ${Math.abs(pointsChange) === 1 ? 'point' : 'points'} ${pointsChange > 0 ? 'better' : 'worse'} than last month.`}
          </p>
        )}
      </Card>

      <Card>
        <ChartHeading title="Average arrival" subtitle="Clock-in time of those who came in, last 30 days" />
        {stats.averageArrival === null ? (
          <p className="text-[12px] text-muted-foreground">Nobody came in during the last 30 days.</p>
        ) : (
          <>
            <p className="text-[12px] text-muted-foreground mb-2">
              <span className="text-2xl font-bold text-ink mr-1.5">{minutesLabel(stats.averageArrival)}</span>
              on average
            </p>
            {firstArrival && lastArrival && stats.arrivalTrend.length > 1 && (
              <Sparkline
                values={stats.arrivalTrend.map((d) => d.minutes)}
                label={`Average arrival each day (higher is later): ${minutesLabel(firstArrival.minutes)} on ${dayLabel(firstArrival.day)}, ${minutesLabel(lastArrival.minutes)} on ${dayLabel(lastArrival.day)}`}
              />
            )}
          </>
        )}
      </Card>

      <Card>
        <ChartHeading title="Late arrivals by weekday" subtitle={`Last 30 days: ${plural(lateTotal, 'late arrival', 'late arrivals')}`} />
        {lateTotal === 0 ? (
          <p className="text-[12px] text-muted-foreground">Nobody was late in the last 30 days.</p>
        ) : (
          <BarList rows={stats.lateByWeekday} caption="Late arrivals by weekday" unit={['late arrival', 'late arrivals']} />
        )}
      </Card>

      <Card>
        <ChartHeading title="Most late arrivals this month" subtitle="The five people late most often" />
        {stats.topLate.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Nobody has been late this month.</p>
        ) : (
          <ol className="divide-y divide-gray-100" aria-label="Most late arrivals this month">
            {stats.topLate.map((p) => (
              <li key={p.employeeNumber} className="flex items-center gap-3 py-2">
                <Clock className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="text-[12.5px] text-gray-700 flex-1 min-w-0 truncate">{nameOf(p.employeeNumber)}</span>
                <span className="text-[12.5px] font-semibold text-ink tabular-nums">{plural(p.count, 'time', 'times')}</span>
                <span className="text-[11.5px] text-muted-foreground tabular-nums whitespace-nowrap">{p.minutes.toLocaleString()} min in all</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <ChartHeading title="Attendance rate by department" subtitle="Last 30 days, the highest first" />
        {stats.byDepartment.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No working days in the last 30 days.</p>
        ) : (
          <BarList
            rows={stats.byDepartment.map((d) => ({ name: d.name, value: d.rate ?? 0 }))}
            caption="Attendance rate by department"
            format={(v) => `${v}%`}
            max={100}
          />
        )}
      </Card>
    </section>
  );
}
