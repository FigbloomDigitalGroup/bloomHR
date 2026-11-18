import { supabase } from './supabase';
import { IN_LIST_SIZE, chunks } from './fetchAll';
import { openPrivateFile, randomFileName } from './privateFiles';
import { imagesLoaded } from './offers';
import { loadCompanyProfile } from './companyProfile';
import {
  DEFAULT_LOAN_FORM_SETTINGS,
  borrowerFromEmployee,
  lenderDetails,
  signedFormProblem,
  type BorrowerDetails,
  type LenderDetails,
  type LoanForm,
  type LoanFormSettings,
} from './loanForm';

// Reading and acting on loan forms (migration 20261118100000). The database checks who may sign, upload and review,
// and holds payout until the signed form is accepted; these only call it.

const BUCKET = 'loan-forms';

const fail = (error: { message?: string } | null, fallback: string): never => {
  throw new Error(error?.message || fallback);
};

const FORM_COLUMNS =
  'loan_id, required, borrower_signature, borrower_signed_at, approver_signature, approver_name, approver_title, approver_signed_at, status, file_path, file_name, uploaded_at, send_back_reason, employer_signature, employer_officer, employer_officer_title, reviewed_at';

/** The forms of these loans (the ones the signed-in person may see), by loan id. */
export async function loadLoanForms(loanIds: string[]): Promise<Record<string, LoanForm>> {
  const out: Record<string, LoanForm> = {};
  for (const ids of chunks([...new Set(loanIds)], IN_LIST_SIZE)) {
    const { data, error } = await supabase.from('employee_loan_forms').select(FORM_COLUMNS).in('loan_id', ids);
    if (error) throw error;
    for (const row of (data ?? []) as LoanForm[]) out[row.loan_id] = row;
  }
  return out;
}

export async function loadLoanFormSettings(): Promise<LoanFormSettings> {
  const { data, error } = await supabase
    .from('loan_settings')
    .select('lender_name, lender_licence, lender_address, lender_postal_address, lender_phone, lender_email, complaints_email, late_charge_percent, incapacity_terms, require_signed_form')
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_LOAN_FORM_SETTINGS;
  return {
    ...DEFAULT_LOAN_FORM_SETTINGS,
    ...data,
    late_charge_percent: data.late_charge_percent === null || data.late_charge_percent === undefined ? null : Number(data.late_charge_percent),
    require_signed_form: data.require_signed_form !== false,
  } as LoanFormSettings;
}

export async function saveLoanFormSettings(settings: LoanFormSettings): Promise<void> {
  const tidy = (v: string | null) => (v ?? '').trim() || null;
  const { error } = await supabase.from('loan_settings').upsert(
    {
      lender_name: tidy(settings.lender_name),
      lender_licence: tidy(settings.lender_licence),
      lender_address: tidy(settings.lender_address),
      lender_postal_address: tidy(settings.lender_postal_address),
      lender_phone: tidy(settings.lender_phone),
      lender_email: tidy(settings.lender_email),
      complaints_email: tidy(settings.complaints_email),
      late_charge_percent: settings.late_charge_percent,
      incapacity_terms: tidy(settings.incapacity_terms),
      require_signed_form: settings.require_signed_form,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' }
  );
  if (error) fail(error, 'The form settings were not saved.');
}

/** What the form shows beyond the loan itself. */
export interface LoanFormContext {
  lender: LenderDetails;
  settings: LoanFormSettings;
  borrower: BorrowerDetails;
  /** the latest payslip's gross and net pay, when the reader may see it */
  latestPay: { gross: number; net: number; period: string } | null;
  /** finance's record of the payout, when the reader may see it */
  payout: { reference: string | null; paidOn: string | null } | null;
}

const quiet = async <T,>(work: () => Promise<T>): Promise<T | null> => {
  try {
    return await work();
  } catch {
    return null;
  }
};

/** Everything the form needs about the lender, the borrower and their pay, for one loan. */
export async function loadLoanFormContext(loan: { id: string; employee_number: string }): Promise<LoanFormContext> {
  const [settings, company, employee] = await Promise.all([
    loadLoanFormSettings(),
    quiet(loadCompanyProfile),
    supabase.from('employees').select('*').eq('"Employee Number"', loan.employee_number).maybeSingle(),
  ]);
  if (employee.error) fail(employee.error, 'Could not load the borrower’s details.');
  const [pay, payout] = await Promise.all([
    quiet(async () => {
      const { data, error } = await supabase
        .from('salary_history')
        .select('gross_pay, net_pay, pay_period')
        .eq('employee_id', loan.employee_number)
        .order('pay_period', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    }),
    quiet(async () => {
      const { data, error } = await supabase
        .from('payment_requests')
        .select('payment_reference, paid_on, status')
        .eq('source', 'loan')
        .eq('source_id', loan.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    }),
  ]);
  return {
    settings,
    lender: lenderDetails(settings, company),
    borrower: borrowerFromEmployee((employee.data ?? { 'Employee Number': loan.employee_number }) as Record<string, unknown>, company?.company_name ?? null),
    latestPay: pay ? { gross: Number(pay.gross_pay) || 0, net: Number(pay.net_pay) || 0, period: String(pay.pay_period) } : null,
    payout: payout && payout.status === 'paid' ? { reference: payout.payment_reference ?? null, paidOn: payout.paid_on ?? null } : null,
  };
}

/** The signed-in login's id (whoever approved a loan signs its approval). */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** The signed-in person's name and job title, to go with their signature. */
export async function loadMySignerIdentity(): Promise<{ name: string; title: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { name: '', title: null };
  const { data } = await supabase.from('employees').select('"First Name", "Last Name", "Job Title"').eq('"Work Email"', user.email).maybeSingle();
  const name = data ? [data['First Name'], data['Last Name']].filter(Boolean).join(' ') : '';
  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
  return { name: name || meta.full_name || meta.name || user.email, title: (data?.['Job Title'] as string | null) ?? null };
}

/** The borrower signs their approved loan's form with their saved signature. */
export async function signAsBorrower(loanId: string, signature: string): Promise<void> {
  const { error } = await supabase.rpc('loan_form_sign_borrower', { p_loan: loanId, p_signature: signature });
  if (error) fail(error, 'Your signature was not added.');
}

/** The final approver signs the lender approval with their saved signature. */
export async function signAsApprover(loanId: string, signature: string): Promise<void> {
  const me = await loadMySignerIdentity();
  const { error } = await supabase.rpc('loan_form_sign_approver', { p_loan: loanId, p_signature: signature, p_name: me.name, p_title: me.title });
  if (error) fail(error, 'Your signature was not added to the approval.');
}

/** The signed copy, a PDF: from the borrower, or from HR for a form signed on paper. Every copy is kept. */
export async function uploadSignedForm(loan: { id: string }, file: File): Promise<void> {
  const problem = signedFormProblem(file);
  if (problem) throw new Error(problem);
  const { data: profile, error: profileError } = await supabase.from('employee_loans').select('tenant_id').eq('id', loan.id).maybeSingle();
  if (profileError || !profile) fail(profileError, 'Loan not found.');
  const path = `${profile!.tenant_id}/${loan.id}/signed-${randomFileName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: false });
  if (uploadError) fail(uploadError, 'The signed form was not uploaded.');
  const { error } = await supabase.rpc('loan_form_submit', { p_loan: loan.id, p_path: path, p_file_name: file.name.slice(0, 255) });
  if (error) fail(error, 'The signed form was not uploaded.');
}

/** HR accepts the signed copy (signing the employer undertaking) or sends it back saying what to fix. */
export async function reviewSignedForm(loanId: string, accept: true, signature: string): Promise<void>;
export async function reviewSignedForm(loanId: string, accept: false, reason: string): Promise<void>;
export async function reviewSignedForm(loanId: string, accept: boolean, signatureOrReason: string): Promise<void> {
  const me = accept ? await loadMySignerIdentity() : null;
  const { error } = await supabase.rpc('loan_form_review', {
    p_loan: loanId,
    p_accept: accept,
    p_reason: accept ? null : signatureOrReason.trim(),
    p_signature: accept ? signatureOrReason : null,
    p_officer: me?.name ?? null,
    p_title: me?.title ?? null,
  });
  if (error) fail(error, accept ? 'The form was not accepted.' : 'The form was not sent back.');
}

/** Opens the latest signed copy in a new tab. */
export async function openSignedForm(form: Pick<LoanForm, 'file_path'>): Promise<void> {
  if (!form.file_path) throw new Error('No signed form has been uploaded yet');
  await openPrivateFile(BUCKET, form.file_path);
}

/** Downloads the rendered form (LoanAgreementDocument) as an A4 PDF. */
export async function downloadLoanFormPdf(element: HTMLElement, filename: string): Promise<void> {
  await imagesLoaded(element);
  const { default: html2pdf } = await import('html2pdf.js');
  await html2pdf()
    .from(element)
    .set({
      margin: [0.45, 0.5, 0.5, 0.5],
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, windowWidth: 900 },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.loan-form-keep'] },
    })
    .save();
}
