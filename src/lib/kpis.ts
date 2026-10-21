// Scoring for custom KPIs (migration 20261016900000). Pure: no database, no React.
//
//   achievement %   how much of the target was reached:
//                     higher is better   actual / target          (a target of 0 or less: met when actual >= target)
//                     lower is better    target / actual          (an actual of 0 or less: the cap when the target is
//                                                                  above 0, otherwise met when actual <= target)
//                     yes/no             100 for yes, 0 for no    (reversed when lower is better: "had an incident")
//                     rating 1-5         rating / 5               (the target is not used)
//                   never below 0, never above ACHIEVEMENT_CAP
//   overall score   the weighted average of the scored KPIs' achievement: sum(achievement x weight) / sum(weight)
//   rating band     Exceeds, Meets or Below, from RATING_BANDS
//   weights check   an employee's weights in a period should total 100 (a warning only)
//   measures        how a KPI's actual is found: typed in, or calculated from tasks (20261023200000), which fixes the
//                   KPI's unit and direction

export type KpiUnit = 'number' | 'percent' | 'currency_ksh' | 'yes_no' | 'rating_1_5';
export type KpiDirection = 'higher_is_better' | 'lower_is_better';
export type KpiFrequency = 'monthly' | 'quarterly' | 'annual';
export type PeriodStatus = 'draft' | 'open' | 'closed';
export type KpiMeasure = 'manual' | 'tasks_on_time' | 'tasks_completed' | 'tasks_late' | 'task_days';

export const ACHIEVEMENT_CAP = 150;
export const WEIGHTS_TOTAL = 100;

export const UNIT_LABEL: Record<KpiUnit, string> = {
  number: 'Number',
  percent: 'Percent (%)',
  currency_ksh: 'Amount (KSh)',
  yes_no: 'Yes / No',
  rating_1_5: 'Rating (1-5)',
};
export const DIRECTION_LABEL: Record<KpiDirection, string> = {
  higher_is_better: 'Higher is better',
  lower_is_better: 'Lower is better',
};
export const FREQUENCY_LABEL: Record<KpiFrequency, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };
export const PERIOD_STATUS_LABEL: Record<PeriodStatus, string> = { draft: 'Draft', open: 'Open', closed: 'Closed' };
export const MEASURE_LABEL: Record<KpiMeasure, string> = {
  manual: 'Entered by hand',
  tasks_on_time: 'Tasks done on time (%)',
  tasks_completed: 'Tasks completed',
  tasks_late: 'Late tasks',
  task_days: 'Average days to complete a task',
};
export const MEASURE_HINT: Record<KpiMeasure, string> = {
  manual: 'The employee self-assesses and their manager or HR enters the final score.',
  tasks_on_time: 'Of the tasks due in the period so far, the share done by their due date.',
  tasks_completed: 'Tasks the employee finished in the period.',
  tasks_late: 'Tasks due in the period that were not done by their due date (done late or still open).',
  task_days: 'The median number of days from a task being created to it being done.',
};
/** The unit and direction a calculated measure fixes. */
export const MEASURE_FIXED: Record<Exclude<KpiMeasure, 'manual'>, { unit: KpiUnit; direction: KpiDirection }> = {
  tasks_on_time: { unit: 'percent', direction: 'higher_is_better' },
  tasks_completed: { unit: 'number', direction: 'higher_is_better' },
  tasks_late: { unit: 'number', direction: 'lower_is_better' },
  task_days: { unit: 'number', direction: 'lower_is_better' },
};

/** What a calculated value was worked out from, e.g. "8 of 10 due tasks done on time". */
export function measureDetail(measure: KpiMeasure, detail: Record<string, number> | null | undefined): string {
  if (!detail || measure === 'manual') return '';
  const n = (k: string) => Number(detail[k] ?? 0);
  const tasks = (k: number) => (k === 1 ? 'task' : 'tasks');
  switch (measure) {
    case 'tasks_on_time':
      return n('due') === 0 ? 'No tasks due yet' : `${n('on_time')} of ${n('due')} due ${tasks(n('due'))} done on time`;
    case 'tasks_late':
      return n('due') === 0 ? 'No tasks due yet' : `${n('late')} of ${n('due')} due ${tasks(n('due'))} late`;
    case 'tasks_completed':
      return `${n('done')} ${tasks(n('done'))} done`;
    case 'task_days':
      return n('done') === 0 ? 'No tasks done yet' : `Median of ${n('done')} ${tasks(n('done'))} done`;
  }
}

export const KPI_CATEGORIES = ['Financial', 'Customer', 'Process', 'People'] as const;

export type BandId = 'exceeds' | 'meets' | 'below';
export interface RatingBand {
  id: BandId;
  label: string;
  /** the lowest score in the band */
  min: number;
}
/** Highest first: a score is in the first band whose minimum it reaches. */
export const RATING_BANDS: readonly RatingBand[] = [
  { id: 'exceeds', label: 'Exceeds', min: 110 },
  { id: 'meets', label: 'Meets', min: 90 },
  { id: 'below', label: 'Below', min: -Infinity },
];

const clamp = (n: number) => Math.min(ACHIEVEMENT_CAP, Math.max(0, n));
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export interface ScoreInput {
  unit: KpiUnit;
  direction: KpiDirection;
  target: number | null | undefined;
  actual: number | null | undefined;
}

/** Achievement as a percentage (0 to ACHIEVEMENT_CAP), or null when there is nothing to score yet. */
export function achievement({ unit, direction, target, actual }: ScoreInput): number | null {
  if (!isNum(actual)) return null;
  const lower = direction === 'lower_is_better';
  if (unit === 'yes_no') {
    const yes = actual >= 1;
    return (lower ? !yes : yes) ? 100 : 0;
  }
  if (unit === 'rating_1_5') return clamp((actual / 5) * 100);
  if (!isNum(target)) return null;
  if (!lower) {
    if (target <= 0) return actual >= target ? 100 : 0;
    return clamp((actual / target) * 100);
  }
  if (actual <= 0) {
    if (target > 0) return ACHIEVEMENT_CAP;
    return actual <= target ? 100 : 0;
  }
  if (target <= 0) return 0;
  return clamp((target / actual) * 100);
}

export interface WeightedItem {
  weight: number | null | undefined;
  /** achievement %, null when not scored yet */
  achievement: number | null | undefined;
}

export interface OverallScore {
  /** the weighted score, null when nothing weighted has been scored */
  score: number | null;
  /** how many KPIs have a score */
  scored: number;
  total: number;
}

/** The weighted average of the scored KPIs (unscored ones and those of weight 0 are left out). */
export function overallScore(items: readonly WeightedItem[]): OverallScore {
  let sum = 0;
  let weights = 0;
  let scored = 0;
  for (const it of items) {
    if (!isNum(it.achievement)) continue;
    scored += 1;
    const w = isNum(it.weight) ? it.weight : 0;
    if (w <= 0) continue;
    sum += it.achievement * w;
    weights += w;
  }
  return { score: weights > 0 ? round1(sum / weights) : null, scored, total: items.length };
}

/** The band a score falls in, or null without a score. */
export function ratingBand(score: number | null | undefined): RatingBand | null {
  if (!isNum(score)) return null;
  return RATING_BANDS.find((b) => score >= b.min) ?? null;
}

export interface WeightsCheck {
  total: number;
  ok: boolean;
  /** what to tell HR when they don't add up, or null */
  warning: string | null;
}

/** Whether an employee's weights for a period add up to 100. */
export function checkWeights(weights: readonly (number | null | undefined)[]): WeightsCheck {
  const total = round1(weights.reduce<number>((s, w) => s + (isNum(w) ? w : 0), 0));
  const ok = Math.abs(total - WEIGHTS_TOTAL) < 0.01;
  return {
    total,
    ok,
    warning: ok
      ? null
      : `Weights add up to ${formatNumber(total)}%, not ${WEIGHTS_TOTAL}%. ${total > WEIGHTS_TOTAL ? 'Lower' : 'Raise'} some so the overall score reflects what matters most.`,
  };
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export const formatNumber = (n: number) => n.toLocaleString('en-KE', { maximumFractionDigits: 2 });

/** A target or actual as people read it for the KPI's unit. */
export function formatValue(unit: KpiUnit, v: number | null | undefined): string {
  if (!isNum(v)) return '—';
  switch (unit) {
    case 'percent':
      return `${formatNumber(v)}%`;
    case 'currency_ksh':
      return `KSh ${formatNumber(v)}`;
    case 'yes_no':
      return v >= 1 ? 'Yes' : 'No';
    case 'rating_1_5':
      return `${formatNumber(v)} / 5`;
    default:
      return formatNumber(v);
  }
}

export const formatPercent = (v: number | null | undefined) => (isNum(v) ? `${formatNumber(round1(v))}%` : '—');

export interface KpiTemplate {
  name: string;
  description: string;
  unit: KpiUnit;
  direction: KpiDirection;
  default_target: number | null;
  default_weight: number;
  frequency: KpiFrequency;
  category: string;
  measure?: KpiMeasure;
}

/** Starter KPIs offered on an empty library. */
export const KPI_TEMPLATES: readonly KpiTemplate[] = [
  { name: 'Sales revenue', description: 'Revenue closed in the period.', unit: 'currency_ksh', direction: 'higher_is_better', default_target: 1_000_000, default_weight: 30, frequency: 'quarterly', category: 'Financial' },
  { name: 'Customer satisfaction', description: 'Average customer rating from surveys or feedback.', unit: 'rating_1_5', direction: 'higher_is_better', default_target: 4, default_weight: 20, frequency: 'quarterly', category: 'Customer' },
  { name: 'Attendance rate', description: 'Days present as a share of working days.', unit: 'percent', direction: 'higher_is_better', default_target: 95, default_weight: 15, frequency: 'monthly', category: 'People' },
  { name: 'Tasks completed on time', description: 'Share of assigned tasks delivered by their due date.', unit: 'percent', direction: 'higher_is_better', default_target: 90, default_weight: 20, frequency: 'monthly', category: 'Process', measure: 'tasks_on_time' },
  { name: 'Quality / error rate', description: 'Share of work returned or with errors.', unit: 'percent', direction: 'lower_is_better', default_target: 2, default_weight: 15, frequency: 'monthly', category: 'Process' },
];

/** A number from a form field (commas allowed), or null when it is empty or not a number. */
export const parseNumber = (s: string): number | null => {
  const t = s.replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** The period to show first: an open one, else the first (the latest). */
export const defaultPeriodId = (periods: readonly { id: string; status: PeriodStatus }[]) =>
  (periods.find((p) => p.status === 'open') ?? periods[0])?.id ?? '';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The quarter a day is in, as a draft review period: "Q4 2026", 1 Oct to 31 Dec. */
export function currentQuarter(today = new Date()): { name: string; starts_on: string; ends_on: string; status: PeriodStatus } {
  const q = Math.floor(today.getMonth() / 3);
  const start = new Date(today.getFullYear(), q * 3, 1);
  const end = new Date(today.getFullYear(), q * 3 + 3, 0);
  return { name: `Q${q + 1} ${today.getFullYear()}`, starts_on: isoDay(start), ends_on: isoDay(end), status: 'draft' };
}
