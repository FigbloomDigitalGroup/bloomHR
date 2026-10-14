import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronRight, Layers, Plus } from 'lucide-react';
import { Button, Card, EmptyState, Modal, PageHeader, StatusPill, TableScroll } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { usePermissions } from '../../hooks/usePermissions';
import {
  JobGroup,
  JobGroupRateInput,
  basicLabel,
  formatKsh,
  loadJobGroups,
  rateError,
  saveJobGroup,
  saveJobGroupRate,
} from '../../lib/jobGroups';

const inputClass = 'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand';

const today = () => new Date().toLocaleDateString('en-CA');
const dateLabel = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

interface Draft {
  code: string;
  name: string;
  band: boolean;
  basic: string;
  min: string;
  max: string;
  house: string;
  travel: string;
  other: string;
  from: string;
}

const str = (n: number | null) => (n === null ? '' : String(n));
const amount = (s: string) => (s.trim() === '' ? null : Number(s));

const draftOf = (g: JobGroup | null): Draft => ({
  code: g?.code ?? '',
  name: g?.name ?? '',
  band: !!g?.effective_from && g.basic_salary === null,
  basic: str(g?.basic_salary ?? null),
  min: str(g?.basic_min ?? null),
  max: str(g?.basic_max ?? null),
  house: str(g?.house_allowance ?? null),
  travel: str(g?.travel_allowance ?? null),
  other: str(g?.other_allowances ?? null),
  from: today(),
});

const rateOf = (d: Draft): JobGroupRateInput => ({
  effective_from: d.from,
  basic_salary: d.band ? null : amount(d.basic),
  basic_min: d.band ? amount(d.min) : null,
  basic_max: d.band ? amount(d.max) : null,
  house_allowance: amount(d.house) ?? 0,
  travel_allowance: amount(d.travel) ?? 0,
  other_allowances: amount(d.other) ?? 0,
});

const amountsOf = (d: Draft) => JSON.stringify([d.band, d.basic, d.min, d.max, d.house, d.travel, d.other].map((v) => (typeof v === 'string' ? v.trim() : v)));

/**
 * Settings → Job groups: the company's job groups and what each pays (a fixed basic salary or a band, and the
 * standard allowances) from a date. Employees on a group are paid its current amounts unless HR overrides their pay.
 * ADMIN and people with Payroll or Employees see and change them; nobody else sees the amounts.
 */
export default function JobGroupsPage() {
  const { hasAnyPermission, loading: permissionsLoading } = usePermissions();
  const allowed = !permissionsLoading && hasAnyPermission(['payroll', 'employees']);
  const [groups, setGroups] = useState<JobGroup[] | null>(null);
  const [editing, setEditing] = useState<JobGroup | 'new' | null>(null);

  const reload = useCallback(async () => {
    setGroups((await loadJobGroups()) ?? []);
  }, []);

  useEffect(() => {
    if (allowed) void reload();
  }, [allowed, reload]);

  const toggleActive = async (g: JobGroup) => {
    try {
      await saveJobGroup(g.id, { code: g.code, name: g.name, active: !g.active });
      toast.success(g.active ? `${g.code} deactivated` : `${g.code} active again`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const header = (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[11.5px] text-muted-foreground mb-2">
        <Link to="/settings" className="hover:text-brand">Settings</Link>
        <ChevronRight className="w-3 h-3" />
        <span>Job groups</span>
      </nav>
      <PageHeader
        title="Job groups"
        subtitle="What each job group pays. Employees on a group get its amounts unless their pay is overridden."
        actions={allowed && (
          <Button icon={<Plus className="w-3 h-3" strokeWidth={2.2} />} onClick={() => setEditing('new')}>Add job group</Button>
        )}
      />
    </>
  );

  if (permissionsLoading) {
    return <div className="p-4 sm:p-6"><Card className="flex items-center justify-center !p-8"><FigbloomLoader label="Loading job groups" /></Card></div>;
  }
  if (!allowed) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl">
        {header}
        <Card><p className="m-0 text-[12.5px] text-ink" role="status">Only an admin or someone with Payroll or Employees can see job groups.</p></Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      {header}
      {groups === null ? (
        <Card className="flex items-center justify-center !p-8"><FigbloomLoader label="Loading job groups" /></Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Layers className="w-5 h-5" />}
            title="No job groups yet"
            description="Add your job groups and what they pay, then choose a group on each employee."
            action={<Button onClick={() => setEditing('new')}>Add job group</Button>}
          />
        </Card>
      ) : (
        <Card className="!p-0">
          <TableScroll>
            <table className="w-full min-w-[760px] text-left text-[12.5px]">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Group</th>
                  <th className="px-4 py-2.5 font-semibold">Basic salary</th>
                  <th className="px-4 py-2.5 font-semibold">House</th>
                  <th className="px-4 py-2.5 font-semibold">Travel</th>
                  <th className="px-4 py-2.5 font-semibold">Other</th>
                  <th className="px-4 py-2.5 font-semibold">Employees</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink">{g.code}</div>
                      {g.name !== g.code && <div className="text-[11.5px] text-muted-foreground">{g.name}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-ink">{basicLabel(g)}</div>
                      {g.effective_from && <div className="text-[11px] text-muted-foreground">from {dateLabel(g.effective_from)}</div>}
                      {g.next_effective_from && <div className="text-[11px] text-status-info">new amounts from {dateLabel(g.next_effective_from)}</div>}
                    </td>
                    <td className="px-4 py-3">{g.effective_from ? formatKsh(g.house_allowance) : '—'}</td>
                    <td className="px-4 py-3">{g.effective_from ? formatKsh(g.travel_allowance) : '—'}</td>
                    <td className="px-4 py-3">{g.effective_from ? formatKsh(g.other_allowances) : '—'}</td>
                    <td className="px-4 py-3">{g.employee_count}</td>
                    <td className="px-4 py-3"><StatusPill label={g.active ? 'Active' : 'Inactive'} tone={g.active ? 'success' : 'neutral'} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button variant="secondary" onClick={() => setEditing(g)} aria-label={`Edit ${g.code}`}>Edit</Button>
                        <Button variant="ghost" onClick={() => void toggleActive(g)} aria-label={`${g.active ? 'Deactivate' : 'Reactivate'} ${g.code}`}>
                          {g.active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      {editing && (
        <JobGroupForm
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-ink mb-1">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function JobGroupForm({ group, onClose, onSaved }: { group: JobGroup | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(group));
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const original = draftOf(group);
  // amounts are saved when they changed (a new group: when any are given); then they need a date
  const amountsChanged = amountsOf(draft) !== amountsOf(original);
  const anyAmount = draft.band ? draft.min.trim() !== '' || draft.max.trim() !== '' : draft.basic.trim() !== '';
  const saveRate = amountsChanged && (anyAmount || !!group?.effective_from);
  const rate = rateOf(draft);
  const problem = !draft.code.trim()
    ? 'Give the group a code'
    : !draft.name.trim()
      ? 'Give the group a name'
      : saveRate
        ? rateError(rate, draft.band)
        : null;
  const changed = !group || draft.code.trim() !== group.code || draft.name.trim() !== group.name || saveRate;

  const save = async () => {
    setBusy(true);
    try {
      const id = await saveJobGroup(group?.id ?? null, { code: draft.code, name: draft.name });
      if (saveRate) await saveJobGroupRate(id, rate);
      toast.success(saveRate && rate.effective_from <= today()
        ? `${draft.code.trim()} saved; employees on it now get the new amounts`
        : `${draft.code.trim()} saved`);
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={group ? `Edit ${group.code}` : 'Add job group'} size="2xl" closeOnBackdrop={!busy}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <Field label="Code" hint="Unique in your company, e.g. JG5 or Grade A">
          <input className={inputClass} value={draft.code} maxLength={40} onChange={set('code')} />
        </Field>
        <Field label="Name">
          <input className={inputClass} value={draft.name} maxLength={80} onChange={set('name')} placeholder="e.g. Senior officers" />
        </Field>
      </div>

      <div role="radiogroup" aria-label="Kind of basic salary" className="mt-4 flex flex-wrap gap-4 text-[12.5px] text-ink">
        <label className="flex items-center gap-2">
          <input type="radio" name="basic-kind" checked={!draft.band} onChange={() => setDraft((d) => ({ ...d, band: false }))} className="accent-brand" />
          A fixed basic salary
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="basic-kind" checked={draft.band} onChange={() => setDraft((d) => ({ ...d, band: true }))} className="accent-brand" />
          A band (lowest to highest)
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        {draft.band ? (
          <>
            <Field label="Lowest basic salary"><input className={inputClass} type="number" inputMode="decimal" min={0} value={draft.min} onChange={set('min')} /></Field>
            <Field label="Highest basic salary"><input className={inputClass} type="number" inputMode="decimal" min={0} value={draft.max} onChange={set('max')} /></Field>
          </>
        ) : (
          <Field label="Basic salary" hint="Per month"><input className={inputClass} type="number" inputMode="decimal" min={0} value={draft.basic} onChange={set('basic')} /></Field>
        )}
        <Field label="House allowance"><input className={inputClass} type="number" inputMode="decimal" min={0} value={draft.house} onChange={set('house')} /></Field>
        <Field label="Travel allowance"><input className={inputClass} type="number" inputMode="decimal" min={0} value={draft.travel} onChange={set('travel')} /></Field>
        <Field label="Other allowances"><input className={inputClass} type="number" inputMode="decimal" min={0} value={draft.other} onChange={set('other')} /></Field>
        <Field label="Amounts start on" hint="Not in a month whose payroll is approved">
          <input className={inputClass} type="date" value={draft.from} onChange={set('from')} />
        </Field>
      </div>

      {group && group.employee_count > 0 && saveRate && (
        <p className="mt-3 mb-0 text-[12px] text-muted-foreground">
          The {group.employee_count} employee{group.employee_count === 1 ? '' : 's'} on this group get the new amounts from that date,
          except those whose pay is overridden.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[12.5px]" role="status" aria-live="polite">
          {problem && <span className="text-red-600">{problem}</span>}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || !changed || !!problem}>{busy ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
