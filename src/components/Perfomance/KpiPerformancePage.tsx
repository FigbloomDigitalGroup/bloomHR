import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { PageHeader, TabBar, type TabBarItem } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import type { TownProps } from '../../types/supabase';
import {
  loadKpiAccess,
  loadKpiDepartments,
  loadKpiPeople,
  loadKpis,
  loadPeriods,
  type Kpi,
  type KpiAccess,
  type KpiPeriod,
  type KpiPerson,
} from '../../lib/kpiApi';
import type { Department } from '../../lib/orgStructure';
import KpiLibrary from './kpis/KpiLibrary';
import ReviewPeriods from './kpis/ReviewPeriods';
import AssignKpis from './kpis/AssignKpis';
import Scorecards from './kpis/Scorecards';
import MyKpis from './kpis/MyKpis';

// The microfinance loan-target screens this page used to be; kept for companies that still use them.
const LegacyLoanTargets = lazy(() => import('./PerfomanceDashboard'));

type TabId = 'scorecards' | 'library' | 'periods' | 'assign' | 'mine' | 'legacy';

/**
 * Performance, measured with each company's own KPIs (migration 20261016900000): the KPI library, review periods,
 * assigning KPIs and scorecards. HR sees everything; a manager their reports; everyone their own KPIs.
 */
export default function KpiPerformancePage(props: TownProps) {
  const [access, setAccess] = useState<KpiAccess | null>(null);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [periods, setPeriods] = useState<KpiPeriod[]>([]);
  const [people, setPeople] = useState<KpiPerson[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tab, setTab] = useState<TabId | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, k, p, ppl, d] = await Promise.all([
        loadKpiAccess(),
        loadKpis(),
        loadPeriods(),
        loadKpiPeople().catch(() => [] as KpiPerson[]),
        loadKpiDepartments().catch(() => [] as Department[]),
      ]);
      setAccess(a);
      setKpis(k);
      setPeriods(p);
      setPeople(ppl);
      setDepartments(d);
    } catch (e) {
      toast.error((e as Error).message);
      setAccess((x) => x ?? { manages: false, employeeNumber: null, team: [] });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const tabs = useMemo<TabBarItem[]>(() => {
    if (!access) return [];
    const list: TabBarItem[] = [];
    const leads = access.manages || access.team.length > 0;
    if (leads) list.push({ id: 'scorecards', label: access.manages ? 'Scorecards' : 'My team' });
    if (access.manages) list.push({ id: 'library', label: 'KPI library' }, { id: 'periods', label: 'Review periods' });
    if (leads) list.push({ id: 'assign', label: 'Assign' });
    if (access.employeeNumber) list.push({ id: 'mine', label: 'My KPIs' });
    if (access.manages) list.push({ id: 'legacy', label: 'Loan targets (legacy)' });
    return list;
  }, [access]);

  const active: TabId | null = tab && tabs.some((t) => t.id === tab) ? tab : ((tabs[0]?.id as TabId | undefined) ?? null);

  if (!access) return <FigbloomLoader />;

  return (
    <div className="min-w-0 p-4 sm:p-6">
      <PageHeader title="Performance" subtitle="KPIs your company defines, scored each review period" />
      {tabs.length === 0 ? (
        <MyKpis embedded />
      ) : (
        <>
          <TabBar items={tabs} activeId={active ?? ''} onChange={(id) => setTab(id as TabId)} className="mb-4" />
          {active === 'scorecards' && <Scorecards kpis={kpis} periods={periods} people={people} departments={departments} access={access} />}
          {active === 'library' && <KpiLibrary kpis={kpis} canManage={access.manages} onChanged={load} />}
          {active === 'periods' && <ReviewPeriods periods={periods} canManage={access.manages} onChanged={load} />}
          {active === 'assign' && <AssignKpis kpis={kpis} periods={periods} people={people} departments={departments} access={access} />}
          {active === 'mine' && <MyKpis embedded />}
          {active === 'legacy' && (
            <Suspense fallback={<FigbloomLoader />}>
              <LegacyLoanTargets {...props} />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}
