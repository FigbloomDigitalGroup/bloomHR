import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, Contact, GraduationCap, House, Truck } from 'lucide-react';
import { Button, Card, PageHeader } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { ConsoleStat } from './ConsoleStat';
import { myPlatformRole, type PlatformRole } from '../../lib/platformRoles';
import { organisationTotals, type OrganisationTotals } from '../../lib/platformOrganisations';
import { listSchools, schoolTotals, schoolsProblem, type SchoolsProblem } from '../../lib/platformSchools';
import { activeWithin, schoolsNeedingAttention } from '../../lib/consoleAnalytics';
import { fleetProblem, fleetTotals, listFleetCompanies, type FleetProblem, type FleetTotals } from '../../lib/platformFleet';
import { crmProblem, crmTotals, listCrmOrganisations, type CrmProblem, type CrmTotals } from '../../lib/platformCrm';
import { listPropertyWorkspaces, propertyProblem, propertyTotals, type PropertyProblem, type PropertyTotals } from '../../lib/platformProperty';
import { useConsoleBadge } from '../Console/consoleBadges';
import { attentionLabel } from '../../lib/hrRequests';

// The console's home (/platform/overview): one card per product, with its headline numbers and links to its pages.
// Each product loads on its own, so Schools, Fleet, CRM or Property being unreachable (or not connected) never hides another. Any role.

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
/** platformOk: whether the platform's statuses came with Fleet's list (without them nothing shows as waiting) */
type FleetState = { totals: FleetTotals; platformOk: boolean } | { problem: FleetProblem; message: string } | null;
/** platformOk: whether the platform's statuses came with CRM's list (without them the suspended count is CRM's own) */
type CrmState = { totals: CrmTotals; platformOk: boolean } | { problem: CrmProblem; message: string } | null;
/** platformOk: whether the platform's statuses came with Property's list (without them the suspended count is Property's own) */
type PropertyState = { totals: PropertyTotals; platformOk: boolean } | { problem: PropertyProblem; message: string } | null;

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
  const [fleet, setFleet] = useState<FleetState>(null);
  const [crm, setCrm] = useState<CrmState>(null);
  const [property, setProperty] = useState<PropertyState>(null);

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

  const loadFleet = useCallback(async () => {
    setFleet(null);
    try {
      const { companies, platform } = await listFleetCompanies();
      setFleet({ totals: fleetTotals(companies), platformOk: platform.ok });
    } catch (err) {
      setFleet({ problem: fleetProblem(err), message: err instanceof Error ? err.message : 'Could not load Figbloom Fleet.' });
    }
  }, []);

  const loadCrm = useCallback(async () => {
    setCrm(null);
    try {
      const { organizations, platform } = await listCrmOrganisations();
      setCrm({ totals: crmTotals(organizations), platformOk: platform.ok });
    } catch (err) {
      setCrm({ problem: crmProblem(err), message: err instanceof Error ? err.message : 'Could not load Figbloom CRM.' });
    }
  }, []);

  const loadProperty = useCallback(async () => {
    setProperty(null);
    try {
      const { workspaces, platform } = await listPropertyWorkspaces();
      setProperty({ totals: propertyTotals(workspaces), platformOk: platform.ok });
    } catch (err) {
      setProperty({ problem: propertyProblem(err), message: err instanceof Error ? err.message : 'Could not load Figbloom Property.' });
    }
  }, []);

  useEffect(() => {
    if (!role) return;
    void loadHr();
    void loadSchools();
    void loadFleet();
    void loadCrm();
    void loadProperty();
  }, [role, loadHr, loadSchools, loadFleet, loadCrm, loadProperty]);

  // the console menu's badges, from what this page loads anyway
  useConsoleBadge('/platform/organisations', hr && 'totals' in hr ? hr.totals.by_status.pending : null, (c) => `${c} waiting for approval`);
  useConsoleBadge('/platform/schools', schools && 'numbers' in schools ? schools.numbers.attention : null, (c) => `${c} need attention`);
  const fleetCounts = fleet && 'totals' in fleet ? fleet.totals : null;
  useConsoleBadge('/platform/fleet/companies', fleetCounts ? fleetCounts.pending + fleetCounts.hr_requested : null,
    () => (fleetCounts ? attentionLabel(fleetCounts.pending, fleetCounts.hr_requested) : ''));
  useConsoleBadge('/platform/property/workspaces', property && 'totals' in property ? property.totals.hr_requested : null,
    (c) => attentionLabel(0, c));

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

        <ProductCard title="Figbloom Fleet" icon={<Truck className="w-4 h-4" />} mark="bg-orange-tint text-orange-text"
          links={[{ label: 'Companies', to: '/platform/fleet/companies' }]}>
          {!fleet ? (
            <FigbloomLoader label="Loading Figbloom Fleet" size={40} />
          ) : 'problem' in fleet ? (
            <div>
              <p className="text-xs font-semibold text-ink">
                {fleet.problem === 'not_connected'
                  ? "Fleet isn't connected to the console yet"
                  : fleet.problem === 'unavailable'
                    ? "Figbloom Fleet didn't answer"
                    : 'Could not load Figbloom Fleet'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {fleet.problem === 'not_connected'
                  ? 'The console needs FLEET_PLATFORM_URL and FLEET_PLATFORM_SECRET. Figbloom HR and Schools work as usual.'
                  : fleet.message}
              </p>
              {fleet.problem !== 'not_connected' && (
                <div className="mt-2"><Button variant="secondary" onClick={() => void loadFleet()}>Try again</Button></div>
              )}
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <ConsoleStat label="Companies" value={n(fleet.totals.companies)} sub={`${n(fleet.totals.active)} active`} />
              <ConsoleStat label="Waiting for approval" value={fleet.platformOk ? n(fleet.totals.pending) : '—'}
                alarming={fleet.platformOk && fleet.totals.pending > 0}
                sub={fleet.platformOk ? 'need your approval' : "the platform couldn't be read"} />
              <ConsoleStat label="Vehicles" value={n(fleet.totals.vehicles)} sub={`${n(fleet.totals.drivers)} drivers`} />
              <ConsoleStat label="Trips, last 30 days" value={n(fleet.totals.trips)} />
            </div>
          )}
        </ProductCard>

        <ProductCard title="Figbloom CRM" icon={<Contact className="w-4 h-4" />} mark="bg-status-purple-tint text-status-purple"
          links={[{ label: 'Organisations', to: '/platform/crm/organisations' }]}>
          {!crm ? (
            <FigbloomLoader label="Loading Figbloom CRM" size={40} />
          ) : 'problem' in crm ? (
            <div>
              <p className="text-xs font-semibold text-ink">
                {crm.problem === 'not_connected'
                  ? "CRM isn't connected to the console yet"
                  : crm.problem === 'unavailable'
                    ? "Figbloom CRM didn't answer"
                    : 'Could not load Figbloom CRM'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {crm.problem === 'not_connected'
                  ? 'The console needs CRM_PLATFORM_URL and CRM_PLATFORM_SECRET. The other products work as usual.'
                  : crm.message}
              </p>
              {crm.problem !== 'not_connected' && (
                <div className="mt-2"><Button variant="secondary" onClick={() => void loadCrm()}>Try again</Button></div>
              )}
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <ConsoleStat label="Organisations" value={n(crm.totals.organisations)} sub={`${n(crm.totals.active)} active`} />
              <ConsoleStat label="Suspended" value={n(crm.totals.suspended)}
                sub={crm.platformOk ? undefined : "as CRM reports it: the platform couldn't be read"} />
            </div>
          )}
        </ProductCard>

        <ProductCard title="Figbloom Property" icon={<House className="w-4 h-4" />} mark="bg-secondary text-status-success"
          links={[{ label: 'Workspaces', to: '/platform/property/workspaces' }]}>
          {!property ? (
            <FigbloomLoader label="Loading Figbloom Property" size={40} />
          ) : 'problem' in property ? (
            <div>
              <p className="text-xs font-semibold text-ink">
                {property.problem === 'not_connected'
                  ? "Property isn't connected to the console yet"
                  : property.problem === 'unavailable'
                    ? "Figbloom Property didn't answer"
                    : 'Could not load Figbloom Property'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {property.problem === 'not_connected'
                  ? 'The console needs PROPERTY_PLATFORM_URL and PROPERTY_PLATFORM_SECRET. The other products work as usual.'
                  : property.message}
              </p>
              {property.problem !== 'not_connected' && (
                <div className="mt-2"><Button variant="secondary" onClick={() => void loadProperty()}>Try again</Button></div>
              )}
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <ConsoleStat label="Workspaces" value={n(property.totals.workspaces)} sub={`${n(property.totals.units)} units`} />
              <ConsoleStat label="Active" value={n(property.totals.active)}
                sub={property.totals.deactivated ? `${n(property.totals.deactivated)} deactivated by their owner` : undefined} />
              <ConsoleStat label="Suspended" value={n(property.totals.suspended)}
                sub={property.platformOk ? undefined : "as Property reports it: the platform couldn't be read"} />
            </div>
          )}
        </ProductCard>
      </div>
    </div>
  );
}
