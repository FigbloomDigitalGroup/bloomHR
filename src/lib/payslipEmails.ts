import { supabase } from './supabase';

// Payslips emailed with their PDF attached (FIG-732, migration 20261019600000).
//   1. queue_payslip_emails(run): a row per payslip of an approved run in payslip_emails (skipped, with the reason, when
//      there is no work email, or no ID number while the PDFs are password protected).
//   2. The browser makes each waiting payslip's PDF (payslipPdf.tsx), uploads it to the private payslip-pdfs bucket at
//      the row's pdf_path, and payslip_pdfs_uploaded() marks it ready.
//   3. The send-notification-emails Edge Function emails it with the PDF attached and marks it sent (or failed after
//      5 tries; pressing "Email payslips" again retries the failed and skipped ones).
// Payroll's settings for it are on company_payroll_settings.

export const PAYSLIP_BUCKET = 'payslip-pdfs';

export type PayslipEmailStatus = 'waiting_pdf' | 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface PayslipEmailRow {
  id: number;
  employee_number: string;
  employee_name: string | null;
  to_email: string | null;
  status: PayslipEmailStatus;
  error: string | null;
  attempts: number;
  pdf_path: string;
  password_protected: boolean;
}

export interface PayslipEmailSettings {
  /** start emailing payslips when a month is approved */
  auto: boolean;
  /** protect each PDF with the employee's ID number */
  password: boolean;
  /** days the PDF is kept after it is sent (0 = deleted at once) */
  keepDays: number;
}

export const DEFAULT_PAYSLIP_EMAIL_SETTINGS: PayslipEmailSettings = { auto: false, password: true, keepDays: 0 };

export interface PayslipEmailSummary {
  total: number;
  /** PDFs still to be made in the browser */
  waiting: number;
  /** ready, or being sent by the server */
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
}

export function summarizePayslipEmails(rows: Pick<PayslipEmailRow, 'status'>[]): PayslipEmailSummary {
  const n = (...s: PayslipEmailStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  return {
    total: rows.length,
    waiting: n('waiting_pdf'),
    queued: n('pending', 'sending'),
    sent: n('sent'),
    failed: n('failed'),
    skipped: n('skipped'),
  };
}

/** "Sent 34 of 40" (of those that can be sent: the skipped are listed apart). */
export function progressLabel(s: PayslipEmailSummary): string {
  return `Sent ${s.sent} of ${s.total - s.skipped}`;
}

/** Still something to wait for: PDFs to make, or emails the server has not sent yet. */
export const stillSending = (s: PayslipEmailSummary) => s.waiting > 0 || s.queued > 0;

/** The PDF password for an ID number as HR keeps it (upper case, no spaces); null when there is none. */
export function pdfPassword(idNumber: unknown): string | null {
  if (idNumber === null || idNumber === undefined) return null;
  const s = String(idNumber).replace(/\s+/g, '').toUpperCase();
  return s ? s : null;
}

const notThereYet = (err: unknown) => ['PGRST202', '42883', '42703', 'PGRST204', '42P01', 'PGRST205'].includes(String((err as { code?: string })?.code));

export async function loadPayslipEmailSettings(): Promise<PayslipEmailSettings> {
  const { data, error } = await supabase
    .from('company_payroll_settings')
    .select('payslip_email_auto, payslip_pdf_password, payslip_pdf_keep_days')
    .maybeSingle();
  if (error) {
    if (notThereYet(error)) return DEFAULT_PAYSLIP_EMAIL_SETTINGS;
    throw error;
  }
  const row = data as { payslip_email_auto?: boolean; payslip_pdf_password?: boolean; payslip_pdf_keep_days?: number } | null;
  return {
    auto: row?.payslip_email_auto ?? DEFAULT_PAYSLIP_EMAIL_SETTINGS.auto,
    password: row?.payslip_pdf_password ?? DEFAULT_PAYSLIP_EMAIL_SETTINGS.password,
    keepDays: row?.payslip_pdf_keep_days ?? DEFAULT_PAYSLIP_EMAIL_SETTINGS.keepDays,
  };
}

export async function savePayslipEmailSettings(s: PayslipEmailSettings): Promise<void> {
  const { error } = await supabase.from('company_payroll_settings').upsert(
    {
      payslip_email_auto: s.auto,
      payslip_pdf_password: s.password,
      payslip_pdf_keep_days: Math.max(0, Math.min(365, Math.round(s.keepDays) || 0)),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' },
  );
  if (error) throw error;
}

export async function listPayslipEmails(runId: string): Promise<PayslipEmailRow[]> {
  const { data, error } = await supabase
    .from('payslip_emails')
    .select('id, employee_number, employee_name, to_email, status, error, attempts, pdf_path, password_protected')
    .eq('run_id', runId)
    .order('employee_number');
  if (error) {
    if (notThereYet(error)) return [];
    throw error;
  }
  return (data ?? []) as PayslipEmailRow[];
}

/** Queues (or re-queues the failed and skipped) payslips of an approved run. */
export async function queuePayslipEmails(runId: string): Promise<void> {
  const { error } = await supabase.rpc('queue_payslip_emails', { p_run: runId });
  if (error) throw error;
}

/** Uploads one payslip's PDF to its place in the bucket (replacing an earlier one). */
export async function uploadPayslipPdf(path: string, pdf: Blob): Promise<void> {
  const { error } = await supabase.storage.from(PAYSLIP_BUCKET).upload(path, pdf, { upsert: true, contentType: 'application/pdf' });
  if (error) throw error;
}

/** These rows' PDFs are uploaded: ready for the server to send. */
export async function markPayslipPdfsUploaded(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.rpc('payslip_pdfs_uploaded', { p_ids: ids });
  if (error) throw error;
}
