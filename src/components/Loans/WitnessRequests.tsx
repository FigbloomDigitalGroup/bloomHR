import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { PenLine, X } from 'lucide-react';
import { Button, Card, Modal, StatusPill } from '../UI';
import { SignWithMySignature } from './LoanFormPanel';
import { formatKsh } from '../../lib/loans';
import type { LoanWitness } from '../../lib/loanForm';
import { declineWitness, loadMyWitnessing, loadWitnessView, signAsWitness, type WitnessView } from '../../lib/loanFormApi';

// Staff portal: the loan forms colleagues asked the signed-in employee to witness. They see whose signature it is and
// the loan, and once the borrower has signed, sign with their saved signature (their name and ID number go on the form
// from their record), or decline with a reason. Nothing shows when nobody has asked them.

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message) || fallback;
const inputClass =
  'w-full px-3 py-2 text-[13px] border border-border rounded-tile bg-white focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand';

export default function WitnessRequests({ employeeNumber }: { employeeNumber: string }) {
  const [asked, setAsked] = useState<LoanWitness[]>([]);
  const [views, setViews] = useState<Record<string, WitnessView>>({});
  const [signing, setSigning] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const mine = await loadMyWitnessing(employeeNumber);
    setAsked(mine);
    const loaded = await Promise.all(mine.map((w) => loadWitnessView(w.loan_id).then((v) => [w.loan_id, v] as const).catch(() => null)));
    setViews(Object.fromEntries(loaded.filter(Boolean) as (readonly [string, WitnessView])[]));
  }, [employeeNumber]);

  useEffect(() => {
    load().catch(() => setAsked([]));
  }, [load]);

  if (asked.length === 0) return null;

  const decline = async () => {
    if (!declining || !reason.trim()) return;
    setBusy(true);
    try {
      await declineWitness(declining, reason);
      toast.success('Declined');
      setDeclining(null);
      setReason('');
      await load();
    } catch (error) {
      toast.error(errorText(error, 'Not declined'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5" data-testid="witness-requests">
      <h2 className="text-[15px] font-bold text-ink mb-3">Asked to witness</h2>
      <ul className="space-y-3">
        {asked.map((w) => {
          const v = views[w.loan_id];
          const canSign = w.status === 'asked' && v?.loan_status === 'approved' && v.borrower_signed;
          return (
            <li key={w.loan_id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-bold text-ink">{v?.borrower_name ?? 'A colleague'}</div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {v ? `Loan form: ${formatKsh(v.principal)} over ${v.months} months · ${v.product_name || 'Staff loan'}` : 'Loading…'}
                    </div>
                  </div>
                  <StatusPill
                    label={w.status === 'signed' ? 'You witnessed' : w.status === 'declined' ? 'You declined' : canSign ? 'Waiting for you' : 'Borrower signs first'}
                    tone={w.status === 'signed' ? 'success' : w.status === 'declined' ? 'neutral' : 'warning'}
                  />
                </div>
                {v?.borrower_signature && w.status === 'asked' && (
                  <div className="mt-2">
                    <div className="text-[11.5px] text-muted-foreground">Their signature on the form</div>
                    <img src={v.borrower_signature} alt="The borrower's signature" className="h-12 w-auto max-w-[220px] object-contain rounded border border-border bg-white px-2" />
                  </div>
                )}
                {w.status === 'asked' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button disabled={!canSign} onClick={() => setSigning(w.loan_id)} icon={<PenLine className="w-3.5 h-3.5" />}>
                      Sign as witness
                    </Button>
                    <Button variant="ghost" onClick={() => setDeclining(w.loan_id)} icon={<X className="w-3.5 h-3.5" />}>
                      Decline
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <SignWithMySignature
        open={!!signing}
        title="Sign as witness"
        explain={`You confirm you saw ${signing ? views[signing]?.borrower_name ?? 'the borrower' : 'the borrower'} sign this loan form. Your saved signature, name and ID number go on it.`}
        confirmLabel="Sign as witness"
        onClose={() => setSigning(null)}
        onSign={async (signature) => {
          await signAsWitness(signing!, signature);
          toast.success('Signed as witness');
          await load();
        }}
      />

      <Modal open={!!declining} onClose={() => setDeclining(null)} title="Decline to witness" size="md">
        {declining && (
          <>
            <label htmlFor="witness-decline" className="block text-[12px] font-semibold text-ink mb-1">
              Reason (the borrower sees it)
            </label>
            <textarea id="witness-decline" rows={3} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeclining(null)}>
                Cancel
              </Button>
              <Button disabled={!reason.trim() || busy} onClick={() => void decline()}>
                Decline
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
