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
  type ChecklistItem,
  type FormValues,
  type LoanGuarantor,
  type LoanWitness,
  recordValues,
  withCorrections,
} from './loanForm';
import type { LoanInstalment } from './loans';
import type { EmployeeLoan } from './loansApi';

// Reading and acting on loan forms (migration 20261118100000). The database checks who may sign, upload and review,
// and holds payout until the signed form is accepted; these only call it.

const BUCKET = 'loan-forms';

const fail = (error: { message?: string } | null, fallback: string): never => {
  throw new Error(error?.message || fallback);
};

const FORM_COLUMNS =
  'loan_id, required, borrower_signature, borrower_signed_at, approver_signature, approver_name, approver_title, approver_signed_at, status, file_path, file_name, uploaded_at, send_back_reason, employer_signature, employer_officer, employer_officer_title, reviewed_at, updated_at, witness_name, witness_id_number, witness_signature, witness_signed_at, affordability_by, checks';

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
    .select('lender_name, lender_licence, lender_address, lender_postal_address, lender_phone, lender_email, complaints_email, late_charge_percent, incapacity_terms, require_signed_form, term_rates')
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_LOAN_FORM_SETTINGS;
  return {
    ...DEFAULT_LOAN_FORM_SETTINGS,
    ...data,
    late_charge_percent: data.late_charge_percent === null || data.late_charge_percent === undefined ? null : Number(data.late_charge_percent),
    require_signed_form: data.require_signed_form !== false,
    term_rates: Array.isArray(data.term_rates)
      ? (data.term_rates as { months: unknown; rate: unknown }[]).map((t) => ({ months: Number(t.months), rate: Number(t.rate) })).sort((a, b) => a.months - b.months)
      : [],
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
  /** the borrower's details, with the loan's corrections on top */
  borrower: BorrowerDetails;
  /** what the employee record says, and the corrections made for this loan */
  record?: FormValues;
  corrections?: FormValues;
  /** gross and net pay: the latest payslip's, or the record's basic salary (and no net) after a pay change */
  latestPay: { gross: number | null; net: number | null; period: string } | null;
  /** the record's salary changed since the latest payslip: net pay is for the borrower to give */
  payChanged?: boolean;
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
  // the borrower's details as the database reads them: employment type from HR Lifecycle, pay from the latest payslip
  // only while it matches the record's basic salary (20261118600000)
  const [settings, company, details] = await Promise.all([
    loadLoanFormSettings(),
    quiet(loadCompanyProfile),
    supabase.rpc('loan_form_borrower', { p_loan: loan.id }),
  ]);
  if (details.error || !details.data) fail(details.error, 'Could not load the borrower’s details.');
  const d = details.data as {
    employee: Record<string, unknown> | null;
    employment_type: string | null;
    contract_end_date: string | null;
    gross: number | string | null;
    net: number | string | null;
    pay_period: string | null;
    pay_changed: boolean;
    basic_salary: number | string | null;
    corrections?: FormValues;
    payout?: { reference: string | null; paid_on: string | null } | null;
  };
  const [payout] = await Promise.all([
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
  const borrower = borrowerFromEmployee(
    {
      ...(d.employee ?? { 'Employee Number': loan.employee_number }),
      'Basic Salary': d.basic_salary,
      'Employee Type': d.employment_type,
      'Contract End Date': d.contract_end_date,
    },
    company?.company_name ?? null
  );
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const latestPay = d.gross === null && d.net === null ? null : { gross: num(d.gross), net: num(d.net), period: d.pay_period ?? '' };
  const corrections: FormValues = d.corrections ?? (await loadFormValues([loan.id]).catch((): Record<string, FormValues> => ({})))[loan.id] ?? {};
  const corrected = withCorrections(borrower, latestPay, corrections);
  return {
    settings,
    lender: lenderDetails(settings, company),
    borrower: corrected.borrower,
    latestPay: corrected.latestPay,
    record: recordValues(borrower, latestPay),
    corrections,
    payChanged: !!d.pay_changed,
    // finance's record of the payout: from the database for everyone who reads the form (staff can't read payments)
    payout: d.payout
      ? { reference: d.payout.reference ?? null, paidOn: d.payout.paid_on ?? null }
      : payout && payout.status === 'paid'
        ? { reference: payout.payment_reference ?? null, paidOn: payout.paid_on ?? null }
        : null,
  };
}

/** A loan's repayment against net pay, for HR and finance (20261120100000). */
export interface LoanAffordability {
  loan_id: string;
  net_pay: number | null;
  share_percent: number | null;
  flag_percent: number | null;
  over_flag: boolean;
  checked_by_name: string | null;
  checked_at: string | null;
}

export async function loadAffordability(loanIds: string[]): Promise<Record<string, LoanAffordability>> {
  const out: Record<string, LoanAffordability> = {};
  for (const ids of chunks([...new Set(loanIds)], IN_LIST_SIZE)) {
    const { data, error } = await supabase.rpc('loan_affordability', { p_loans: ids });
    if (error) throw error;
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      out[String(r.loan_id)] = {
        loan_id: String(r.loan_id),
        net_pay: r.net_pay == null ? null : Number(r.net_pay),
        share_percent: r.share_percent == null ? null : Number(r.share_percent),
        flag_percent: r.flag_percent == null ? null : Number(r.flag_percent),
        over_flag: !!r.over_flag,
        checked_by_name: (r.checked_by_name as string | null) ?? null,
        checked_at: (r.checked_at as string | null) ?? null,
      };
    }
  }
  return out;
}

/** HR or finance confirm they checked the borrower can afford the loan (needed to approve a flagged one). */
export async function confirmAffordability(loanId: string): Promise<void> {
  const me = await loadMySignerIdentity();
  const { error } = await supabase.rpc('loan_confirm_affordability', { p_loan: loanId, p_name: me.name || null });
  if (error) fail(error, 'Your check was not saved.');
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
export async function signAsApprover(loanId: string, signature: string, designation?: string): Promise<void> {
  const me = await loadMySignerIdentity();
  const { error } = await supabase.rpc('loan_form_sign_approver', {
    p_loan: loanId,
    p_signature: signature,
    p_name: me.name,
    p_title: designation?.trim() || me.title,
  });
  if (error) fail(error, 'Your signature was not added to the approval.');
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the signature.'));
    reader.readAsDataURL(blob);
  });

/** The witness of the borrower's signature: their name, ID number and signature drawn on the screen (a PNG). */
export async function addWitness(loanId: string, witness: { name: string; idNumber: string; signature: Blob }): Promise<void> {
  const { error } = await supabase.rpc('loan_form_witness', {
    p_loan: loanId,
    p_name: witness.name.trim(),
    p_id_number: witness.idNumber.trim(),
    p_signature: await blobToDataUrl(witness.signature),
  });
  if (error) fail(error, 'The witness was not added.');
}

/** HR's part of the form: who did the affordability assessment and the checklist items ticked. */
export async function saveFormChecks(loanId: string, affordabilityBy: string, checks: ChecklistItem[]): Promise<void> {
  const { error } = await supabase.rpc('loan_form_checks', { p_loan: loanId, p_affordability_by: affordabilityBy.trim(), p_checks: checks });
  if (error) fail(error, 'The checklist was not saved.');
}

// ---- corrections to the form's values

/** The corrections made on these loans' forms, by loan id. */
export async function loadFormValues(loanIds: string[]): Promise<Record<string, FormValues>> {
  const out: Record<string, FormValues> = {};
  for (const ids of chunks([...new Set(loanIds)], IN_LIST_SIZE)) {
    const { data, error } = await supabase.from('employee_loan_form_values').select('loan_id, values').in('loan_id', ids);
    if (error) throw error;
    for (const row of (data ?? []) as { loan_id: string; values: FormValues }[]) out[row.loan_id] = row.values ?? {};
  }
  return out;
}

/** Saves all of a loan's corrections (a field left empty shows the record's value again). */
export async function saveFormValues(loanId: string, values: FormValues): Promise<void> {
  const { error } = await supabase.rpc('loan_form_set_values', { p_loan: loanId, p_values: values });
  if (error) fail(error, 'The corrections were not saved.');
}

// ---- the witness, a colleague

const WITNESS_COLUMNS = 'loan_id, employee_number, witness_name, status, decline_reason, signed_at';

export async function loadWitnesses(loanIds: string[]): Promise<Record<string, LoanWitness>> {
  const out: Record<string, LoanWitness> = {};
  for (const ids of chunks([...new Set(loanIds)], IN_LIST_SIZE)) {
    const { data, error } = await supabase.from('employee_loan_witnesses').select(WITNESS_COLUMNS).in('loan_id', ids);
    if (error) throw error;
    for (const row of (data ?? []) as LoanWitness[]) out[row.loan_id] = row;
  }
  return out;
}

/** The loans the signed-in employee was asked to witness. */
export async function loadMyWitnessing(employeeNumber: string): Promise<LoanWitness[]> {
  const { data, error } = await supabase.from('employee_loan_witnesses').select(WITNESS_COLUMNS).eq('employee_number', employeeNumber).order('loan_id');
  if (error) throw error;
  return (data ?? []) as LoanWitness[];
}

export async function setWitness(loanId: string, employeeNumber: string): Promise<void> {
  const { error } = await supabase.rpc('loan_set_witness', { p_loan: loanId, p_employee: employeeNumber });
  if (error) fail(error, 'The witness was not asked.');
}

export interface WitnessView {
  borrower_name: string;
  principal: number;
  months: number;
  product_name: string | null;
  loan_status: string;
  borrower_signed: boolean;
  borrower_signature: string | null;
}

export async function loadWitnessView(loanId: string): Promise<WitnessView> {
  const { data, error } = await supabase.rpc('loan_witness_view', { p_loan: loanId });
  if (error || !data) fail(error, 'Could not load the loan.');
  const v = data as WitnessView;
  return { ...v, principal: Number(v.principal), months: Number(v.months) };
}

export async function signAsWitness(loanId: string, signature: string): Promise<void> {
  const { error } = await supabase.rpc('loan_witness_sign', { p_loan: loanId, p_signature: signature });
  if (error) fail(error, 'You did not sign. Please try again.');
}

export async function declineWitness(loanId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('loan_witness_decline', { p_loan: loanId, p_reason: reason.trim() });
  if (error) fail(error, 'Not declined. Please try again.');
}

/** HR deletes a cancelled loan with everything that belongs to it. */
export async function deleteCancelledLoan(loanId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_cancelled_loan', { p_loan: loanId });
  if (error) fail(error, 'The loan was not deleted.');
}

// ---- the guarantor

const GUARANTOR_COLUMNS =
  'loan_id, employee_number, guarantor_name, status, decline_reason, relationship, alternative_phone, residential_address, id_number, kra_pin, date_of_birth, mobile, email, town, signature, signed_at';

/** The guarantors of these loans (the ones the signed-in person may see), by loan id. */
export async function loadGuarantors(loanIds: string[]): Promise<Record<string, LoanGuarantor>> {
  const out: Record<string, LoanGuarantor> = {};
  for (const ids of chunks([...new Set(loanIds)], IN_LIST_SIZE)) {
    const { data, error } = await supabase.from('employee_loan_guarantors').select(GUARANTOR_COLUMNS).in('loan_id', ids);
    if (error) throw error;
    for (const row of (data ?? []) as LoanGuarantor[]) out[row.loan_id] = row;
  }
  return out;
}

/** The loans the signed-in employee was asked to guarantee. */
export async function loadMyGuarantees(employeeNumber: string): Promise<LoanGuarantor[]> {
  const { data, error } = await supabase.from('employee_loan_guarantors').select(GUARANTOR_COLUMNS).eq('employee_number', employeeNumber).order('loan_id');
  if (error) throw error;
  return (data ?? []) as LoanGuarantor[];
}

/** The colleagues a borrower may ask to guarantee their loan. */
export async function loadGuarantorChoices(): Promise<{ employee_number: string; name: string }[]> {
  const { data, error } = await supabase.rpc('loan_guarantor_choices');
  if (error) throw error;
  return (data ?? []) as { employee_number: string; name: string }[];
}

/** Asks a colleague to guarantee the loan (or another, after one declined). */
export async function setGuarantor(loanId: string, employeeNumber: string): Promise<void> {
  const { error } = await supabase.rpc('loan_set_guarantor', { p_loan: loanId, p_employee: employeeNumber });
  if (error) fail(error, 'The guarantor was not asked.');
}

/** The guarantor signs with their saved signature, adding how they know the borrower and how to reach them. */
export async function signAsGuarantor(
  loanId: string,
  signature: string,
  details: { relationship: string; alternativePhone: string; address: string }
): Promise<void> {
  const { error } = await supabase.rpc('loan_guarantor_sign', {
    p_loan: loanId,
    p_signature: signature,
    p_relationship: details.relationship.trim(),
    p_alternative_phone: details.alternativePhone.trim() || null,
    p_address: details.address.trim() || null,
  });
  if (error) fail(error, 'You did not sign. Please try again.');
}

export async function declineGuarantee(loanId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('loan_guarantor_decline', { p_loan: loanId, p_reason: reason.trim() });
  if (error) fail(error, 'Not declined. Please try again.');
}

/** What the guarantor sees: the loan's terms and schedule and their own part, the borrower's name only. */
export interface GuarantorView {
  loan: EmployeeLoan;
  schedule: LoanInstalment[];
  guarantor: LoanGuarantor;
  /** the form as it stands (the borrower's, witness's and approver's signatures), and the witness */
  form: LoanForm | null;
  witness: LoanWitness | null;
  context: LoanFormContext;
}

const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadGuarantorView(loanId: string): Promise<GuarantorView> {
  const { data, error } = await supabase.rpc('loan_form_for_guarantor', { p_loan: loanId });
  if (error || !data) fail(error, 'Could not load the loan.');
  const v = data as {
    loan: Record<string, unknown>;
    borrower_name: string;
    schedule: Record<string, unknown>[];
    guarantor: LoanGuarantor;
    form: LoanForm | null;
    witness: LoanWitness | null;
    employer: string | null;
  };
  const loan = {
    ...v.loan,
    principal: Number(v.loan.principal),
    annual_rate: Number(v.loan.annual_rate),
    months: Number(v.loan.months),
    monthly_instalment: numOrNull(v.loan.monthly_instalment),
    total_interest: numOrNull(v.loan.total_interest),
    total_repayable: numOrNull(v.loan.total_repayable),
    other_loan_repayments: numOrNull(v.loan.other_loan_repayments),
    employee_name: v.borrower_name,
    decided_by_email: null,
    decision_comment: null,
    disbursed_by_email: null,
  } as unknown as EmployeeLoan;
  const schedule = (v.schedule ?? []).map((i) => ({
    instalment_no: Number(i.instalment_no),
    period: String(i.period),
    payment: Number(i.payment),
    principal: Number(i.principal),
    interest: Number(i.interest),
    balance: Number(i.balance),
  }));
  // the borrower's details as the form shows them, as for the borrower and HR (loan_form_borrower, 20261118700000)
  const context = await loadLoanFormContext({ id: loanId, employee_number: String(v.loan.employee_number ?? '') });
  return { loan, schedule, guarantor: v.guarantor, form: v.form, witness: v.witness, context };
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

/**
 * HR attaches the signed form of a loan already paid out (signed on paper by someone not on the platform, scanned to
 * PDF): kept as its signed form, accepted. Not for a loan whose signed copy was accepted already.
 */
export async function attachSignedForm(loan: { id: string }, file: File): Promise<void> {
  const problem = signedFormProblem(file);
  if (problem) throw new Error(problem);
  const { data: row, error: rowError } = await supabase.from('employee_loans').select('tenant_id').eq('id', loan.id).maybeSingle();
  if (rowError || !row) fail(rowError, 'Loan not found.');
  const path = `${row!.tenant_id}/${loan.id}/signed-${randomFileName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: false });
  if (uploadError) fail(uploadError, 'The signed form was not attached.');
  const { error } = await supabase.rpc('loan_form_attach', { p_loan: loan.id, p_path: path, p_file_name: file.name.slice(0, 255) });
  if (error) fail(error, 'The signed form was not attached.');
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
