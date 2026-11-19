import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Info, Plus } from 'lucide-react';
import { Button, Card, Modal, PageHeader, SearchInput, StatusPill, TableScroll } from '../UI';
import type { StatusTone } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import ConsoleStatRow, { ConsoleStat } from './ConsoleStat';
import { myPlatformRole, roleCan, type PlatformRole } from '../../lib/platformRoles';
import {
  CRM_STATUSES, CRM_STATUS_LABELS, MAX_CRM_REASON, createCrmOrganisation, crmActions, crmProblem, crmTotals, fieldErrorsByPath,
  filterOrganisations, getCrmOrganisation, listCrmOrganisations, registered, setCrmOrganisationStatus, statusOf,
  type CrmAction, type CrmOrganisation, type CrmOrganisationsList, type CrmProblem,
} from '../../lib/platformCrm';

// Figbloom CRM's organisations (ERP/CRM_PLATFORM_CONTRACT.md 3): CRM's own summaries (admin, members, invitations, leads,
// open deals, companies, last activity: counts only, CRM sends no deal values or customer data) with the platform's
// status for each. The same page as Fleet's companies, with two differences: Figbloom staff create organisations here
// (New organisation: CRM provisions it and invites its admin), and there is nothing to approve, so an organisation is
// only suspended (with a reason) or reactivated, on the Figbloom platform, which tells CRM. Creating, suspending and
// reactivating are Owner/Admin (approve_companies); every console role sees the list. An organisation opens a detail
// panel. A new organisation can't be suspended until CRM has registered it with the platform (within a minute).

const TONES: Record<string, StatusTone> = {
  active: 'success', suspended: 'neutral', inactive: 'neutral', pending: 'warning', rejected: 'danger', unregistered: 'neutral',
};

const LABELS: Record<CrmAction, string> = { suspend: 'Suspend', reactivate: 'Reactivate' };

const NOT_REGISTERED =
  'Figbloom CRM registers a new organisation with the Figbloom platform within a minute. It can be suspended or reactivated once it has.';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const moment = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const n = (v: number) => v.toLocaleString('en-KE');
const num = (v: number | null) => (v === null ? '—' : n(v));

function actionText(action: CrmAction) {
  return action === 'suspend'
    ? "Suspends the organisation: its members can't use Figbloom CRM until it is reactivated. Its data is kept, and its website forms and inbound email keep collecting leads."
    : 'The organisation can use Figbloom CRM again, with everything as it was.';
}

type Load = CrmOrganisationsList | { problem: CrmProblem; message: string } | null;

const EMPTY_FORM = { name: '', slug: '', adminName: '', adminEmail: '' };
type FormField = keyof typeof EMPTY_FORM;
const FORM_FIELDS: { key: FormField; label: string; type: string; max: number; hint?: string }[] = [
  { key: 'name', label: 'Organisation name', type: 'text', max: 200 },
  { key: 'slug', label: 'Slug (optional)', type: 'text', max: 63, hint: 'Its short name in CRM, e.g. acme-insurance. Left empty, CRM makes one from the name.' },
  { key: 'adminName', label: "Admin's name", type: 'text', max: 200 },
  { key: 'adminEmail', label: "Admin's email", type: 'email', max: 254, hint: 'CRM emails them an invitation to manage the organisation.' },
];

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-t border-border/60 py-1.5 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

export default function CrmOrganisationsPage() {
  // undefined while loading; null when not a platform admin
  const [role, setRole] = useState<PlatformRole | null | undefined>(undefined);
  const allowed = role === undefined ? null : role !== null;
  const [load, setLoad] = useState<Load>(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<CrmOrganisation | null>(null);
  const [acting, setActing] = useState<{ organisation: CrmOrganisation; action: CrmAction } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void myPlatformRole().then(setRole);
  }, []);

  const fetchOrganisations = useCallback(async () => {
    setLoad(null);
    try {
      setLoad(await listCrmOrganisations());
    } catch (err) {
      setLoad({ problem: crmProblem(err), message: err instanceof Error ? err.message : 'Could not load the CRM organisations.' });
    }
  }, []);

  useEffect(() => {
    if (allowed) void fetchOrganisations();
  }, [allowed, fetchOrganisations]);

  const list = load && 'organizations' in load ? load : null;
  const organisations = list?.organizations ?? null;
  const platformOk = !list || list.platform.ok;
  const totals = useMemo(() => (organisations ? crmTotals(organisations) : null), [organisations]);
  const shown = useMemo(() => filterOrganisations(organisations ?? [], { status, search }), [organisations, status, search]);
  const canManage = roleCan(role, 'approve_companies');

  const actionsFor = (o: CrmOrganisation) => (platformOk && canManage ? crmActions(o) : []);

  const view = (o: CrmOrganisation) => {
    setViewing(o);
    if (!o.in_crm || !o.id) return;
    // the latest counts; the row's are shown meanwhile, and kept if CRM doesn't answer
    getCrmOrganisation(o.id).then(
      (fresh) => setViewing((v) => (v && v.id === fresh.id ? fresh : v)),
      () => {}
    );
  };

  const open = (organisation: CrmOrganisation, action: CrmAction) => {
    setReason('');
    setViewing(null);
    setActing({ organisation, action });
  };

  const reasonOk = !acting || acting.action !== 'suspend' || reason.trim().length > 0;

  const confirm = async () => {
    if (!acting || !reasonOk || !list || !acting.organisation.organization_id) return;
    setBusy(true);
    try {
      const updated = await setCrmOrganisationStatus(acting.organisation.organization_id, acting.action, reason);
      const label = CRM_STATUS_LABELS[updated?.status ?? ''] ?? updated?.status ?? 'changed';
      toast.success(`${acting.organisation.name}: ${label.toLowerCase()}. Figbloom CRM applies it within a minute.`);
      setActing(null);
      if (updated) {
        setLoad({
          ...list,
          organizations: list.organizations.map((o) =>
            o.organization_id === updated.organization_id ? { ...o, status: updated.status, status_reason: updated.status_reason } : o
          ),
        });
      } else await fetchOrganisations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The organisation was not changed.');
    } finally {
      setBusy(false);
    }
  };

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setFormError(null);
    setCreating(true);
  };

  const formOk = !!(form.name.trim() && form.adminName.trim() && form.adminEmail.trim());

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!formOk || busy) return;
    setBusy(true);
    setFormErrors({});
    setFormError(null);
    try {
      const created = await createCrmOrganisation(form);
      toast.success(`${created.name} created in Figbloom CRM. ${created.admin_email ?? form.adminEmail.trim()} has been invited.`);
      setCreating(false);
      setLoad((l) => (l && 'organizations' in l ? { ...l, organizations: [created, ...l.organizations.filter((o) => o.id !== created.id)] } : l));
    } catch (err) {
      const fields = fieldErrorsByPath(err);
      setFormErrors(fields);
      const message = err instanceof Error ? err.message : 'The organisation was not created.';
      // the message once, under the form, unless it only repeats a field's
      if (!Object.values(fields).includes(message)) setFormError(message);
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <PageHeader title="CRM organisations" subtitle="Figbloom CRM's organisations: open one for a customer, suspend or reactivate one"
      actions={canManage && list ? <Button icon={<Plus className="w-4 h-4" aria-hidden="true" />} onClick={startCreate}>New organisation</Button> : undefined} />
  );

  if (allowed === null) return <FigbloomLoader label="Loading" />;
  if (!allowed) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <p className="text-sm text-ink">Only Figbloom platform admins can see CRM organisations.</p>
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
              <h2 className="text-sm font-semibold text-ink">CRM isn't connected to the console yet</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The console needs CRM's address and its shared secret (CRM_PLATFORM_URL and CRM_PLATFORM_SECRET).
                The other Figbloom products work as usual.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-ink">
                {load.problem === 'unavailable' ? "Figbloom CRM didn't answer, try again" : 'Could not load the CRM organisations'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{load.message}</p>
              <div className="mt-3">
                <Button variant="secondary" onClick={() => void fetchOrganisations()}>Try again</Button>
              </div>
            </>
          )}
        </Card>
      </div>
    );
  }

  const extra = Object.keys(CRM_STATUS_LABELS).filter((s) => !CRM_STATUSES.includes(s) && (organisations ?? []).some((o) => statusOf(o) === s));
  const tabs = ['all', ...CRM_STATUSES, ...extra];

  return (
    <div className="space-y-4">
      {header}

      {list && !list.platform.ok && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-white px-4 py-3 text-xs text-ink" role="note">
          <Info className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            {list.platform.code === 'platform_not_connected'
              ? "The Figbloom platform isn't connected to the console, so organisations show CRM's own status and can't be suspended or reactivated here."
              : `The Figbloom platform couldn't be read (${list.platform.message}), so organisations show CRM's own status and can't be suspended or reactivated until it is back.`}
          </span>
        </p>
      )}

      {totals && (
        <ConsoleStatRow label="CRM organisation totals">
          <ConsoleStat label="Organisations" value={n(totals.organisations)} sub={`${n(totals.members)} active members`} />
          <ConsoleStat label="Active" value={n(totals.active)} />
          <ConsoleStat label="Suspended" value={n(totals.suspended)} />
        </ConsoleStatRow>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Status">
            {tabs.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-tile border text-[11.5px] font-semibold ${status === s ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-white text-ink hover:bg-secondary'}`}>
                {s === 'all' ? 'All' : `${CRM_STATUS_LABELS[s]} (${(organisations ?? []).filter((o) => statusOf(o) === s).length})`}
              </button>
            ))}
          </div>
          <div className="ml-auto w-full sm:w-72">
            <SearchInput placeholder="Search by organisation or admin" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {!organisations ? (
          <FigbloomLoader label="Loading CRM organisations" size={48} />
        ) : organisations.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No organisations in Figbloom CRM yet.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No organisations match.</p>
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Organisation</th>
                  <th className="py-1 pr-3 font-medium">Slug</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 pr-3 font-medium">Admin</th>
                  <th className="py-1 pr-3 font-medium text-right">Members</th>
                  <th className="py-1 pr-3 font-medium">Last activity</th>
                  <th className="py-1 pr-3 font-medium">Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => {
                  const s = statusOf(o);
                  return (
                    <tr key={o.organization_id ?? o.id} className="border-t border-border/60 align-top">
                      <td className="py-1.5 pr-3">
                        <button type="button" onClick={() => view(o)} className="text-left font-semibold text-ink hover:text-brand hover:underline">
                          {o.name}
                        </button>
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground font-mono text-[11px]">{o.slug ?? '—'}</td>
                      <td className="py-1.5 pr-3">
                        <StatusPill label={CRM_STATUS_LABELS[s] ?? s} tone={TONES[s] ?? 'neutral'} />
                        {o.status_reason && <span className="block mt-1 text-muted-foreground">{o.status_reason}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {o.admin_name && <span className="block text-ink">{o.admin_name}</span>}
                        {o.admin_email ?? (o.admin_name ? null : '—')}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-ink tabular-nums">{num(o.active_members)}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{moment(o.last_activity_at)}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{day(o.created_at)}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {actionsFor(o).map((a) => (
                          <button key={a} type="button" onClick={() => open(o, a)}
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
        {list?.truncated && <p className="mt-2 text-[11.5px] text-muted-foreground">Showing the newest 2,000 organisations on the platform.</p>}
      </Card>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name ?? ''} size="md">
        {viewing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill label={CRM_STATUS_LABELS[statusOf(viewing)] ?? statusOf(viewing)} tone={TONES[statusOf(viewing)] ?? 'neutral'} />
              {viewing.status_reason && <span className="text-xs text-muted-foreground">{viewing.status_reason}</span>}
            </div>
            {!viewing.in_crm && (
              <p className="text-xs text-muted-foreground">On the Figbloom platform, but not in Figbloom CRM's list: CRM sent no summary for it.</p>
            )}
            <dl aria-label="Organisation details">
              <Detail label="Slug"><span className="font-mono text-[11px]">{viewing.slug ?? '—'}</span></Detail>
              <Detail label="Admin">{viewing.admin_name ?? '—'}</Detail>
              <Detail label="Admin email">{viewing.admin_email ?? '—'}</Detail>
              <Detail label="Active members">{num(viewing.active_members)}</Detail>
              <Detail label="Pending invitations">{num(viewing.pending_invitations)}</Detail>
              <Detail label="Leads">{num(viewing.leads)}</Detail>
              <Detail label="Open deals">{num(viewing.open_deals)}</Detail>
              <Detail label="Companies">{num(viewing.companies)}</Detail>
              <Detail label="Last activity">{moment(viewing.last_activity_at)}</Detail>
              <Detail label="Created">{day(viewing.created_at)}</Detail>
              <Detail label="Status in CRM">{viewing.crm_status ? CRM_STATUS_LABELS[viewing.crm_status] ?? viewing.crm_status : '—'}</Detail>
              <Detail label="CRM ID"><span className="font-mono text-[11px]">{viewing.id || '—'}</span></Detail>
              <Detail label="Platform ID">
                <span className="font-mono text-[11px]">{viewing.organization_id ?? viewing.platform_organization_id ?? 'not registered yet'}</span>
              </Detail>
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
        title={acting ? `${LABELS[acting.action]} ${acting.organisation.name}?` : ''} size="sm" closeOnBackdrop={!busy}>
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
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={MAX_CRM_REASON}
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

      <Modal open={creating} onClose={() => !busy && setCreating(false)} title="New CRM organisation" size="md" closeOnBackdrop={!busy}>
        <form className="space-y-3" onSubmit={(e) => void submitCreate(e)} noValidate>
          <p className="text-xs text-muted-foreground">
            Figbloom CRM creates the organisation with its usual defaults and emails its admin an invitation. Recorded in
            CRM's audit history with your email.
          </p>
          {FORM_FIELDS.map((f) => {
            const error = formErrors[f.key];
            const id = `crm-new-${f.key}`;
            const noteId = `${id}-note`;
            const note = error ?? f.hint;
            return (
              <div key={f.key} className="text-xs text-ink">
                <label htmlFor={id} className="block">{f.label}</label>
                <input id={id} type={f.type} value={form[f.key]} maxLength={f.max} autoComplete="off"
                  onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
                  aria-invalid={error ? true : undefined} aria-describedby={note ? noteId : undefined}
                  className={`block mt-1 w-full rounded-lg border px-2 py-1.5 text-sm ${error ? 'border-status-danger' : 'border-border'}`} />
                {note && <span id={noteId} className={`block mt-1 ${error ? 'text-status-danger' : 'text-muted-foreground'}`}>{note}</span>}
              </div>
            );
          })}
          {formError && <p className="text-xs text-status-danger" role="alert">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !formOk}>{busy ? 'Creating…' : 'Create organisation'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
