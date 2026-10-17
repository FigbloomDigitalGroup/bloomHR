import { StatusPill, type StatusTone } from '../../UI';
import { PERIOD_STATUS_LABEL, formatPercent, ratingBand, type BandId, type PeriodStatus } from '../../../lib/kpis';
import type { KpiAssignment, KpiPeriod } from '../../../lib/kpiApi';

export const inputClass =
  'w-full min-w-0 border border-border rounded-tile bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-brand disabled:bg-secondary disabled:cursor-not-allowed';
export const labelClass = 'block text-[11.5px] font-semibold text-muted-foreground mb-1';
export const thClass = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap';
export const tdClass = 'px-3 py-2.5 text-[12.5px] text-ink align-top';

const BAND_TONE: Record<BandId, StatusTone> = { exceeds: 'success', meets: 'info', below: 'danger' };
const STATUS_TONE: Record<PeriodStatus, StatusTone> = { draft: 'neutral', open: 'success', closed: 'purple' };

export function BandPill({ score }: { score: number | null }) {
  const band = ratingBand(score);
  if (!band) return <span className="text-[12px] text-muted-foreground">Not scored</span>;
  return <StatusPill label={band.label} tone={BAND_TONE[band.id]} />;
}

export function ScoreText({ score }: { score: number | null }) {
  return <span className="font-semibold tabular-nums">{formatPercent(score)}</span>;
}

export function PeriodStatusPill({ status }: { status: PeriodStatus }) {
  return <StatusPill label={PERIOD_STATUS_LABEL[status]} tone={STATUS_TONE[status]} />;
}

export function PeriodSelect({
  periods,
  value,
  onChange,
  id = 'kpi-period',
  label = 'Review period',
}: {
  periods: KpiPeriod[];
  value: string;
  onChange: (id: string) => void;
  id?: string;
  label?: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={labelClass}>{label}</label>
      <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {periods.length === 0 && <option value="">No review periods yet</option>}
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({PERIOD_STATUS_LABEL[p.status]})
          </option>
        ))}
      </select>
    </div>
  );
}

/** Where an assignment came from: a template (adjusted or no longer matching), or nothing for one given by hand. */
export function SourceNote({ a, templateNames }: { a: KpiAssignment; templateNames?: Map<string, string> }) {
  if (a.assigned_via !== 'template') return null;
  const name = a.template_id ? templateNames?.get(a.template_id) : undefined;
  return (
    <div className="text-[11px] text-muted-foreground">
      {name ? `From template: ${name}` : 'From a template'}
      {a.overridden && <span className="ml-1 font-semibold text-status-info">· adjusted</span>}
      {a.no_longer_matches && (
        <span className="ml-1 font-semibold text-orange-text-alt" title="The template no longer fits this person; kept because it has check-ins">
          · no longer matches
        </span>
      )}
    </div>
  );
}
