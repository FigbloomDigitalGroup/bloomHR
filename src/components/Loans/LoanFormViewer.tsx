import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, FileText } from 'lucide-react';
import { Button, Modal } from '../UI';
import { LoaderBlock } from '../UI/FigbloomLoader';
import LoanAgreementDocument from './LoanAgreementDocument';
import { supabase } from '../../lib/supabase';
import { loanFormFileName, type LoanForm, type LoanGuarantor } from '../../lib/loanForm';
import { downloadLoanFormPdf, loadGuarantors, loadLoanFormContext, loadLoanForms, type LoanFormContext } from '../../lib/loanFormApi';
import { loadSchedules, type EmployeeLoan } from '../../lib/loansApi';
import type { LoanInstalment } from '../../lib/loans';

// A loan's form to read and download, for finance paying it out (Payments to make): who reads loan forms is
// reads_loan_forms() in 20261118400000, which includes the Payments module.

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message) || fallback;

interface Loaded {
  loan: EmployeeLoan;
  form: LoanForm | null;
  guarantor: LoanGuarantor | null;
  schedule: LoanInstalment[];
  context: LoanFormContext;
}

async function loadAll(loanId: string): Promise<Loaded> {
  const { data, error } = await supabase.from('employee_loans').select('*').eq('id', loanId).maybeSingle();
  if (error || !data) throw new Error('You can’t open this loan’s form, or it no longer exists');
  const row = data as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const loan = {
    ...row,
    principal: Number(row.principal),
    annual_rate: Number(row.annual_rate),
    months: Number(row.months),
    monthly_instalment: num(row.monthly_instalment),
    total_interest: num(row.total_interest),
    total_repayable: num(row.total_repayable),
    other_loan_repayments: num(row.other_loan_repayments),
  } as EmployeeLoan;
  const [forms, guarantors, schedules, context] = await Promise.all([
    loadLoanForms([loanId]),
    loadGuarantors([loanId]).catch(() => ({}) as Record<string, LoanGuarantor>),
    loadSchedules([loanId]),
    loadLoanFormContext(loan),
  ]);
  return { loan: { ...loan, employee_name: context.borrower.fullName }, form: forms[loanId] ?? null, guarantor: guarantors[loanId] ?? null, schedule: schedules.schedules[loanId] ?? [], context };
}

/** A "Loan form" button that opens the loan's form to read and download. */
export default function LoanFormViewer({ loanId }: { loanId: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [downloading, setDownloading] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || loaded) return;
    loadAll(loanId).then(setLoaded, (error) => {
      toast.error(errorText(error, 'Could not load the form'));
      setOpen(false);
    });
  }, [open, loaded, loanId]);

  const download = async () => {
    if (!docRef.current || !loaded) return;
    setDownloading(true);
    try {
      await downloadLoanFormPdf(docRef.current, loanFormFileName(loanId, loaded.context.borrower.fullName));
    } catch (error) {
      toast.error(errorText(error, 'The form was not downloaded'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} icon={<FileText className="w-3.5 h-3.5" />}>
        Loan form
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={loaded ? `Loan form: ${loaded.loan.employee_name}` : 'Loan form'} size="3xl">
        {open &&
          (!loaded ? (
            <LoaderBlock label="Loading the form" compact />
          ) : (
            <>
              <div className="flex justify-end mb-3">
                <Button onClick={() => void download()} disabled={downloading} icon={<Download className="w-3.5 h-3.5" />}>
                  {downloading ? 'Preparing…' : 'Download PDF'}
                </Button>
              </div>
              <div className="max-h-[70vh] overflow-auto rounded-tile border border-border bg-white p-4">
                <LoanAgreementDocument ref={docRef} loan={loaded.loan} form={loaded.form} context={loaded.context} schedule={loaded.schedule} guarantor={loaded.guarantor} />
              </div>
            </>
          ))}
      </Modal>
    </>
  );
}
