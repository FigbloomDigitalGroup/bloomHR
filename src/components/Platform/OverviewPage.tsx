import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, GraduationCap } from 'lucide-react';
import { Button, Card, PageHeader } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { ConsoleStat } from './ConsoleStat';
import { myPlatformRole, type PlatformRole } from '../../lib/platformRoles';
import { organisationTotals, type OrganisationTotals } from '../../lib/platformOrganisations';
import { listSchools, schoolTotals, schoolsProblem, type SchoolsProblem } from '../../lib/platformSchools';
import { activeWithin, schoolsNeedingAttention } from '../../lib/consoleAnalytics';
import { useConsoleBadge } from '../Console/consoleBadges';

// The console's home (/platform/overview): one card per product, with its headline numbers and links to its pages.
// Each product loads on its own, so Schools being unreachable (or not connected) never hides Figbloom HR. Any role.

type HrState = { totals: OrganisationTotals } | { error: string } | null;
interface SchoolNumbers {
  schools: number;
  active: number;
  suspended: number;
  students: number;
  activeLast7: number;
  attention: number;
}
type SchoolsState = { numbers: SchoolNumbers } | { problem: SchoolsProblem; message: string } | null;

const n = (v: number) => v.toLocaleString('en-KE');

function ProductCard({ title, icon, mark, links, children }: {
  title: string; icon: ReactNode; mark: string; links: { label: string; to: string }[]; children: ReactNode;
}) {
  return (
    <Card>
      <section aria-label={title}>
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-8 h-8 rounded-tile flex items-center justify-center ${mark}`} aria-hidden="true">{icon}</span>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
        </div>
        {children}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
              {l.label}
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </Card>
  );
}

export default function OverviewPage() {
  const [role, setRole] = useState<PlatformRole | null | undefined>(undefined);
  const [hr, setHr] = useState<HrState>(null);
  const [schools, setSchools] = useState<SchoolsState>(null);

  useEffect(() => {
    void myPlatformRole().then(setRole);
  }, []);

  const loadHr = useCallback(async () => {
    setHr(null);
    try {
      const totals = await organisationTotals();
      setHr(totals ? { totals } : { error: 'Figbloom HR sent no totals.' });
    } catch (err) {
      setHr({ error: err instanceof Error ? err.message : 'Could not load Figbloom HR.' });
    }
  }, []);

  const loadSchools = useCallback(async () => {
    setSchools(null);
    try {
      const { schools: list } = await listSchools();
      const t = schoolTotals(list);
      setSchools({
        numbers: {
          ...t,
          activeLast7: list.filter((s) => activeWithin(s.last_activity_at, 7)).length,
          attention: schoolsNeedingAttention(list).length,
        },
      });
    } catch (err) {
      setSchools({ problem: schoolsProblem(err), message: err instanceof Error ? err.message : 'Could not load the schools.' });
    }
  }, []);

  useEffect(() => {
    if (!role) return;
    void loadHr();
    void loadSchools();
  }, [role, loadHr, loadSchools]);

  // the console menu's badges, from what this page loads anyway
  useConsoleBadge('/platform/organisations', hr && 'totals' in hr ? hr.totals.by_status.pending : null, (c) => `${c} waiting for approval`);
  useConsoleBadge('/platform/schools', schools && 'numbers' in schools ? schools.numbers.attention : null, (c) => `${c} need attention`);

  const header = <PageHeader title="Overview" subtitle="Every Figbloom product at a glance" />;

  if (role === undefined) return <FigbloomLoader label="Loading" />;
  if (!role) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <p className="text-sm text-ink">Only Figbloom platform admins can see the console.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      <div className="grid gap-3 lg:grid-cols-2">
        <ProductCard title="Figbloom HR" icon={<Building2 className="w-4 h-4" />} mark="bg-green-tint text-brand"
          links={[{ label: 'Organisations', to: '/platform/organisations' }, { label: 'Statutory rates', to: '/platform/rates' }]}>
          {!hr ? (
            <FigbloomLoader label="Loading Figbloom HR" size={40} />
          ) : 'error' in hr ? (
            <div>
              <p className="text-xs text-muted-foreground">Could not load Figbloom HR: {hr.error}</p>
              <div className="mt-2"><Button variant="secondary" onClick={() => void loadHr()}>Try again</Button></div>
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <ConsoleStat label="Companies" value={n(hr.totals.by_status.total)} sub={`${n(hr.totals.by_status.active)} active`} />
              <ConsoleStat label="Waiting for approval" value={n(hr.totals.by_status.pending)}
                sub={hr.totals.auto_approve ? 'approved automatically' : 'need your approval'} />
              <ConsoleStat label="Active in the last 7 days" value={n(hr.totals.active_last_7_days)} sub="someone signed in" />
              <ConsoleStat label="Suspended" value={n(hr.totals.by_status.suspended)} sub={`${n(hr.totals.by_status.rejected)} not approved`} />
            </div>
          )}
        </ProductCard>

        <ProductCard title="Figbloom Schools" icon={<GraduationCap className="w-4 h-4" />} mark="bg-status-info-tint text-status-info"
          links={[{ label: 'Schools', to: '/platform/schools' }]}>
          {!schools ? (
            <FigbloomLoader label="Loading Figbloom Schools" size={40} />
          ) : 'problem' in schools ? (
            <div>
              <p className="text-xs font-semibold text-ink">
                {schools.problem === 'not_connected'
                  ? "Figbloom Schools isn't connected yet"
                  : schools.problem === 'unavailable'
                    ? "Figbloom Schools didn't answer"
                    : 'Could not load Figbloom Schools'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {schools.problem === 'not_connected'
                  ? 'The console needs SCHOOLS_PLATFORM_URL and SCHOOLS_PLATFORM_SECRET. Figbloom HR works as usual.'
                  : schools.message}
              </p>
              {schools.problem !== 'not_connected' && (
                <div className="mt-2"><Button variant="secondary" onClick={() => void loadSchools()}>Try again</Button></div>
              )}
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <ConsoleStat label="Schools" value={n(schools.numbers.schools)} sub={`${n(schools.numbers.active)} live`} />
              <ConsoleStat label="Active" value={n(schools.numbers.active)} />
              <ConsoleStat label="Suspended" value={n(schools.numbers.suspended)} />
              <ConsoleStat label="Students" value={n(schools.numbers.students)} />
              <ConsoleStat label="Needs attention" value={n(schools.numbers.attention)} alarming={schools.numbers.attention > 0} />
              <ConsoleStat label="Active in the last 7 days" value={n(schools.numbers.activeLast7)} sub="someone signed in" />
            </div>
          )}
        </ProductCard>
      </div>
    </div>
  );
}
