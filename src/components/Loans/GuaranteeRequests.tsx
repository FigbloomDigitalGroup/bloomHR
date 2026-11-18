import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, FileText, PenLine, ShieldCheck, X } from 'lucide-react';
import { Button, Card, Modal, StatusPill } from '../UI';
import MySignature from '../Signature/MySignature';
import LoanAgreementDocument from './LoanAgreementDocument';
import { LoaderBlock } from '../UI/FigbloomLoader';
import { formatKsh } from '../../lib/loans';
import { loanFormFileName, type LoanGuarantor } from '../../lib/loanForm';
import { declineGuarantee, downloadLoanFormPdf, loadGuarantorView, loadMyGuarantees, signAsGuarantor, type GuarantorView } from '../../lib/loanFormApi';

// Staff portal: the loans colleagues asked the signed-in employee to guarantee. They read the loan's terms on the form
// (not the borrower's personal details), then sign with their saved signature, adding how they know the borrower and
// how to reach them, or decline with a reason. Nothing shows when nobody has asked them.

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message) || fallback;
const inputClass =
  'w-full px-3 py-2 text-[13px] border border-border rounded-tile bg-white focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand';

export default function GuaranteeRequests({ employeeNumber }: { employeeNumber: string }) {
  const [asked, setAsked] = useState<LoanGuarantor[]>([]);
  const [views, setViews] = useState<Record<string, GuarantorView>>({});
  const [open, setOpen] = useState<{ loanId: string; mode: 'read' | 'sign' | 'decline' } | null>(null);
  const [details, setDetails] = useState({ relationship: '', alternativePhone: '', address: '' });
  const [signature, setSignature] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const mine = await loadMyGuarantees(employeeNumber);
    setAsked(mine);
    const loaded = await Promise.all(mine.map((g) => loadGuarantorView(g.loan_id).then((v) => [g.loan_id, v] as const).catch(() => null)));
    setViews(Object.fromEntries(loaded.filter(Boolean) as (readonly [string, GuarantorView])[]));
  }, [employeeNumber]);

  useEffect(() => {
    load().catch(() => setAsked([]));
  }, [load]);

  if (asked.length === 0) return null;

  const view = open ? views[open.loanId] : undefined;
  const close = () => {
    setOpen(null);
    setReason('');
    setDetails({ relationship: '', alternativePhone: '', address: '' });
  };

  const act = async (work: () => Promise<void>, message: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(message);
      close();
      await load();
    } catch (error) {
      toast.error(errorText(error, 'Not saved. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!docRef.current || !view) return;
    setDownloading(true);
    try {
      await downloadLoanFormPdf(docRef.current, loanFormFileName(view.loan.id, `guarantor-${view.loan.employee_name ?? ''}`));
    } catch (error) {
      toast.error(errorText(error, 'The form was not downloaded'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mt-5" data-testid="guarantee-requests">
      <h2 className="text-[15px] font-bold text-ink mb-3">Asked to guarantee</h2>
      <ul className="space-y-3">
        {asked.map((g) => {
          const v = views[g.loan_id];
          return (
            <li key={g.loan_id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-bold text-ink">{v?.loan.employee_name ?? 'A colleague'}</div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {v ? `${formatKsh(v.loan.principal)} over ${v.loan.months} months · ${v.loan.product_name || 'Staff loan'}` : 'Loading…'}
                    </div>
                  </div>
                  <StatusPill
                    label={g.status === 'signed' ? 'You signed' : g.status === 'declined' ? 'You declined' : 'Waiting for you'}
                    tone={g.status === 'signed' ? 'success' : g.status === 'declined' ? 'neutral' : 'warning'}
                  />
                </div>
                {g.status === 'asked' && (
                  <p className="mt-2 mb-0 text-[11.5px] text-muted-foreground">
                    Read the form first. As guarantor you may have to repay the outstanding balance if they default and the lender has given them notice.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={!v} onClick={() => setOpen({ loanId: g.loan_id, mode: 'read' })} icon={<FileText className="w-3.5 h-3.5" />}>
                    Read the form
                  </Button>
                  {g.status === 'asked' && (
                    <>
                      <Button disabled={!v} onClick={() => setOpen({ loanId: g.loan_id, mode: 'sign' })} icon={<PenLine className="w-3.5 h-3.5" />}>
                        Sign as guarantor
                      </Button>
                      <Button variant="ghost" onClick={() => setOpen({ loanId: g.loan_id, mode: 'decline' })} icon={<X className="w-3.5 h-3.5" />}>
                        Decline
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <Modal open={open?.mode === 'read'} onClose={close} title={`Loan form: ${view?.loan.employee_name ?? ''}`} size="3xl">
        {open?.mode === 'read' &&
          (!view ? (
            <LoaderBlock label="Loading the form" compact />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <p className="m-0 text-[12px] text-muted-foreground">The loan’s terms and your part as guarantor. The borrower’s personal details are not shown to you.</p>
                <Button onClick={() => void download()} disabled={downloading} icon={<Download className="w-3.5 h-3.5" />}>
                  {downloading ? 'Preparing…' : 'Download PDF'}
                </Button>
              </div>
              <div className="max-h-[70vh] overflow-auto rounded-tile border border-border bg-white p-4">
                <LoanAgreementDocument ref={docRef} loan={view.loan} form={null} context={view.context} schedule={view.schedule} guarantor={view.guarantor} />
              </div>
            </>
          ))}
      </Modal>

      <Modal open={open?.mode === 'sign'} onClose={close} title="Sign as guarantor" size="md">
        {open?.mode === 'sign' && view && (
          <>
            <p className="text-[12.5px] text-ink mb-3">
              You guarantee {view.loan.employee_name}’s loan of {formatKsh(view.loan.principal)}. Your ID, KRA PIN, date of birth, phone, email and town go on the form
              from your employee record; add the rest here.
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">Relationship to borrower</span>
                <input className={inputClass} value={details.relationship} maxLength={100} placeholder="For example: colleague" onChange={(e) => setDetails({ ...details, relationship: e.target.value })} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="block text-[12px] font-semibold text-ink mb-1">Alternative telephone number</span>
                  <input className={inputClass} value={details.alternativePhone} maxLength={50} onChange={(e) => setDetails({ ...details, alternativePhone: e.target.value })} />
                </label>
                <label className="block">
                  <span className="block text-[12px] font-semibold text-ink mb-1">Residential address</span>
                  <input className={inputClass} value={details.address} maxLength={300} onChange={(e) => setDetails({ ...details, address: e.target.value })} />
                </label>
              </div>
              <div>
                <div className="text-[12px] font-semibold text-ink mb-1">Your signature</div>
                <MySignature bare onChange={setSignature} />
              </div>
              <p className="m-0 text-[11.5px] text-muted-foreground">
                By signing you confirm the guarantor’s declarations and undertakings on the form, and that you work for the same employer as the borrower.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                disabled={!signature || !details.relationship.trim() || busy}
                icon={<ShieldCheck className="w-3.5 h-3.5" />}
                onClick={() => void act(() => signAsGuarantor(open.loanId, signature!, details), 'Signed as guarantor')}
              >
                Sign as guarantor
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={open?.mode === 'decline'} onClose={close} title="Decline to guarantee" size="md">
        {open?.mode === 'decline' && (
          <>
            <label htmlFor="guarantee-decline" className="block text-[12px] font-semibold text-ink mb-1">
              Reason (the borrower sees it)
            </label>
            <textarea id="guarantee-decline" rows={3} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button disabled={!reason.trim() || busy} onClick={() => void act(() => declineGuarantee(open.loanId, reason), 'Declined')}>
                Decline
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
