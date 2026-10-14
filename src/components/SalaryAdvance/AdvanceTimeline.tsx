import { Check, X } from 'lucide-react';
import StatusPill, { type StatusTone } from '../UI/StatusPill';
import {
  advanceStage,
  currentPeriod,
  formatKsh,
  periodLabel,
  repaymentProgress,
  type AdvanceRow,
  type AdvanceStage,
} from '../../lib/salaryAdvance';

// Where an advance stands, shown the same way to the person who asked and to the approver:
// Requested -> Approved -> Paid -> Repaying -> Repaid, or Requested -> Declined.

const STAGES: { id: AdvanceStage; label: string }[] = [
  { id: 'requested', label: 'Requested' },
  { id: 'approved', label: 'Approved' },
  { id: 'paid', label: 'Paid' },
  { id: 'repaying', label: 'Repaying' },
  { id: 'repaid', label: 'Repaid' },
];

const STAGE_PILL: Record<AdvanceStage, { label: string; tone: StatusTone }> = {
  requested: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved, not paid yet', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  repaying: { label: 'Repaying', tone: 'purple' },
  repaid: { label: 'Repaid', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
};

export function AdvanceStagePill({ row }: { row: AdvanceRow }) {
  const pill = STAGE_PILL[advanceStage(row)];
  return <StatusPill label={pill.label} tone={pill.tone} />;
}

export default function AdvanceTimeline({ row, period = currentPeriod() }: { row: AdvanceRow; period?: string }) {
  const stage = advanceStage(row, period);
  const steps = stage === 'declined' ? [STAGES[0], { id: 'declined' as const, label: 'Declined' }] : STAGES;
  const at = steps.findIndex((s) => s.id === stage);

  return (
    <ol className="flex items-start w-full" aria-label="Progress">
      {steps.map((step, i) => {
        const done = i <= at;
        const declined = step.id === 'declined';
        return (
          <li key={step.id} className="flex-1 flex flex-col items-center relative min-w-0" aria-current={i === at ? 'step' : undefined}>
            {i > 0 && (
              <span className={`absolute top-[9px] right-1/2 w-full h-0.5 ${done ? (declined ? 'bg-status-danger' : 'bg-brand') : 'bg-border'}`} aria-hidden />
            )}
            <span
              className={`relative z-10 w-5 h-5 rounded-full flex items-center justify-center text-white ${
                done ? (declined ? 'bg-status-danger' : 'bg-brand') : 'bg-white border-2 border-border'
              }`}
            >
              {done && (declined ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />)}
            </span>
            <span className={`mt-1 text-[10.5px] sm:text-[11px] text-center truncate max-w-full ${i === at ? 'font-bold text-ink' : done ? 'text-ink' : 'text-subtle'}`}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** "KSh x of y repaid", a bar, and what comes off pay next. Only for paid advances. */
export function RepaymentSummary({ row, period = currentPeriod() }: { row: AdvanceRow; period?: string }) {
  const stage = advanceStage(row, period);
  if (stage !== 'paid' && stage !== 'repaying' && stage !== 'repaid') return null;
  const p = repaymentProgress(row, period);
  const share = p.total > 0 ? Math.min(100, Math.round((p.repaid / p.total) * 100)) : 0;
  return (
    <div className="text-[11.5px]">
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
        <span className="font-semibold text-ink">
          {formatKsh(p.repaid)} of {formatKsh(p.total)} repaid
        </span>
        <span className="text-muted-foreground">{formatKsh(p.remaining)} left</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} aria-label="Repaid">
        <div className="h-full bg-brand rounded-full" style={{ width: `${share}%` }} />
      </div>
      <div className="mt-1 text-muted-foreground">
        {p.next
          ? p.months > 1
            ? `${formatKsh(p.next.amount)} comes off ${periodLabel(p.next.period)} pay (${p.months} monthly parts, last in ${periodLabel(p.lastPeriod)}).`
            : `${formatKsh(p.next.amount)} comes off ${periodLabel(p.next.period)} pay.`
          : stage === 'repaid'
            ? `Repaid through payroll by ${periodLabel(p.lastPeriod)}.`
            : 'Marked paid without being processed, so payroll does not take it back.'}
      </div>
    </div>
  );
}
