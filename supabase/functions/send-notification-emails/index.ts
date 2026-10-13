// Sends the staff portal's notifications by email (FIG-771). Run every minute by pg_cron (migration
// 20261013800000), which calls it with the shared secret in the x-cron-secret header.
//
// claim_notification_emails() hands back, per employee, every notification not yet emailed (once the latest is a
// couple of minutes old) and marks them emailed in the same statement, so two runs never send the same one. A send
// that fails goes back with release_notification_emails() and is tried again on a later run, up to 5 times.
//
// Secrets (supabase secrets set ...): RESEND_API_KEY, EMAIL_FROM (e.g. "Figbloom HR <hr@figbloom.org>"),
// APP_URL (the staff portal, https://...), CRON_SECRET (the same value as the vault secret the cron job sends).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { htmlFor, subjectFor, type NotificationItem } from './email.ts';

interface Claim {
  tenant_id: string;
  employee_number: string;
  to_email: string | null;
  first_name: string | null;
  company_name: string | null;
  ids: number[];
  items: NotificationItem[];
}

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

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  });

  const { data, error } = await db.rpc('claim_notification_emails');
  if (error) {
    console.error('claim_notification_emails:', error.message);
    return json({ error: 'Could not read the notifications' }, 500);
  }

  let sent = 0;
  let failed = 0;
  for (const c of (data ?? []) as Claim[]) {
    const release = async (why: string) => {
      failed++;
      const { error: e } = await db.rpc('release_notification_emails', { p_ids: c.ids, p_error: why });
      if (e) console.error('release_notification_emails:', e.message);
    };
    const to = (c.to_email ?? '').trim();
    if (!EMAIL_RE.test(to)) {
      // no work email: nothing to retry until one is added, so give up straight away
      await db.from('hr_notifications').update({ email_error: 'not emailed: no work email' }).in('id', c.ids);
      continue;
    }
    const email = { firstName: c.first_name, companyName: c.company_name, items: c.items, appUrl };
    const subject = subjectFor(email);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html: htmlFor(email) }),
      });
      if (!res.ok) {
        await release(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
        continue;
      }
      const { id } = (await res.json()) as { id?: string };
      sent++;
      const { error: logError } = await db.from('sent_emails').insert({
        tenant_id: c.tenant_id, provider: 'resend', provider_id: id ?? null, purpose: 'notification',
        sent_by: null, from_address: from, to_addresses: [to], subject,
      });
      if (logError) console.error('sent_emails:', logError.message);
    } catch (err) {
      await release(err instanceof Error ? err.message : String(err));
    }
  }
  return json({ sent, failed });
});
