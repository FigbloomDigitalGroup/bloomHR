import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Loader, Wallet } from 'lucide-react';
import { Modal } from '../UI';
import { type DemoChannel, type DemoPayLine, totalNet } from '../../lib/demoPayments';

// Pretend paying for sales demos (PAYMENTS_DEMO in lib/inAppPayments): "Pay all employees" and the per-person "Pay"
// on an approved month. Everything happens in the page's memory: nothing is saved, nothing is sent, no money moves.
// People whose payment details have problems are never "paid".

const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString()}`;
const CHANNELS: DemoChannel[] = ['Bank', 'M-Pesa', 'Other'];

const button =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-tile text-[11.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${button} bg-brand text-white hover:bg-brand-dark`;
const secondary = `${button} border border-border bg-white text-ink hover:bg-secondary`;

/** The subtle note that this is a demo, so nobody in a real company thinks money moved. */
export const DemoTag = () => (
  <span className="inline-flex items-center px-2 py-0.5 rounded-pill bg-secondary text-[10px] font-semibold text-muted-foreground">
    Demo mode — no money moves
  </span>
);

const ProblemList = ({ lines }: { lines: DemoPayLine[] }) => (
  <ul className="max-h-40 overflow-y-auto space-y-1 text-[11.5px] text-ink">
    {lines.map((l) => (
      <li key={l.employeeNumber || l.name}>
        <span className="font-semibold">{l.name}</span>
        <span className="text-muted-foreground">: {l.problems.join(', ')}</span>
      </li>
    ))}
  </ul>
);

interface DemoPayAllDialogProps {
  open: boolean;
  onClose: () => void;
  periodLabel: string;
  /** everyone on the month's payroll still to pay */
  lines: DemoPayLine[];
  /** the employee numbers "paid" */
  onPaid: (employeeNumbers: string[]) => void;
  /** opens the missing-details tool */
  onFixDetails: () => void;
  /** how long the pretend sending takes */
  delayMs?: number;
}

/** "Pay all employees": confirm (totals, channels, who can't be paid), a short pretend send, then the outcome. */
export function DemoPayAllDialog({ open, onClose, periodLabel, lines, onPaid, onFixDetails, delayMs = 2000 }: DemoPayAllDialogProps) {
  const [stage, setStage] = useState<'confirm' | 'sending' | 'done'>('confirm');
  // what was sent, kept for the outcome screen (lines change once the paid ones are marked)
  const [outcome, setOutcome] = useState<{ paid: DemoPayLine[]; failed: DemoPayLine[] }>({ paid: [], failed: [] });
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (open) setStage('confirm');
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const payable = useMemo(() => lines.filter((l) => l.problems.length === 0), [lines]);
  const failing = useMemo(() => lines.filter((l) => l.problems.length > 0), [lines]);
  const byChannel = useMemo(
    () => CHANNELS.map((c) => ({ channel: c, lines: lines.filter((l) => l.channel === c) })).filter((c) => c.lines.length > 0),
    [lines],
  );

  const confirm = () => {
    setStage('sending');
    const paid = payable;
    const failed = failing;
    timer.current = setTimeout(() => {
      setOutcome({ paid, failed });
      onPaid(paid.map((l) => l.employeeNumber));
      setStage('done');
    }, delayMs);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Pay employees for ${periodLabel}`} size="lg" closeOnBackdrop={stage !== 'sending'}>
      <div className="space-y-4 mt-3">
        {stage === 'confirm' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border p-3">
                <div className="text-[10px] font-bold uppercase text-subtle">Employees</div>
                <div className="text-lg font-bold text-ink" data-testid="demo-pay-count">{lines.length}</div>
              </div>
              <div className="rounded-xl border border-border p-3">
                <div className="text-[10px] font-bold uppercase text-subtle">Total net pay</div>
                <div className="text-lg font-bold text-brand-dark" data-testid="demo-pay-total">{ksh(totalNet(lines))}</div>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase text-subtle mb-1">By channel</div>
              <ul className="divide-y divide-border rounded-xl border border-border text-xs">
                {byChannel.map((c) => (
                  <li key={c.channel} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="font-semibold text-ink">{c.channel}</span>
                    <span className="text-muted-foreground">
                      {c.lines.length} {c.lines.length === 1 ? 'employee' : 'employees'} · {ksh(totalNet(c.lines))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {failing.length > 0 && (
              <div className="rounded-xl bg-orange-tint-alt p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-orange-text-alt">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {failing.length} can't be paid until their details are fixed
                </div>
                <ProblemList lines={failing} />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <DemoTag />
              <div className="flex gap-2">
                <button type="button" className={secondary} onClick={onClose}>
                  Cancel
                </button>
                <button type="button" className={primary} onClick={confirm} disabled={payable.length === 0}>
                  <Wallet className="w-3.5 h-3.5" />
                  Pay {payable.length} {payable.length === 1 ? 'employee' : 'employees'} · {ksh(totalNet(payable))}
                </button>
              </div>
            </div>
          </>
        )}

        {stage === 'sending' && (
          <div className="py-8 flex flex-col items-center gap-3 text-xs text-muted-foreground" role="status">
            <Loader className="w-6 h-6 animate-spin text-brand" />
            Sending payments…
          </div>
        )}

        {stage === 'done' && (
          <>
            <div className="flex flex-col items-center text-center gap-2 py-2">
              <CheckCircle2 className="w-9 h-9 text-status-success" />
              <div className="text-sm font-bold text-ink">
                Payments sent to {outcome.paid.length} {outcome.paid.length === 1 ? 'employee' : 'employees'} · {ksh(totalNet(outcome.paid))}
              </div>
              <DemoTag />
            </div>
            {outcome.failed.length > 0 && (
              <div className="rounded-xl bg-orange-tint-alt p-3 space-y-2">
                <div className="text-xs font-bold text-orange-text-alt">
                  {outcome.failed.length} couldn't be paid: fix their details
                </div>
                <ProblemList lines={outcome.failed} />
                <button
                  type="button"
                  className="text-xs font-semibold text-brand"
                  onClick={() => {
                    onClose();
                    onFixDetails();
                  }}
                >
                  Fix missing details
                </button>
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" className={primary} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

interface DemoPayButtonProps {
  line: DemoPayLine;
  paid: boolean;
  onPaid: (employeeNumber: string) => void;
  delayMs?: number;
}

/** "Pay" for one person on an approved month: a small confirm and a pretend send, or why they can't be paid. */
export function DemoPayButton({ line, paid, onPaid, delayMs = 1000 }: DemoPayButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  if (paid) {
    return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[7px] bg-green-tint text-brand-dark text-[10.5px] font-bold">
      <CheckCircle2 className="w-3 h-3" />
      Paid
    </span>;
  }

  const start = () => {
    if (line.problems.length) {
      const message = `${line.name} can't be paid: ${line.problems.join(', ')}`;
      setError(message);
      toast.error(message);
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const pay = () => {
    setSending(true);
    timer.current = setTimeout(() => {
      setSending(false);
      setConfirming(false);
      onPaid(line.employeeNumber);
      toast.success(`Paid ${line.name} ${ksh(line.netPay)} (demo)`);
    }, delayMs);
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="px-2.5 py-1 rounded-[7px] bg-green-tint text-brand-dark text-[10.5px] font-bold hover:bg-[#d3e6d9] transition-colors"
      >
        Pay
      </button>
      {error && (
        <span role="alert" className="basis-full text-[10.5px] text-status-danger">
          {error}
        </span>
      )}
      <Modal open={confirming} onClose={() => !sending && setConfirming(false)} title={`Pay ${line.name}?`} size="sm" closeOnBackdrop={!sending}>
        <div className="space-y-3 mt-2 text-xs text-ink">
          <p>
            {ksh(line.netPay)} by {line.channel}.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DemoTag />
            <div className="flex gap-2">
              <button type="button" className={secondary} onClick={() => setConfirming(false)} disabled={sending}>
                Cancel
              </button>
              <button type="button" className={primary} onClick={pay} disabled={sending}>
                {sending ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
                {sending ? 'Paying…' : 'Pay'}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
