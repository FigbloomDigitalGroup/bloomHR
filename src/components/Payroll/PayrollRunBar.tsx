import { CheckCircle, Loader, Lock, RefreshCw, RotateCcw, Trash2, Wallet } from 'lucide-react';
import { Card, StatusPill } from '../UI';
import type { StatusTone } from '../UI';
import type { PayrollRun, PayrollRunStatus } from '../../lib/payrollRuns';

const STATUS: Record<PayrollRunStatus, { label: string; tone: StatusTone }> = {
  draft: { label: 'Draft', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
};

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

interface PayrollRunBarProps {
  periodLabel: string;
  /** null when the month has no run yet */
  run: PayrollRun | null;
  loading: boolean;
  busy: boolean;
  onStart: () => void;
  onRecalculate: () => void;
  onApprove: () => void;
  onReopen: () => void;
  onMarkPaid: () => void;
  onDiscard: () => void;
}

const actionClass =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile text-[11.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${actionClass} bg-brand text-white hover:bg-brand-dark`;
const secondary = `${actionClass} border border-border bg-white text-ink hover:bg-secondary`;

/** The month's payroll run: where it stands, and the next step (start, approve, mark paid). */
export default function PayrollRunBar({
  periodLabel,
  run,
  loading,
  busy,
  onStart,
  onRecalculate,
  onApprove,
  onReopen,
  onMarkPaid,
  onDiscard,
}: PayrollRunBarProps) {
  let pill: { label: string; tone: StatusTone } = { label: 'Not started', tone: 'neutral' };
  let message = `Payroll for ${periodLabel} hasn't been started. The figures below are a preview from current employee details.`;
  if (loading) {
    pill = { label: 'Loading', tone: 'neutral' };
    message = `Loading payroll for ${periodLabel}…`;
  } else if (run?.status === 'draft') {
    pill = STATUS.draft;
    message = 'Draft: staff can\'t see these payslips yet. Recalculate after changing employee details, then approve.';
  } else if (run?.status === 'approved') {
    pill = STATUS.approved;
    message = `Approved${run.approved_at ? ` on ${date(run.approved_at)}` : ''}. Payslips are locked and staff can see them.`;
  } else if (run?.status === 'paid') {
    pill = STATUS.paid;
    message = `Paid on ${date(run.paid_at)}. Payslips are locked.`;
  }

  return (
    <Card padding="sm" className="!rounded-xl">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {run && run.status !== 'draft' && <Lock className="w-3.5 h-3.5 text-subtle shrink-0" aria-hidden />}
          <span className="text-xs font-bold text-ink whitespace-nowrap">Payroll {periodLabel}</span>
          <StatusPill label={pill.label} tone={pill.tone} />
          <span className="text-[11.5px] text-muted-foreground">{message}</span>
        </div>

        {!loading && (
          <div className="flex items-center gap-2 flex-wrap">
            {busy && <Loader className="w-3.5 h-3.5 animate-spin text-subtle" aria-label="Working" />}
            {!run && (
              <button type="button" className={primary} onClick={onStart} disabled={busy}>
                <CheckCircle className="w-3.5 h-3.5" />
                Start payroll run
              </button>
            )}
            {run?.status === 'draft' && (
              <>
                <button type="button" className={secondary} onClick={onDiscard} disabled={busy}>
                  <Trash2 className="w-3.5 h-3.5" />
                  Discard draft
                </button>
                <button type="button" className={secondary} onClick={onRecalculate} disabled={busy}>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Recalculate
                </button>
                <button type="button" className={primary} onClick={onApprove} disabled={busy}>
                  <CheckCircle className="w-3.5 h-3.5" />
                  Approve payroll
                </button>
              </>
            )}
            {run?.status === 'approved' && (
              <>
                <button type="button" className={secondary} onClick={onReopen} disabled={busy}>
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reopen
                </button>
                <button type="button" className={primary} onClick={onMarkPaid} disabled={busy}>
                  <Wallet className="w-3.5 h-3.5" />
                  Mark as paid
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
