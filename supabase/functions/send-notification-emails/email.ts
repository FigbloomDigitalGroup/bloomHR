// The notification email (FIG-771): one email per employee with every notification not yet emailed. Plain
// TypeScript with no Deno or Node APIs, so the Edge Function uses it and vitest tests it.

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

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** One line, no line breaks (a header). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export function subjectFor({ items, companyName }: Pick<NotificationEmail, 'items' | 'companyName'>): string {
  const from = companyName ? ` - ${oneLine(companyName)}` : '';
  if (items.length === 1) return `${oneLine(items[0].title)}${from}`.slice(0, 200);
  return `${items.length} updates from HR${from}`.slice(0, 200);
}

export function htmlFor({ firstName, companyName, items, appUrl }: NotificationEmail): string {
  const company = escape(companyName || 'Figbloom HR');
  const hello = firstName ? `Hi ${escape(firstName)},` : 'Hi,';
  const intro = items.length === 1 ? 'There is an update for you:' : `There are ${items.length} updates for you:`;
  const rows = items
    .map(
      (n) => `
      <tr><td style="padding:12px 16px;border-top:1px solid #E5E7EB">
        <div style="font-weight:600;color:#16201A;font-size:14px">${escape(n.title)}</div>
        <div style="color:#4B5563;font-size:13px;line-height:1.5;margin-top:4px">${escape(n.message)}</div>
      </td></tr>`
    )
    .join('');
  const link = /^https:\/\//.test(appUrl) ? escape(appUrl) : '';
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F6F8F6;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;border-collapse:separate">
    <tr><td style="padding:20px 16px;background:#17402A;border-radius:12px 12px 0 0;color:#FFFFFF;font-size:16px;font-weight:700">${company}</td></tr>
    <tr><td style="padding:16px;color:#16201A;font-size:14px">${hello}<br>${intro}</td></tr>
    ${rows}
    ${link ? `<tr><td style="padding:16px;border-top:1px solid #E5E7EB">
      <a href="${link}" style="display:inline-block;background:#17402A;color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600">Open the staff portal</a>
    </td></tr>` : ''}
    <tr><td style="padding:12px 16px;color:#9CA3AF;font-size:11px;border-top:1px solid #E5E7EB">
      You get these emails for updates in the staff portal. You can turn them off from the bell in the portal
      (warnings, suspensions and payslips are always emailed).
    </td></tr>
  </table>
</body></html>`;
}
