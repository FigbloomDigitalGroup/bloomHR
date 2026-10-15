import { useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarRange, Pencil, Plus } from 'lucide-react';
import { Button, Card, EmptyState, Modal } from '../../UI';
import { confirmDialog } from '../../../lib/confirmDialog';
import { savePeriod, type KpiPeriod, type KpiPeriodInput } from '../../../lib/kpiApi';
import { currentQuarter, type PeriodStatus } from '../../../lib/kpis';
import { PeriodStatusPill, inputClass, labelClass } from './shared';

interface Props {
  periods: KpiPeriod[];
  canManage: boolean;
  onChanged: () => void;
}

const formatDate = (s: string) => {
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
};

function PeriodForm({ initial, busy, onCancel, onSave }: { initial: KpiPeriodInput; busy: boolean; onCancel: () => void; onSave: (p: KpiPeriodInput) => void }) {
  const [form, setForm] = useState(initial);
  const problem = !form.name.trim()
    ? 'Give the period a name'
    : !form.starts_on || !form.ends_on
      ? 'Choose the start and end dates'
      : form.ends_on < form.starts_on
        ? 'The period ends before it starts'
        : null;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) onSave(form);
      }}
    >
      <div>
        <label htmlFor="period-name" className={labelClass}>Name</label>
        <input id="period-name" className={inputClass} value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="period-start" className={labelClass}>Starts</label>
          <input id="period-start" type="date" className={inputClass} value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />
        </div>
        <div>
          <label htmlFor="period-end" className={labelClass}>Ends</label>
          <input id="period-end" type="date" className={inputClass} value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
        </div>
      </div>
      {problem && <p className="text-[12px] text-status-danger">{problem}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy || !!problem}>Save</Button>
      </div>
    </form>
  );
}

const NEXT: Record<PeriodStatus, { to: PeriodStatus; label: string; ask: string }[]> = {
  draft: [{ to: 'open', label: 'Open', ask: 'Staff will see their KPIs and can add self-assessments; managers can enter scores.' }],
  open: [{ to: 'closed', label: 'Close', ask: 'Scores are locked: nobody can add check-ins or change KPIs until it is reopened.' }],
  closed: [{ to: 'open', label: 'Reopen', ask: 'Check-ins and changes are allowed again.' }],
};

export default function ReviewPeriods({ periods, canManage, onChanged }: Props) {
  const [editing, setEditing] = useState<{ id: string | null; initial: KpiPeriodInput } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (fields: KpiPeriodInput) => {
    setBusy(true);
    try {
      await savePeriod(editing?.id ?? null, fields);
      toast.success(editing?.id ? 'Review period updated' : 'Review period added');
      setEditing(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const move = async (p: KpiPeriod, to: PeriodStatus, label: string, ask: string) => {
    if (!(await confirmDialog({ title: `${label} ${p.name}?`, message: ask, confirmLabel: label }))) return;
    try {
      await savePeriod(p.id, { name: p.name, starts_on: p.starts_on, ends_on: p.ends_on, status: to });
      toast.success(`${p.name} is ${to}`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted-foreground max-w-xl">
          A draft period is for setting up KPIs; staff see them once it is open. Close it to lock the scores.
        </p>
        {canManage && (
          <Button icon={<Plus size={14} />} onClick={() => setEditing({ id: null, initial: currentQuarter() })}>Add review period</Button>
        )}
      </div>
      {periods.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarRange size={20} />} title="No review periods yet" description="Add one, e.g. this quarter, to start assigning KPIs." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {periods.map((p) => (
            <Card key={p.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[14px] font-bold text-ink break-words">{p.name}</div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">{formatDate(p.starts_on)} – {formatDate(p.ends_on)}</div>
                </div>
                <PeriodStatusPill status={p.status} />
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button variant="secondary" icon={<Pencil size={13} />} aria-label={`Edit ${p.name}`}
                    onClick={() => setEditing({ id: p.id, initial: { name: p.name, starts_on: p.starts_on, ends_on: p.ends_on, status: p.status } })}>
                    Edit
                  </Button>
                  {NEXT[p.status].map((n) => (
                    <Button key={n.to} variant={n.to === 'open' ? 'primary' : 'secondary'} aria-label={`${n.label} ${p.name}`} onClick={() => move(p, n.to, n.label, n.ask)}>
                      {n.label}
                    </Button>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!editing} onClose={() => !busy && setEditing(null)} title={editing?.id ? 'Edit review period' : 'Add review period'} size="md">
        {editing && <PeriodForm initial={editing.initial} busy={busy} onCancel={() => setEditing(null)} onSave={save} />}
      </Modal>
    </div>
  );
}
