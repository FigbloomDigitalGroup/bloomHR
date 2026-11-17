import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, Info } from 'lucide-react';
import { Button, Card, Modal, PageHeader, SearchInput, StatusPill, TableScroll } from '../UI';
import type { StatusTone } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import ConsoleStatRow, { ConsoleStat } from './ConsoleStat';
import { SchoolHrCell } from './SchoolHr';
import { useSchoolHr } from './useSchoolHr';
import { useConsoleBadge } from '../Console/consoleBadges';
import { myPlatformRole, roleCan, type PlatformRole } from '../../lib/platformRoles';
import { listSchools, type School } from '../../lib/platformSchools';
import {
  GROUP_STATUSES, GROUP_STATUS_LABELS, MAX_GROUP_REASON, actionPermission, filterGroups, groupActions, groupPeople, groupTotals,
  groupsProblem, listSchoolGroups, needsReason, setSchoolGroupStatus,
  type GroupAction, type GroupsProblem, type SchoolGroup,
} from '../../lib/platformSchoolGroups';

// Figbloom Schools' school groups (organisations), decided on the Figbloom platform (design 5.8): approve or reject a
// new group, suspend or reactivate one. A group's decision covers all its schools. The backend checks the console role
// (Owner/Admin approve and reject; Support suspends and reactivates; Viewer views), and the platform records who decided.
// Students, teachers and parents come from Figbloom Schools' own list, joined by school ID; without it, they show "—".
// Each school shows its HR & Payroll state, switched on by Owners and Admins (SchoolHr.tsx).

const TONES: Record<string, StatusTone> = { pending: 'warning', active: 'success', suspended: 'neutral', rejected: 'danger' };

const LABELS: Record<GroupAction, string> = { approve: 'Approve', reject: 'Reject', suspend: 'Suspend', reactivate: 'Reactivate' };

const SWITCH_ON =
  "Decisions here are recorded on the Figbloom platform. Figbloom Schools starts applying them at switch-on; until then use Schools' own console for changes that must take effect now.";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const n = (v: number) => v.toLocaleString('en-KE');
const schoolsWord = (count: number) => `${count} ${count === 1 ? 'school' : 'schools'}`;

/** What an action does, in words, for the confirm dialog. */
function actionText(action: GroupAction, group: SchoolGroup) {
  const count = group.tenant_count || group.schools.length;
  switch (action) {
    case 'approve':
      return `The group's ${schoolsWord(count)} can use Figbloom Schools.`;
    case 'reject':
      return 'The group stays closed. Its owner sees that it was not approved, with your reason.';
    case 'suspend':
      return `Suspends all ${schoolsWord(count)} in this group: nobody in them can use Figbloom Schools until the group is reactivated.`;
    default:
      return "Restores the schools this group's suspension locked.";
  }
}

type Load = { groups: SchoolGroup[]; live: boolean; truncated: boolean } | { problem: GroupsProblem; message: string } | null;

export default function SchoolGroupsPage() {
  // undefined while loading; null when not a platform admin
  const [role, setRole] = useState<PlatformRole | null | undefined>(undefined);
  const allowed = role === undefined ? null : role !== null;
  const [load, setLoad] = useState<Load>(null);
  // Figbloom Schools' list, for the people in each group: undefined while loading, null when it couldn't be read
  const [schoolList, setSchoolList] = useState<School[] | null | undefined>(undefined);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [acting, setActing] = useState<{ group: SchoolGroup; action: GroupAction } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void myPlatformRole().then(setRole);
  }, []);

  const fetchGroups = useCallback(async () => {
    setLoad(null);
    try {
      const { groups, decisions_live, truncated } = await listSchoolGroups();
      setLoad({ groups, live: decisions_live, truncated });
    } catch (err) {
      setLoad({ problem: groupsProblem(err), message: err instanceof Error ? err.message : 'Could not load the school groups.' });
    }
  }, []);

  const fetchSchools = useCallback(async () => {
    try {
      setSchoolList((await listSchools()).schools);
    } catch {
      setSchoolList(null); // the groups still show, without their people
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void fetchGroups();
    void fetchSchools();
  }, [allowed, fetchGroups, fetchSchools]);

  const groups = load && 'groups' in load ? load.groups : null;
  const totals = useMemo(() => (groups ? groupTotals(groups) : null), [groups]);
  const shown = useMemo(() => filterGroups(groups ?? [], { status, search }), [groups, status, search]);
  const schoolsById = useMemo(() => new Map((schoolList ?? []).map((s) => [s.id, s])), [schoolList]);

  // the console menu's badge: groups waiting for approval
  useConsoleBadge('/platform/school-groups', totals ? totals.pending : null, (c) => `${c} waiting for approval`);

  const can = (a: GroupAction, status: string) => roleCan(role, actionPermission(a, status));
  const hr = useSchoolHr(!!allowed);
  const canEnableHr = roleCan(role, 'approve_companies');

  const open = (group: SchoolGroup, action: GroupAction) => {
    setReason('');
    setActing({ group, action });
  };

  const reasonOk = !acting || !needsReason(acting.action) || reason.trim().length > 0;

  const confirm = async () => {
    if (!acting || !reasonOk || !load || !('groups' in load)) return;
    setBusy(true);
    try {
      const updated = await setSchoolGroupStatus(acting.group.id, acting.action, reason);
      const label = GROUP_STATUS_LABELS[updated?.status ?? ''] ?? updated?.status ?? 'changed';
      toast.success(
        load.live ? `${acting.group.name}: ${label.toLowerCase()}.` : `${acting.group.name}: ${label.toLowerCase()} on the platform. Figbloom Schools applies it at switch-on.`
      );
      setActing(null);
      if (updated) setLoad({ ...load, groups: load.groups.map((g) => (g.id === updated.id ? { ...g, ...updated } : g)) });
      else await fetchGroups();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The school group was not changed.');
    } finally {
      setBusy(false);
    }
  };

  const header = <PageHeader title="School groups" subtitle="Figbloom Schools' groups: approve new ones, suspend or reactivate a whole group" />;

  if (allowed === null) return <FigbloomLoader label="Loading" />;
  if (!allowed) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <p className="text-sm text-ink">Only Figbloom platform admins can see school groups.</p>
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
              <h2 className="text-sm font-semibold text-ink">The Figbloom platform isn't connected yet</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The console needs the platform's address and its own sign-in (PLATFORM_API_URL, PLATFORM_TOKEN_URL,
                PLATFORM_CONSOLE_CLIENT_ID and PLATFORM_CONSOLE_CLIENT_SECRET). Schools and Figbloom HR work as usual.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-ink">
                {load.problem === 'unavailable' ? "The Figbloom platform didn't answer, try again" : 'Could not load the school groups'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{load.message}</p>
              <div className="mt-3">
                <Button variant="secondary" onClick={() => void fetchGroups()}>Try again</Button>
              </div>
            </>
          )}
        </Card>
      </div>
    );
  }

  const people = (g: SchoolGroup) => {
    if (schoolList === undefined) return '…';
    if (schoolList === null) return '—';
    const p = groupPeople(g, schoolsById);
    return p.matched === 0 ? '—' : `${n(p.students)} / ${n(p.teachers)} / ${n(p.parents)}`;
  };

  return (
    <div className="space-y-4">
      {header}

      {load && !load.live && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-white px-4 py-3 text-xs text-ink" role="note">
          <Info className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{SWITCH_ON}</span>
        </p>
      )}

      {totals && (
        <ConsoleStatRow label="School group totals">
          <ConsoleStat label="Groups" value={n(totals.groups)} sub={`${n(groups!.reduce((s, g) => s + (g.tenant_count || g.schools.length), 0))} schools in them`} />
          <ConsoleStat label="Waiting for approval" value={n(totals.pending)} alarming={totals.pending > 0} sub={totals.pending ? 'need a decision' : 'none waiting'} />
          <ConsoleStat label="Active" value={n(totals.active)} />
          <ConsoleStat label="Suspended or rejected" value={n(totals.suspendedOrRejected)}
            sub={`${n(totals.suspended)} suspended · ${n(totals.rejected)} not approved`} />
          <ConsoleStat label="No schools" value={n(totals.empty)} sub="groups without a school yet" />
        </ConsoleStatRow>
      )}

      {schoolList === null && (
        <p className="text-xs text-muted-foreground" role="status">
          Students, teachers and parents come from Figbloom Schools, which couldn't be reached: they show as —.
        </p>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Status">
            {(['all', ...GROUP_STATUSES] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-tile border text-[11.5px] font-semibold ${status === s ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-white text-ink hover:bg-secondary'}`}>
                {s === 'all' ? 'All' : `${GROUP_STATUS_LABELS[s]} (${(groups ?? []).filter((g) => g.status === s).length})`}
              </button>
            ))}
          </div>
          <div className="ml-auto w-full sm:w-72">
            <SearchInput placeholder="Search by group, school or slug" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {!groups ? (
          <FigbloomLoader label="Loading school groups" size={48} />
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No school groups on the Figbloom platform yet.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No school groups match.</p>
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Group</th>
                  <th className="py-1 pr-3 font-medium">Owner</th>
                  <th className="py-1 pr-3 font-medium">Schools</th>
                  <th className="py-1 pr-3 font-medium text-right">Count</th>
                  <th className="py-1 pr-3 font-medium text-right" title="Added up from Figbloom Schools">Students / teachers / parents</th>
                  <th className="py-1 pr-3 font-medium">Created</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => (
                  <tr key={g.id} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-3 text-ink font-semibold">{g.name}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{g.owner_email ?? '—'}</td>
                    <td className="py-1.5 pr-3">
                      {g.schools.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <ul className="space-y-1">
                          {g.schools.map((s) => {
                            const slug = s.local_slug ?? s.name;
                            return (
                              <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <Link to={`/platform/schools?q=${encodeURIComponent(slug)}`} className="font-mono text-[11px] text-brand hover:underline"
                                  title={`${s.name} on the Schools page`}>
                                  {slug}
                                </Link>
                                <SchoolHrCell school={hr.byPlatformId.get(s.id)} data={hr} canEnable={canEnableHr} labelled />
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-ink tabular-nums">{g.tenant_count || g.schools.length}</td>
                    <td className="py-1.5 pr-3 text-right text-ink tabular-nums whitespace-nowrap">{people(g)}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{day(g.created_at)}</td>
                    <td className="py-1.5 pr-3">
                      <StatusPill label={GROUP_STATUS_LABELS[g.status] ?? g.status} tone={TONES[g.status] ?? 'neutral'} />
                      {g.status_reason && <span className="block mt-1 text-muted-foreground">{g.status_reason}</span>}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {groupActions(g.status).filter((a) => can(a, g.status)).map((a) => (
                        <button key={a} type="button" onClick={() => open(g, a)}
                          className={`ml-3 font-semibold ${a === 'reject' || a === 'suspend' ? 'text-status-danger' : 'text-brand'}`}>
                          {LABELS[a]}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        {load && 'truncated' in load && load.truncated && (
          <p className="mt-2 text-[11.5px] text-muted-foreground">Showing the newest 2,000 groups.</p>
        )}
      </Card>

      <Modal open={!!acting} onClose={() => !busy && setActing(null)}
        title={acting ? `${LABELS[acting.action]} ${acting.group.name}?` : ''} size="sm" closeOnBackdrop={!busy}>
        {acting && (
          <div className="space-y-4">
            {acting.action === 'suspend' ? (
              <p className="flex items-start gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-ink" role="alert">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-status-danger" aria-hidden="true" />
                <span>{actionText(acting.action, acting.group)}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{actionText(acting.action, acting.group)}</p>
            )}
            {load && 'live' in load && !load.live && <p className="text-xs text-muted-foreground">{SWITCH_ON}</p>}
            {(acting.action === 'reject' || acting.action === 'suspend') && (
              <label className="block text-xs text-ink">
                Why? (recorded on the platform with your email)
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={MAX_GROUP_REASON}
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
