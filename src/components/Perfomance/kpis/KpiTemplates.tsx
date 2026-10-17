import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, LayoutTemplate, Pencil, Play, Plus, Trash2, Users } from 'lucide-react';
import { Button, Card, EmptyState, Modal, StatusPill, TableScroll } from '../../UI';
import { confirmDialog } from '../../../lib/confirmDialog';
import { formatNumber, formatValue, parseNumber } from '../../../lib/kpis';
import type { Kpi, KpiPeriod, KpiPerson } from '../../../lib/kpiApi';
import { departmentPath, type Department } from '../../../lib/orgStructure';
import { loadJobGroupChoices, loadJobTitles, type JobGroupChoice, type JobTitle } from '../../../lib/jobTitles';
import {
  PRIORITY_ORDER,
  SCOPE_LABEL,
  applyKpiTemplates,
  deleteKpiTemplate,
  loadKpiTemplates,
  loadTemplateMembers,
  previewEmployees,
  saveKpiTemplate,
  setKpiTemplateActive,
  targetOf,
  templateProblem,
  templateWeights,
  type KpiTemplateInput,
  type KpiTemplateRecord,
  type TemplateMember,
  type TemplateScope,
} from '../../../lib/kpiTemplates';
import { inputClass, labelClass, tdClass, thClass } from './shared';

interface Props {
  kpis: Kpi[];
  periods: KpiPeriod[];
  people: KpiPerson[];
  departments: Department[];
}

const SCOPES: TemplateScope[] = ['department', 'job_title', 'job_group', 'everyone'];

/**
 * KPI templates: sets of KPIs for a department, a job title, a job group or everyone, given to people automatically
 * when a review period opens and when they join or move during an open one (the database does it).
 */
export default function KpiTemplates({ kpis, periods, people, departments }: Props) {
  const [templates, setTemplates] = useState<KpiTemplateRecord[] | null>(null);
  const [members, setMembers] = useState<TemplateMember[]>([]);
  const [titles, setTitles] = useState<JobTitle[]>([]);
  const [groups, setGroups] = useState<JobGroupChoice[]>([]);
  const [editing, setEditing] = useState<KpiTemplateRecord | 'new' | null>(null);
  const [showing, setShowing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([loadKpiTemplates(), loadTemplateMembers()]);
      setTemplates(t);
      setMembers(m);
    } catch (e) {
      toast.error((e as Error).message);
      setTemplates((x) => x ?? []);
    }
  }, []);
  useEffect(() => {
    void reload();
    loadJobTitles().then(setTitles).catch(() => setTitles([]));
    loadJobGroupChoices().then(setGroups);
  }, [reload]);

  const kpiById = useMemo(() => new Map(kpis.map((k) => [k.id, k])), [kpis]);
  const personBy = useMemo(() => new Map(people.map((p) => [p.employeeNumber, p])), [people]);
  const openPeriods = periods.filter((p) => p.status === 'open');

  const targetLabel = useCallback(
    (t: Pick<KpiTemplateRecord, 'applies_to' | 'department_id' | 'job_title_id' | 'job_group_id'>) => {
      const id = targetOf(t);
      switch (t.applies_to) {
        case 'department':
          return `Department: ${departmentPath(departments, id) || 'unknown'} (and the departments under it)`;
        case 'job_title':
          return `Job title: ${titles.find((x) => x.id === id)?.name ?? 'unknown'}`;
        case 'job_group': {
          const g = groups.find((x) => x.id === id);
          return `Job group: ${g ? g.code : 'unknown'}`;
        }
        default:
          return 'Everyone';
      }
    },
    [departments, titles, groups]
  );

  const matchedBy = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of members) m.set(r.template_id, [...(m.get(r.template_id) ?? []), r.employee_number]);
    return m;
  }, [members]);
  const offBalance = useMemo(
    () => previewEmployees(members, templates ?? []).filter((p) => Math.abs(p.weightTotal - 100) >= 0.01),
    [members, templates]
  );

  const toggle = async (t: KpiTemplateRecord) => {
    try {
      await setKpiTemplateActive(t.id, !t.active);
      toast.success(t.active ? `${t.name} is off` : `${t.name} is active`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (t: KpiTemplateRecord) => {
    const ok = await confirmDialog({
      title: `Delete ${t.name}?`,
      message: 'KPIs it already gave people stay on their scorecards (without a template). Turning it off instead keeps it for later.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteKpiTemplate(t.id);
      toast.success('Template deleted');
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const applyNow = async () => {
    setBusy(true);
    try {
      const n = await applyKpiTemplates();
      toast.success(n ? `${n} KPI${n === 1 ? '' : 's'} added from templates` : 'Everyone already has their template KPIs');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-[12.5px] text-muted-foreground max-w-2xl space-y-1">
            <p className="m-0">
              Active templates are given to everyone they match when a review period opens, and to anyone who joins or changes department, job
              title or job group while a period is open. KPIs assigned by hand are kept; a target or weight changed for one person stays as set.
            </p>
            <p className="m-0">When the same KPI comes from more than one place, the first of these wins: {PRIORITY_ORDER.join(' > ')}.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Play size={13} />} disabled={busy || openPeriods.length === 0} onClick={applyNow}
              title={openPeriods.length === 0 ? 'No review period is open' : undefined}>
              Apply to open periods
            </Button>
            <Button icon={<Plus size={14} />} onClick={() => setEditing('new')}>New template</Button>
          </div>
        </div>
      </Card>

      {offBalance.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-tile px-3 py-2 text-[12px] text-orange-text-alt bg-orange-tint-alt">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            {offBalance.length} {offBalance.length === 1 ? 'person matches' : 'people match'} templates whose weights together don’t total 100% (usually
            because more than one template fits them):{' '}
            {offBalance.slice(0, 5).map((p) => `${personBy.get(p.employeeNumber)?.fullName ?? p.employeeNumber} (${formatNumber(p.weightTotal)}%)`).join(', ')}
            {offBalance.length > 5 ? '…' : ''}. Their scorecards will warn until weights are adjusted.
          </span>
        </div>
      )}

      {templates === null ? (
        <Card><p className="text-[13px] text-muted-foreground">Loading…</p></Card>
      ) : templates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<LayoutTemplate size={20} />}
            title="No KPI templates yet"
            description="Make a template for a department, job title or job group so people get the right KPIs every period without assigning them one by one."
            action={<Button onClick={() => setEditing('new')}>New template</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {templates.map((t) => {
            const w = templateWeights(t.items);
            const who = matchedBy.get(t.id) ?? [];
            return (
              <Card key={t.id} padding="none">
                <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 border-b border-border">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-bold text-ink break-words">{t.name}</div>
                    <div className="text-[11.5px] text-muted-foreground">{targetLabel(t)}</div>
                  </div>
                  <StatusPill label={t.active ? 'Active' : 'Off'} tone={t.active ? 'success' : 'neutral'} />
                </div>
                {w.problem && (
                  <div role="alert" className="flex items-start gap-2 px-4 py-2 text-[12px] text-orange-text-alt bg-orange-tint-alt">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {w.problem}
                  </div>
                )}
                <TableScroll>
                  <table className="w-full min-w-[360px]">
                    <thead>
                      <tr>
                        <th className={thClass}>KPI</th>
                        <th className={thClass}>Target</th>
                        <th className={thClass}>Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.items.map((i) => {
                        const k = kpiById.get(i.kpi_id);
                        return (
                          <tr key={i.kpi_id} className="border-t border-border">
                            <td className={tdClass}>{k?.name ?? 'Unknown KPI'}{k?.archived ? ' (archived)' : ''}</td>
                            <td className={tdClass}>{k ? formatValue(k.unit, i.target ?? k.default_target) : (i.target ?? '—')}</td>
                            <td className={tdClass}>{i.weight}%</td>
                          </tr>
                        );
                      })}
                      <tr className="border-t border-border">
                        <td className={`${tdClass} font-semibold`} colSpan={2}>Total</td>
                        <td className={`${tdClass} font-semibold ${w.ok ? 'text-status-success' : 'text-orange-text-alt'}`}>{formatNumber(w.total)}%</td>
                      </tr>
                    </tbody>
                  </table>
                </TableScroll>
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-border">
                  <Button variant="ghost" icon={<Users size={13} />} aria-expanded={showing === t.id} aria-label={`People matching ${t.name}`}
                    onClick={() => setShowing(showing === t.id ? null : t.id)}>
                    Matches {who.length} {who.length === 1 ? 'person' : 'people'}
                  </Button>
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="secondary" icon={<Pencil size={13} />} aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>Edit</Button>
                    <Button variant="secondary" aria-label={`${t.active ? 'Turn off' : 'Activate'} ${t.name}`} disabled={!t.active && !w.ok} onClick={() => toggle(t)}>
                      {t.active ? 'Turn off' : 'Activate'}
                    </Button>
                    <Button variant="ghost" icon={<Trash2 size={13} />} aria-label={`Delete ${t.name}`} onClick={() => remove(t)}>Delete</Button>
                  </div>
                </div>
                {showing === t.id && (
                  <ul className="m-0 px-4 pb-3 list-none text-[12px] text-ink grid grid-cols-1 sm:grid-cols-2 gap-1" aria-label={`Matching ${t.name}`}>
                    {who.length === 0 && <li className="text-muted-foreground">Nobody yet.</li>}
                    {who.map((n) => <li key={n}>{personBy.get(n)?.fullName ?? n} <span className="text-muted-foreground">({n})</span></li>)}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!editing} onClose={() => !busy && setEditing(null)} title={editing === 'new' ? 'New KPI template' : 'Edit KPI template'} size="3xl">
        {editing && (
          <TemplateForm
            template={editing === 'new' ? null : editing}
            kpis={kpis}
            departments={departments}
            titles={titles}
            groups={groups}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

interface ItemDraft {
  kpi_id: string;
  target: string;
  weight: string;
}

export function TemplateForm({
  template,
  kpis,
  departments,
  titles,
  groups,
  onCancel,
  onSaved,
}: {
  template: KpiTemplateRecord | null;
  kpis: Kpi[];
  departments: Department[];
  titles: JobTitle[];
  groups: JobGroupChoice[];
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [scope, setScope] = useState<TemplateScope>(template?.applies_to ?? 'department');
  const [target, setTarget] = useState(template ? targetOf(template) ?? '' : '');
  const [active, setActive] = useState(template?.active ?? true);
  const [items, setItems] = useState<ItemDraft[]>(
    template?.items.map((i) => ({ kpi_id: i.kpi_id, target: i.target === null ? '' : String(i.target), weight: String(i.weight) })) ?? [
      { kpi_id: '', target: '', weight: '' },
    ]
  );
  const [busy, setBusy] = useState(false);

  const input: KpiTemplateInput = {
    name,
    description: template?.description ?? null,
    applies_to: scope,
    target: scope === 'everyone' ? null : target || null,
    active,
    items: items.map((i) => ({ kpi_id: i.kpi_id, target: parseNumber(i.target), weight: parseNumber(i.weight) ?? Number.NaN })),
  };
  const badTarget = items.some((i) => i.target.trim() && parseNumber(i.target) === null);
  const weights = templateWeights(input.items.map((i) => ({ weight: Number.isFinite(i.weight) ? i.weight : 0 })));
  const problem = badTarget ? 'Targets must be numbers' : templateProblem(input);

  const targets = useMemo(() => {
    switch (scope) {
      case 'department':
        return departments.filter((d) => d.active || d.id === target).map((d) => ({ value: d.id, label: departmentPath(departments, d.id) || d.name }))
          .sort((a, b) => a.label.localeCompare(b.label));
      case 'job_title':
        return titles.filter((t) => t.active || t.id === target).map((t) => ({ value: t.id, label: t.name }));
      case 'job_group':
        return groups.filter((g) => g.active || g.id === target).map((g) => ({ value: g.id, label: g.name !== g.code ? `${g.code} – ${g.name}` : g.code }));
      default:
        return [];
    }
  }, [scope, departments, titles, groups, target]);

  const setItem = (i: number, patch: Partial<ItemDraft>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const chooseKpi = (i: number, kpiId: string) => {
    const k = kpis.find((x) => x.id === kpiId);
    const cur = items[i];
    setItem(i, { kpi_id: kpiId, weight: cur.weight || (k ? String(k.default_weight) : '') });
  };

  const save = async () => {
    if (problem) return;
    setBusy(true);
    try {
      await saveKpiTemplate(template?.id ?? null, input);
      toast.success(template ? 'Template saved' : 'Template added');
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const available = kpis.filter((k) => !k.archived || items.some((i) => i.kpi_id === k.id));

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="min-w-0">
          <label htmlFor="template-name" className={labelClass}>Name</label>
          <input id="template-name" className={inputClass} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales team" />
        </div>
        <div className="min-w-0">
          <label htmlFor="template-scope" className={labelClass}>For</label>
          <select id="template-scope" className={inputClass} value={scope} onChange={(e) => { setScope(e.target.value as TemplateScope); setTarget(''); }}>
            {SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
          </select>
        </div>
        {scope !== 'everyone' && (
          <div className="min-w-0">
            <label htmlFor="template-target" className={labelClass}>{SCOPE_LABEL[scope].replace(/^A /, '').replace(/^./, (c) => c.toUpperCase())}</label>
            <select id="template-target" className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose…</option>
              {targets.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
      </div>
      {scope === 'department' && <p className="text-[11.5px] text-muted-foreground m-0">People in the departments under it get it too.</p>}

      <TableScroll>
        <table className="w-full min-w-[520px]">
          <thead>
            <tr>
              <th className={thClass}>KPI</th>
              <th className={thClass}>Target</th>
              <th className={thClass}>Weight (%)</th>
              <th className={thClass}><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const k = kpis.find((x) => x.id === it.kpi_id);
              return (
                <tr key={i} className="border-t border-border">
                  <td className={tdClass}>
                    <select aria-label={`KPI ${i + 1}`} className={inputClass} value={it.kpi_id} onChange={(e) => chooseKpi(i, e.target.value)}>
                      <option value="">Choose a KPI</option>
                      {available.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </td>
                  <td className={tdClass}>
                    <input aria-label={`Target ${i + 1}`} className={inputClass} inputMode="decimal" value={it.target} onChange={(e) => setItem(i, { target: e.target.value })}
                      placeholder={k?.default_target != null ? `Default ${k.default_target}` : 'Default'} />
                  </td>
                  <td className={tdClass}>
                    <input aria-label={`Weight ${i + 1}`} className={inputClass} inputMode="decimal" value={it.weight} onChange={(e) => setItem(i, { weight: e.target.value })} />
                  </td>
                  <td className={`${tdClass} text-right`}>
                    <Button variant="ghost" icon={<Trash2 size={13} />} aria-label={`Remove KPI ${i + 1}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                      <span className="sr-only">Remove</span>
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" icon={<Plus size={13} />} onClick={() => setItems([...items, { kpi_id: '', target: '', weight: '' }])}>Add KPI</Button>
        <div className={`text-[12.5px] font-semibold ${weights.ok ? 'text-status-success' : 'text-orange-text-alt'}`} data-testid="template-total">
          Total {formatNumber(weights.total)}%
        </div>
      </div>
      {!weights.ok && (
        <div role="alert" className="flex items-start gap-2 rounded-tile px-3 py-2 text-[12px] text-orange-text-alt bg-orange-tint-alt">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {weights.problem} You can save it turned off and finish later.
        </div>
      )}
      <label className="inline-flex items-center gap-2 text-[12.5px] text-ink">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-brand" />
        Active (given to people automatically)
      </label>
      {problem && <p className="text-[12px] text-status-danger m-0">{problem}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy || !!problem}>Save</Button>
      </div>
    </form>
  );
}
