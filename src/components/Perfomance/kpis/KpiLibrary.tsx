import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Archive, Pencil, Plus, RotateCcw, Target, Upload } from 'lucide-react';
import { Button, Card, EmptyState, Modal, StatusPill, TableScroll } from '../../UI';
import { confirmDialog } from '../../../lib/confirmDialog';
import {
  DIRECTION_LABEL,
  FREQUENCY_LABEL,
  KPI_CATEGORIES,
  KPI_TEMPLATES,
  MEASURE_FIXED,
  MEASURE_HINT,
  MEASURE_LABEL,
  UNIT_LABEL,
  formatValue,
  parseNumber,
  type KpiDirection,
  type KpiFrequency,
  type KpiMeasure,
  type KpiTemplate,
  type KpiUnit,
} from '../../../lib/kpis';
import { saveKpi, setKpiArchived, type Kpi, type KpiInput, type KpiPeriod, type KpiPerson } from '../../../lib/kpiApi';
import type { Department } from '../../../lib/orgStructure';
import { inputClass, labelClass, tdClass, thClass } from './shared';
import KpiUploadModal from './KpiUploadModal';

interface Props {
  kpis: Kpi[];
  canManage: boolean;
  onChanged: () => void;
  /** for uploading a spreadsheet: the review periods, people and departments its rows may name */
  periods?: KpiPeriod[];
  people?: KpiPerson[];
  departments?: Department[];
}

const BLANK: KpiInput = {
  name: '', description: '', unit: 'number', direction: 'higher_is_better', default_target: null, default_weight: 0,
  frequency: 'quarterly', category: null, measure: 'manual',
};

const fromTemplate = (t: KpiTemplate): KpiInput => ({ ...t, measure: t.measure ?? 'manual' });

function KpiForm({ initial, onCancel, onSave, busy }: { initial: KpiInput; onCancel: () => void; onSave: (k: KpiInput) => void; busy: boolean }) {
  const [form, setForm] = useState({
    ...initial,
    description: initial.description ?? '',
    category: initial.category ?? '',
    target: initial.default_target === null ? '' : String(initial.default_target),
    weight: String(initial.default_weight ?? 0),
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const weight = parseNumber(form.weight);
  const problem = !form.name.trim()
    ? 'Give the KPI a name'
    : weight === null || weight < 0 || weight > 100
      ? 'The weight is from 0 to 100'
      : form.target.trim() && parseNumber(form.target) === null
        ? 'The target must be a number'
        : null;
  const usesTarget = form.unit !== 'rating_1_5';
  const calculated = form.measure !== 'manual';
  const setMeasure = (m: KpiMeasure) =>
    setForm((f) => ({ ...f, measure: m, ...(m === 'manual' ? {} : MEASURE_FIXED[m]) }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (problem) return;
        onSave({
          name: form.name, description: form.description, unit: form.unit, direction: form.direction,
          default_target: usesTarget ? parseNumber(form.target) : 5, default_weight: weight ?? 0, frequency: form.frequency,
          category: form.category || null, measure: form.measure,
        });
      }}
      className="space-y-3"
    >
      <div>
        <label htmlFor="kpi-name" className={labelClass}>Name</label>
        <input id="kpi-name" className={inputClass} value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div>
        <label htmlFor="kpi-description" className={labelClass}>Description (optional)</label>
        <textarea id="kpi-description" className={inputClass} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div>
        <label htmlFor="kpi-measure" className={labelClass}>How it's measured</label>
        <select id="kpi-measure" className={inputClass} value={form.measure} onChange={(e) => setMeasure(e.target.value as KpiMeasure)}>
          <option value="manual">{MEASURE_LABEL.manual}</option>
          <optgroup label="Calculated from tasks">
            {(Object.keys(MEASURE_FIXED) as Exclude<KpiMeasure, 'manual'>[]).map((m) => <option key={m} value={m}>{MEASURE_LABEL[m]}</option>)}
          </optgroup>
        </select>
        <p className="text-[11.5px] text-muted-foreground mt-1">
          {MEASURE_HINT[form.measure]}
          {calculated && ' Worked out every hour from the Task Manager; a manager can still enter a final score instead.'}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="kpi-unit" className={labelClass}>Measured as</label>
          <select id="kpi-unit" className={inputClass} value={form.unit} disabled={calculated} onChange={(e) => set('unit', e.target.value as KpiUnit)}>
            {(Object.keys(UNIT_LABEL) as KpiUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="kpi-direction" className={labelClass}>Direction</label>
          <select id="kpi-direction" className={inputClass} value={form.direction} disabled={calculated} onChange={(e) => set('direction', e.target.value as KpiDirection)}>
            {(Object.keys(DIRECTION_LABEL) as KpiDirection[]).map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
          </select>
        </div>
        {usesTarget && (
          <div>
            <label htmlFor="kpi-target" className={labelClass}>Default target</label>
            <input id="kpi-target" className={inputClass} inputMode="decimal" value={form.target} onChange={(e) => set('target', e.target.value)} />
          </div>
        )}
        <div>
          <label htmlFor="kpi-weight" className={labelClass}>Default weight (%)</label>
          <input id="kpi-weight" className={inputClass} inputMode="decimal" value={form.weight} onChange={(e) => set('weight', e.target.value)} />
        </div>
        <div>
          <label htmlFor="kpi-frequency" className={labelClass}>Frequency</label>
          <select id="kpi-frequency" className={inputClass} value={form.frequency} onChange={(e) => set('frequency', e.target.value as KpiFrequency)}>
            {(Object.keys(FREQUENCY_LABEL) as KpiFrequency[]).map((f) => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="kpi-category" className={labelClass}>Category (optional)</label>
          <input id="kpi-category" className={inputClass} list="kpi-categories" value={form.category} maxLength={60} onChange={(e) => set('category', e.target.value)} />
          <datalist id="kpi-categories">
            {KPI_CATEGORIES.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>
      {problem && <p className="text-[12px] text-status-danger">{problem}</p>}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy || !!problem}>Save</Button>
      </div>
    </form>
  );
}

export default function KpiLibrary({ kpis, canManage, onChanged, periods = [], people = [], departments = [] }: Props) {
  const [editing, setEditing] = useState<{ id: string | null; initial: KpiInput } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [uploading, setUploading] = useState(false);

  const visible = useMemo(() => kpis.filter((k) => showArchived || !k.archived), [kpis, showArchived]);
  const names = useMemo(() => new Set(kpis.map((k) => k.name.trim().toLowerCase())), [kpis]);
  const unusedTemplates = KPI_TEMPLATES.filter((t) => !names.has(t.name.toLowerCase()));

  const save = async (fields: KpiInput) => {
    setBusy(true);
    try {
      await saveKpi(editing?.id ?? null, fields);
      toast.success(editing?.id ? 'KPI updated' : 'KPI added');
      setEditing(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addTemplates = async (list: readonly KpiTemplate[]) => {
    setBusy(true);
    try {
      for (const t of list) await saveKpi(null, fromTemplate(t));
      toast.success(list.length === 1 ? `${list[0].name} added` : `${list.length} KPIs added`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async (k: Kpi) => {
    if (!k.archived) {
      const ok = await confirmDialog({
        title: `Archive ${k.name}?`,
        message: 'It stays on scorecards it is already on, but can no longer be assigned. You can restore it later.',
        confirmLabel: 'Archive',
      });
      if (!ok) return;
    }
    try {
      await setKpiArchived(k.id, !k.archived);
      toast.success(k.archived ? 'KPI restored' : 'KPI archived');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted-foreground max-w-xl">
          The measures your company uses to judge performance. Assign them to people for each review period.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          {canManage && (
            <Button variant="secondary" icon={<Upload size={14} />} onClick={() => setUploading(true)}>Upload spreadsheet</Button>
          )}
          {canManage && (
            <Button icon={<Plus size={14} />} onClick={() => setEditing({ id: null, initial: BLANK })}>Add KPI</Button>
          )}
        </div>
      </div>

      {canManage && unusedTemplates.length > 0 && (
        <Card padding="sm">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="text-[12.5px] font-bold text-ink">Starter templates</div>
            {unusedTemplates.length > 1 && (
              <Button variant="secondary" disabled={busy} onClick={() => addTemplates(unusedTemplates)}>Add all</Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {unusedTemplates.map((t) => (
              <button
                key={t.name}
                type="button"
                disabled={busy}
                onClick={() => addTemplates([t])}
                className="inline-flex items-center gap-1 rounded-pill border border-border px-3 py-1.5 text-[12px] text-ink hover:bg-secondary disabled:opacity-50"
                aria-label={`Add template ${t.name}`}
              >
                <Plus size={12} /> {t.name}
              </button>
            ))}
          </div>
        </Card>
      )}

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target size={20} />}
            title="No KPIs yet"
            description={canManage ? 'Add your own, or start from the templates above.' : 'HR has not set up any KPIs yet.'}
          />
        </Card>
      ) : (
        <Card padding="none">
          <TableScroll>
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-border bg-secondary/50">
                <tr>
                  <th className={thClass}>KPI</th>
                  <th className={thClass}>Category</th>
                  <th className={thClass}>Measured as</th>
                  <th className={thClass}>Default target</th>
                  <th className={thClass}>Weight</th>
                  <th className={thClass}>Frequency</th>
                  {canManage && <th className={thClass}><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((k) => (
                  <tr key={k.id} className="border-b border-border last:border-0">
                    <td className={tdClass}>
                      <div className="font-semibold flex flex-wrap items-center gap-2">
                        {k.name}
                        {k.archived && <StatusPill label="Archived" />}
                      </div>
                      {k.description && <div className="text-[11.5px] text-muted-foreground mt-0.5">{k.description}</div>}
                    </td>
                    <td className={tdClass}>{k.category || '—'}</td>
                    <td className={tdClass}>
                      {UNIT_LABEL[k.unit]}
                      <div className="text-[11px] text-muted-foreground">{DIRECTION_LABEL[k.direction]}</div>
                      {k.measure !== 'manual' && <div className="text-[11px] font-semibold text-status-info">From tasks: {MEASURE_LABEL[k.measure]}</div>}
                    </td>
                    <td className={tdClass}>{k.unit === 'rating_1_5' ? '—' : formatValue(k.unit, k.default_target)}</td>
                    <td className={tdClass}>{k.default_weight}%</td>
                    <td className={tdClass}>{FREQUENCY_LABEL[k.frequency]}</td>
                    {canManage && (
                      <td className={`${tdClass} whitespace-nowrap text-right`}>
                        <Button variant="ghost" aria-label={`Edit ${k.name}`} icon={<Pencil size={13} />} onClick={() => setEditing({ id: k.id, initial: k })}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`${k.archived ? 'Restore' : 'Archive'} ${k.name}`}
                          icon={k.archived ? <RotateCcw size={13} /> : <Archive size={13} />}
                          onClick={() => toggleArchive(k)}
                        >
                          {k.archived ? 'Restore' : 'Archive'}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <Modal open={!!editing} onClose={() => !busy && setEditing(null)} title={editing?.id ? 'Edit KPI' : 'Add KPI'} size="xl">
        {editing && <KpiForm initial={editing.initial} busy={busy} onCancel={() => setEditing(null)} onSave={save} />}
      </Modal>

      {canManage && (
        <KpiUploadModal
          open={uploading}
          onClose={() => setUploading(false)}
          kpis={kpis}
          periods={periods}
          people={people}
          departments={departments}
          onDone={onChanged}
        />
      )}
    </div>
  );
}
