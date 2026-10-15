import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, StatusPill, StatusTone, TableScroll } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { usePermissions } from '../../hooks/usePermissions';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_TABLE_LABELS,
  AuditAction,
  AuditEntry,
  AuditFilters,
  actionLabel,
  fieldChanges,
  fieldLabel,
  loadAuditPeople,
  loadAuditTrail,
  tableLabel,
  valueText,
} from '../../lib/auditTrail';

const inputClass = 'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand';

const ACTION_TONES: Record<AuditAction, StatusTone> = { INSERT: 'success', UPDATE: 'info', DELETE: 'danger', VIEW: 'neutral' };

const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// the record types in the filter, by their on-screen name
const TABLE_OPTIONS = Object.keys(AUDIT_TABLE_LABELS).sort((a, b) => tableLabel(a).localeCompare(tableLabel(b)));

/** What an entry did, in a line: the fields changed, or how many were set when a record was added or deleted. */
function summary(e: AuditEntry) {
  const fields = fieldChanges(e);
  if (e.action_type === 'VIEW') return 'Opened the records';
  if (fields.length === 0) return '';
  if (e.action_type === 'UPDATE') {
    const names = fields.map((f) => fieldLabel(f.field));
    return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  }
  return `${fields.length} field${fields.length === 1 ? '' : 's'}`;
}

/**
 * Settings → Audit trail: every recorded change in the company, newest first: who, when, which record and what
 * changed. ADMIN and people with Settings see it; nobody can change it.
 */
export default function AuditTrailPage() {
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const allowed = !permissionsLoading && hasPermission('settings');
  const [filters, setFilters] = useState<AuditFilters>({});
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // the record search waits for typing to stop
  const [recordInput, setRecordInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.record === recordInput ? f : { ...f, record: recordInput }));
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [recordInput]);

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    setRows(null);
    setError(null);
    loadAuditTrail(filters, page)
      .then(async (r) => {
        const names = await loadAuditPeople(r.rows.map((e) => e.performed_by).filter((id): id is string => !!id));
        if (!live) return;
        setRows(r.rows);
        setMore(r.more);
        setPeople((p) => ({ ...p, ...names }));
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [allowed, filters, page]);

  const setFilter = (patch: Partial<AuditFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  };
  const filtered = useMemo(() => Object.values(filters).some(Boolean), [filters]);

  const header = (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[11.5px] text-muted-foreground mb-2">
        <Link to="/settings" className="hover:text-brand">Settings</Link>
        <ChevronRight className="w-3 h-3" />
        <span>Audit trail</span>
      </nav>
      <PageHeader title="Audit trail" subtitle="Every recorded change in your company: who made it, when, and what changed." />
    </>
  );

  if (permissionsLoading) {
    return <div className="p-4 sm:p-6"><Card className="flex items-center justify-center !p-8"><FigbloomLoader label="Loading the audit trail" /></Card></div>;
  }
  if (!allowed) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl">
        {header}
        <Card><p className="m-0 text-[12.5px] text-ink" role="status">Only an admin or someone with Settings can see the audit trail.</p></Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      {header}

      <Card className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <label className="block">
          <span className="block text-[12px] font-semibold text-ink mb-1">Record type</span>
          <select className={inputClass} value={filters.table ?? ''} onChange={(e) => setFilter({ table: e.target.value })}>
            <option value="">All</option>
            {TABLE_OPTIONS.map((t) => <option key={t} value={t}>{tableLabel(t)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[12px] font-semibold text-ink mb-1">Action</span>
          <select className={inputClass} value={filters.action ?? ''} onChange={(e) => setFilter({ action: e.target.value as AuditAction | '' })}>
            <option value="">All</option>
            {(Object.keys(AUDIT_ACTION_LABELS) as AuditAction[]).map((a) => <option key={a} value={a}>{AUDIT_ACTION_LABELS[a]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[12px] font-semibold text-ink mb-1">From</span>
          <input type="date" className={inputClass} value={filters.from ?? ''} onChange={(e) => setFilter({ from: e.target.value })} />
        </label>
        <label className="block">
          <span className="block text-[12px] font-semibold text-ink mb-1">To</span>
          <input type="date" className={inputClass} value={filters.to ?? ''} onChange={(e) => setFilter({ to: e.target.value })} />
        </label>
        <label className="block">
          <span className="block text-[12px] font-semibold text-ink mb-1">Employee number or record</span>
          <input className={inputClass} value={recordInput} onChange={(e) => setRecordInput(e.target.value)} placeholder="e.g. MCL-000012" />
        </label>
      </Card>

      {error ? (
        <Card><p className="m-0 text-[12.5px] text-red-600" role="alert">Could not load the audit trail: {error}</p></Card>
      ) : rows === null ? (
        <Card className="flex items-center justify-center !p-8"><FigbloomLoader label="Loading the audit trail" /></Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<History className="w-5 h-5" />}
            title={filtered || page > 0 ? 'Nothing matches' : 'No changes recorded yet'}
            description={filtered || page > 0 ? 'Try other filters.' : 'Changes to employees, payroll, settings and more show here as they happen.'}
          />
        </Card>
      ) : (
        <Card className="!p-0">
          <TableScroll>
            <table className="w-full min-w-[760px] text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="w-8 px-3 py-2.5" aria-label="Details" />
                  <th className="px-3 py-2.5 font-semibold">When</th>
                  <th className="px-3 py-2.5 font-semibold">Who</th>
                  <th className="px-3 py-2.5 font-semibold">Action</th>
                  <th className="px-3 py-2.5 font-semibold">Record</th>
                  <th className="px-3 py-2.5 font-semibold">What</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const isOpen = open === e.id;
                  const changes = fieldChanges(e);
                  const action = (e.action_type ?? '').toUpperCase() as AuditAction;
                  return (
                    <Fragment key={e.id}>
                      <tr className="border-b border-border last:border-0 align-top">
                        <td className="px-3 py-2.5">
                          {changes.length > 0 && (
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={isOpen ? 'Hide the changes' : 'Show the changes'}
                              onClick={() => setOpen(isOpen ? null : e.id)}
                              className="rounded p-0.5 text-subtle hover:text-ink"
                            >
                              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-ink">{whenLabel(e.performed_at)}</td>
                        <td className="px-3 py-2.5 text-ink">
                          {e.performed_by ? people[e.performed_by] ?? 'Unknown user' : <span className="text-muted-foreground">System</span>}
                        </td>
                        <td className="px-3 py-2.5"><StatusPill label={actionLabel(e.action_type)} tone={ACTION_TONES[action] ?? 'neutral'} /></td>
                        <td className="px-3 py-2.5 text-ink">
                          <span className="block font-semibold">{tableLabel(e.table_name)}</span>
                          {e.record_key && <span className="block font-mono text-[11px] text-muted-foreground break-all">{e.record_key}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{summary(e)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-border bg-secondary/50">
                          <td />
                          <td colSpan={5} className="px-3 py-3">
                            <table className="w-full text-[12px]">
                              <thead>
                                <tr className="text-[11px] text-muted-foreground">
                                  <th className="py-1 pr-3 font-semibold w-1/4">Field</th>
                                  {action !== 'INSERT' && <th className="py-1 pr-3 font-semibold">Before</th>}
                                  {action !== 'DELETE' && <th className="py-1 font-semibold">After</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {changes.map((c) => (
                                  <tr key={c.field} className="align-top">
                                    <td className="py-1 pr-3 font-semibold text-ink">{fieldLabel(c.field)}</td>
                                    {action !== 'INSERT' && <td className="py-1 pr-3 text-muted-foreground break-all">{valueText(c.before)}</td>}
                                    {action !== 'DELETE' && <td className="py-1 text-ink break-all">{valueText(c.after)}</td>}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      {rows !== null && (page > 0 || more) && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="text-[12px] text-muted-foreground">Page {page + 1}</span>
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</Button>
          <Button variant="secondary" disabled={!more} onClick={() => setPage(page + 1)}>Older</Button>
        </div>
      )}
    </div>
  );
}
