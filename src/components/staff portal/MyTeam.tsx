import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardList, Users } from 'lucide-react';
import { Card, EmptyState, PageHeader, StatusPill, TabBar, type TabBarItem } from '../UI';
import FigbloomLoader, { LoaderBlock } from '../UI/FigbloomLoader';
import { loadKpiAccess, loadKpis, loadPeriods, type Kpi, type KpiAccess, type KpiPeriod } from '../../lib/kpiApi';
import { loadOvertimePeople, loadWaitingOvertime, type OvertimeEntry, type OvertimePerson } from '../../lib/overtimeApi';
import { loadCasuals } from '../../lib/casualApi';
import type { CasualWorker } from '../../lib/casualPay';
import { loadTeamLeave, memberInitials, memberName, toKpiPerson, type TeamLeave, type TeamMember } from '../../lib/myTeamApi';
import Scorecards from '../Perfomance/kpis/Scorecards';
import AssignKpis from '../Perfomance/kpis/AssignKpis';
import OvertimeWeekGrid from '../Overtime/OvertimeWeekGrid';
import OvertimeWaiting from '../Overtime/OvertimeWaiting';
import CasualDaysGrid from '../Casual/CasualDaysGrid';
import LeaveAwaitingMe from '../Approvals/LeaveAwaitingMe';
import TaskWorkspace from '../Tasks/TaskWorkspace';
import TeamWork from '../PieceRate/TeamWork';
import { loadWorkPeople } from '../../lib/pieceRateApi';
import type { WorkPerson } from '../../lib/pieceRate';
import { useUrlParam } from '../../hooks/useUrlParam';
import MissedScanApprovals from '../Attendance/MissedScanApprovals';

// My team (staff portal): for a staff member who supervises others (migration 20261018900000). The same screens HR
// and managers use, limited to the supervisor's reports; the database decides what they may do (custom KPIs,
// overtime, casual days and leave approvals all already allow a supervisor, whatever their role).

type Tab = 'team' | 'tasks' | 'kpis' | 'overtime' | 'casual' | 'work' | 'leave' | 'missed';

export default function MyTeam({ team }: { team: TeamMember[] }) {
  // the tab is in the address (?view=kpis), so the phone's Back returns to the previous tab
  const [tabParam, setTab] = useUrlParam('view', 'team');
  const tab = tabParam as Tab;
  const [casuals, setCasuals] = useState<CasualWorker[]>([]);
  const [workers, setWorkers] = useState<WorkPerson[]>([]);

  useEffect(() => {
    // the casuals they supervise (none: no Casual days tab)
    loadCasuals().then(setCasuals).catch(() => setCasuals([]));
    // reports paid by work, piece rate or per job (none: no Work tab)
    loadWorkPeople().then((p) => setWorkers(p.filter((w) => w.is_team))).catch(() => setWorkers([]));
  }, []);
  const paidByWork = workers.filter((w) => w.pay_basis === 'work').length;

  const tabs = useMemo<TabBarItem[]>(() => [
    { id: 'team', label: 'Team' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'kpis', label: 'KPIs' },
    { id: 'overtime', label: 'Overtime' },
    ...(casuals.length ? [{ id: 'casual', label: 'Casual days' }] : []),
    ...(paidByWork ? [{ id: 'work', label: 'Work' }] : []),
    { id: 'leave', label: 'Leave' },
    { id: 'missed', label: 'Missed scans' },
  ], [casuals.length, paidByWork]);

  return (
    <div className="min-w-0 p-0 sm:p-2">
      <PageHeader
        title="My team"
        subtitle={<span>{team.length} {team.length === 1 ? 'person reports' : 'people report'} to you</span>}
      />
      <TabBar items={tabs} activeId={tab} onChange={(id) => setTab(id as Tab)} className="mb-4" />
      {tab === 'team' && <TeamList team={team} />}
      {tab === 'tasks' && <TaskWorkspace mode="staff" teamNumbers={team.map((m) => m.employee_number)} />}
      {tab === 'kpis' && <TeamKpis team={team} />}
      {tab === 'overtime' && <TeamOvertime />}
      {tab === 'casual' && casuals.length > 0 && <CasualDaysGrid casuals={casuals} canApprove={false} hideMoney />}
      {tab === 'work' && paidByWork > 0 && <TeamWork people={workers} />}
      {tab === 'leave' && (
        <div className="flex flex-col gap-4">
          <LeaveAwaitingMe showEmpty />
          <TeamOnLeave />
        </div>
      )}
      {tab === 'missed' && <MissedScanApprovals />}
    </div>
  );
}

function TeamList({ team }: { team: TeamMember[] }) {
  if (team.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Users size={20} />} title="Nobody reports to you" description="People show here once HR sets you as their manager." />
      </Card>
    );
  }
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 list-none p-0 m-0">
      {team.map((m) => (
        <li key={m.employee_number}>
          <Card padding="sm" className="flex items-center gap-3 h-full">
            {m.photo ? (
              <img src={m.photo} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
            ) : (
              <div aria-hidden className="w-11 h-11 rounded-full bg-secondary text-ink font-bold text-[13px] flex items-center justify-center shrink-0">
                {memberInitials(m)}
              </div>
            )}
            <div className="min-w-0">
              <p className="m-0 text-[13px] font-bold text-ink break-words">{memberName(m)}</p>
              <p className="m-0 text-[11.5px] text-muted-foreground break-words">
                {[m.job_title, m.department].filter(Boolean).join(' · ') || 'No job title yet'}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span className="text-[11px] text-subtle">{m.employee_number}</span>
                {m.worker_kind === 'casual' && <StatusPill label="Casual" tone="info" />}
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

type KpiView = 'scores' | 'assign';

function TeamKpis({ team }: { team: TeamMember[] }) {
  const [access, setAccess] = useState<KpiAccess | null>(null);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [periods, setPeriods] = useState<KpiPeriod[]>([]);
  const [view, setView] = useState<KpiView>('scores');
  const people = useMemo(() => team.map(toKpiPerson), [team]);

  useEffect(() => {
    (async () => {
      try {
        const [a, k, p] = await Promise.all([loadKpiAccess(), loadKpis(), loadPeriods()]);
        setKpis(k);
        setPeriods(p);
        setAccess(a);
      } catch (e) {
        toast.error((e as Error).message);
        setAccess({ manages: false, employeeNumber: null, team: [] });
      }
    })();
  }, []);

  if (!access) return <FigbloomLoader />;
  if (periods.length === 0) {
    return (
      <Card>
        <EmptyState icon={<ClipboardList size={20} />} title="No review periods yet" description="HR sets up review periods and the KPI library; you can then give your team their KPIs here." />
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <TabBar
        variant="pill"
        items={[{ id: 'scores', label: 'Progress and scores' }, { id: 'assign', label: 'Assign and edit' }]}
        activeId={view}
        onChange={(id) => setView(id as KpiView)}
      />
      {view === 'scores' && <Scorecards kpis={kpis} periods={periods} people={people} departments={[]} access={access} teamMode />}
      {view === 'assign' && (
        kpis.some((k) => !k.archived) ? (
          <AssignKpis kpis={kpis} periods={periods} people={people} departments={[]} access={access} teamMode />
        ) : (
          <Card>
            <EmptyState icon={<ClipboardList size={20} />} title="No KPIs in the library yet" description="Ask HR to add your company's KPIs; you can then assign them to your team here." />
          </Card>
        )
      )}
    </div>
  );
}

type OvertimeView = 'week' | 'waiting';

function TeamOvertime() {
  const [view, setView] = useState<OvertimeView>('week');
  const [people, setPeople] = useState<OvertimePerson[]>([]);
  const [waiting, setWaiting] = useState<OvertimeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [p, w] = await Promise.all([loadOvertimePeople(), loadWaitingOvertime()]);
      setPeople(p);
      // their own requests wait for someone else
      const mine = new Set(p.map((x) => x.employee_number));
      setWaiting(w.filter((e) => mine.has(e.employee_number)));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="space-y-3">
      <TabBar
        variant="pill"
        items={[{ id: 'week', label: 'Record hours' }, { id: 'waiting', label: `Waiting for approval (${waiting.length})` }]}
        activeId={view}
        onChange={(id) => setView(id as OvertimeView)}
      />
      {view === 'week' && <OvertimeWeekGrid people={people} canUpload={false} onChanged={() => void reload()} />}
      {view === 'waiting' && <OvertimeWaiting entries={waiting} people={people} loading={loading} onChanged={() => void reload()} />}
    </div>
  );
}

// who on the team is on approved leave this month (or another month): dates and type only (my_team_leave)
function TeamOnLeave() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<TeamLeave[] | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    loadTeamLeave(month).then((r) => live && setRows(r)).catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [month]);
  const shift = (by: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="m-0 text-[13.5px] font-bold text-ink">On leave in {label}</h3>
        <div className="flex gap-1">
          <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="rounded-md border border-border px-2 py-1 text-[12px]">‹</button>
          <button type="button" aria-label="Next month" onClick={() => shift(1)} className="rounded-md border border-border px-2 py-1 text-[12px]">›</button>
        </div>
      </div>
      {rows === null ? (
        <LoaderBlock label="Loading" compact />
      ) : rows.length === 0 ? (
        <p className="m-0 text-[12px] text-muted-foreground">Nobody on your team has approved leave this month.</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {rows.map((r) => (
            <li key={`${r.employee_number}-${r.start_date}`} className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
              <span className="font-semibold text-ink">{r.name}</span>
              <span className="text-muted-foreground">
                {r.leave_type} · {formatDay(r.start_date)}{r.end_date !== r.start_date ? ` to ${formatDay(r.end_date)}` : ''} · {r.days} {Number(r.days) === 1 ? 'day' : 'days'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const formatDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
