import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Pencil, Trash2, UserPlus } from 'lucide-react';
import { Button, Card, EmptyState, Modal, TableScroll } from '../../UI';
import { confirmDialog } from '../../../lib/confirmDialog';
import { checkWeights, defaultPeriodId, formatValue, parseNumber } from '../../../lib/kpis';
import {
  assignKpi,
  loadAssignments,
  removeAssignment,
  updateAssignment,
  type AssignScope,
  type Kpi,
  type KpiAccess,
  type KpiAssignment,
  type KpiPeriod,
  type KpiPerson,
} from '../../../lib/kpiApi';
import type { Department } from '../../../lib/orgStructure';
import { PeriodSelect, inputClass, labelClass, tdClass, thClass } from './shared';

interface Props {
  kpis: Kpi[];
  periods: KpiPeriod[];
  people: KpiPerson[];
  departments: Department[];
  access: KpiAccess;
}

const SCOPES: { id: AssignScope; label: string }[] = [
  { id: 'person', label: 'One person' },
  { id: 'department', label: 'A department' },
  { id: 'job_title', label: 'A job title' },
  { id: 'job_group', label: 'A job group' },
];

const distinct = (values: string[]) =>
  [...new Map(values.filter(Boolean).map((v) => [v.toLowerCase(), v])).values()].sort((a, b) => a.localeCompare(b));

export default function AssignKpis({ kpis, periods, people, departments, access }: Props) {
  const [periodId, setPeriodId] = useState(() => defaultPeriodId(periods));
  const [kpiId, setKpiId] = useState('');
  const [scope, setScope] = useState<AssignScope>('person');
  const [value, setValue] = useState('');
  const [target, setTarget] = useState('');
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [assignments, setAssignments] = useState<KpiAssignment[]>([]);
  const [editing, setEditing] = useState<KpiAssignment | null>(null);

  useEffect(() => {
    if (!periodId && periods.length) setPeriodId(defaultPeriodId(periods));
  }, [periods, periodId]);

  const reload = useCallback(async () => {
    if (!periodId) return setAssignments([]);
    try {
      setAssignments(await loadAssignments(periodId));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [periodId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // a manager reaches only their own reports
  const reachable = useMemo(() => {
    const active = people.filter((p) => !/^(terminated|inactive|exited|resigned|dismissed)$/i.test(p.status));
    if (access.manages) return active;
    const team = new Set(access.team);
    return active.filter((p) => team.has(p.employeeNumber));
  }, [people, access]);

  const options = useMemo(() => {
    switch (scope) {
      case 'person':
        return reachable.map((p) => ({ value: p.employeeNumber, label: `${p.fullName} (${p.employeeNumber})` })).sort((a, b) => a.label.localeCompare(b.label));
      case 'department': {
        const used = new Set(reachable.map((p) => p.departmentId));
        return departments.filter((d) => d.active && used.has(d.id)).map((d) => ({ value: d.id, label: d.name }));
      }
      case 'job_title':
        return distinct(reachable.map((p) => p.jobTitle)).map((t) => ({ value: t, label: t }));
      default:
        return distinct(reachable.map((p) => p.jobGroup)).map((g) => ({ value: g, label: g }));
    }
  }, [scope, reachable, departments]);

  const activeKpis = kpis.filter((k) => !k.archived);
  const kpi = kpis.find((k) => k.id === kpiId);
  const period = periods.find((p) => p.id === periodId);
  const closed = period?.status === 'closed';
  const weightNum = parseNumber(weight);
  const problem = !periodId
    ? 'Add a review period first'
    : closed
      ? 'This period is closed; reopen it to change its KPIs'
      : !kpiId
        ? 'Choose a KPI'
        : !value
          ? 'Choose who to assign it to'
          : weight.trim() && (weightNum === null || weightNum < 0 || weightNum > 100)
            ? 'The weight is from 0 to 100'
            : target.trim() && parseNumber(target) === null
              ? 'The target must be a number'
              : null;

  const submit = async () => {
    if (problem) return;
    setBusy(true);
    try {
      const n = await assignKpi({ periodId, kpiId, scope, value, target: parseNumber(target), weight: parseNumber(weight) });
      if (n === 0) toast.error('Nobody matched: no current employees there');
      else toast.success(`${kpi?.name ?? 'KPI'} assigned to ${n} ${n === 1 ? 'person' : 'people'}`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const kpiById = useMemo(() => new Map(kpis.map((k) => [k.id, k])), [kpis]);
  const personBy = useMemo(() => new Map(people.map((p) => [p.employeeNumber, p])), [people]);
  const grouped = useMemo(() => {
    const m = new Map<string, KpiAssignment[]>();
    for (const a of assignments) m.set(a.employee_number, [...(m.get(a.employee_number) ?? []), a]);
    return [...m.entries()]
      .map(([emp, list]) => ({ emp, name: personBy.get(emp)?.fullName ?? emp, list, weights: checkWeights(list.map((a) => a.weight)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assignments, personBy]);

  const remove = async (a: KpiAssignment) => {
    const name = kpiById.get(a.kpi_id)?.name ?? 'this KPI';
    const who = personBy.get(a.employee_number)?.fullName ?? a.employee_number;
    const ok = await confirmDialog({ title: `Remove ${name} from ${who}?`, message: 'Its check-ins and scores for this period go with it.', confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    try {
      await removeAssignment(a.id);
      toast.success('Removed');
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-[13px] font-bold text-ink mb-3">Assign a KPI</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <PeriodSelect periods={periods} value={periodId} onChange={setPeriodId} id="assign-period" />
          <div className="min-w-0">
            <label htmlFor="assign-kpi" className={labelClass}>KPI</label>
            <select id="assign-kpi" className={inputClass} value={kpiId} onChange={(e) => setKpiId(e.target.value)}>
              <option value="">Choose a KPI</option>
              {activeKpis.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="assign-scope" className={labelClass}>Assign to</label>
            <select id="assign-scope" className={inputClass} value={scope} onChange={(e) => { setScope(e.target.value as AssignScope); setValue(''); }}>
              {SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="assign-who" className={labelClass}>{SCOPES.find((s) => s.id === scope)?.label.replace(/^(One|A) /, '').replace(/^./, (c) => c.toUpperCase())}</label>
            <select id="assign-who" className={inputClass} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose…</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="assign-target" className={labelClass}>Target</label>
            <input id="assign-target" className={inputClass} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)}
              placeholder={kpi?.default_target != null ? `Default ${kpi.default_target}` : 'Default'} />
          </div>
          <div className="min-w-0">
            <label htmlFor="assign-weight" className={labelClass}>Weight (%)</label>
            <input id="assign-weight" className={inputClass} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)}
              placeholder={kpi ? `Default ${kpi.default_weight}` : 'Default'} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <p className="text-[12px] text-muted-foreground">{problem ?? 'Assigning again updates the target and weight.'}</p>
          <Button icon={<UserPlus size={14} />} disabled={busy || !!problem} onClick={submit}>Assign</Button>
        </div>
      </Card>

      {grouped.length === 0 ? (
        <Card>
          <EmptyState icon={<UserPlus size={20} />} title="No KPIs assigned in this period" description="Assign KPIs above to build each person's scorecard." />
        </Card>
      ) : (
        grouped.map((g) => (
          <Card key={g.emp} padding="none">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-ink">{g.name}</div>
                <div className="text-[11.5px] text-muted-foreground">{g.emp}</div>
              </div>
              <div className={`text-[12px] font-semibold ${g.weights.ok ? 'text-status-success' : 'text-orange-text-alt'}`}>
                Weights: {g.weights.total}%
              </div>
            </div>
            {g.weights.warning && (
              <div role="alert" className="flex items-start gap-2 px-4 py-2 text-[12px] text-orange-text-alt bg-orange-tint-alt">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {g.weights.warning}
              </div>
            )}
            <TableScroll>
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr>
                    <th className={thClass}>KPI</th>
                    <th className={thClass}>Target</th>
                    <th className={thClass}>Weight</th>
                    <th className={thClass}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {g.list.map((a) => {
                    const k = kpiById.get(a.kpi_id);
                    return (
                      <tr key={a.id} className="border-t border-border">
                        <td className={tdClass}>{k?.name ?? 'Unknown KPI'}</td>
                        <td className={tdClass}>{k ? formatValue(k.unit, a.target) : a.target}</td>
                        <td className={tdClass}>{a.weight}%</td>
                        <td className={`${tdClass} text-right whitespace-nowrap`}>
                          <Button variant="ghost" icon={<Pencil size={13} />} aria-label={`Edit ${k?.name ?? 'KPI'} for ${g.name}`} disabled={closed} onClick={() => setEditing(a)}>Edit</Button>
                          <Button variant="ghost" icon={<Trash2 size={13} />} aria-label={`Remove ${k?.name ?? 'KPI'} from ${g.name}`} disabled={closed} onClick={() => remove(a)}>Remove</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </Card>
        ))
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Target and weight: ${editing ? kpiById.get(editing.kpi_id)?.name ?? '' : ''}`} size="sm">
        {editing && <EditAssignment a={editing} onDone={async () => { setEditing(null); await reload(); }} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function EditAssignment({ a, onDone, onCancel }: { a: KpiAssignment; onDone: () => void; onCancel: () => void }) {
  const [target, setTarget] = useState(a.target === null ? '' : String(a.target));
  const [weight, setWeight] = useState(String(a.weight));
  const [busy, setBusy] = useState(false);
  const w = parseNumber(weight);
  const problem = w === null || w < 0 || w > 100 ? 'The weight is from 0 to 100' : target.trim() && parseNumber(target) === null ? 'The target must be a number' : null;
  const save = async () => {
    setBusy(true);
    try {
      await updateAssignment(a.id, { target: parseNumber(target), weight: w ?? 0 });
      toast.success('Saved');
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="edit-target" className={labelClass}>Target</label>
        <input id="edit-target" className={inputClass} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
      </div>
      <div>
        <label htmlFor="edit-weight" className={labelClass}>Weight (%)</label>
        <input id="edit-weight" className={inputClass} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
      </div>
      {problem && <p className="text-[12px] text-status-danger">{problem}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || !!problem}>Save</Button>
      </div>
    </div>
  );
}
