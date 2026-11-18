import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Download, FileSignature, FileText, PenLine, Upload, X } from 'lucide-react';
import { Button, Modal, StatusPill } from '../UI';
import MySignature from '../Signature/MySignature';
import LoanAgreementDocument from './LoanAgreementDocument';
import { LoaderBlock } from '../UI/FigbloomLoader';
import { loanSchedule, type LoanInstalment } from '../../lib/loans';
import { formStage, loanFormFileName, signedFormProblem, type LoanForm } from '../../lib/loanForm';
import {
  downloadLoanFormPdf,
  loadLoanFormContext,
  openSignedForm,
  reviewSignedForm,
  signAsApprover,
  signAsBorrower,
  uploadSignedForm,
  type LoanFormContext,
} from '../../lib/loanFormApi';
import type { EmployeeLoan } from '../../lib/loansApi';

// A loan's agreement form, on the borrower's loan card and on HR's: see and download it, and the step it is waiting
// for. The borrower signs it with their saved signature and uploads the signed copy; HR uploads one signed on paper,
// accepts it (signing the employer undertaking with theirs) or sends it back; whoever approved the loan signs the
// lender approval if they did not when approving. Payout waits for HR to accept it when the company requires that.

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message) || fallback;
const inputClass =
  'w-full px-3 py-2 text-[13px] border border-border rounded-tile bg-white focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand';

/** Asks for the signed-in person's saved signature (drawing one if they have none) and hands it to `onSign`. */
export function SignWithMySignature({
  open,
  title,
  explain,
  confirmLabel,
  onClose,
  onSign,
}: {
  open: boolean;
  title: string;
  explain: string;
  confirmLabel: string;
  onClose: () => void;
  onSign: (signature: string) => Promise<void>;
}) {
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sign = async () => {
    if (!signature) return;
    setBusy(true);
    try {
      await onSign(signature);
      onClose();
    } catch (error) {
      toast.error(errorText(error, 'Not signed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      {open && (
        <>
          <p className="text-[12.5px] text-ink mb-3">{explain}</p>
          <MySignature bare onChange={setSignature} />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void sign()} disabled={!signature || busy} icon={<PenLine className="w-3.5 h-3.5" />}>
              {busy ? 'Signing…' : confirmLabel}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

interface LoanFormPanelProps {
  loan: EmployeeLoan;
  form: LoanForm | undefined;
  /** the borrower on their own loan, or HR */
  mode: 'staff' | 'hr';
  /** the loan's schedule, once the database has made it */
  schedule?: LoanInstalment[];
  /** the borrower had a loan paid out before */
  renewal?: boolean;
  /** the signed-in login (to offer the approver their signature) */
  myUserId?: string | null;
  onChanged: () => void | Promise<void>;
}

export default function LoanFormPanel({ loan, form, mode, schedule, renewal, myUserId, onChanged }: LoanFormPanelProps) {
  const [viewing, setViewing] = useState(false);
  const [context, setContext] = useState<LoanFormContext | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [signing, setSigning] = useState<'borrower' | 'approver' | 'employer' | null>(null);
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!viewing || context) return;
    loadLoanFormContext(loan).then(setContext, (error) => {
      toast.error(errorText(error, 'Could not load the form'));
      setViewing(false);
    });
  }, [viewing, context, loan]);

  if (['rejected', 'cancelled'].includes(loan.status)) return null;

  const stage = formStage(loan, form);
  const open = loan.status === 'approved' && !!form && form.status !== 'accepted';
  const waitingOnReview = form?.status === 'uploaded';
  const docSchedule = schedule && schedule.length ? schedule : loanSchedule(loan.principal, loan.annual_rate, loan.months, loan.interest_method, loan.start_period);

  const done = async (message: string) => {
    toast.success(message);
    setContext(null);
    await onChanged();
  };

  const upload = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    const problem = signedFormProblem(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await uploadSignedForm(loan, file);
      await done(mode === 'staff' ? 'Signed form sent to HR' : 'Signed form uploaded');
    } catch (error) {
      toast.error(errorText(error, 'The signed form was not uploaded'));
    } finally {
      setBusy(false);
    }
  };

  const sendBack = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await reviewSignedForm(loan.id, false, reason);
      setSendingBack(false);
      await done('Sent back to the borrower');
    } catch (error) {
      toast.error(errorText(error, 'Not sent back'));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!docRef.current || !context) return;
    setDownloading(true);
    try {
      await downloadLoanFormPdf(docRef.current, loanFormFileName(loan.id, context.borrower.fullName || loan.employee_name || loan.employee_number));
    } catch (error) {
      toast.error(errorText(error, 'The form was not downloaded'));
    } finally {
      setDownloading(false);
    }
  };

  const nextStep =
    mode === 'staff'
      ? !form
        ? loan.status === 'requested'
          ? 'Once the loan is approved, you sign the loan form here.'
          : null
        : form.status === 'accepted'
          ? null
          : form.status === 'uploaded'
            ? 'HR has your signed form and will review it.'
            : !open
              ? null
              : !form.borrower_signature
                ? `Sign the form with your saved signature, download it, have a witness sign it, then upload the signed copy as a PDF.${form.required ? ' The loan is paid out once HR accepts it.' : ''}`
                : `Download the form, have a witness sign it, then upload the signed copy as a PDF.${form.required ? ' The loan is paid out once HR accepts it.' : ''}`
      : !form
        ? null
        : form.status === 'uploaded'
          ? 'Review the signed copy. Accepting signs the employer undertaking with your saved signature and sends the loan to finance to pay out.'
          : open && form.required
            ? 'Finance is told to pay it out once the signed form is uploaded and accepted.'
            : null;

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
        <span className="text-[12px] font-semibold text-ink">Loan form</span>
        <StatusPill label={stage.label} tone={stage.tone} />
      </div>
      {form?.status === 'sent_back' && form.send_back_reason && (
        <p className="mt-1.5 mb-0 text-[12px] text-status-danger">
          <strong>Sent back:</strong> {form.send_back_reason}
        </p>
      )}
      {nextStep && <p className="mt-1.5 mb-0 text-[11.5px] text-muted-foreground">{nextStep}</p>}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setViewing(true)} icon={<FileText className="w-3.5 h-3.5" />}>
          {loan.status === 'requested' ? 'Draft form' : 'View form'}
        </Button>
        {mode === 'staff' && open && (
          <Button variant={form?.borrower_signature ? 'ghost' : 'primary'} onClick={() => setSigning('borrower')} icon={<PenLine className="w-3.5 h-3.5" />}>
            {form?.borrower_signature ? 'Sign again' : 'Sign with my signature'}
          </Button>
        )}
        {mode === 'hr' && form && !form.approver_signature && myUserId && loan.decided_by === myUserId && (
          <Button variant="secondary" onClick={() => setSigning('approver')} icon={<PenLine className="w-3.5 h-3.5" />}>
            Sign the approval
          </Button>
        )}
        {open && (
          <>
            <input ref={fileRef} id={`loan-form-file-${loan.id}`} type="file" accept=".pdf,application/pdf" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} />
            <Button variant={mode === 'staff' && !waitingOnReview ? 'primary' : 'secondary'} onClick={() => fileRef.current?.click()} disabled={busy} icon={<Upload className="w-3.5 h-3.5" />}>
              {busy ? 'Uploading…' : form?.file_path ? 'Replace signed form' : mode === 'staff' ? 'Upload signed form (PDF)' : 'Upload a paper-signed form'}
            </Button>
          </>
        )}
        {form?.file_path && (
          <Button variant="ghost" onClick={() => openSignedForm(form).catch((e) => toast.error(errorText(e, 'Could not open it')))} icon={<Download className="w-3.5 h-3.5" />}>
            {mode === 'staff' ? 'My signed copy' : 'Signed copy'}
          </Button>
        )}
        {mode === 'hr' && waitingOnReview && loan.status === 'approved' && (
          <>
            <Button onClick={() => setSigning('employer')} disabled={busy} icon={<Check className="w-3.5 h-3.5" />}>
              Accept form
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setReason('');
                setSendingBack(true);
              }}
              disabled={busy}
              icon={<X className="w-3.5 h-3.5" />}
            >
              Send back
            </Button>
          </>
        )}
      </div>

      <Modal open={viewing} onClose={() => setViewing(false)} title={`Loan form: ${loan.employee_name || 'my loan'}`} size="3xl">
        {viewing &&
          (!context ? (
            <LoaderBlock label="Loading the form" compact />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <p className="m-0 text-[12px] text-muted-foreground">
                  {loan.status === 'requested'
                    ? 'A draft from the request: the figures are confirmed on approval.'
                    : 'Filled in from the loan, with the signatures added so far. The witness and stamps are signed by hand.'}
                </p>
                <Button onClick={() => void download()} disabled={downloading} icon={<Download className="w-3.5 h-3.5" />}>
                  {downloading ? 'Preparing…' : 'Download PDF'}
                </Button>
              </div>
              <div className="max-h-[70vh] overflow-auto rounded-tile border border-border bg-white p-4">
                <LoanAgreementDocument ref={docRef} loan={loan} form={form ?? null} context={context} schedule={docSchedule} renewal={renewal} />
              </div>
            </>
          ))}
      </Modal>

      <SignWithMySignature
        open={signing === 'borrower'}
        title="Sign your loan form"
        explain="Your saved signature goes on the declaration (G) and the salary deduction authority (F). By signing you confirm you have read the form, its key facts statement and its terms."
        confirmLabel="Sign the form"
        onClose={() => setSigning(null)}
        onSign={async (signature) => {
          await signAsBorrower(loan.id, signature);
          await done('Signed. Download the form, have it witnessed, and upload the signed copy.');
        }}
      />
      <SignWithMySignature
        open={signing === 'approver'}
        title="Sign the loan approval"
        explain="Your saved signature, name and job title go on the lender approval (H) of this loan's form."
        confirmLabel="Sign the approval"
        onClose={() => setSigning(null)}
        onSign={async (signature) => {
          await signAsApprover(loan.id, signature);
          await done('Approval signed');
        }}
      />
      <SignWithMySignature
        open={signing === 'employer'}
        title="Accept the signed form"
        explain={`Your saved signature, name and job title go on the employer undertaking (F). ${loan.employee_name || 'The borrower'}'s loan then goes to finance to be paid out.`}
        confirmLabel="Accept and sign"
        onClose={() => setSigning(null)}
        onSign={async (signature) => {
          await reviewSignedForm(loan.id, true, signature);
          await done('Form accepted. Finance is told to pay the loan out.');
        }}
      />

      <Modal open={sendingBack} onClose={() => setSendingBack(false)} title="Send the signed form back" size="md">
        {sendingBack && (
          <>
            <label htmlFor={`loan-form-reason-${loan.id}`} className="block text-[12px] font-semibold text-ink mb-1">
              What needs fixing?
            </label>
            <textarea
              id={`loan-form-reason-${loan.id}`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={inputClass}
              placeholder="For example: the witness has not signed"
            />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setSendingBack(false)}>
                Cancel
              </Button>
              <Button onClick={() => void sendBack()} disabled={!reason.trim() || busy} icon={<FileSignature className="w-3.5 h-3.5" />}>
                Send back
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
