import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Copy, GraduationCap, PauseCircle, School as SchoolIcon } from 'lucide-react';
import { Button, Card, Modal, PageHeader, SearchInput, StatCard, StatusPill, TableScroll } from '../UI';
import type { StatusTone } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { myPlatformRole, roleCan, type PlatformRole } from '../../lib/platformRoles';
import {
  MAX_REASON, filterSchools, listSchools, schoolTotals, schoolsProblem, setSchoolStatus, statusFilters, statusLabel,
  type School, type SchoolStatusChange, type SchoolsProblem,
} from '../../lib/platformSchools';

// Every school on Figbloom Schools, for Figbloom's platform admins (ERP/SCHOOLS_CONSOLE_CONTRACT.md): the console
// reads Schools through bloomHR's backend, which checks the console role; Schools itself suspends and reactivates.
// Roles that can suspend companies (owner, admin, support) can suspend schools too.

const TONES: Record<string, StatusTone> = { active: 'success', suspended: 'neutral' };

const ACTION: Record<SchoolStatusChange, { label: string; text: string }> = {
  suspended: {
    label: 'Suspend',
    text: 'Nobody in the school can use Figbloom Schools until it is reactivated, exactly as when suspended from Schools itself.',
  },
  active: { label: 'Reactivate', text: 'The school can use Figbloom Schools again.' },
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

type Load = { schools: School[] } | { problem: SchoolsProblem; message: string } | null;

export default function SchoolsPage() {
  // undefined while loading; null when not a platform admin
  const [role, setRole] = useState<PlatformRole | null | undefined>(undefined);
  const allowed = role === undefined ? null : role !== null;
  const [load, setLoad] = useState<Load>(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [acting, setActing] = useState<{ school: School; to: SchoolStatusChange } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void myPlatformRole().then(setRole);
  }, []);

  const fetchSchools = useCallback(async () => {
    setLoad(null);
    try {
      const { schools } = await listSchools();
      setLoad({ schools });
    } catch (err) {
      setLoad({ problem: schoolsProblem(err), message: err instanceof Error ? err.message : 'Could not load the schools.' });
    }
  }, []);

  useEffect(() => {
    if (allowed) void fetchSchools();
  }, [allowed, fetchSchools]);

  const schools = load && 'schools' in load ? load.schools : null;
  const totals = useMemo(() => (schools ? schoolTotals(schools) : null), [schools]);
  const tabs = useMemo(() => statusFilters(schools ?? []), [schools]);
  const shown = useMemo(() => filterSchools(schools ?? [], { status, search }), [schools, status, search]);
  const canSuspend = roleCan(role, 'suspend_companies');

  const copyId = async (school: School) => {
    try {
      await navigator.clipboard.writeText(school.id);
      toast.success(`${school.name}'s ID copied`);
    } catch {
      toast.error('Could not copy. Hover the ID to see it in full.');
    }
  };

  const open = (school: School, to: SchoolStatusChange) => {
    setReason('');
    setActing({ school, to });
  };

  const needsReason = acting?.to === 'suspended';
  const reasonOk = !needsReason || reason.trim().length > 0;

  const confirm = async () => {
    if (!acting || !reasonOk) return;
    setBusy(true);
    try {
      const updated = await setSchoolStatus(acting.school.id, acting.to, reason);
      toast.success(`${acting.school.name}: ${acting.to === 'suspended' ? 'suspended' : 'reactivated'}.`);
      setActing(null);
      if (updated && schools) setLoad({ schools: schools.map((s) => (s.id === updated.id ? updated : s)) });
      else await fetchSchools();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The school was not changed.');
    } finally {
      setBusy(false);
    }
  };

  const header = <PageHeader title="Schools" subtitle="Every school using Figbloom Schools: suspend or reactivate" />;

  if (allowed === null) return <FigbloomLoader label="Loading" />;
  if (!allowed) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <p className="text-sm text-ink">Only Figbloom platform admins can see schools.</p>
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
              <h2 className="text-sm font-semibold text-ink">Figbloom Schools isn't connected yet</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The console needs Schools' address and shared secret (SCHOOLS_PLATFORM_URL and SCHOOLS_PLATFORM_SECRET). The
                Figbloom HR pages work as usual.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-ink">
                {load.problem === 'unavailable' ? "Figbloom Schools didn't answer, try again" : 'Could not load the schools'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{load.message}</p>
              <div className="mt-3">
                <Button variant="secondary" onClick={() => void fetchSchools()}>Try again</Button>
              </div>
            </>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Schools" value={totals.schools} icon={<SchoolIcon className="w-4 h-4" />} />
          <StatCard label="Active" value={totals.active} icon={<CheckCircle2 className="w-4 h-4" />} tint="info" />
          <StatCard label="Suspended" value={totals.suspended} icon={<PauseCircle className="w-4 h-4" />} tint="danger" />
          <StatCard label="Students" value={totals.students.toLocaleString('en-KE')} icon={<GraduationCap className="w-4 h-4" />} tint="orange" />
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Status">
            {tabs.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-tile border text-[11.5px] font-semibold ${status === s ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-white text-ink hover:bg-secondary'}`}>
                {s === 'all' ? 'All' : `${statusLabel(s)} (${(schools ?? []).filter((x) => x.status === s).length})`}
              </button>
            ))}
          </div>
          <div className="ml-auto w-full sm:w-64">
            <SearchInput placeholder="Search by name, slug or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {!schools ? (
          <FigbloomLoader label="Loading schools" size={48} />
        ) : schools.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No schools on Figbloom Schools yet.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No schools match.</p>
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">School</th>
                  <th className="py-1 pr-3 font-medium">Group</th>
                  <th className="py-1 pr-3 font-medium">Admin</th>
                  <th className="py-1 pr-3 font-medium text-right">Students</th>
                  <th className="py-1 pr-3 font-medium text-right">Teachers</th>
                  <th className="py-1 pr-3 font-medium text-right">Parents</th>
                  <th className="py-1 pr-3 font-medium" title="The latest sign-in of anyone in the school">Last activity</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-3">
                      <span className="block text-ink font-semibold">{s.name}</span>
                      {/* the school's permanent ID, shortened; the button copies all of it */}
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span title={s.id}>{s.slug} · {s.id.slice(0, 8)}</span>
                        <button type="button" onClick={() => void copyId(s)} aria-label={`Copy ${s.name}'s ID`}
                          className="p-0.5 rounded hover:text-ink">
                          <Copy className="w-3 h-3" />
                        </button>
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-ink">{s.organization?.name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{s.admin_email ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">{s.students}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">{s.teachers}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">{s.parents}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{s.last_activity_at ? day(s.last_activity_at) : 'Never'}</td>
                    <td className="py-1.5 pr-3">
                      <StatusPill label={statusLabel(s.status)} tone={TONES[s.status] ?? 'neutral'} />
                      {s.status_reason && <span className="block mt-1 text-muted-foreground">{s.status_reason}</span>}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {canSuspend && s.status === 'active' && (
                        <button type="button" onClick={() => open(s, 'suspended')} className="ml-3 font-semibold text-status-danger">
                          Suspend
                        </button>
                      )}
                      {canSuspend && s.status === 'suspended' && (
                        <button type="button" onClick={() => open(s, 'active')} className="ml-3 font-semibold text-brand">
                          Reactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Modal open={!!acting} onClose={() => !busy && setActing(null)}
        title={acting ? `${ACTION[acting.to].label} ${acting.school.name}?` : ''} size="sm" closeOnBackdrop={!busy}>
        {acting && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{ACTION[acting.to].text}</p>
            <label className="block text-xs text-ink">
              {needsReason ? 'Why? (recorded in Schools with your email)' : 'Why? (optional, recorded in Schools with your email)'}
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={MAX_REASON}
                className="block mt-1 w-full rounded-lg border border-border px-2 py-1 text-sm" />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setActing(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void confirm()} disabled={busy || !reasonOk}>
                {busy ? 'Saving…' : ACTION[acting.to].label}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
