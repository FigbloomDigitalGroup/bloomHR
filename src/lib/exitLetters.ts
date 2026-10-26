import { supabase } from './supabase';
import { sendEmailViaServer } from './emailApi';
import { archiveDocument, type GeneratedDocument } from './generatedDocuments';
import { letterDate, type LetterBranding, type OfferTemplate } from './offers';
import { reasonLabel, type ExitRecord } from './exits';

// Exit letters (migration 20261026000000): HR writes a letter from one of the company's exit letter templates
// (termination, non-confirmation after probation, accepting a resignation, or their own), on the company letterhead and
// signed with their drawn signature, then emails it to the employee as a PDF. Every letter sent or downloaded is kept in
// the archive of generated documents.

export type ExitLetterTemplate = OfferTemplate;

/** The placeholders an exit letter can use. {{signature}} on a line of its own is the sender's drawn signature. */
export const EXIT_LETTER_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'employee_name', label: 'Employee’s full name' },
  { key: 'first_name', label: 'Employee’s first name' },
  { key: 'job_title', label: 'Their position' },
  { key: 'employee_number', label: 'Their employee number' },
  { key: 'start_date', label: 'When they started' },
  { key: 'notice_given_on', label: 'When notice was given' },
  { key: 'notice_days', label: 'Notice period (days)' },
  { key: 'last_working_day', label: 'Last working day' },
  { key: 'reason', label: 'Reason for the exit' },
  { key: 'company_name', label: 'Company name' },
  { key: 'letter_date', label: 'Date of the letter' },
  { key: 'sender_name', label: 'Your name' },
  { key: 'sender_title', label: 'Your job title' },
  { key: 'signature', label: 'Your drawn signature (on its own line)' },
];

/** The employee the letter goes to. */
export interface LetterRecipient {
  firstName: string;
  lastName: string;
  jobTitle: string;
  startDate: string | null;
  workEmail: string | null;
  personalEmail: string | null;
}

/** Who signs the letter: the HR person sending it. */
export interface LetterSender {
  name: string;
  title: string;
}

const fail = (error: { message?: string } | null, fallback: string): never => {
  throw new Error(error?.message || fallback);
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Each placeholder's value for this exit ({{signature}} is drawn by the letter, not filled here). */
export function exitLetterValues(
  exit: Pick<ExitRecord, 'employee_number' | 'kind' | 'reason_category' | 'notice_given_on' | 'notice_days' | 'last_working_day'>,
  recipient: LetterRecipient,
  extra: { companyName: string; sender: LetterSender; letterDate?: string | null }
): Record<string, string> {
  return {
    employee_name: [recipient.firstName, recipient.lastName].filter(Boolean).join(' '),
    first_name: recipient.firstName,
    job_title: recipient.jobTitle || '—',
    employee_number: exit.employee_number,
    start_date: letterDate(recipient.startDate) || '—',
    notice_given_on: letterDate(exit.notice_given_on) || '—',
    notice_days: String(exit.notice_days ?? ''),
    last_working_day: letterDate(exit.last_working_day) || '—',
    reason: reasonLabel(exit),
    company_name: extra.companyName.trim(),
    letter_date: letterDate(extra.letterDate ?? new Date().toISOString()),
    sender_name: extra.sender.name,
    sender_title: extra.sender.title,
  };
}

/** The template to start a letter from: the default, else the first active one. */
export const startingTemplate = (templates: ExitLetterTemplate[]) =>
  templates.find((t) => t.is_default && t.active) ?? templates.find((t) => t.active) ?? null;

export async function loadLetterRecipient(employeeNumber: string): Promise<LetterRecipient> {
  const { data, error } = await supabase
    .from('employees')
    .select('"First Name", "Last Name", "Job Title", "Start Date", "Work Email", "Personal Email"')
    .eq('"Employee Number"', employeeNumber)
    .maybeSingle();
  if (error || !data) fail(error, 'Could not load the employee.');
  const r = data as Record<string, unknown>;
  return {
    firstName: text(r['First Name']),
    lastName: text(r['Last Name']),
    jobTitle: text(r['Job Title']),
    startDate: (r['Start Date'] as string | null) ?? null,
    workEmail: text(r['Work Email']) || null,
    personalEmail: text(r['Personal Email']) || null,
  };
}

/** The signed-in person's name and job title from their employee record, else their account name. */
export async function loadLetterSender(): Promise<LetterSender> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  const fallback = text(user?.user_metadata?.full_name) || text(user?.email?.split('@')[0]);
  if (!user?.email) return { name: fallback, title: '' };
  const { data } = await supabase.from('employees').select('"First Name", "Last Name", "Job Title"').eq('"Work Email"', user.email).maybeSingle();
  const r = (data ?? {}) as Record<string, unknown>;
  const name = [text(r['First Name']), text(r['Last Name'])].filter(Boolean).join(' ');
  return { name: name || fallback, title: text(r['Job Title']) };
}

export async function loadExitLetterTemplates(): Promise<ExitLetterTemplate[]> {
  const { data, error } = await supabase.from('exit_letter_templates').select('id, title, body, is_default, active').order('created_at');
  if (error) fail(error, 'Could not load the letter templates.');
  return (data ?? []) as ExitLetterTemplate[];
}

/** Adds (id null) or changes a template. Making one the default takes it off the others first. */
export async function saveExitLetterTemplate(
  id: string | null,
  t: Pick<ExitLetterTemplate, 'title' | 'body' | 'is_default' | 'active'>
): Promise<ExitLetterTemplate> {
  if (t.is_default) {
    const others = supabase.from('exit_letter_templates').update({ is_default: false }).eq('is_default', true);
    const { error } = id ? await others.neq('id', id) : await others;
    if (error) fail(error, 'The template was not saved.');
  }
  const row = { title: t.title.trim(), body: t.body, is_default: t.is_default, active: t.active };
  const { data, error } = id
    ? await supabase.from('exit_letter_templates').update(row).eq('id', id).select('id, title, body, is_default, active').single()
    : await supabase.from('exit_letter_templates').insert(row).select('id, title, body, is_default, active').single();
  if (error) fail(error, 'The template was not saved.');
  return data as ExitLetterTemplate;
}

export async function deleteExitLetterTemplate(id: string) {
  const { error } = await supabase.from('exit_letter_templates').delete().eq('id', id);
  if (error) fail(error, 'The template was not deleted.');
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The email the letter is attached to. */
export function exitLetterEmailHtml(p: { firstName: string; companyName: string; title: string }) {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2937;max-width:560px">
<p>Dear ${escapeHtml(p.firstName || 'colleague')},</p>
<p>Please find attached a letter from ${escapeHtml(p.companyName)}: <strong>${escapeHtml(p.title)}</strong>.</p>
<p>If you have any questions about it, please contact HR.</p>
</div>`;
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Could not attach the letter.'));
    reader.readAsDataURL(blob);
  });

/** A file name for the letter: letter-jane-wanjiku.pdf */
export const exitLetterFileName = (recipient: Pick<LetterRecipient, 'firstName' | 'lastName'>) =>
  `letter-${[recipient.firstName, recipient.lastName].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'employee'}.pdf`;

export type ExitLetterOutcome =
  | { status: 'sent'; to: string[]; document: GeneratedDocument | null; archiveProblem?: string }
  | { status: 'not-emailed'; reason: string; document: GeneratedDocument | null; archiveProblem?: string };

/**
 * Emails the letter (a PDF) to the addresses given, then keeps it in the archive with who it went to. A letter that
 * could not be emailed is still kept (it was made), so HR can download it and hand it over.
 */
export async function sendExitLetter(p: {
  exit: Pick<ExitRecord, 'id' | 'employee_number'>;
  title: string;
  pdf: Blob;
  to: string[];
  recipient: Pick<LetterRecipient, 'firstName' | 'lastName'>;
  branding: Pick<LetterBranding, 'name'>;
}): Promise<ExitLetterOutcome> {
  let emailProblem: string | null = null;
  try {
    await sendEmailViaServer(
      {
        to: p.to,
        subject: `${p.title} - ${p.branding.name}`,
        html: exitLetterEmailHtml({ firstName: p.recipient.firstName, companyName: p.branding.name, title: p.title }),
        attachments: [{ filename: exitLetterFileName(p.recipient), content: await toBase64(p.pdf) }],
      },
      { purpose: 'termination' }
    );
  } catch (err) {
    emailProblem = (err as Error).message || 'the email was not sent';
  }

  let document: GeneratedDocument | null = null;
  let archiveProblem: string | undefined;
  try {
    document = await archiveDocument({
      kind: 'exit_letter',
      title: p.title,
      employeeNumber: p.exit.employee_number,
      referenceId: p.exit.id,
      pdf: p.pdf,
      emailedTo: emailProblem ? [] : p.to,
    });
  } catch (err) {
    archiveProblem = (err as Error).message;
  }
  return emailProblem
    ? { status: 'not-emailed', reason: emailProblem, document, archiveProblem }
    : { status: 'sent', to: p.to, document, archiveProblem };
}

/** Keeps a downloaded letter in the archive (not emailed to anyone). */
export const archiveDownloadedExitLetter = (p: { exit: Pick<ExitRecord, 'id' | 'employee_number'>; title: string; pdf: Blob }) =>
  archiveDocument({ kind: 'exit_letter', title: p.title, employeeNumber: p.exit.employee_number, referenceId: p.exit.id, pdf: p.pdf });
