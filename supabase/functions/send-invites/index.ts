// Emails the queued invitations to join a company (FIG-818). Run every minute by pg_cron while anything is waiting
// (migration 20261014300000), which calls it with the shared secret in the x-cron-secret header (the same secret
// and Vault entries as send-notification-emails).
//
// claim_invitations() hands out a batch, each with a fresh link token (it makes the invitation exactly as
// create_invitation() does and locks the rows with SKIP LOCKED, so two runs never send the same one). They go to
// Resend in one batch call, spaced out for Resend's rate limit; then finish_invitations() or release_invitations()
// records each person's result (retried later, up to 5 times, unless Resend refused the address).
//
// Secrets (supabase secrets set ...): RESEND_API_KEY, EMAIL_FROM, CRON_SECRET (already set for the notification
// emails), and SITE_URL: the website's address (https://...), where the /join page is; APP_URL is used when
// SITE_URL is not set. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { processInviteQueue, type ClaimedInvite, type OutgoingEmail, type SendResult } from './invites.ts';

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
  const siteUrl = (Deno.env.get('SITE_URL') || Deno.env.get('APP_URL') || '').replace(/\/+$/, '');
  if (!resendKey || !from) return json({ error: 'RESEND_API_KEY and EMAIL_FROM are not set' }, 500);
  // without the site address there is no link to send: leave everything queued
  if (!/^https:\/\//.test(siteUrl)) return json({ error: 'SITE_URL (the website, https://...) is not set' }, 500);

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  });

  const resend = async (path: string, body: unknown): Promise<SendResult> => {
    try {
      const res = await fetch(`https://api.resend.com${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true };
      return { ok: false, status: res.status, error: (await res.text()).slice(0, 300) };
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
  };

  try {
    const run = await processInviteQueue(
      {
        claim: async (limit) => {
          const { data, error } = await db.rpc('claim_invitations', { p_limit: limit });
          if (error) throw new Error(`claim_invitations: ${error.message}`);
          return (data ?? []) as ClaimedInvite[];
        },
        sendBatch: (emails: OutgoingEmail[]) => resend('/emails/batch', emails),
        sendOne: (email: OutgoingEmail) => resend('/emails', email),
        finish: (ids) => rpc('finish_invitations', { p_ids: ids }),
        release: (ids, error, retry) => rpc('release_invitations', { p_ids: ids, p_error: error, p_retry: retry }),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
      },
      { from, siteUrl }
    );
    return json(run);
  } catch (err) {
    // whatever was claimed and not recorded is claimed again after 10 minutes
    console.error('send-invites:', err instanceof Error ? err.message : err);
    return json({ error: 'Could not send the invitations' }, 500);
  }
});
