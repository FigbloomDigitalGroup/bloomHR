import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Activity, Building2, Clock, PauseCircle } from 'lucide-react';
import { Button, Card, Modal, PageHeader, SearchInput, StatCard, StatusPill, TableScroll } from '../UI';
import type { StatusTone } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { isPlatformAdmin } from '../../lib/platformRates';
import {
  COMPANY_STATUSES, STATUS_LABELS, actionsFor, filterOrganisations, listOrganisations, organisationTotals, setAutoApprove, setCompanyStatus,
  type CompanyAction, type CompanyStatus, type Organisation, type OrganisationTotals,
} from '../../lib/platformOrganisations';

// Every company on the platform, for Figbloom's platform admins (migration 20261029100000_platform_organisations.sql):
// approve or reject a new company, suspend or reactivate one, and choose whether new companies wait for approval.
// The page checks is_platform_admin(), and the database refuses anyone else.

const TONES: Record<CompanyStatus, StatusTone> = { pending: 'warning', active: 'success', rejected: 'danger', suspended: 'neutral' };

const ACTION_LABELS: Record<CompanyAction, string> = { approve: 'Approve', reject: 'Reject', suspend: 'Suspend', reactivate: 'Reactivate' };

const ACTION_TEXT: Record<CompanyAction, string> = {
  approve: 'The company can start using Figbloom HR straight away. Its owner gets an email.',
  reject: 'The company stays closed. Its owner sees that it was not approved, with your reason.',
  suspend: 'Nobody in the company can use it until it is reactivated. People who also belong to another company keep that one.',
  reactivate: 'The company can use Figbloom HR again.',
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const weekLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

export default function OrganisationsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [list, setList] = useState<Organisation[] | null>(null);
  const [totals, setTotals] = useState<OrganisationTotals | null>(null);
  const [status, setStatus] = useState<CompanyStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [acting, setActing] = useState<{ org: Organisation; action: CompanyAction } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void isPlatformAdmin().then(setAllowed);
  }, []);

  const load = useCallback(async () => {
    try {
      const [l, t] = await Promise.all([listOrganisations(), organisationTotals()]);
      setList(l);
      setTotals(t);
    } catch (err) {
      setList([]);
      toast.error(err instanceof Error ? err.message : 'Could not load the companies.');
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const shown = useMemo(() => filterOrganisations(list ?? [], { status, search }), [list, status, search]);

  const open = (org: Organisation, action: CompanyAction) => {
    setReason('');
    setActing({ org, action });
  };

  const confirm = async () => {
    if (!acting) return;
    if (acting.action === 'reject' && !reason.trim()) return;
    setBusy(true);
    try {
      const to = await setCompanyStatus(acting.org.id, acting.action, reason);
      toast.success(`${acting.org.name}: ${STATUS_LABELS[to].toLowerCase()}.`);
      setActing(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The company was not changed.');
    } finally {
      setBusy(false);
    }
  };

  const toggleAuto = async () => {
    if (!totals) return;
    try {
      const on = await setAutoApprove(!totals.auto_approve);
      setTotals({ ...totals, auto_approve: on });
      toast.success(on ? 'New companies are now approved automatically.' : 'New companies now wait for your approval.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The setting was not saved.');
    }
  };

  if (allowed === null) return <FigbloomLoader label="Loading" />;
  if (!allowed) {
    return (
      <div className="space-y-4">
        <PageHeader title="Organisations" subtitle="Every company on Figbloom HR" />
        <Card>
          <p className="text-sm text-ink">Only Figbloom platform admins can see and approve companies.</p>
        </Card>
      </div>
    );
  }

  const maxWeek = Math.max(1, ...(totals?.signups_by_week ?? []).map((w) => w.count));

  return (
    <div className="space-y-4">
      <PageHeader title="Organisations" subtitle="Every company on Figbloom HR: approve new ones, suspend or reactivate" />

      {totals && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Waiting for approval" value={totals.by_status.pending} icon={<Clock className="w-4 h-4" />} tint="orange" />
            <StatCard label="Active companies" value={totals.by_status.active} icon={<Building2 className="w-4 h-4" />}
              note={`${totals.by_status.total} in all`} />
            <StatCard label="Active in the last 7 days" value={totals.active_last_7_days} icon={<Activity className="w-4 h-4" />} tint="info"
              note="someone signed in" />
            <StatCard label="Suspended or not approved" value={totals.by_status.suspended + totals.by_status.rejected}
              icon={<PauseCircle className="w-4 h-4" />} tint="danger"
              note={`${totals.by_status.suspended} suspended, ${totals.by_status.rejected} not approved`} />
          </div>

          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <Card>
              <h2 className="text-sm font-semibold text-ink mb-3">New sign-ups per week</h2>
              <ul className="space-y-1.5" aria-label="New sign-ups per week">
                {totals.signups_by_week.map((w) => (
                  <li key={w.week} className="flex items-center gap-3 text-xs">
                    <span className="w-24 shrink-0 text-muted-foreground">Week of {weekLabel(w.week)}</span>
                    <span className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                      <span className="block h-full bg-brand rounded-full" style={{ width: `${(w.count / maxWeek) * 100}%` }} />
                    </span>
                    <span className="w-6 text-right font-semibold text-ink">{w.count}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <h2 className="text-sm font-semibold text-ink">Approving new companies</h2>
              <label className="mt-3 flex items-start gap-2 text-xs text-ink cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={totals.auto_approve} onChange={() => void toggleAuto()} />
                <span>
                  Approve new companies automatically
                  <span className="block text-muted-foreground mt-0.5">
                    {totals.auto_approve
                      ? 'On: a new company can use the app as soon as it signs up.'
                      : 'Off: a new company waits on this page until you approve it.'}
                  </span>
                </span>
              </label>
            </Card>
          </div>
        </>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Status">
            {(['all', ...COMPANY_STATUSES] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-tile border text-[11.5px] font-semibold ${status === s ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-white text-ink hover:bg-secondary'}`}>
                {s === 'all' ? 'All' : STATUS_LABELS[s]}
                {totals && s !== 'all' ? ` (${totals.by_status[s]})` : ''}
              </button>
            ))}
          </div>
          <div className="ml-auto w-full sm:w-64">
            <SearchInput placeholder="Search by company name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {!list ? (
          <FigbloomLoader label="Loading companies" size={48} />
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No companies match.</p>
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Company</th>
                  <th className="py-1 pr-3 font-medium">Signed up</th>
                  <th className="py-1 pr-3 font-medium">Owner</th>
                  <th className="py-1 pr-3 font-medium">Plan</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 pr-3 font-medium text-right">Employees</th>
                  <th className="py-1 pr-3 font-medium text-right">Users</th>
                  <th className="py-1 pr-3 font-medium text-right">Payroll runs</th>
                  <th className="py-1 pr-3 font-medium" title="The latest sign-in of anyone in the company">Last sign-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-3 text-ink font-semibold">{o.name}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{day(o.created_at)}</td>
                    <td className="py-1.5 pr-3 text-ink">
                      {o.owner_name && <span className="block">{o.owner_name}</span>}
                      <span className="text-muted-foreground">{o.owner_email ?? '—'}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground capitalize">{o.plan}</td>
                    <td className="py-1.5 pr-3">
                      <StatusPill label={STATUS_LABELS[o.status] ?? o.status} tone={TONES[o.status] ?? 'neutral'} />
                      {o.status_reason && <span className="block mt-1 text-muted-foreground">{o.status_reason}</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-ink">{o.employees}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">{o.users}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">{o.payroll_runs}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{o.last_activity ? day(o.last_activity) : 'Never'}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {actionsFor(o.status).map((a) => (
                        <button key={a} type="button" onClick={() => open(o, a)}
                          className={`ml-3 font-semibold ${a === 'reject' || a === 'suspend' ? 'text-status-danger' : 'text-brand'}`}>
                          {ACTION_LABELS[a]}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Modal open={!!acting} onClose={() => !busy && setActing(null)} title={acting ? `${ACTION_LABELS[acting.action]} ${acting.org.name}?` : ''} size="sm"
        closeOnBackdrop={!busy}>
        {acting && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{ACTION_TEXT[acting.action]}</p>
            {acting.action !== 'approve' && acting.action !== 'reactivate' && (
              <label className="block text-xs text-ink">
                {acting.action === 'reject' ? 'Why? (the owner sees this)' : 'Why? (optional, the owner sees this)'}
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000}
                  className="block mt-1 w-full rounded-lg border border-border px-2 py-1 text-sm" />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setActing(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void confirm()} disabled={busy || (acting.action === 'reject' && !reason.trim())}>
                {busy ? 'Saving…' : ACTION_LABELS[acting.action]}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
