import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Target } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from '../../UI';
import { DIRECTION_LABEL, checkWeights, formatPercent, formatValue } from '../../../lib/kpis';
import {
  addCheckin,
  buildScorecards,
  loadAssignments,
  loadKpiAccess,
  loadKpis,
  loadPeriods,
  type Kpi,
  type KpiAccess,
  type KpiAssignment,
  type KpiPeriod,
} from '../../../lib/kpiApi';
import { BandPill, PeriodSelect, PeriodStatusPill, ScoreText } from './shared';
import { CheckinForm } from './Scorecards';
import { LoaderBlock } from '../../UI/FigbloomLoader';

/** The signed-in employee's KPIs for a review period, with self-assessments (staff portal and the Performance page). */
export default function MyKpis({ embedded = false }: { embedded?: boolean }) {
  const [access, setAccess] = useState<KpiAccess | null>(null);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [periods, setPeriods] = useState<KpiPeriod[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [assignments, setAssignments] = useState<KpiAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [assessing, setAssessing] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [a, k, p] = await Promise.all([loadKpiAccess(), loadKpis(), loadPeriods()]);
        if (!live) return;
        const visible = p.filter((x) => x.status !== 'draft');
        setAccess(a);
        setKpis(k);
        setPeriods(visible);
        setPeriodId((visible.find((x) => x.status === 'open') ?? visible[0])?.id ?? '');
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!periodId || !access?.employeeNumber) return setAssignments([]);
    try {
      const all = await loadAssignments(periodId);
      setAssignments(all.filter((a) => a.employee_number === access.employeeNumber));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [periodId, access]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const period = periods.find((p) => p.id === periodId);
  const card = useMemo(() => buildScorecards(assignments, kpis, [])[0] ?? null, [assignments, kpis]);
  const open = period?.status === 'open';
  const weights = card ? checkWeights(card.lines.map((l) => l.assignment.weight)) : null;

  const header = !embedded && <PageHeader title="My KPIs" subtitle="What you are measured on, and how you are doing" />;

  if (loading) return <div>{header}<Card><LoaderBlock label="Loading your KPIs" compact /></Card></div>;

  if (!access?.employeeNumber || periods.length === 0) {
    return (
      <div>
        {header}
        <Card>
          <EmptyState icon={<Target size={20} />} title="No KPIs yet" description="When HR opens a review period with KPIs for you, they show here." />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      <Card padding="sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <PeriodSelect periods={periods} value={periodId} onChange={setPeriodId} id="my-kpi-period" />
          {period && (
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <PeriodStatusPill status={period.status} />
              {card && <span className="text-[13px]">Overall: <ScoreText score={card.score} /></span>}
              {card && <BandPill score={card.score} />}
            </div>
          )}
        </div>
      </Card>

      {weights && !weights.ok && (
        <div role="alert" className="flex items-start gap-2 rounded-tile px-3 py-2 text-[12px] text-orange-text-alt bg-orange-tint-alt">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          Your KPI weights add up to {weights.total}%, not 100%. Your manager or HR will adjust them; your overall score may change.
        </div>
      )}

      {!card ? (
        <Card>
          <EmptyState icon={<Target size={20} />} title="No KPIs for you in this period" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {card.lines.map((l) => {
            const a = l.assignment;
            const unit = l.kpi?.unit ?? 'number';
            return (
              <Card key={a.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-bold text-ink break-words">{l.kpi?.name ?? 'KPI'}</div>
                    {l.kpi?.description && <div className="text-[12px] text-muted-foreground mt-0.5">{l.kpi.description}</div>}
                  </div>
                  <div className="text-[12px] font-semibold text-muted-foreground">Weight {a.weight}%</div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-[12.5px]">
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Target</dt>
                    <dd className="font-semibold">{unit === 'rating_1_5' ? '—' : formatValue(unit, a.target)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">{l.kpi ? DIRECTION_LABEL[l.kpi.direction] : ''}</dt>
                    <dd className="font-semibold">Achievement {formatPercent(l.achievement)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Your self-assessment</dt>
                    <dd>{formatValue(unit, a.self_value)}</dd>
                    {a.self_comment && <dd className="text-[11.5px] text-muted-foreground whitespace-pre-wrap">{a.self_comment}</dd>}
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Final score</dt>
                    <dd>{formatValue(unit, a.actual_value)}</dd>
                    {a.manager_comment && <dd className="text-[11.5px] text-muted-foreground whitespace-pre-wrap">{a.manager_comment}</dd>}
                  </div>
                </dl>
                {open && assessing !== a.id && (
                  <div className="mt-3">
                    <Button variant="secondary" aria-label={`Self-assess ${l.kpi?.name ?? 'KPI'}`} onClick={() => setAssessing(a.id)}>
                      {a.self_value === null && !a.self_comment ? 'Add self-assessment' : 'Update self-assessment'}
                    </Button>
                  </div>
                )}
                {assessing === a.id && (
                  <div className="mt-3">
                    <CheckinForm
                      kind="self"
                      unit={unit}
                      title="Your self-assessment"
                      initial={a.self_value}
                      onCancel={() => setAssessing(null)}
                      onSave={async (value, comment) => {
                        await addCheckin(a.id, 'self', value, comment);
                        toast.success('Self-assessment saved');
                        setAssessing(null);
                        await reload();
                      }}
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
