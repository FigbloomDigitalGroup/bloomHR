// The queued invitations to join a company (FIG-818): the email, and the loop that claims a batch, sends it through
// Resend and records each person's result. Plain TypeScript with no Deno or Node APIs, so the Edge Function uses it
// and vitest tests it. The database and Resend are passed in (QueueDeps).
//
// The email is the one invite_routes.js sends for a single invitation (keep the two the same).

/** One invitation claim_invitations() handed out: the link token is only ever here, never stored. */
export interface ClaimedInvite {
  id: number;
  tenant_id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  company_name: string | null;
  inviter_email: string | null;
}

export interface OutgoingEmail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

/** What Resend said: ok, or the HTTP status (0 when it could not be reached) and why. */
export type SendResult = { ok: true } | { ok: false; status: number; error: string };

export interface QueueDeps {
  claim(limit: number): Promise<ClaimedInvite[]>;
  /** Resend's batch endpoint: all of them are sent, or none. */
  sendBatch(emails: OutgoingEmail[]): Promise<SendResult>;
  sendOne(email: OutgoingEmail): Promise<SendResult>;
  finish(ids: number[]): Promise<void>;
  release(ids: number[], error: string, retry: boolean): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface QueueOptions {
  from: string;
  /** the website, https://..., where /join?token= is */
  siteUrl: string;
  /** invitations per Resend batch call (Resend takes up to 100) */
  batchSize?: number;
  /** pause after each call to Resend: it accepts about 2 requests a second per account */
  gapMs?: number;
  /** stop claiming more after this long, so a run ends well before the next one starts */
  budgetMs?: number;
}

export interface QueueRun {
  sent: number;
  /** handed back to be tried again later */
  retrying: number;
  /** refused for good (for example an address Resend will not deliver to) */
  failed: number;
}

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const roleLabel = (role: string) => String(role || '').charAt(0) + String(role || '').slice(1).toLowerCase();

/** The link that opens the join page for this invitation. */
export const joinLink = (siteUrl: string, token: string) => `${siteUrl.replace(/\/+$/, '')}/join?token=${encodeURIComponent(token)}`;

/** The subject, HTML and plain-text body of an invitation (as invite_routes.js). Everything inserted is escaped. */
export function invitationEmail({ company, role, inviter, link, expires }: { company: string; role: string; inviter?: string | null; link: string; expires?: string | null }) {
  const who = inviter ? `${inviter} has invited you` : 'You have been invited';
  const expiry = expires ? new Date(expires).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '7 days from now';
  const subject = `You're invited to join ${company} on Figbloom HR`;
  const text = [
    `${who} to join ${company} on Figbloom HR as ${roleLabel(role)}.`,
    '',
    `Create your account here: ${link}`,
    '',
    `This link works once, only for this email address, and expires on ${expiry}.`,
    'If you were not expecting this, you can ignore this email.',
  ].join('\n');
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#16201a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
      <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 16px;font-size:13px;font-weight:bold;color:#17402a;">Figbloom HR</p>
          <h1 style="margin:0 0 12px;font-size:20px;">Join ${escapeHtml(company)}</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">${escapeHtml(who)} to join <strong>${escapeHtml(company)}</strong> on Figbloom HR as <strong>${escapeHtml(roleLabel(role))}</strong>.</p>
          <p style="margin:0 0 24px;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#17402a;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:8px;">Accept the invitation</a></p>
          <p style="margin:0 0 8px;font-size:12px;color:#5f6b62;">Or paste this link into your browser:<br><span style="word-break:break-all;">${escapeHtml(link)}</span></p>
          <p style="margin:16px 0 0;font-size:12px;color:#5f6b62;">This link works once, only for this email address, and expires on ${escapeHtml(expiry)}. If you were not expecting this, you can ignore this email.</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;
  return { subject, html, text };
}

/** The email for one claimed invitation. */
export function emailFor(invite: ClaimedInvite, from: string, siteUrl: string): OutgoingEmail {
  const message = invitationEmail({
    company: invite.company_name || 'your company',
    role: invite.role,
    inviter: invite.inviter_email,
    link: joinLink(siteUrl, invite.token),
    expires: invite.expires_at,
  });
  return { from, to: [invite.email], ...message };
}

/** Worth trying again later: Resend was busy, down or unreachable. Anything else (4xx) will not change by waiting. */
export const isTransient = (status: number) => status === 0 || status === 429 || status >= 500;

const why = (r: Extract<SendResult, { ok: false }>) => (r.status ? `Resend ${r.status}: ${r.error}` : r.error).slice(0, 500);

/**
 * Sends what is waiting: claims up to batchSize invitations, sends them in one Resend batch call, records the result,
 * and goes on until nothing is waiting or the time budget is spent. A batch Resend refuses as a whole (one bad
 * address fails the lot) is sent one at a time, so each person gets their own result. When Resend says to slow
 * down (429), the rest of this run is left for the next one.
 */
export async function processInviteQueue(deps: QueueDeps, options: QueueOptions): Promise<QueueRun> {
  const { from, siteUrl, batchSize = 100, gapMs = 600, budgetMs = 40_000 } = options;
  const started = deps.now();
  const timeLeft = () => deps.now() - started < budgetMs;
  const run: QueueRun = { sent: 0, retrying: 0, failed: 0 };

  const giveBack = async (ids: number[], error: string, retry: boolean) => {
    if (ids.length === 0) return;
    await deps.release(ids, error, retry);
    if (retry) run.retrying += ids.length;
    else run.failed += ids.length;
  };

  while (timeLeft()) {
    const claimed = await deps.claim(batchSize);
    if (claimed.length === 0) break;
    const emails = claimed.map((c) => emailFor(c, from, siteUrl));

    const batch = await deps.sendBatch(emails);
    await deps.sleep(gapMs);
    if (batch.ok) {
      await deps.finish(claimed.map((c) => c.id));
      run.sent += claimed.length;
      continue;
    }
    if (isTransient(batch.status)) {
      await giveBack(claimed.map((c) => c.id), why(batch), true);
      if (batch.status === 429) break;
      continue;
    }

    // refused as a whole: one at a time, so the bad address fails alone
    for (const [i, invite] of claimed.entries()) {
      if (!timeLeft()) {
        await giveBack(claimed.slice(i).map((c) => c.id), 'not sent yet: out of time, tried again shortly', true);
        break;
      }
      const one = await deps.sendOne(emails[i]);
      await deps.sleep(gapMs);
      if (one.ok) {
        await deps.finish([invite.id]);
        run.sent += 1;
      } else if (one.status === 429) {
        await giveBack(claimed.slice(i).map((c) => c.id), why(one), true);
        return run;
      } else {
        await giveBack([invite.id], why(one), isTransient(one.status));
      }
    }
  }
  return run;
}
