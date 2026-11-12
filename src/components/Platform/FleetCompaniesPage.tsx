import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Info } from 'lucide-react';
import { Button, Card, Modal, PageHeader, SearchInput, StatusPill, TableScroll } from '../UI';
import type { StatusTone } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import ConsoleStatRow, { ConsoleStat } from './ConsoleStat';
import { useConsoleBadge } from '../Console/consoleBadges';
import { myPlatformRole, roleCan, type PlatformRole } from '../../lib/platformRoles';
import { actionPermission, groupActions, needsReason } from '../../lib/platformSchoolGroups';
import {
  FLEET_STATUSES, FLEET_STATUS_LABELS, MAX_FLEET_REASON, filterCompanies, fleetProblem, fleetTotals, listFleetCompanies,
  setFleetCompanyStatus, statusOf,
  type FleetAction, type FleetCompaniesList, type FleetCompany, type FleetProblem,
} from '../../lib/platformFleet';

// Figbloom Fleet's companies (ERP/FLEET_PLATFORM_CONTRACT.md 3): Fleet's own summaries (owner, plan, vehicles, drivers,
// trips, last ping) with the platform's decision for each. Approve or reject a new company, suspend or reactivate one:
// decided on the Figbloom platform, which tells Fleet. The backend checks the console role as for school groups
// (Owner/Admin approve and reject; Support suspends and reactivates; Viewer views). A company opens a detail panel.

const TONES: Record<string, StatusTone> = { pending: 'warning', active: 'success', suspended: 'neutral', rejected: 'danger', unregistered: 'neutral' };

const LABELS: Record<FleetAction, string> = { approve: 'Approve', reject: 'Reject', suspend: 'Suspend', reactivate: 'Reactivate' };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const moment = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const n = (v: number) => v.toLocaleString('en-KE');
const num = (v: number | null) => (v === null ? '—' : n(v));

/** What an action does, in words, for the confirm dialog. */
function actionText(action: FleetAction) {
  switch (action) {
    case 'approve':
      return 'The company can use Figbloom Fleet. Fleet emails the owner that it is approved.';
    case 'reject':
      return 'The company stays closed. Its owner sees that it was not approved, with your reason.';
    case 'suspend':
      return "Suspends the company: nobody in it can sign in to Figbloom Fleet until it is reactivated.";
    default:
      return 'The company can use Figbloom Fleet again.';
  }
}

type Load = FleetCompaniesList | { problem: FleetProblem; message: string } | null;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-t border-border/60 py-1.5 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

export default function FleetCompaniesPage() {
  // undefined while loading; null when not a platform admin
  const [role, setRole] = useState<PlatformRole | null | undefined>(undefined);
  const allowed = role === undefined ? null : role !== null;
  const [load, setLoad] = useState<Load>(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<FleetCompany | null>(null);
  const [acting, setActing] = useState<{ company: FleetCompany; action: FleetAction } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void myPlatformRole().then(setRole);
  }, []);

  const fetchCompanies = useCallback(async () => {
    setLoad(null);
    try {
      setLoad(await listFleetCompanies());
    } catch (err) {
      setLoad({ problem: fleetProblem(err), message: err instanceof Error ? err.message : 'Could not load the Fleet companies.' });
    }
  }, []);

  useEffect(() => {
    if (allowed) void fetchCompanies();
  }, [allowed, fetchCompanies]);

  const list = load && 'companies' in load ? load : null;
  const companies = list?.companies ?? null;
  const platformOk = !list || list.platform.ok;
  const totals = useMemo(() => (companies ? fleetTotals(companies) : null), [companies]);
  const shown = useMemo(() => filterCompanies(companies ?? [], { status, search }), [companies, status, search]);

  // the console menu's badge: companies waiting for approval
  useConsoleBadge('/platform/fleet/companies', totals ? totals.pending : null, (c) => `${c} waiting for approval`);

  const actionsFor = (c: FleetCompany) =>
    platformOk && c.organization_id && c.status ? groupActions(c.status).filter((a) => roleCan(role, actionPermission(a, c.status!))) : [];

  const open = (company: FleetCompany, action: FleetAction) => {
    setReason('');
    setViewing(null);
    setActing({ company, action });
  };

  const reasonOk = !acting || !needsReason(acting.action) || reason.trim().length > 0;

  const confirm = async () => {
    if (!acting || !reasonOk || !list || !acting.company.organization_id) return;
    setBusy(true);
    try {
      const updated = await setFleetCompanyStatus(acting.company.organization_id, acting.action, reason);
      const label = FLEET_STATUS_LABELS[updated?.status ?? ''] ?? updated?.status ?? 'changed';
      toast.success(`${acting.company.name}: ${label.toLowerCase()}. Figbloom Fleet applies it within a minute.`);
      setActing(null);
      if (updated) {
        setLoad({
          ...list,
          companies: list.companies.map((c) =>
            c.organization_id === updated.organization_id ? { ...c, status: updated.status, status_reason: updated.status_reason } : c
          ),
        });
      } else await fetchCompanies();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The company was not changed.');
    } finally {
      setBusy(false);
    }
  };

  const header = <PageHeader title="Fleet companies" subtitle="Figbloom Fleet's companies: approve new ones, suspend or reactivate a company" />;

  if (allowed === null) return <FigbloomLoader label="Loading" />;
  if (!allowed) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <p className="text-sm text-ink">Only Figbloom platform admins can see Fleet companies.</p>
        </Card>
      </div>
    );
  }

  if (load && 'problem' in load) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          {load.problem === 'not_connected' ? (
            <>
              <h2 className="text-sm font-semibold text-ink">Fleet isn't connected to the console yet</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The console needs Fleet's API address and its shared secret (FLEET_PLATFORM_URL and FLEET_PLATFORM_SECRET).
                Figbloom HR and Figbloom Schools work as usual.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-ink">
                {load.problem === 'unavailable' ? "Figbloom Fleet didn't answer, try again" : 'Could not load the Fleet companies'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{load.message}</p>
              <div className="mt-3">
                <Button variant="secondary" onClick={() => void fetchCompanies()}>Try again</Button>
              </div>
            </>
          )}
        </Card>
      </div>
    );
  }

  const tabs = ['all', ...FLEET_STATUSES, ...(totals?.unregistered ? ['unregistered'] : [])];

  return (
    <div className="space-y-4">
      {header}

      {list && !list.platform.ok && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-white px-4 py-3 text-xs text-ink" role="note">
          <Info className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            {list.platform.code === 'platform_not_connected'
              ? "The Figbloom platform isn't connected to the console, so companies show without their approval status and can't be approved or suspended here."
              : `The Figbloom platform couldn't be read (${list.platform.message}), so companies show without their approval status and can't be approved or suspended until it is back.`}
          </span>
        </p>
      )}

      {totals && (
        <ConsoleStatRow label="Fleet company totals">
          <ConsoleStat label="Companies" value={n(totals.companies)} sub={`${n(totals.vehicles)} vehicles · ${n(totals.drivers)} drivers`} />
          <ConsoleStat label="Waiting for approval" value={n(totals.pending)} alarming={totals.pending > 0} sub={totals.pending ? 'need a decision' : 'none waiting'} />
          <ConsoleStat label="Active" value={n(totals.active)} />
          <ConsoleStat label="Suspended or rejected" value={n(totals.suspended + totals.rejected)}
            sub={`${n(totals.suspended)} suspended · ${n(totals.rejected)} not approved`} />
          <ConsoleStat label="Trips, last 30 days" value={n(totals.trips)} />
        </ConsoleStatRow>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Status">
            {tabs.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-tile border text-[11.5px] font-semibold ${status === s ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-white text-ink hover:bg-secondary'}`}>
                {s === 'all' ? 'All' : `${FLEET_STATUS_LABELS[s]} (${(companies ?? []).filter((c) => statusOf(c) === s).length})`}
              </button>
            ))}
          </div>
          <div className="ml-auto w-full sm:w-72">
            <SearchInput placeholder="Search by company or owner" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {!companies ? (
          <FigbloomLoader label="Loading Fleet companies" size={48} />
        ) : companies.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No companies in Figbloom Fleet yet.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No companies match.</p>
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Company</th>
                  <th className="py-1 pr-3 font-medium">Owner</th>
                  <th className="py-1 pr-3 font-medium">Plan</th>
                  <th className="py-1 pr-3 font-medium text-right">Vehicles</th>
                  <th className="py-1 pr-3 font-medium text-right">Drivers</th>
                  <th className="py-1 pr-3 font-medium text-right">Trips (30 days)</th>
                  <th className="py-1 pr-3 font-medium">Last ping</th>
                  <th className="py-1 pr-3 font-medium">Created</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const s = statusOf(c);
                  return (
                    <tr key={c.organization_id ?? c.id} className="border-t border-border/60 align-top">
                      <td className="py-1.5 pr-3">
                        <button type="button" onClick={() => setViewing(c)} className="text-left font-semibold text-ink hover:text-brand hover:underline">
                          {c.name}
                        </button>
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {c.owner_name && <span className="block text-ink">{c.owner_name}</span>}
                        {c.owner_email ?? (c.owner_name ? null : '—')}
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{c.plan ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-right text-ink tabular-nums">{num(c.vehicles)}</td>
                      <td className="py-1.5 pr-3 text-right text-ink tabular-nums">{num(c.drivers)}</td>
                      <td className="py-1.5 pr-3 text-right text-ink tabular-nums">{num(c.trips_last_30_days)}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{moment(c.last_location_at)}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{day(c.created_at)}</td>
                      <td className="py-1.5 pr-3">
                        <StatusPill label={FLEET_STATUS_LABELS[s] ?? s} tone={TONES[s] ?? 'neutral'} />
                        {c.status_reason && <span className="block mt-1 text-muted-foreground">{c.status_reason}</span>}
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {actionsFor(c).map((a) => (
                          <button key={a} type="button" onClick={() => open(c, a)}
                            className={`ml-3 font-semibold ${a === 'reject' || a === 'suspend' ? 'text-status-danger' : 'text-brand'}`}>
                            {LABELS[a]}
                          </button>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
        {list?.truncated && <p className="mt-2 text-[11.5px] text-muted-foreground">Showing the newest 2,000 companies on the platform.</p>}
      </Card>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name ?? ''} size="md">
        {viewing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill label={FLEET_STATUS_LABELS[statusOf(viewing)] ?? statusOf(viewing)} tone={TONES[statusOf(viewing)] ?? 'neutral'} />
              {viewing.status_reason && <span className="text-xs text-muted-foreground">{viewing.status_reason}</span>}
            </div>
            {!viewing.in_fleet && (
              <p className="text-xs text-muted-foreground">On the Figbloom platform, but not in Figbloom Fleet's list: Fleet sent no summary for it.</p>
            )}
            <dl aria-label="Company details">
              <Detail label="Owner">{viewing.owner_name ?? '—'}</Detail>
              <Detail label="Owner email">{viewing.owner_email ?? '—'}</Detail>
              <Detail label="Plan">{viewing.plan ?? '—'}</Detail>
              <Detail label="Vehicles">{num(viewing.vehicles)}</Detail>
              <Detail label="Drivers">{num(viewing.drivers)}</Detail>
              <Detail label="Admins">{num(viewing.admins)}</Detail>
              <Detail label="Trips, last 30 days">{num(viewing.trips_last_30_days)}</Detail>
              <Detail label="Last location ping">{moment(viewing.last_location_at)}</Detail>
              <Detail label="Created">{day(viewing.created_at)}</Detail>
              <Detail label="Status in Fleet">{viewing.fleet_status ?? '—'}</Detail>
              <Detail label="Fleet ID"><span className="font-mono text-[11px]">{viewing.id || '—'}</span></Detail>
              <Detail label="Platform ID"><span className="font-mono text-[11px]">{viewing.organization_id ?? 'not registered yet'}</span></Detail>
            </dl>
            {actionsFor(viewing).length > 0 && (
              <div className="flex justify-end gap-2">
                {actionsFor(viewing).map((a) => (
                  <Button key={a} variant={a === 'reject' || a === 'suspend' ? 'secondary' : undefined} onClick={() => open(viewing, a)}>
                    {LABELS[a]}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!acting} onClose={() => !busy && setActing(null)}
        title={acting ? `${LABELS[acting.action]} ${acting.company.name}?` : ''} size="sm" closeOnBackdrop={!busy}>
        {acting && (
          <div className="space-y-4">
            {acting.action === 'suspend' ? (
              <p className="flex items-start gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-ink" role="alert">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-status-danger" aria-hidden="true" />
                <span>{actionText(acting.action)}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{actionText(acting.action)}</p>
            )}
            {needsReason(acting.action) && (
              <label className="block text-xs text-ink">
                Why? (recorded on the platform with your email)
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={MAX_FLEET_REASON}
                  className="block mt-1 w-full rounded-lg border border-border px-2 py-1 text-sm" />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setActing(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void confirm()} disabled={busy || !reasonOk}>
                {busy ? 'Saving…' : LABELS[acting.action]}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
