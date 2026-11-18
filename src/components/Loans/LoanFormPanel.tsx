import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, ClipboardCheck, Download, FileSignature, FileText, Pencil, PenLine, Upload, UserCheck, UserPlus, X } from 'lucide-react';
import { Button, Modal, StatusPill } from '../UI';
import MySignature from '../Signature/MySignature';
import SignaturePad from '../Signature/SignaturePad';
import LoanAgreementDocument from './LoanAgreementDocument';
import { LoaderBlock } from '../UI/FigbloomLoader';
import { loanSchedule, type LoanInstalment } from '../../lib/loans';
import {
  CHECKLIST,
  FORM_VALUE_FIELDS,
  formStage,
  loanFormFileName,
  readyInApp,
  signedFormProblem,
  type ChecklistItem,
  type FormValues,
  type LoanForm,
  type LoanGuarantor,
  type LoanWitness,
} from '../../lib/loanForm';
import {
  addWitness,
  downloadLoanFormPdf,
  loadGuarantorChoices,
  loadLoanFormContext,
  loadMySignerIdentity,
  saveFormChecks,
  saveFormValues,
  setGuarantor,
  setWitness,
  openSignedForm,
  reviewSignedForm,
  signAsApprover,
  signAsBorrower,
  uploadSignedForm,
  type LoanFormContext,
} from '../../lib/loanFormApi';
import type { EmployeeLoan } from '../../lib/loansApi';

// A loan's agreement form, on the borrower's loan card and on HR's: see and download it, and the step it is waiting
// for. The borrower chooses a colleague as guarantor (who signs in their own staff portal), signs with their saved
// signature and asks a colleague to witness it from their own portal; then HR reviews it with no upload needed. HR can
// enter a witness who isn't on staff, who signs on the screen. The borrower or HR correct details the employee record
// has wrong, for this loan's form only. A copy signed on paper can
// be uploaded instead. HR accepts it (signing the employer undertaking with their saved signature) or sends it back,
// and fills in the checklist; whoever approved the loan signs the lender approval if they did not when approving.
// Payout waits for HR to accept it when the company requires that.

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
  /** the colleague guaranteeing it, once asked */
  guarantor?: LoanGuarantor;
  /** the colleague asked to witness the borrower's signature */
  witness?: LoanWitness;
  /** the details corrected on this loan's form */
  corrections?: FormValues;
  onChanged: () => void | Promise<void>;
}

const fieldLabel = (id: string) => FORM_VALUE_FIELDS.find((f) => f.id === id)?.label.replace(/ \(.*\)$/, '') ?? id;

export default function LoanFormPanel({ loan, form, mode, schedule, renewal, myUserId, guarantor, witness, corrections, onChanged }: LoanFormPanelProps) {
  const [viewing, setViewing] = useState(false);
  const [context, setContext] = useState<LoanFormContext | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [signing, setSigning] = useState<'borrower' | 'approver' | 'employer' | null>(null);
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [witnessing, setWitnessing] = useState<{ name: string; idNumber: string } | null>(null);
  const [choosing, setChoosing] = useState<{ role: 'guarantor' | 'witness'; choices: { employee_number: string; name: string }[]; picked: string } | null>(null);
  const [correcting, setCorrecting] = useState<{ record: FormValues; values: FormValues; payChanged?: boolean } | null>(null);
  const [checking, setChecking] = useState<{ by: string; checks: ChecklistItem[] } | null>(null);
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

  const ready = readyInApp(form, guarantor);
  const stage = formStage(loan, form, ready);
  const open = loan.status === 'approved' && !!form && form.status !== 'accepted';
  const waitingOnReview = form?.status === 'uploaded' || ready;
  // signing online works from the request on; a paper copy and HR's review wait for approval
  const signable = ['requested', 'approved'].includes(loan.status) && !!form && form.status !== 'accepted';
  // Once approved, the agreement is locked (20261119000000): what is given stays, and only what is missing is added,
  // unless HR sent the form back to be fixed. Before approval the borrower (and HR) may change things.
  const reopened = loan.status === 'requested' || form?.status === 'sent_back';
  const beforePayout = ['requested', 'approved'].includes(loan.status) && form?.status !== 'accepted';
  const canChooseGuarantor =
    beforePayout && (guarantor?.status !== 'signed' || (reopened && (mode === 'hr' || loan.status === 'requested')));
  const canChooseWitness = beforePayout && (!form?.witness_signature || reopened);
  const canCorrect = beforePayout && reopened;
  const canSignAgain = !form?.borrower_signature || reopened;
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

  const run = async (work: () => Promise<void>, message: string) => {
    setBusy(true);
    try {
      await work();
      await done(message);
      return true;
    } catch (error) {
      toast.error(errorText(error, 'Not saved. Please try again.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openChoose = async (role: 'guarantor' | 'witness') => {
    try {
      const choices = (await loadGuarantorChoices()).filter((c) => c.employee_number !== loan.employee_number);
      setChoosing({ role, choices, picked: '' });
    } catch (error) {
      toast.error(errorText(error, 'Could not load your colleagues'));
    }
  };

  const openCorrect = async () => {
    try {
      const ctx = await loadLoanFormContext(loan);
      const record = ctx.record ?? {};
      setCorrecting({ record, values: { ...record, ...(ctx.corrections ?? {}) }, payChanged: !!ctx.payChanged });
    } catch (error) {
      toast.error(errorText(error, 'Could not load the form'));
    }
  };

  const saveCorrections = async () => {
    if (!correcting) return;
    // only what differs from the record is a correction; a field matching it (or emptied) shows the record again
    const changed: FormValues = {};
    for (const f of FORM_VALUE_FIELDS) {
      const v = (correcting.values[f.id] ?? '').trim();
      if (v && v !== (correcting.record[f.id] ?? '').trim()) changed[f.id] = v;
    }
    if (await run(() => saveFormValues(loan.id, changed), 'Details corrected on the form')) setCorrecting(null);
  };

  const openChecklist = async () => {
    const me = await loadMySignerIdentity().catch(() => ({ name: '' }));
    setChecking({ by: form?.affordability_by ?? me.name, checks: [...(form?.checks ?? [])] });
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

  const missing = [
    !form?.borrower_signature && 'sign it with your saved signature',
    !form?.witness_signature && (witness?.status === 'asked' ? `${witness.witness_name} witnesses your signature from their portal` : 'choose a colleague to witness your signature'),
    form?.required && guarantor?.status !== 'signed' && 'your guarantor signs it in their staff portal',
  ].filter(Boolean) as string[];
  const nextStep =
    mode === 'staff'
      ? !form
        ? null
        : form.status === 'accepted'
          ? null
          : waitingOnReview
            ? 'HR has your signed form and will review it.'
            : !signable
              ? null
              : `To finish the form: ${missing.join(', ')}. HR then reviews it${form.required ? ', and the loan is paid out once HR accepts it' : ''}. Signed on paper instead? Upload the scanned PDF.`
      : !form
        ? null
        : waitingOnReview
          ? `Review the ${form.status === 'uploaded' ? 'signed copy' : 'form signed in the app'}. Accepting signs the employer undertaking with your saved signature and sends the loan to finance to pay out.`
          : open && form.required
            ? 'Finance is told to pay it out once the form is signed (borrower, witness and guarantor) and you accept it.'
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
      {(guarantor || canChooseGuarantor) && (
        <p className="mt-1.5 mb-0 text-[12px] text-ink" data-testid={`guarantor-${loan.id}`}>
          <strong>Guarantor:</strong>{' '}
          {!guarantor
            ? 'not chosen yet'
            : guarantor.status === 'signed'
              ? `${guarantor.guarantor_name}, signed`
              : guarantor.status === 'declined'
                ? `${guarantor.guarantor_name} declined: ${guarantor.decline_reason ?? ''}`
                : `${guarantor.guarantor_name}, waiting for them to sign`}
        </p>
      )}
      {witness && !form?.witness_signature ? (
        <p className="mt-1 mb-0 text-[12px] text-ink" data-testid={`witness-${loan.id}`}>
          <strong>Witness:</strong>{' '}
          {witness.status === 'declined'
            ? `${witness.witness_name} declined: ${witness.decline_reason ?? ''}`
            : `${witness.witness_name}, ${loan.status === 'approved' && form?.borrower_signature ? 'waiting for them to sign' : 'signs after you do'}`}
        </p>
      ) : (
        form?.witness_name && (
          <p className="mt-1 mb-0 text-[12px] text-ink" data-testid={`witness-${loan.id}`}>
            <strong>Witness:</strong> {form.witness_name} (ID {form.witness_id_number}), signed
          </p>
        )
      )}
      {mode === 'hr' && corrections && Object.keys(corrections).length > 0 && (
        <p className="mt-1 mb-0 text-[12px] text-orange-text-alt">
          <strong>Corrected on the form:</strong> {Object.keys(corrections).map(fieldLabel).join(', ')}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setViewing(true)} icon={<FileText className="w-3.5 h-3.5" />}>
          {loan.status === 'requested' ? 'Draft form' : 'View form'}
        </Button>
        {mode === 'staff' && signable && canSignAgain && (
          <Button variant={form?.borrower_signature ? 'ghost' : 'primary'} onClick={() => setSigning('borrower')} icon={<PenLine className="w-3.5 h-3.5" />}>
            {form?.borrower_signature ? 'Sign again' : 'Sign with my signature'}
          </Button>
        )}
        {canChooseGuarantor && (
          <Button variant={guarantor && guarantor.status !== 'declined' ? 'ghost' : 'secondary'} onClick={() => void openChoose('guarantor')} disabled={busy} icon={<UserPlus className="w-3.5 h-3.5" />}>
            {guarantor ? 'Change guarantor' : 'Choose guarantor'}
          </Button>
        )}
        {canChooseWitness && (
          <Button
            variant={(witness && witness.status !== 'declined') || form?.witness_signature ? 'ghost' : 'secondary'}
            onClick={() => void openChoose('witness')}
            disabled={busy}
            icon={<UserCheck className="w-3.5 h-3.5" />}
          >
            {witness || form?.witness_signature ? 'Change witness' : 'Choose witness'}
          </Button>
        )}
        {mode === 'hr' && open && canChooseWitness && (
          <Button variant="ghost" onClick={() => setWitnessing({ name: '', idNumber: '' })} disabled={busy} icon={<UserCheck className="w-3.5 h-3.5" />}>
            Witness not on staff
          </Button>
        )}
        {canCorrect && (
          <Button variant="ghost" onClick={() => void openCorrect()} disabled={busy} icon={<Pencil className="w-3.5 h-3.5" />}>
            Correct details
          </Button>
        )}
        {mode === 'hr' && form && !['rejected', 'cancelled'].includes(loan.status) && (
          <Button variant="ghost" onClick={() => void openChecklist()} disabled={busy} icon={<ClipboardCheck className="w-3.5 h-3.5" />}>
            Checklist
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
                    : 'Filled in from the loan, with the signatures and dates added so far.'}
                </p>
                <Button onClick={() => void download()} disabled={downloading} icon={<Download className="w-3.5 h-3.5" />}>
                  {downloading ? 'Preparing…' : 'Download PDF'}
                </Button>
              </div>
              <div className="max-h-[70vh] overflow-auto rounded-tile border border-border bg-white p-4">
                <LoanAgreementDocument ref={docRef} loan={loan} form={form ?? null} context={context} schedule={docSchedule} renewal={renewal} guarantor={guarantor} witness={witness} />
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
          await done('Signed. Your witness can now sign from their portal.');
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

      <Modal open={!!witnessing} onClose={() => setWitnessing(null)} title="The witness" size="md">
        {witnessing && (
          <>
            <p className="text-[12.5px] text-ink mb-3">The person who saw the borrower sign: their name and ID number, and their signature, drawn here with a finger, pen or mouse.</p>
            <div className="grid gap-3 sm:grid-cols-2 mb-3">
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">Witness full name</span>
                <input className={inputClass} value={witnessing.name} maxLength={200} onChange={(e) => setWitnessing({ ...witnessing, name: e.target.value })} />
              </label>
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">Witness National ID number</span>
                <input className={inputClass} value={witnessing.idNumber} maxLength={50} onChange={(e) => setWitnessing({ ...witnessing, idNumber: e.target.value })} />
              </label>
            </div>
            <SignaturePad
              busy={busy}
              saveLabel="Save witness"
              onCancel={() => setWitnessing(null)}
              onSave={async (png) => {
                if (!witnessing.name.trim() || !witnessing.idNumber.trim()) {
                  toast.error('Give the witness’s full name and ID number');
                  return;
                }
                if (await run(() => addWitness(loan.id, { name: witnessing.name, idNumber: witnessing.idNumber, signature: png }), 'Witness added')) setWitnessing(null);
              }}
            />
          </>
        )}
      </Modal>

      <Modal open={!!choosing} onClose={() => setChoosing(null)} title={choosing?.role === 'witness' ? 'Choose a witness' : 'Choose a guarantor'} size="md">
        {choosing && (
          <>
            <p className="text-[12.5px] text-ink mb-3">
              {choosing.role === 'witness'
                ? 'A colleague who witnesses the borrower’s signature. They are told, and sign from their staff portal with their saved signature once the borrower has signed. Their name and ID number go on the form from their record.'
                : 'The guarantor must work for the same company. They are told, read the loan’s terms in their staff portal and sign with their saved signature (or decline).'}
            </p>
            <label className="block">
              <span className="block text-[12px] font-semibold text-ink mb-1">Colleague</span>
              <select className={inputClass} value={choosing.picked} onChange={(e) => setChoosing({ ...choosing, picked: e.target.value })}>
                <option value="">Choose…</option>
                {choosing.choices.map((c) => (
                  <option key={c.employee_number} value={c.employee_number}>
                    {c.name} ({c.employee_number})
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setChoosing(null)}>
                Cancel
              </Button>
              <Button
                disabled={!choosing.picked || busy}
                onClick={async () => {
                  const ask = choosing.role === 'witness' ? setWitness : setGuarantor;
                  if (await run(() => ask(loan.id, choosing.picked), choosing.role === 'witness' ? 'Witness asked' : 'Guarantor asked')) setChoosing(null);
                }}
              >
                Ask them
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!correcting} onClose={() => setCorrecting(null)} title="Correct details on the form" size="lg">
        {correcting && (
          <>
            <p className="text-[12.5px] text-ink mb-3">
              The form shows what the employee record has. Correct anything wrong or missing here: it changes this loan’s form only, and HR sees what was
              corrected. Ask HR to update the employee record too.
            </p>
            {correcting.payChanged && (
              <p className="mb-3 p-2.5 rounded-tile bg-orange-tint text-[12px] text-ink">
                The salary on the record changed after the last payslip, so gross pay is the record’s basic salary and net pay is empty. Enter your
                current net pay (including per diem and other benefits).
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {FORM_VALUE_FIELDS.map((f) => (
                <label key={f.id} className="block">
                  <span className="block text-[12px] font-semibold text-ink mb-1">{f.label}</span>
                  <input
                    className={inputClass}
                    type={'type' in f ? f.type : 'text'}
                    value={correcting.values[f.id] ?? ''}
                    maxLength={200}
                    onChange={(e) => setCorrecting({ ...correcting, values: { ...correcting.values, [f.id]: e.target.value } })}
                  />
                  {(correcting.values[f.id] ?? '') !== (correcting.record[f.id] ?? '') && (
                    <span className="block mt-0.5 text-[11px] text-muted-foreground">Record: {correcting.record[f.id] || 'empty'}</span>
                  )}
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setCorrecting(null)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void saveCorrections()}>
                Save corrections
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!checking} onClose={() => setChecking(null)} title="Checklist" size="md">
        {checking && (
          <>
            <label className="block mb-3">
              <span className="block text-[12px] font-semibold text-ink mb-1">Affordability assessment completed by</span>
              <input className={inputClass} value={checking.by} maxLength={200} onChange={(e) => setChecking({ ...checking, by: e.target.value })} />
            </label>
            <div className="space-y-2">
              {CHECKLIST.map((c) => (
                <label key={c.id} className="flex items-start gap-2 text-[12.5px] text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-brand"
                    checked={checking.checks.includes(c.id)}
                    onChange={(e) =>
                      setChecking({ ...checking, checks: e.target.checked ? [...checking.checks, c.id] : checking.checks.filter((x) => x !== c.id) })
                    }
                  />
                  {c.label}
                </label>
              ))}
              <p className="m-0 text-[11.5px] text-muted-foreground">“Signed application/agreement Loan form” ticks itself when you accept the form.</p>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setChecking(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (await run(() => saveFormChecks(loan.id, checking.by, checking.checks), 'Checklist saved')) setChecking(null);
                }}
              >
                Save checklist
              </Button>
            </div>
          </>
        )}
      </Modal>

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
