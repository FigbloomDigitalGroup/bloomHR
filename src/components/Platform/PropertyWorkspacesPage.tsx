import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Info } from 'lucide-react';
import { Button, Card, Modal, PageHeader, SearchInput, StatusPill, TableScroll } from '../UI';
import type { StatusTone } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import ConsoleStatRow, { ConsoleStat } from './ConsoleStat';
import { myPlatformRole, roleCan, type PlatformRole } from '../../lib/platformRoles';
import {
  MAX_PROPERTY_REASON, PLAN_STATUS_LABELS, PROPERTY_STATUSES, PROPERTY_STATUS_LABELS, filterWorkspaces, getPropertyWorkspace,
  listPropertyWorkspaces, propertyActions, propertyProblem, propertyTotals, registered, setPropertyWorkspaceStatus, statusOf,
  type PropertyAction, type PropertyProblem, type PropertyWorkspace, type PropertyWorkspacesList,
} from '../../lib/platformProperty';

// Figbloom Property's workspaces (ERP/PROPERTY_PLATFORM_CONTRACT.md 3): Property's own summaries (who signed it up, its
// plan, and counts of properties, units, occupied units, team members and tenants: Property sends no tenant names,
// contacts, leases or payments) with the platform's status for each. The same page as CRM's organisations, without
// creating: customers sign themselves up in Property and there is nothing to approve, so a workspace is only suspended
// (with a reason) or reactivated, on the Figbloom platform, which tells Property. Suspending and reactivating are
// Owner/Admin (approve_companies); every console role sees the list. A workspace opens a detail panel. A new workspace
// can't be suspended until Property has registered it with the platform (within a minute). One its owner switched off
// in Property shows as "Deactivated by owner", not as suspended.

const TONES: Record<string, StatusTone> = {
  active: 'success', suspended: 'neutral', deactivated: 'warning', inactive: 'neutral', pending: 'warning', rejected: 'danger', unregistered: 'neutral',
};

const LABELS: Record<PropertyAction, string> = { suspend: 'Suspend', reactivate: 'Reactivate' };

const NOT_REGISTERED =
  'Figbloom Property registers a new workspace with the Figbloom platform within a minute. It can be suspended or reactivated once it has.';
const DEACTIVATED =
  'Its owner switched this workspace off in Figbloom Property. Only they can switch it back on there; the console can still suspend it.';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const n = (v: number) => v.toLocaleString('en-KE');
const num = (v: number | null) => (v === null ? '—' : n(v));
const planText = (w: PropertyWorkspace) => {
  const status = w.plan_status ? PLAN_STATUS_LABELS[w.plan_status] ?? w.plan_status : null;
  if (!w.plan_name && !status) return '—';
  // "Trial", not "Trial (trial)"
  if (!status || (w.plan_name && w.plan_name.toLowerCase() === status.toLowerCase())) return w.plan_name ?? status;
  return w.plan_name ? `${w.plan_name} (${status.toLowerCase()})` : status;
};

function actionText(action: PropertyAction) {
  return action === 'suspend'
    ? "Suspends the workspace: its team can't use Figbloom Property until it is reactivated. Its data is kept."
    : 'The workspace can use Figbloom Property again, with everything as it was.';
}

type Load = PropertyWorkspacesList | { problem: PropertyProblem; message: string } | null;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-t border-border/60 py-1.5 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

export default function PropertyWorkspacesPage() {
  // undefined while loading; null when not a platform admin
  const [role, setRole] = useState<PlatformRole | null | undefined>(undefined);
  const allowed = role === undefined ? null : role !== null;
  const [load, setLoad] = useState<Load>(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<PropertyWorkspace | null>(null);
  const [acting, setActing] = useState<{ workspace: PropertyWorkspace; action: PropertyAction } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void myPlatformRole().then(setRole);
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    setLoad(null);
    try {
      setLoad(await listPropertyWorkspaces());
    } catch (err) {
      setLoad({ problem: propertyProblem(err), message: err instanceof Error ? err.message : 'Could not load the Property workspaces.' });
    }
  }, []);

  useEffect(() => {
    if (allowed) void fetchWorkspaces();
  }, [allowed, fetchWorkspaces]);

  const list = load && 'workspaces' in load ? load : null;
  const workspaces = list?.workspaces ?? null;
  const platformOk = !list || list.platform.ok;
  const totals = useMemo(() => (workspaces ? propertyTotals(workspaces) : null), [workspaces]);
  const shown = useMemo(() => filterWorkspaces(workspaces ?? [], { status, search }), [workspaces, status, search]);
  const canManage = roleCan(role, 'approve_companies');

  const actionsFor = (w: PropertyWorkspace) => (platformOk && canManage ? propertyActions(w) : []);

  const view = (w: PropertyWorkspace) => {
    setViewing(w);
    if (!w.in_property || !w.id) return;
    // the latest counts; the row's are shown meanwhile, and kept if Property doesn't answer
    getPropertyWorkspace(w.id).then(
      (fresh) => setViewing((v) => (v && v.id === fresh.id ? fresh : v)),
      () => {}
    );
  };

  const open = (workspace: PropertyWorkspace, action: PropertyAction) => {
    setReason('');
    setViewing(null);
    setActing({ workspace, action });
  };

  const reasonOk = !acting || acting.action !== 'suspend' || reason.trim().length > 0;

  const confirm = async () => {
    if (!acting || !reasonOk || !list || !acting.workspace.organization_id) return;
    setBusy(true);
    try {
      const updated = await setPropertyWorkspaceStatus(acting.workspace.organization_id, acting.action, reason);
      const label = PROPERTY_STATUS_LABELS[updated?.status ?? ''] ?? updated?.status ?? 'changed';
      toast.success(`${acting.workspace.name}: ${label.toLowerCase()}. Figbloom Property applies it within a minute.`);
      setActing(null);
      if (updated) {
        setLoad({
          ...list,
          workspaces: list.workspaces.map((w) =>
            w.organization_id === updated.organization_id
              ? {
                  ...w,
                  status: updated.status,
                  status_reason: updated.status_reason,
                  // Property follows the platform's decision: show it so now, rather than "deactivated by owner" meanwhile
                  property_active: updated.status === 'active' ? true : updated.status === 'suspended' ? false : w.property_active,
                }
              : w
          ),
        });
      } else await fetchWorkspaces();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The workspace was not changed.');
    } finally {
      setBusy(false);
    }
  };

  const header = <PageHeader title="Property workspaces" subtitle="Figbloom Property's workspaces: open one for a customer, suspend or reactivate one" />;

  if (allowed === null) return <FigbloomLoader label="Loading" />;
  if (!allowed) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <p className="text-sm text-ink">Only Figbloom platform admins can see Property workspaces.</p>
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
              <h2 className="text-sm font-semibold text-ink">Property isn't connected to the console yet</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The console needs Property's address and its shared secret (PROPERTY_PLATFORM_URL and PROPERTY_PLATFORM_SECRET),
                and Property its own PLATFORM_CONSOLE_SECRET. The other Figbloom products work as usual.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-ink">
                {load.problem === 'unavailable' ? "Figbloom Property didn't answer, try again" : 'Could not load the Property workspaces'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{load.message}</p>
              <div className="mt-3">
                <Button variant="secondary" onClick={() => void fetchWorkspaces()}>Try again</Button>
              </div>
            </>
          )}
        </Card>
      </div>
    );
  }

  const extra = Object.keys(PROPERTY_STATUS_LABELS).filter((s) => !PROPERTY_STATUSES.includes(s) && (workspaces ?? []).some((w) => statusOf(w) === s));
  const tabs = ['all', ...PROPERTY_STATUSES, ...extra];

  return (
    <div className="space-y-4">
      {header}

      {list && !list.platform.ok && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-white px-4 py-3 text-xs text-ink" role="note">
          <Info className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            {list.platform.code === 'platform_not_connected'
              ? "The Figbloom platform isn't connected to the console, so workspaces show Property's own status and can't be suspended or reactivated here."
              : `The Figbloom platform couldn't be read (${list.platform.message}), so workspaces show Property's own status and can't be suspended or reactivated until it is back.`}
          </span>
        </p>
      )}

      {totals && (
        <ConsoleStatRow label="Property workspace totals">
          <ConsoleStat label="Workspaces" value={n(totals.workspaces)} sub={`${n(totals.units)} units`} />
          <ConsoleStat label="Active" value={n(totals.active)} />
          <ConsoleStat label="Suspended" value={n(totals.suspended)} />
          <ConsoleStat label="Deactivated by owner" value={n(totals.deactivated)} />
        </ConsoleStatRow>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Status">
            {tabs.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-tile border text-[11.5px] font-semibold ${status === s ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-white text-ink hover:bg-secondary'}`}>
                {s === 'all' ? 'All' : `${PROPERTY_STATUS_LABELS[s]} (${(workspaces ?? []).filter((w) => statusOf(w) === s).length})`}
              </button>
            ))}
          </div>
          <div className="ml-auto w-full sm:w-72">
            <SearchInput placeholder="Search by workspace or owner" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {!workspaces ? (
          <FigbloomLoader label="Loading Property workspaces" size={48} />
        ) : workspaces.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No workspaces in Figbloom Property yet.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No workspaces match.</p>
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Workspace</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 pr-3 font-medium">Owner</th>
                  <th className="py-1 pr-3 font-medium">Plan</th>
                  <th className="py-1 pr-3 font-medium text-right">Properties</th>
                  <th className="py-1 pr-3 font-medium text-right">Units</th>
                  <th className="py-1 pr-3 font-medium">Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((w) => {
                  const s = statusOf(w);
                  return (
                    <tr key={w.organization_id ?? w.id} className="border-t border-border/60 align-top">
                      <td className="py-1.5 pr-3">
                        <button type="button" onClick={() => view(w)} className="text-left font-semibold text-ink hover:text-brand hover:underline">
                          {w.name}
                        </button>
                        {w.slug && <span className="block text-muted-foreground font-mono text-[11px]">{w.slug}</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        <StatusPill label={PROPERTY_STATUS_LABELS[s] ?? s} tone={TONES[s] ?? 'neutral'} />
                        {w.status_reason && <span className="block mt-1 text-muted-foreground">{w.status_reason}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {w.creator_name && <span className="block text-ink">{w.creator_name}</span>}
                        {w.creator_email ?? (w.creator_name ? null : '—')}
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{planText(w)}</td>
                      <td className="py-1.5 pr-3 text-right text-ink tabular-nums">{num(w.properties)}</td>
                      <td className="py-1.5 pr-3 text-right text-ink tabular-nums">{num(w.units)}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{day(w.created_at)}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {actionsFor(w).map((a) => (
                          <button key={a} type="button" onClick={() => open(w, a)}
                            className={`ml-3 font-semibold ${a === 'suspend' ? 'text-status-danger' : 'text-brand'}`}>
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
        {list?.truncated && <p className="mt-2 text-[11.5px] text-muted-foreground">Showing the newest 2,000 workspaces on the platform.</p>}
      </Card>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name ?? ''} size="md">
        {viewing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill label={PROPERTY_STATUS_LABELS[statusOf(viewing)] ?? statusOf(viewing)} tone={TONES[statusOf(viewing)] ?? 'neutral'} />
              {viewing.status_reason && <span className="text-xs text-muted-foreground">{viewing.status_reason}</span>}
            </div>
            {statusOf(viewing) === 'deactivated' && <p className="text-xs text-muted-foreground">{DEACTIVATED}</p>}
            {!viewing.in_property && (
              <p className="text-xs text-muted-foreground">On the Figbloom platform, but not in Figbloom Property's list: Property sent no summary for it.</p>
            )}
            <dl aria-label="Workspace details">
              <Detail label="Slug"><span className="font-mono text-[11px]">{viewing.slug ?? '—'}</span></Detail>
              <Detail label="Owner">{viewing.creator_name ?? '—'}</Detail>
              <Detail label="Owner email">{viewing.creator_email ?? '—'}</Detail>
              <Detail label="Plan">{planText(viewing)}</Detail>
              {viewing.plan_status === 'trialing' && <Detail label="Trial ends">{day(viewing.trial_ends_at)}</Detail>}
              <Detail label="Properties">{num(viewing.properties)}</Detail>
              <Detail label="Units">{num(viewing.units)}</Detail>
              <Detail label="Occupied units">{num(viewing.occupied_units)}</Detail>
              <Detail label="Tenants">{num(viewing.tenants)}</Detail>
              <Detail label="Team members">{num(viewing.team_members)}</Detail>
              <Detail label="Created">{day(viewing.created_at)}</Detail>
              <Detail label="Active in Property">{viewing.property_active === null ? '—' : viewing.property_active ? 'Yes' : 'No'}</Detail>
              <Detail label="Workspace ID"><span className="font-mono text-[11px]">{viewing.id || '—'}</span></Detail>
              <Detail label="Platform ID">
                <span className="font-mono text-[11px]">{viewing.organization_id ?? viewing.platform_organization_id ?? 'not registered yet'}</span>
              </Detail>
              {viewing.registered_at && <Detail label="On the platform since">{day(viewing.registered_at)}</Detail>}
            </dl>
            {canManage && platformOk && !registered(viewing) && (
              <div className="space-y-2">
                <p className="flex items-start gap-2 text-xs text-muted-foreground" role="note">
                  <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{NOT_REGISTERED}</span>
                </p>
                <div className="flex justify-end">
                  <Button variant="secondary" disabled>{statusOf(viewing) === 'suspended' ? 'Reactivate' : 'Suspend'}</Button>
                </div>
              </div>
            )}
            {actionsFor(viewing).length > 0 && (
              <div className="flex justify-end gap-2">
                {actionsFor(viewing).map((a) => (
                  <Button key={a} variant={a === 'suspend' ? 'secondary' : undefined} onClick={() => open(viewing, a)}>
                    {LABELS[a]}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!acting} onClose={() => !busy && setActing(null)}
        title={acting ? `${LABELS[acting.action]} ${acting.workspace.name}?` : ''} size="sm" closeOnBackdrop={!busy}>
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
            {acting.action === 'suspend' && (
              <label className="block text-xs text-ink">
                Why? (recorded on the platform with your email)
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={MAX_PROPERTY_REASON}
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
