import { CheckCircle, Loader, Lock, RefreshCw, RotateCcw, Trash2, Wallet } from 'lucide-react';
import { Card, StatusPill } from '../UI';
import type { StatusTone } from '../UI';
import type { PayrollRun, PayrollRunStatus } from '../../lib/payrollRuns';
import { IN_APP_PAYMENTS } from '../../lib/inAppPayments';

export const RUN_STATUS: Record<PayrollRunStatus, { label: string; tone: StatusTone }> = {
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
  /**
   * One run for every country (FIG-905): how many countries are ready to approve (Approve approves them all), and
   * whether some countries are still drafts or already approved while others are not. Left out: one country, as before.
   */
  countries?: { ready: number; draft: boolean; approved: boolean; summary?: string };
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
  countries,
}: PayrollRunBarProps) {
  // with countries in different states the buttons follow the countries: drafts can be approved while others are
  // approved and can be paid
  const draftActions = countries ? !!run && countries.draft : run?.status === 'draft';
  const approvedActions = countries ? !!run && countries.approved : run?.status === 'approved';
  let pill: { label: string; tone: StatusTone } = { label: 'Not started', tone: 'neutral' };
  let message = `Payroll for ${periodLabel} hasn't been started. The figures below are a preview from current employee details.`;
  if (loading) {
    pill = { label: 'Loading', tone: 'neutral' };
    message = `Loading payroll for ${periodLabel}…`;
  } else if (run?.status === 'draft') {
    pill = RUN_STATUS.draft;
    message = 'Draft: staff can\'t see these payslips yet. Recalculate after changing employee details, then approve.';
  } else if (run?.status === 'approved') {
    pill = RUN_STATUS.approved;
    message = `Approved${run.approved_at ? ` on ${date(run.approved_at)}` : ''}. Payslips are locked and staff can see them.`;
    // finance pays by uploading the downloaded files to the bank, then marks the month paid here
    if (!IN_APP_PAYMENTS) message += ' Pay staff by uploading the bank and M-Pesa files from the Files tab to the bank, then mark as paid.';
  } else if (run?.status === 'paid') {
    pill = RUN_STATUS.paid;
    message = `Paid on ${date(run.paid_at)}. Payslips are locked.`;
  }

  return (
    <Card padding="sm" className="!rounded-xl">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0 w-full sm:w-auto sm:flex-1">
          {run && run.status !== 'draft' && <Lock className="w-3.5 h-3.5 text-subtle shrink-0" aria-hidden />}
          <span className="text-xs font-bold text-ink whitespace-nowrap">Payroll {periodLabel}</span>
          <StatusPill label={pill.label} tone={pill.tone} />
          <span className="text-[11.5px] text-muted-foreground w-full sm:w-auto">{message}</span>
          {countries?.summary && <span className="text-[11.5px] text-ink w-full" data-testid="run-bar-summary">{countries.summary}</span>}
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
            {draftActions && (
              <>
                <button type="button" className={secondary} onClick={onDiscard} disabled={busy}>
                  <Trash2 className="w-3.5 h-3.5" />
                  Discard draft
                </button>
                <button type="button" className={secondary} onClick={onRecalculate} disabled={busy}>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Recalculate
                </button>
                <button
                  type="button"
                  className={primary}
                  onClick={onApprove}
                  disabled={busy || (countries !== undefined && countries.ready === 0)}
                  title={countries !== undefined && countries.ready === 0 ? 'No country is ready to approve: see By country' : undefined}
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Approve payroll
                </button>
              </>
            )}
            {approvedActions && (
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
