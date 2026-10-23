// The notification emails (FIG-771, FIG-890): one email per person with every notification not yet emailed to them,
// the same for HR's alerts, the unread chat digest, and a payslip with its PDF attached (FIG-732). Plain TypeScript with no Deno or Node APIs, so the Edge
// Function uses it and vitest tests it.

export interface NotificationItem {
  type: string;
  title: string;
  message: string;
  at: string;
}

export interface NotificationEmail {
  firstName: string | null;
  companyName: string | null;
  items: NotificationItem[];
  /** the staff portal, for the button */
  appUrl: string;
}

/** One conversation in a chat digest (claim_chat_digest_emails()). */
export interface ChatDigestItem {
  channel_id: string;
  kind: 'dm' | 'channel';
  /** the channel's name, or for a direct message the person who wrote */
  name: string | null;
  unread: number;
  mentions: number;
  latest_at?: string;
}

export interface ChatDigestEmail {
  firstName: string | null;
  companyName: string | null;
  items: ChatDigestItem[];
  /** where the chat is for this person */
  link: string;
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** One line, no line breaks (a header). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The app's address without its path (https only), e.g. for HR pages when APP_URL is the staff portal. */
export function appOrigin(appUrl: string): string {
  if (!/^https:\/\//.test(appUrl)) return '';
  try {
    return new URL(appUrl).origin;
  } catch {
    return '';
  }
}

/** The page an HR alert is handled on: the one all the items share, else the app's start page. */
export const HR_PAGES: Record<string, string> = {
  leave_recommended: '/leaves',
  application_received: '/recruitment',
  loan_requested: '/loans',
  contribution_requested: '/payroll?tab=deductions',
  onboarding_followups_overdue: '/onboarding',
  contract_expiring: '/hr-lifecycle',
  probation_expiring: '/hr-lifecycle',
  contract_signed: '/hr-lifecycle',
  exit_requested: '/hr-lifecycle',
  leave_exhausted: '/leaves',
  casual_limit: '/casual-workers',
  leave_document_overdue: '/leave-discipline',
  attendance_odd_hours: '/attendance',
  missed_scan_requested: '/attendance?tab=missed',
  payment_due: '/payments',
  requisition_requested: '/payments?tab=requisitions',
};

/**
 * The staff portal section an employee's notification opens (/staff?tab=...): a copy of src/lib/notificationLinks.ts
 * for the types it maps by type alone (src/lib/notificationLinks.test.ts checks they agree). The types several features
 * share are left out: their email opens the portal's home.
 */
export const STAFF_TABS: Record<string, string> = {
  leave_approved: 'leave-history', leave_rejected: 'leave-history', leave_reopened: 'leave-history',
  leave_scheduled: 'leave-history', leave_year_end_reminder: 'leave',
  document_accepted: 'onboarding', document_rejected: 'onboarding', document_requested: 'onboarding',
  onboarding_approved: 'onboarding', onboarding_changes_requested: 'onboarding', photo_removed: 'onboarding',
  policy_to_accept: 'onboarding',
  salary_advance_approved: 'salary-advance', salary_advance_rejected: 'salary-advance', salary_advance_paid: 'salary-advance',
  loan_approved: 'loan', loan_rejected: 'loan', loan_disbursed: 'loan', loan_repaid: 'loan',
  payslip_ready: 'payslips', salary_paid: 'payslips',
  phone_change_approved: 'details', phone_change_rejected: 'details', suspended: 'details', reactivated: 'details',
  incident_update: 'incident-report', task_assigned: 'tasks', exit_approved: 'resignation', exit_declined: 'resignation',
  contract_sent: 'contract', contract_sent_back: 'contract', contract_accepted: 'contract', contract_cancelled: 'contract',
  missed_scan_request: 'my-team', missed_scan_approved: 'home', missed_scan_declined: 'home',
  payment_made: 'home', requisition_approved: 'home', requisition_rejected: 'home',
};

/** The portal address opened on one section (the address as it is when it can't be read). */
export function staffPortalLink(appUrl: string, tab: string | null, extra: Record<string, string> = {}): string {
  if (!tab || !/^https?:\/\//.test(appUrl)) return appUrl;
  try {
    const url = new URL(appUrl);
    url.searchParams.set('tab', tab);
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    return url.toString();
  } catch {
    return appUrl;
  }
}

/** An employee's email opens the section all its items share, else the portal's home. */
export function staffEmailLink(appUrl: string, items: Pick<NotificationItem, 'type'>[]): string {
  const tabs = [...new Set(items.map((i) => STAFF_TABS[i.type] ?? null))];
  if (tabs.length !== 1) return appUrl;
  // only policies to accept: straight to them
  const policies = items.every((i) => i.type === 'policy_to_accept');
  return staffPortalLink(appUrl, tabs[0], policies ? { section: 'policies' } : {});
}

export function hrAlertLink(appUrl: string, items: Pick<NotificationItem, 'type'>[]): string {
  const origin = appOrigin(appUrl);
  if (!origin) return '';
  const pages = [...new Set(items.map((i) => HR_PAGES[i.type] ?? '/'))];
  return origin + (pages.length === 1 ? pages[0] : '/');
}

/** Staff read the chat in the staff portal (APP_URL); everyone else in Teams. */
export function chatLink(appUrl: string, role: string | null): string {
  if (!role || role === 'STAFF') return /^https:\/\//.test(appUrl) ? appUrl : '';
  const origin = appOrigin(appUrl);
  return origin ? `${origin}/teams` : '';
}

interface Layout {
  companyName: string | null;
  firstName: string | null;
  intro: string;
  rows: { title: string; message?: string }[];
  link: string;
  button: string;
  footer: string;
}

/** The shared look: the company's name in a green band, a greeting, one row per item, a button, a small footer. */
function layout({ companyName, firstName, intro, rows, link, button, footer }: Layout): string {
  const company = escape(companyName || 'Figbloom HR');
  const hello = firstName ? `Hi ${escape(firstName)},` : 'Hi,';
  const body = rows
    .map(
      (n) => `
      <tr><td style="padding:12px 16px;border-top:1px solid #E5E7EB">
        <div style="font-weight:600;color:#16201A;font-size:14px">${escape(n.title)}</div>${
          n.message ? `
        <div style="color:#4B5563;font-size:13px;line-height:1.5;margin-top:4px">${escape(n.message).replace(/\r?\n/g, '<br>')}</div>` : ''
        }
      </td></tr>`
    )
    .join('');
  const href = /^https:\/\//.test(link) ? escape(link) : '';
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F6F8F6;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;border-collapse:separate">
    <tr><td style="padding:20px 16px;background:#17402A;border-radius:12px 12px 0 0;color:#FFFFFF;font-size:16px;font-weight:700">${company}</td></tr>
    <tr><td style="padding:16px;color:#16201A;font-size:14px">${hello}<br>${escape(intro)}</td></tr>
    ${body}
    ${href ? `<tr><td style="padding:16px;border-top:1px solid #E5E7EB">
      <a href="${href}" style="display:inline-block;background:#17402A;color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600">${escape(button)}</a>
    </td></tr>` : ''}
    <tr><td style="padding:12px 16px;color:#9CA3AF;font-size:11px;border-top:1px solid #E5E7EB">
      ${escape(footer)}
    </td></tr>
  </table>
</body></html>`;
}

const from = (companyName: string | null) => (companyName ? ` - ${oneLine(companyName)}` : '');

// ---- the employee's own notifications -----------------------------------------------------------------------------

export function subjectFor({ items, companyName }: Pick<NotificationEmail, 'items' | 'companyName'>): string {
  if (items.length === 1) return `${oneLine(items[0].title)}${from(companyName)}`.slice(0, 200);
  return `${items.length} updates from HR${from(companyName)}`.slice(0, 200);
}

export function htmlFor({ firstName, companyName, items, appUrl }: NotificationEmail): string {
  return layout({
    companyName,
    firstName,
    intro: items.length === 1 ? 'There is an update for you:' : `There are ${items.length} updates for you:`,
    rows: items,
    link: staffEmailLink(appUrl, items),
    button: 'Open the staff portal',
    footer:
      'You get these emails for updates in the staff portal. You can choose everything, important only or none from ' +
      'the bell in the portal (warnings, suspensions and payslips are always emailed).',
  });
}

// ---- HR alerts ------------------------------------------------------------------------------------------------------

export function hrAlertSubject({ items, companyName }: Pick<NotificationEmail, 'items' | 'companyName'>): string {
  if (items.length === 1) return `${oneLine(items[0].title)}${from(companyName)}`.slice(0, 200);
  return `${items.length} things for HR to look at${from(companyName)}`.slice(0, 200);
}

export function hrAlertHtml({ firstName, companyName, items, appUrl }: NotificationEmail): string {
  return layout({
    companyName,
    firstName,
    intro: items.length === 1 ? 'There is something for you to look at:' : `There are ${items.length} things for you to look at:`,
    rows: items,
    link: hrAlertLink(appUrl, items),
    button: 'Open Figbloom HR',
    footer:
      'You get these because your role looks after this in Figbloom HR. You can choose everything, important only or ' +
      'none under Appearance > Email notifications.',
  });
}

// ---- the unread chat digest -------------------------------------------------------------------------------------

/** "3 new messages from Amina", "You were mentioned in #general", "5 new messages in #ops". */
export function describeChat(c: ChatDigestItem): string {
  const name = oneLine(c.name || '');
  if (c.kind === 'dm') return `${plural(c.unread, 'new message')}${name ? ` from ${name}` : ''}`;
  const where = name ? ` in #${name}` : '';
  if (c.mentions > 0 && c.mentions === c.unread) return `You were mentioned${c.mentions > 1 ? ` ${c.mentions} times` : ''}${where}`;
  if (c.mentions > 0) return `${plural(c.unread, 'new message')}${where}, ${c.mentions} mentioning you`;
  return `${plural(c.unread, 'new message')}${where}`;
}

export function chatDigestSubject({ items, companyName }: Pick<ChatDigestEmail, 'items' | 'companyName'>): string {
  if (items.length === 1) return `${describeChat(items[0])}${from(companyName)}`.slice(0, 200);
  const total = items.reduce((n, c) => n + c.unread, 0);
  return `${plural(total, 'unread message')} in ${items.length} conversations${from(companyName)}`.slice(0, 200);
}

export function chatDigestHtml({ firstName, companyName, items, link }: ChatDigestEmail): string {
  return layout({
    companyName,
    firstName,
    intro: 'You have unread messages in the chat:',
    rows: items.map((c) => ({ title: describeChat(c) })),
    link,
    button: 'Open the chat',
    footer:
      'You get this when messages are still unread 10 minutes after they were sent, at most every 30 minutes. Mute a ' +
      'chat with its bell, or choose everything, direct messages and mentions only, or none in your email settings.',
  });
}

// ---- a payslip, with its PDF attached (FIG-732) ----------------------------------------------------------------

export interface PayslipEmail {
  firstName: string | null;
  companyName: string | null;
  /** the payroll month, 'YYYY-MM' */
  period: string;
  /** the PDF is protected with the employee's ID number (the email says so; it never contains the number) */
  passwordProtected: boolean;
  /** the staff portal, for the button */
  appUrl: string;
}

/** "2026-10" -> "October 2026" (as the "Payslip ready" notification names the month); anything else as it is. */
export function periodLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period ?? '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return oneLine(period ?? '');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** The attachment's name: payslip-2026-10-MCL-000001.pdf (safe characters only). */
export function payslipFileName(period: string, employeeNumber: string): string {
  const safe = (s: string) => (s ?? '').trim().replace(/[^0-9A-Za-z._-]+/g, '_');
  return `payslip-${safe(period)}-${safe(employeeNumber)}.pdf`;
}

export function payslipEmailSubject({ period, companyName }: Pick<PayslipEmail, 'period' | 'companyName'>): string {
  return `Your payslip for ${periodLabel(period)}${from(companyName)}`.slice(0, 200);
}

/** What the email says about opening the PDF: which password, never the password itself. */
export function payslipPasswordNote(passwordProtected: boolean): string {
  return passwordProtected
    ? 'The PDF is protected with a password: your ID number (national ID or passport number, as on your employee record), with no spaces.'
    : 'The PDF is not password protected. Keep it somewhere safe.';
}

export function payslipEmailHtml({ firstName, companyName, period, passwordProtected, appUrl }: PayslipEmail): string {
  return layout({
    companyName,
    firstName,
    intro: `Your payslip for ${periodLabel(period)} is attached to this email as a PDF.`,
    rows: [{ title: 'Opening the PDF', message: payslipPasswordNote(passwordProtected) }],
    link: staffPortalLink(appUrl, 'payslips'),
    button: 'See your payslips in the staff portal',
    footer:
      'This email and its attachment are confidential and meant only for you. Payslips are always emailed; if you ' +
      'think this is not yours, delete it and tell HR.',
  });
}
