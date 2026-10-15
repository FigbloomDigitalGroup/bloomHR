import { supabase } from './supabase';
import { sendEmailViaServer } from './emailApi';
import { queueInvitations } from './inviteQueue';
import { startOnboardingByEmail } from './onboarding';
import { formatKsh } from './jobGroups';
import type { StatusTone } from '../components/UI';

// Offer letters (FIG-831, migration 20261016300000). HR writes an offer from one of the company's templates; the
// letter's placeholders are filled here, the same way for the preview, the PDF and the candidate's page. Sending makes
// a link token in the database (only its hash is kept) and emails the link /offer?token=...; the candidate accepts or
// declines there. After acceptance HR adds them as an employee and their staff invite is queued.

export const OFFER_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired', 'withdrawn'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
};

export const OFFER_STATUS_TONES: Record<OfferStatus, StatusTone> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  declined: 'danger',
  expired: 'warning',
  withdrawn: 'neutral',
};

export interface OfferTemplate {
  id: string;
  title: string;
  body: string;
  is_default: boolean;
  active: boolean;
}

/** What HR fills in on an offer. */
export interface OfferFields {
  application_id: string | null;
  template_id: string | null;
  candidate_first_name: string;
  candidate_last_name: string | null;
  candidate_email: string | null;
  job_title: string;
  job_group_id: string | null;
  basic_salary: number;
  house_allowance: number;
  travel_allowance: number;
  other_allowances: number;
  start_date: string | null;
  expiry_date: string | null;
  title: string;
  body: string;
}

export interface Offer extends OfferFields {
  id: string;
  status: OfferStatus;
  sent_at: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  decline_reason: string | null;
  employee_id: string | null;
  created_at: string;
}

/** A job group with the pay in force today (offer_job_groups). */
export interface OfferJobGroup {
  id: string;
  code: string;
  name: string;
  effective_from: string | null;
  basic_salary: number | null;
  basic_min: number | null;
  basic_max: number | null;
  house_allowance: number | null;
  travel_allowance: number | null;
  other_allowances: number | null;
}

/** The company's look on a letter. */
export interface LetterBranding {
  name: string;
  logo_url?: string | null;
  tagline?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  /** the company's own letterhead image: replaces the generated one at the top */
  letterhead_header_url?: string | null;
  /** an image at the bottom of the letter */
  letterhead_footer_url?: string | null;
}

/** What the candidate's page shows (offer_by_token). */
export interface PublicOffer {
  title: string;
  body: string;
  candidate_first_name: string;
  candidate_last_name: string | null;
  job_title: string;
  job_group: string | null;
  basic_salary: number;
  house_allowance: number;
  travel_allowance: number;
  other_allowances: number;
  start_date: string | null;
  expiry_date: string | null;
  sent_at: string | null;
  status: OfferStatus;
  responded_at: string | null;
  company: LetterBranding;
}

/** The placeholders a template can use, with what each is filled with. */
export const OFFER_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'candidate_name', label: 'Candidate’s full name' },
  { key: 'first_name', label: 'Candidate’s first name' },
  { key: 'job_title', label: 'Job title' },
  { key: 'job_group', label: 'Job group' },
  { key: 'start_date', label: 'Start date' },
  { key: 'basic_salary', label: 'Monthly basic salary' },
  { key: 'allowances', label: 'Monthly allowances (total)' },
  { key: 'gross_pay', label: 'Monthly gross pay' },
  { key: 'company_name', label: 'Company name' },
  { key: 'expiry_date', label: 'Reply-by date' },
  { key: 'offer_date', label: 'Date of the letter' },
];

const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));

/** 14 October 2026 ('' for none). */
export function letterDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

type LetterSource = Pick<OfferFields, 'candidate_first_name' | 'candidate_last_name' | 'job_title' | 'start_date' | 'expiry_date'> & {
  basic_salary: unknown;
  house_allowance: unknown;
  travel_allowance: unknown;
  other_allowances: unknown;
};

/** Each placeholder's value for this offer. */
export function offerValues(
  offer: LetterSource,
  extra: { companyName: string; jobGroup?: string | null; offerDate?: string | null }
): Record<string, string> {
  const allowances = num(offer.house_allowance) + num(offer.travel_allowance) + num(offer.other_allowances);
  const basic = num(offer.basic_salary);
  return {
    candidate_name: [offer.candidate_first_name, offer.candidate_last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' '),
    first_name: (offer.candidate_first_name ?? '').trim(),
    job_title: (offer.job_title ?? '').trim(),
    job_group: extra.jobGroup?.trim() || '—',
    start_date: letterDate(offer.start_date) || '—',
    basic_salary: formatKsh(basic),
    allowances: formatKsh(allowances),
    gross_pay: formatKsh(basic + allowances),
    company_name: extra.companyName.trim(),
    expiry_date: letterDate(offer.expiry_date) || '—',
    offer_date: letterDate(extra.offerDate ?? new Date().toISOString()),
  };
}

/** The text with each {{placeholder}} filled; an unknown one is left as typed so HR notices it. */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => values[key.toLowerCase()] ?? whole);
}

/** Placeholders in the text that are not known (shown as a warning in the editor). */
export function unknownPlaceholders(text: string): string[] {
  const known = new Set(OFFER_PLACEHOLDERS.map((p) => p.key));
  const found = [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase());
  return [...new Set(found.filter((k) => !known.has(k)))];
}

/** A sent offer whose reply-by date has passed is expired, even before the daily job marks it. */
export function effectiveStatus(offer: Pick<Offer, 'status' | 'expiry_date'>, today = new Date().toISOString().slice(0, 10)): OfferStatus {
  return offer.status === 'sent' && offer.expiry_date && offer.expiry_date < today ? 'expired' : offer.status;
}

/** What is wrong with the offer before it can be saved (or, with `sending`, sent), by field. */
export function offerErrors(o: OfferFields, sending = false, today = new Date().toISOString().slice(0, 10)): Partial<Record<keyof OfferFields, string>> {
  const e: Partial<Record<keyof OfferFields, string>> = {};
  if (!o.candidate_first_name.trim()) e.candidate_first_name = 'Give the candidate’s first name';
  if (!o.job_title.trim()) e.job_title = 'Give the job title';
  if (o.candidate_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.candidate_email.trim())) e.candidate_email = 'Enter an email like jane@gmail.com';
  for (const k of ['basic_salary', 'house_allowance', 'travel_allowance', 'other_allowances'] as const) {
    if (!Number.isFinite(o[k]) || o[k] < 0) e[k] = 'Use 0 or more';
  }
  if (!o.title.trim()) e.title = 'Give the letter a title';
  if (!o.body.trim()) e.body = 'Write the letter';
  if (o.start_date && o.expiry_date && o.expiry_date > o.start_date) e.expiry_date = 'The reply-by date must be before the start date';
  if (sending) {
    if (!o.candidate_email?.trim()) e.candidate_email = 'Add the candidate’s email to send the offer';
    if (!o.start_date) e.start_date = 'Choose the start date';
    if (!o.expiry_date) e.expiry_date = 'Choose the reply-by date';
    else if (o.expiry_date < today) e.expiry_date = 'Choose a reply-by date from today on';
  }
  return e;
}

/** The pay a group's current rate sets on an offer (a band keeps `basic`, moved into the band); null without a rate. */
export function payFromOfferGroup(group: OfferJobGroup | undefined, basic: number) {
  if (!group?.effective_from) return null;
  const b = group.basic_salary ?? Math.min(Math.max(basic || (group.basic_min ?? 0), group.basic_min ?? 0), group.basic_max ?? Infinity);
  return {
    basic_salary: b,
    house_allowance: group.house_allowance ?? 0,
    travel_allowance: group.travel_allowance ?? 0,
    other_allowances: group.other_allowances ?? 0,
  };
}

export const blankOffer = (template?: OfferTemplate | null): OfferFields => ({
  application_id: null,
  template_id: template?.id ?? null,
  candidate_first_name: '',
  candidate_last_name: null,
  candidate_email: null,
  job_title: '',
  job_group_id: null,
  basic_salary: 0,
  house_allowance: 0,
  travel_allowance: 0,
  other_allowances: 0,
  start_date: null,
  expiry_date: null,
  title: template?.title ?? 'Offer of employment',
  body: template?.body ?? '',
});

const fail = (error: { message?: string } | null, fallback: string): never => {
  throw new Error(error?.message || fallback);
};

const toOffer = (r: Record<string, unknown>): Offer => ({
  ...(r as unknown as Offer),
  basic_salary: num(r.basic_salary),
  house_allowance: num(r.house_allowance),
  travel_allowance: num(r.travel_allowance),
  other_allowances: num(r.other_allowances),
});

export async function loadOffers(): Promise<Offer[]> {
  const { data, error } = await supabase.from('job_offers').select('*').order('created_at', { ascending: false });
  if (error) fail(error, 'Could not load the offers.');
  return ((data ?? []) as Record<string, unknown>[]).map(toOffer);
}

/** Saves a draft (id null: a new one). Returns it as saved (a job group's pay filled in). */
export async function saveOffer(id: string | null, fields: OfferFields): Promise<Offer> {
  const row = {
    ...fields,
    candidate_first_name: fields.candidate_first_name.trim(),
    candidate_last_name: fields.candidate_last_name?.trim() || null,
    candidate_email: fields.candidate_email?.trim().toLowerCase() || null,
    job_title: fields.job_title.trim(),
    title: fields.title.trim(),
  };
  const { data, error } = id
    ? await supabase.from('job_offers').update(row).eq('id', id).select('*').single()
    : await supabase.from('job_offers').insert(row).select('*').single();
  if (error) fail(error, 'The offer was not saved.');
  return toOffer(data as Record<string, unknown>);
}

export async function deleteOffer(id: string) {
  const { error } = await supabase.from('job_offers').delete().eq('id', id);
  if (error) fail(error, 'The offer was not deleted.');
}

export async function withdrawOffer(id: string) {
  const { error } = await supabase.rpc('withdraw_offer', { p_offer: id });
  if (error) fail(error, 'The offer was not withdrawn.');
}

export const offerLink = (token: string, origin = window.location.origin) => `${origin}/offer?token=${encodeURIComponent(token)}`;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The email that carries the link (the letter itself is on the page). */
export function offerEmailHtml(p: { firstName: string; companyName: string; jobTitle: string; expiry: string | null; link: string; color?: string | null }) {
  const color = p.color && /^#[0-9A-Fa-f]{6}$/.test(p.color) ? p.color : '#17402A';
  const by = letterDate(p.expiry);
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2937;max-width:560px">
<p>Dear ${escapeHtml(p.firstName)},</p>
<p>${escapeHtml(p.companyName)} is pleased to offer you the position of <strong>${escapeHtml(p.jobTitle)}</strong>.</p>
<p>Open your offer letter to read it, download it, and accept or decline it${by ? ` by ${escapeHtml(by)}` : ''}:</p>
<p><a href="${escapeHtml(p.link)}" style="display:inline-block;background:${color};color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">View your offer</a></p>
<p style="font-size:13px;color:#6b7280">This link is for you only; please don’t forward it. If the button doesn’t work, copy this address into your browser: ${escapeHtml(p.link)}</p>
</div>`;
}

export type SendOutcome = { status: 'sent'; email: string } | { status: 'not-emailed'; email: string; link: string; reason: string };

/**
 * Sends (or sends again) the offer: the database makes a new link (the old one stops working) and marks it sent, then
 * the link is emailed to the candidate. If the email fails the offer is still sent; the link is returned to share.
 */
export async function sendOffer(offer: Offer, branding: LetterBranding): Promise<SendOutcome> {
  const { data, error } = await supabase.rpc('send_offer', { p_offer: offer.id });
  if (error) fail(error, 'The offer was not sent.');
  const link = offerLink(String(data));
  const email = offer.candidate_email ?? '';
  try {
    await sendEmailViaServer(
      {
        to: email,
        subject: `Your offer from ${branding.name}: ${offer.job_title}`,
        html: offerEmailHtml({
          firstName: offer.candidate_first_name, companyName: branding.name, jobTitle: offer.job_title,
          expiry: offer.expiry_date, link, color: branding.primary_color,
        }),
      },
      { purpose: 'offer' }
    );
  } catch (err) {
    return { status: 'not-emailed', email, link, reason: (err as Error).message || 'the email was not sent' };
  }
  return { status: 'sent', email };
}

export interface AddedEmployee {
  employeeId: string;
  employeeNumber: string;
  workEmail: string;
  /** whether the staff invite was queued (it is sent within a minute or two) */
  invited: boolean;
  inviteProblem?: string;
}

/**
 * Adds the candidate of an accepted offer as an employee (a draft onboarding record), then queues their invitation
 * to the staff portal and marks them invited. The employee is added even if the invite can't be queued.
 */
export async function addOfferAsEmployee(offerId: string, workEmail?: string): Promise<AddedEmployee> {
  const { data, error } = await supabase.rpc('add_offer_employee', { p_offer: offerId, p_work_email: workEmail?.trim() || null });
  if (error) fail(error, 'The employee was not added.');
  const row = (Array.isArray(data) ? data[0] : data) as { employee_id: string; employee_number: string; work_email: string };
  const added: AddedEmployee = { employeeId: row.employee_id, employeeNumber: row.employee_number, workEmail: row.work_email, invited: false };
  try {
    const queued = await queueInvitations([{ email: row.work_email, role: 'STAFF' }]);
    if (queued.rejected.length) {
      added.inviteProblem = queued.rejected[0].reason;
    } else {
      added.invited = true;
      await startOnboardingByEmail([row.work_email]);
    }
  } catch (err) {
    added.inviteProblem = (err as Error).message;
  }
  return added;
}

export async function loadOfferTemplates(): Promise<OfferTemplate[]> {
  const { data, error } = await supabase.from('offer_letter_templates').select('id, title, body, is_default, active').order('created_at');
  if (error) fail(error, 'Could not load the letter templates.');
  return (data ?? []) as OfferTemplate[];
}

/** Adds (id null) or changes a template. Making one the default takes it off the others first. */
export async function saveOfferTemplate(id: string | null, t: Pick<OfferTemplate, 'title' | 'body' | 'is_default' | 'active'>): Promise<OfferTemplate> {
  if (t.is_default) {
    const others = supabase.from('offer_letter_templates').update({ is_default: false }).eq('is_default', true);
    const { error } = id ? await others.neq('id', id) : await others;
    if (error) fail(error, 'The template was not saved.');
  }
  const row = { title: t.title.trim(), body: t.body, is_default: t.is_default, active: t.active };
  const { data, error } = id
    ? await supabase.from('offer_letter_templates').update(row).eq('id', id).select('id, title, body, is_default, active').single()
    : await supabase.from('offer_letter_templates').insert(row).select('id, title, body, is_default, active').single();
  if (error) fail(error, 'The template was not saved.');
  return data as OfferTemplate;
}

export async function deleteOfferTemplate(id: string) {
  const { error } = await supabase.from('offer_letter_templates').delete().eq('id', id);
  if (error) fail(error, 'The template was not deleted.');
}

/** The company's active job groups with today's pay; [] when there are none or they can't be read. */
export async function loadOfferJobGroups(): Promise<OfferJobGroup[]> {
  const { data, error } = await supabase.rpc('offer_job_groups');
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as OfferJobGroup),
    basic_salary: r.basic_salary === null ? null : num(r.basic_salary),
    basic_min: r.basic_min === null ? null : num(r.basic_min),
    basic_max: r.basic_max === null ? null : num(r.basic_max),
    house_allowance: r.house_allowance === null ? null : num(r.house_allowance),
    travel_allowance: r.travel_allowance === null ? null : num(r.travel_allowance),
    other_allowances: r.other_allowances === null ? null : num(r.other_allowances),
  }));
}

/** The offer a link opens, or null when the link is not valid (any more). */
export async function loadOfferByToken(token: string): Promise<PublicOffer | null> {
  if (!token) return null;
  const { data, error } = await supabase.rpc('offer_by_token', { p_token: token });
  if (error) fail(error, 'Could not open the offer.');
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    ...(r as unknown as PublicOffer),
    basic_salary: num(r.basic_salary),
    house_allowance: num(r.house_allowance),
    travel_allowance: num(r.travel_allowance),
    other_allowances: num(r.other_allowances),
  };
}

/** The candidate's answer. Returns the new status. */
export async function respondToOffer(token: string, accept: boolean, reason?: string): Promise<OfferStatus> {
  const { data, error } = await supabase.rpc('respond_to_offer', { p_token: token, p_accept: accept, p_reason: reason?.trim() || null });
  if (error) fail(error, 'Your answer was not saved.');
  return data as OfferStatus;
}

/**
 * Waits until every image in the element has loaded (or failed), so the PDF doesn't catch a letterhead half drawn.
 * Gives up after `timeoutMs` so a stalled image never blocks the download.
 */
export async function imagesLoaded(element: HTMLElement, timeoutMs = 10000) {
  const pending = Array.from(element.querySelectorAll('img')).filter((img) => !img.complete);
  if (!pending.length) return;
  const all = Promise.all(pending.map((img) => new Promise<void>((done) => {
    img.addEventListener('load', () => done(), { once: true });
    img.addEventListener('error', () => done(), { once: true });
  })));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([all, new Promise<void>((done) => { timer = setTimeout(done, timeoutMs); })]);
  clearTimeout(timer);
}

/** Downloads the element (the rendered letter) as an A4 PDF, as payslips are. */
export async function downloadLetterPdf(element: HTMLElement, filename: string) {
  await imagesLoaded(element);
  const { default: html2pdf } = await import('html2pdf.js');
  await html2pdf()
    .from(element)
    .set({
      margin: 0.5,
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, windowWidth: 900 },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
    })
    .save();
}

/** A file name for the letter: offer-jane-wanjiku.pdf */
export const letterFileName = (first: string, last?: string | null) =>
  `offer-${[first, last].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'letter'}.pdf`;
