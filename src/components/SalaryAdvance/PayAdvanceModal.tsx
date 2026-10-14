import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button, Modal } from '../UI';
import { advanceAmount, formatKsh, type AdvanceRow, type PayeeCheck } from '../../lib/salaryAdvance';

// "Pay advance" for sales demos (PAYMENTS_DEMO with IN_APP_PAYMENTS off): the confirmation, the detail checks and a
// short simulated send, all in React state. Nothing is sent, nothing is saved, the advance stays approved; finance
// pays outside the app and uses "Mark as paid".

type Phase = 'confirm' | 'checking' | 'sending' | 'sent';

interface PayAdvanceModalProps {
  advance: AdvanceRow | null;
  payee: PayeeCheck | null;
  onClose: () => void;
  /** the simulated send finished */
  onSent: (advance: AdvanceRow, destination: string) => void;
  /** how long the simulated send takes */
  delayMs?: number;
}

export function DemoTag() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-pill text-[10.5px] font-semibold bg-status-purple-tint text-status-purple" title="Nothing is sent and nothing is saved">
      Demo mode — no money moves
    </span>
  );
}

export default function PayAdvanceModal({ advance, payee, onClose, onSent, delayMs = 2000 }: PayAdvanceModalProps) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    setPhase('confirm');
  }, [advance?.id]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (!advance || !payee) return null;
  const name = advance['Full Name'] || String(advance['Employee Number'] ?? '');
  const amount = formatKsh(advanceAmount(advance));
  const busy = phase === 'checking' || phase === 'sending';

  const pay = () => {
    if (payee.error) return;
    setPhase('checking');
    timers.current.push(setTimeout(() => setPhase('sending'), delayMs / 2));
    timers.current.push(
      setTimeout(() => {
        setPhase('sent');
        onSent(advance, payee.destination);
      }, delayMs),
    );
  };

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Pay advance" size="md" closeOnBackdrop={!busy}>
      <div className="mb-3">
        <DemoTag />
      </div>

      {phase === 'sent' ? (
        <div className="text-center py-2" role="status">
          <CheckCircle2 className="w-10 h-10 text-brand mx-auto mb-2" />
          <p className="text-[14px] font-semibold text-ink">
            Advance of {amount} sent to {name} ({payee.destination})
          </p>
          <p className="mt-2 text-[12px] text-muted-foreground">
            This was a demo: nothing was sent and the advance is still approved. When finance has paid it, use Mark as paid so payroll takes it back.
          </p>
          <div className="mt-4 flex justify-center">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[12.5px] mb-4">
            <dt className="text-muted-foreground">Employee</dt>
            <dd className="font-semibold text-ink break-words">{name}</dd>
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-semibold text-ink">{amount}</dd>
            <dt className="text-muted-foreground">Paid by</dt>
            <dd className="text-ink">{payee.method}</dd>
            <dt className="text-muted-foreground">To</dt>
            <dd className="text-ink break-words">{payee.destination || '—'}</dd>
          </dl>

          {payee.error && (
            <div className="flex gap-2 p-3 mb-4 rounded-tile bg-orange-tint text-[12px] text-status-danger" role="alert">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{payee.error}</span>
            </div>
          )}

          {busy && (
            <div className="mb-4" role="status">
              <div className="flex items-center gap-2 text-[12.5px] text-ink">
                <Loader2 className="w-4 h-4 animate-spin text-brand" />
                {phase === 'checking' ? 'Checking payment details...' : `Sending ${amount} to ${payee.destination}...`}
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className={`h-full bg-brand rounded-full transition-all duration-1000 ${phase === 'checking' ? 'w-1/3' : 'w-5/6'}`} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={pay} disabled={!!payee.error || busy}>
              {busy ? 'Paying...' : `Pay ${amount}`}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
