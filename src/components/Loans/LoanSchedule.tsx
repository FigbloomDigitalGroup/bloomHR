import { StatusPill } from '../UI';
import type { StatusTone } from '../UI';
import {
  STATUS_LABELS,
  formatKsh,
  outstandingBalance,
  periodLabel,
  repaidBefore,
  scheduleTotals,
  type LoanInstalment,
  type LoanRepayment,
  type LoanStatus,
} from '../../lib/loans';

// A loan's schedule month by month (what comes off pay, how much is interest, what is still owed) with the months
// payroll has already taken, and its stage as a pill.

const TONES: Record<LoanStatus, StatusTone> = {
  requested: 'warning',
  approved: 'info',
  rejected: 'danger',
  disbursed: 'purple',
  repaying: 'purple',
  completed: 'success',
  cancelled: 'neutral',
};

export function LoanStatusPill({ status }: { status: LoanStatus }) {
  return <StatusPill label={STATUS_LABELS[status] ?? status} tone={TONES[status] ?? 'neutral'} />;
}

interface LoanScheduleProps {
  schedule: LoanInstalment[];
  repayments?: Pick<LoanRepayment, 'pay_period' | 'amount'>[];
  /** show only the first months (the rest behind "and N more") */
  limit?: number;
}

/** Repaid so far and what is left, in one line. */
export function LoanBalance({ schedule, repayments = [] }: Pick<LoanScheduleProps, 'schedule' | 'repayments'>) {
  const total = scheduleTotals(schedule).totalRepayable;
  const repaid = repaidBefore(repayments);
  const pct = total > 0 ? Math.min(100, Math.round((repaid / total) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-[11.5px] text-muted-foreground mb-1">
        <span>
          {formatKsh(repaid)} of {formatKsh(total)} repaid
        </span>
        <span>
          <strong className="text-ink">{formatKsh(outstandingBalance(schedule, repayments))}</strong> left
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden" aria-hidden>
        <div className="h-full bg-brand rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function LoanSchedule({ schedule, repayments = [], limit }: LoanScheduleProps) {
  if (schedule.length === 0) return <p className="text-[12px] text-muted-foreground">No schedule yet.</p>;
  const taken = new Map(repayments.map((r) => [r.pay_period, Number(r.amount)]));
  const shown = limit ? schedule.slice(0, limit) : schedule;
  const totals = scheduleTotals(schedule);
  const cell = 'px-2.5 py-1.5 text-right tabular-nums';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-muted-foreground border-b border-border">
            <th className="px-2.5 py-1.5 text-left font-semibold">Month</th>
            <th className={`${cell} font-semibold`}>Instalment</th>
            <th className={`${cell} font-semibold`}>Principal</th>
            <th className={`${cell} font-semibold`}>Interest</th>
            <th className={`${cell} font-semibold`}>Owed after</th>
            {repayments.length > 0 && <th className={`${cell} font-semibold`}>Taken by payroll</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((i) => (
            <tr key={i.instalment_no} className="border-b border-border/60 text-ink">
              <td className="px-2.5 py-1.5">{periodLabel(i.period)}</td>
              <td className={cell}>{formatKsh(i.payment)}</td>
              <td className={cell}>{formatKsh(i.principal)}</td>
              <td className={cell}>{formatKsh(i.interest)}</td>
              <td className={cell}>{formatKsh(i.balance)}</td>
              {repayments.length > 0 && <td className={cell}>{taken.has(i.period) ? formatKsh(taken.get(i.period)!) : '—'}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold text-ink">
            <td className="px-2.5 py-1.5">{limit && schedule.length > limit ? `and ${schedule.length - limit} more months` : 'Total'}</td>
            <td className={cell}>{formatKsh(totals.totalRepayable)}</td>
            <td className={cell}>{formatKsh(totals.totalRepayable - totals.totalInterest)}</td>
            <td className={cell}>{formatKsh(totals.totalInterest)}</td>
            <td className={cell} />
            {repayments.length > 0 && <td className={cell}>{formatKsh(repaidBefore(repayments))}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
