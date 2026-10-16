// Sends the staff portal's notifications by email (FIG-771), HR's alerts to the HR people who look after them and the
// unread chat digests (FIG-890, migration 20261017600000), then the queued company-wide emails (FIG-820). Run every
// minute by pg_cron (migration 20261013800000), which calls it with the shared secret in the x-cron-secret header.
//
// claim_hr_alert_emails() / claim_chat_digest_emails() hand back one email per person, marked sent as they are claimed;
// each person's copy is a row in notification_email_deliveries, put back with release_email_deliveries() when a send
// fails (tried again on a later run, up to 5 times). All of these respect each person's email preferences and their
// daily cap in the database.
//
// claim_notification_emails() hands back, per employee, every notification not yet emailed (once the latest is a
// couple of minutes old) and marks them emailed in the same statement, so two runs never send the same one. A send
// that fails goes back with release_notification_emails() and is tried again on a later run, up to 5 times.
// claim_bulk_emails() / release_bulk_emails() / finish_bulk_emails() do the same for the company-wide email queue
// (migration 20261014500000), whose rows go queued -> sending -> sent (or failed after 5 tries).
//
// Each run keeps claiming 100 at a time and sending for up to RUN_MS (under the cron's minute, so runs do not overlap),
// through Resend's batch endpoint at RESEND_MAX_RPS requests a second (see sending.ts): tens of thousands an hour,
// where sending one at a time managed about 3,000.
//
// Secrets (supabase secrets set ...): RESEND_API_KEY, EMAIL_FROM (e.g. "Figbloom HR <hr@figbloom.org>"),
// APP_URL (the staff portal, https://...), CRON_SECRET (the same value as the vault secret the cron job sends),
// RESEND_MAX_RPS (optional: requests a second the Resend account allows, default 2).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  chatDigestHtml, chatDigestSubject, chatLink, htmlFor, hrAlertHtml, hrAlertSubject, subjectFor,
  type ChatDigestItem, type NotificationItem,
} from './email.ts';
import { createPacer, createResendSender, groupFailures, type Attachment, type OutgoingEmail } from './sending.ts';

interface Claim {
  tenant_id: string;
  employee_number: string;
  to_email: string | null;
  first_name: string | null;
  company_name: string | null;
  ids: number[];
  items: NotificationItem[];
}

interface HrAlertClaim {
  tenant_id: string;
  user_id: string;
  to_email: string | null;
  first_name: string | null;
  company_name: string | null;
  role: string | null;
  ids: number[];
  items: NotificationItem[];
}

interface ChatClaim {
  id: number;
  tenant_id: string;
  user_id: string;
  to_email: string | null;
  first_name: string | null;
  company_name: string | null;
  role: string | null;
  items: ChatDigestItem[];
}

interface BulkClaim {
  id: number;
  bulk_email_id: string;
  tenant_id: string;
  to_email: string;
}

interface BulkEmail {
  id: string;
  created_by: string | null;
  purpose: string;
  from_address: string | null;
  subject: string;
  html: string;
  attachments: Attachment[] | null;
}

/** How long one run keeps claiming and sending; the cron calls every minute and waits up to 60 seconds. */
const RUN_MS = 45_000;
/** Claimed at a time: one Resend batch. */
const CLAIM_SIZE = 100;

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// the same check in constant time, so the secret can't be guessed a character at a time
const sameSecret = (a: string, b: string) => {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET') ?? '';
  if (!secret || !sameSecret(req.headers.get('x-cron-secret') ?? '', secret)) return json({ error: 'Forbidden' }, 403);

  const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const from = Deno.env.get('EMAIL_FROM') ?? '';
  if (!resendKey || !from) return json({ error: 'RESEND_API_KEY and EMAIL_FROM are not set' }, 500);
  const appUrl = Deno.env.get('APP_URL') ?? '';
  const perSecond = Number(Deno.env.get('RESEND_MAX_RPS')) > 0 ? Number(Deno.env.get('RESEND_MAX_RPS')) : 2;

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  });
  const sender = createResendSender({
    apiKey: resendKey,
    fetch,
    pace: createPacer(perSecond, Date.now, (ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  });
  const deadline = Date.now() + RUN_MS;
  const more = () => Date.now() < deadline && !sender.rateLimited;
  let sent = 0;
  let failed = 0;

  const logSent = async (rows: Record<string, unknown>[]) => {
    if (!rows.length) return;
    const { error } = await db.from('sent_emails').insert(rows);
    if (error) console.error('sent_emails:', error.message);
  };

  // 1. notifications --------------------------------------------------------------------------------------------
  for (let first = true; more(); first = false) {
    const { data, error } = await db.rpc('claim_notification_emails', { p_limit: CLAIM_SIZE });
    if (error) {
      console.error('claim_notification_emails:', error.message);
      if (first) return json({ error: 'Could not read the notifications' }, 500);
      break;
    }
    const claims = (data ?? []) as Claim[];
    if (claims.length === 0) break;

    // no work email: nothing to retry until one is added, so give up straight away
    const noEmail = claims.filter((c) => !EMAIL_RE.test((c.to_email ?? '').trim()));
    if (noEmail.length) {
      await db.from('hr_notifications').update({ email_error: 'not emailed: no work email' }).in('id', noEmail.flatMap((c) => c.ids));
    }
    const ready = claims.filter((c) => EMAIL_RE.test((c.to_email ?? '').trim()));
    const emails: OutgoingEmail[] = ready.map((c) => {
      const content = { firstName: c.first_name, companyName: c.company_name, items: c.items, appUrl };
      return { from, to: (c.to_email ?? '').trim(), subject: subjectFor(content), html: htmlFor(content) };
    });
    const results = await sender.send(emails);

    const log: Record<string, unknown>[] = [];
    results.forEach((r, i) => {
      if (!r.ok) return;
      sent++;
      log.push({
        tenant_id: ready[i].tenant_id, provider: 'resend', provider_id: r.id, purpose: 'notification',
        sent_by: null, from_address: from, to_addresses: [emails[i].to], subject: emails[i].subject,
      });
    });
    await logSent(log);
    for (const g of groupFailures(ready, results)) {
      failed += g.items.length;
      const { error: e } = await db.rpc('release_notification_emails', {
        p_ids: g.items.flatMap((c) => c.ids), p_error: g.error, p_count_attempt: g.countAttempt,
      });
      if (e) console.error('release_notification_emails:', e.message);
    }
    if (claims.length < CLAIM_SIZE) break;
  }

  // 2. HR alerts and 3. unread chat digests: one delivery row (or several, for HR) per email ---------------------
  const sendDeliveries = async <T extends { tenant_id: string; to_email: string | null }>(
    name: string,
    claimFn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
    idsOf: (c: T) => number[],
    build: (c: T) => { subject: string; html: string },
    purpose: string,
  ) => {
    while (more()) {
      const { data, error } = await claimFn();
      if (error) {
        console.error(`${name}:`, error.message);
        break;
      }
      const claims = (data ?? []) as T[];
      if (claims.length === 0) break;

      // no email address: nothing to retry
      const noEmail = claims.filter((c) => !EMAIL_RE.test((c.to_email ?? '').trim()));
      if (noEmail.length) {
        const { error: e } = await db.rpc('skip_email_deliveries', { p_ids: noEmail.flatMap(idsOf), p_error: 'not emailed: no email address' });
        if (e) console.error('skip_email_deliveries:', e.message);
      }
      const ready = claims.filter((c) => EMAIL_RE.test((c.to_email ?? '').trim()));
      const emails: OutgoingEmail[] = ready.map((c) => ({ from, to: (c.to_email ?? '').trim(), ...build(c) }));
      const results = await sender.send(emails);

      const log: Record<string, unknown>[] = [];
      results.forEach((r, i) => {
        if (!r.ok) return;
        sent++;
        log.push({
          tenant_id: ready[i].tenant_id, provider: 'resend', provider_id: r.id, purpose,
          sent_by: null, from_address: from, to_addresses: [emails[i].to], subject: emails[i].subject,
        });
      });
      await logSent(log);
      for (const g of groupFailures(ready, results)) {
        failed += g.items.length;
        const { error: e } = await db.rpc('release_email_deliveries', {
          p_ids: g.items.flatMap(idsOf), p_error: g.error, p_count_attempt: g.countAttempt,
        });
        if (e) console.error('release_email_deliveries:', e.message);
      }
      if (claims.length < CLAIM_SIZE) break;
    }
  };

  await sendDeliveries<HrAlertClaim>(
    'claim_hr_alert_emails',
    () => db.rpc('claim_hr_alert_emails', { p_limit: CLAIM_SIZE }),
    (c) => c.ids,
    (c) => {
      const content = { firstName: c.first_name, companyName: c.company_name, items: c.items, appUrl };
      return { subject: hrAlertSubject(content), html: hrAlertHtml(content) };
    },
    'hr-alert',
  );

  await sendDeliveries<ChatClaim>(
    'claim_chat_digest_emails',
    () => db.rpc('claim_chat_digest_emails', { p_limit: CLAIM_SIZE }),
    (c) => [c.id],
    (c) => {
      const content = { firstName: c.first_name, companyName: c.company_name, items: c.items, link: chatLink(appUrl, c.role) };
      return { subject: chatDigestSubject(content), html: chatDigestHtml(content) };
    },
    'chat-digest',
  );

  // 4. company-wide emails ----------------------------------------------------------------------------------------
  const bulkEmails = new Map<string, BulkEmail>();
  while (more()) {
    const { data, error } = await db.rpc('claim_bulk_emails', { p_limit: CLAIM_SIZE });
    if (error) {
      console.error('claim_bulk_emails:', error.message);
      break;
    }
    const claims = (data ?? []) as BulkClaim[];
    if (claims.length === 0) break;

    const missing = [...new Set(claims.map((c) => c.bulk_email_id))].filter((id) => !bulkEmails.has(id));
    if (missing.length) {
      const { data: rows, error: e } = await db
        .from('bulk_emails')
        .select('id, created_by, purpose, from_address, subject, html, attachments')
        .in('id', missing);
      if (e) {
        console.error('bulk_emails:', e.message);
        await db.rpc('release_bulk_emails', { p_ids: claims.map((c) => c.id), p_error: 'could not read the email', p_count_attempt: false });
        break;
      }
      for (const row of (rows ?? []) as BulkEmail[]) bulkEmails.set(row.id, row);
    }

    const emails: OutgoingEmail[] = claims.map((c) => {
      const b = bulkEmails.get(c.bulk_email_id)!;
      const attachments = Array.isArray(b?.attachments) && b.attachments.length ? b.attachments : undefined;
      return { from: b?.from_address || from, to: c.to_email, subject: b?.subject ?? '', html: b?.html ?? '', attachments };
    });
    const results = await sender.send(emails);

    const done: { id: number; providerId: string | null }[] = [];
    const log: Record<string, unknown>[] = [];
    results.forEach((r, i) => {
      if (!r.ok) return;
      sent++;
      const b = bulkEmails.get(claims[i].bulk_email_id)!;
      done.push({ id: claims[i].id, providerId: r.id });
      log.push({
        tenant_id: claims[i].tenant_id, provider: 'resend', provider_id: r.id, purpose: b.purpose,
        sent_by: b.created_by, from_address: emails[i].from, to_addresses: [emails[i].to], subject: emails[i].subject,
      });
    });
    if (done.length) {
      const { error: e } = await db.rpc('finish_bulk_emails', { p_ids: done.map((d) => d.id), p_provider_ids: done.map((d) => d.providerId) });
      if (e) console.error('finish_bulk_emails:', e.message);
    }
    await logSent(log);
    for (const g of groupFailures(claims, results)) {
      failed += g.items.length;
      const { error: e } = await db.rpc('release_bulk_emails', {
        p_ids: g.items.map((c) => c.id), p_error: g.error, p_count_attempt: g.countAttempt,
      });
      if (e) console.error('release_bulk_emails:', e.message);
    }
    if (claims.length < CLAIM_SIZE) break;
  }

  return json({ sent, failed, rateLimited: sender.rateLimited });
});
