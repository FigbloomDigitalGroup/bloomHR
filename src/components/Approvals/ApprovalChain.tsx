import { useState } from 'react';
import { Check, Clock, Minus, RotateCcw, X } from 'lucide-react';
import { Button, StatusPill } from '../UI';
import type { StatusTone } from '../UI';
import { ApprovalChain as Chain, ChainStep, ChainStepStatus, decideApproval, reopenLeave } from '../../lib/approvals';

const STATUS: Record<ChainStepStatus, { label: string; tone: StatusTone }> = {
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  current: { label: 'Waiting', tone: 'warning' },
  upcoming: { label: 'Next', tone: 'neutral' },
  not_reached: { label: 'Not reached', tone: 'neutral' },
};

const dotClass: Record<ChainStepStatus, string> = {
  approved: 'bg-green-tint text-status-success',
  rejected: 'bg-orange-tint text-status-danger',
  skipped: 'bg-secondary text-subtle',
  current: 'bg-orange-tint-alt text-orange-text-alt',
  upcoming: 'bg-secondary text-subtle',
  not_reached: 'bg-secondary text-subtle',
};

const StepIcon = ({ status }: { status: ChainStepStatus }) => {
  const cls = 'w-3 h-3';
  if (status === 'approved') return <Check className={cls} strokeWidth={2.5} />;
  if (status === 'rejected') return <X className={cls} strokeWidth={2.5} />;
  if (status === 'current') return <Clock className={cls} strokeWidth={2.5} />;
  return <Minus className={cls} strokeWidth={2.5} />;
};

// the day and time a step was decided: "23/10/2026, 13:05"
const when = (iso: string | null) =>
  (iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/** One line per step: "Line manager · Approved by Jane Doe", "HR · Waiting on HR". */
function StepLine({ step }: { step: ChainStep }) {
  const s = STATUS[step.status];
  const detail =
    step.status === 'current'
      ? step.waiting_on ? `Waiting on ${step.waiting_on}` : 'Waiting'
      : step.status === 'skipped'
        ? step.comment || 'Skipped'
        : step.actor_name
          ? `${step.status === 'rejected' ? 'Rejected' : 'Approved'} by ${step.actor_name}${step.acted_as === 'admin' ? ' (admin)' : ''}${step.acted_at ? `, ${when(step.acted_at)}` : ''}`
          : '';
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center ${dotClass[step.status]}`} aria-hidden="true">
        <StepIcon status={step.status} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[12.5px] font-semibold text-ink">{step.position}. {step.label}</span>
          <StatusPill tone={s.tone} label={s.label} />
        </div>
        {detail && <p className="m-0 mt-0.5 text-[11.5px] text-muted-foreground break-words">{detail}</p>}
        {step.comment && step.status !== 'skipped' && (
          <p className="m-0 mt-0.5 text-[11.5px] text-ink italic break-words">“{step.comment}”</p>
        )}
      </div>
    </li>
  );
}

interface ApprovalChainProps {
  chain: Chain | undefined;
  /** called after the signed-in person approved or rejected, with the request's status now */
  onDecided?: (status: 'pending' | 'approved' | 'rejected') => void | Promise<void>;
  /** a one-line summary instead of the full list */
  compact?: boolean;
}

/**
 * An approval request's chain: each step with its status, who it is waiting on, and who decided it. The current
 * approver gets Approve / Reject with a comment; a later step's approver may reject early. Whoever holds Reopen approved
 * leave can send approved leave back to pending, with a reason, before it starts.
 */
export default function ApprovalChain({ chain, onDecided, compact = false }: ApprovalChainProps) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');

  if (!chain) return null;

  if (compact) {
    const current = chain.steps.find((s) => s.status === 'current');
    // a finished request says who ended it, and why: the step that rejected it, or the last to approve it
    const decided = chain.steps.find((s) => s.status === 'rejected')
      ?? (chain.status === 'approved' ? [...chain.steps].reverse().find((s) => s.status === 'approved') : undefined);
    return (
      <div className="flex flex-col gap-1 min-w-0">
        <ol className="m-0 p-0 list-none flex flex-wrap items-center gap-1" aria-label="Approval chain">
          {chain.steps.map((s, i) => (
            <li key={s.position} className="flex items-center gap-1">
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-pill text-[10.5px] font-semibold whitespace-nowrap ${dotClass[s.status]}`}
                title={`${s.label}: ${STATUS[s.status].label}`}
              >
                <StepIcon status={s.status} />
                {s.label}
              </span>
              {i < chain.steps.length - 1 && <span className="text-subtle text-[10px]" aria-hidden="true">→</span>}
            </li>
          ))}
        </ol>
        {current?.waiting_on && <span className="text-[10.5px] text-muted-foreground">Waiting on {current.waiting_on}</span>}
        {decided?.actor_name && (
          <span className="text-[10.5px] text-muted-foreground">
            {decided.status === 'rejected' ? 'Rejected' : 'Approved'} by {decided.actor_name}
            {decided.acted_as === 'admin' ? ' (admin)' : ''}{decided.acted_at ? `, ${when(decided.acted_at)}` : ''}
          </span>
        )}
        {decided?.comment && <span className="text-[10.5px] text-ink italic break-words">“{decided.comment}”</span>}
      </div>
    );
  }

  const decide = async (decision: 'approved' | 'rejected') => {
    // the employee is told why (decide_approval refuses a rejection without a reason too)
    if (decision === 'rejected' && !comment.trim()) {
      setError('Give a reason for rejecting: the employee will see it');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const status = await decideApproval(chain.request_id, decision, comment.trim());
      setComment('');
      await onDecided?.(status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    setBusy(true);
    setError(null);
    try {
      await reopenLeave(chain.record_id, reason.trim());
      setReason('');
      setReopening(false);
      await onDecided?.('pending');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canAct = chain.status === 'pending' && (chain.can_approve || chain.can_reject);
  const sentBack = chain.reopened;

  return (
    <div className="flex flex-col gap-3">
      {sentBack && (
        <div className="rounded-tile bg-orange-tint-alt px-3 py-2 text-[11.5px] text-ink">
          <span className="font-semibold">
            Sent back to pending{sentBack.actor_name ? ` by ${sentBack.actor_name}` : ''}{sentBack.acted_at ? `, ${when(sentBack.acted_at)}` : ''}
          </span>
          {sentBack.comment && <p className="m-0 mt-0.5 italic break-words">“{sentBack.comment}”</p>}
        </div>
      )}
      <ol className="m-0 p-0 list-none flex flex-col gap-2.5" aria-label="Approval chain">
        {chain.steps.map((s) => <StepLine key={s.position} step={s} />)}
      </ol>
      {canAct && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <label className="text-[11.5px] font-semibold text-ink" htmlFor={`approval-comment-${chain.request_id}`}>
            Comment (optional to approve, required to reject)
          </label>
          <textarea
            id={`approval-comment-${chain.request_id}`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={2}
            className="w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand"
          />
          {!chain.can_approve && (
            <p className="m-0 text-[11.5px] text-muted-foreground">You approve a later step: you can turn this down now, or approve it when it reaches you.</p>
          )}
          {error && <p className="m-0 text-[11.5px] text-status-danger" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {chain.can_approve && (
              <Button onClick={() => decide('approved')} disabled={busy} icon={<Check className="w-3 h-3" strokeWidth={2.4} />}>
                Approve
              </Button>
            )}
            <Button variant="secondary" onClick={() => decide('rejected')} disabled={busy} icon={<X className="w-3 h-3" strokeWidth={2.4} />}>
              Reject
            </Button>
          </div>
        </div>
      )}
      {chain.can_reopen && !reopening && (
        <div className="border-t border-border pt-3">
          <Button variant="secondary" onClick={() => setReopening(true)} icon={<RotateCcw className="w-3 h-3" strokeWidth={2.4} />}>
            Send back to pending
          </Button>
        </div>
      )}
      {chain.can_reopen && reopening && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <label className="text-[11.5px] font-semibold text-ink" htmlFor={`reopen-reason-${chain.request_id}`}>
            Why is it going back? (required)
          </label>
          <textarea
            id={`reopen-reason-${chain.request_id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={2}
            className="w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand"
          />
          <p className="m-0 text-[11.5px] text-muted-foreground">
            The days go back to the balance, the approvers decide again from the first step, and the employee sees your reason.
          </p>
          {error && <p className="m-0 text-[11.5px] text-status-danger" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={reopen} disabled={busy || !reason.trim()} icon={<RotateCcw className="w-3 h-3" strokeWidth={2.4} />}>
              Send back to pending
            </Button>
            <Button variant="secondary" onClick={() => { setReopening(false); setError(null); }} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
