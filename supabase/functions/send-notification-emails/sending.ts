// Sending many emails through Resend quickly but within its limits (FIG-820). Plain TypeScript with no Deno or Node
// APIs, so the Edge Function uses it and vitest tests it.
//
// Resend takes up to 100 emails in one request to its batch endpoint, and a few requests a second per account
// (RESEND_MAX_RPS, default 2). Emails without attachments go 100 at a time; the batch endpoint takes no attachments, so
// those go one request each. Requests are spaced evenly so the account's rate is never exceeded; if Resend still says
// 429 (something else is sending on the same account), the rest are handed back to be sent on a later run, without
// counting as a failed try.

export interface Attachment {
  filename: string;
  content: string; // base64
}

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
}

/** What happened to one email: sent (with Resend's id), or failed; `rateLimited` failures are not counted as a try. */
export type SendResult = { ok: true; id: string | null } | { ok: false; error: string; rateLimited: boolean };

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** Emails per request to Resend's batch endpoint (its maximum). */
export const BATCH_SIZE = 100;

/**
 * Waits as needed so that calls are at least 1000 / perSecond ms apart: call it before each request.
 * `now` and `sleep` are passed in so tests need not wait.
 */
export function createPacer(perSecond: number, now: () => number, sleep: (ms: number) => Promise<void>) {
  const gap = 1000 / Math.max(perSecond, 0.1);
  let next = 0;
  return async () => {
    const t = now();
    const at = Math.max(t, next);
    next = at + gap;
    if (at > t) await sleep(at - t);
  };
}

const RESEND = 'https://api.resend.com';

/** Sends emails through Resend, paced; resolves with one result per email, in the same order. Never throws. */
export function createResendSender({ apiKey, fetch, pace }: { apiKey: string; fetch: Fetch; pace: () => Promise<void> }) {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  let rateLimited = false; // once Resend says 429, nothing more is sent this run

  const failAll = (n: number, error: string, limited: boolean): SendResult[] =>
    Array.from({ length: n }, () => ({ ok: false as const, error, rateLimited: limited }));

  async function post(path: string, body: unknown): Promise<{ ok: true; json: unknown } | { ok: false; status: number; error: string }> {
    await pace();
    try {
      const res = await fetch(`${RESEND}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (res.ok) return { ok: true, json: await res.json().catch(() => null) };
      if (res.status === 429) rateLimited = true;
      return { ok: false, status: res.status, error: `Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}` };
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function sendOne(email: OutgoingEmail): Promise<SendResult> {
    if (rateLimited) return { ok: false, error: 'Resend rate limit: sent on a later run', rateLimited: true };
    const r = await post('/emails', { from: email.from, to: [email.to], subject: email.subject, html: email.html, attachments: email.attachments });
    if (r.ok) return { ok: true, id: (r.json as { id?: string } | null)?.id ?? null };
    return { ok: false, error: r.error, rateLimited: r.status === 429 };
  }

  async function sendBatch(emails: OutgoingEmail[]): Promise<SendResult[]> {
    if (rateLimited) return failAll(emails.length, 'Resend rate limit: sent on a later run', true);
    if (emails.length === 1) return [await sendOne(emails[0])];
    const r = await post('/emails/batch', emails.map((e) => ({ from: e.from, to: [e.to], subject: e.subject, html: e.html })));
    if (r.ok) {
      const ids = ((r.json as { data?: { id?: string }[] } | null)?.data ?? []).map((d) => d?.id ?? null);
      return emails.map((_, i) => ({ ok: true, id: ids[i] ?? null }));
    }
    if (r.status === 429) return failAll(emails.length, r.error, true);
    // Resend refuses the whole batch if one email in it is invalid: send them one by one, so only that one fails
    if (r.status === 400 || r.status === 422) {
      const results: SendResult[] = [];
      for (const e of emails) results.push(await sendOne(e));
      return results;
    }
    return failAll(emails.length, r.error, false);
  }

  return {
    /** True once Resend has said 429 this run. */
    get rateLimited() {
      return rateLimited;
    },
    async send(emails: OutgoingEmail[]): Promise<SendResult[]> {
      const results: SendResult[] = new Array(emails.length);
      const plain: number[] = [];
      for (let i = 0; i < emails.length; i++) {
        if (emails[i].attachments?.length) results[i] = await sendOne(emails[i]);
        else plain.push(i);
      }
      for (let i = 0; i < plain.length; i += BATCH_SIZE) {
        const part = plain.slice(i, i + BATCH_SIZE);
        const got = await sendBatch(part.map((j) => emails[j]));
        part.forEach((j, k) => (results[j] = got[k]));
      }
      return results;
    },
  };
}

/** Failures grouped by error and whether they count as a try, so each group goes back in one database call. */
export function groupFailures<T>(items: T[], results: SendResult[]): { error: string; countAttempt: boolean; items: T[] }[] {
  const groups = new Map<string, { error: string; countAttempt: boolean; items: T[] }>();
  results.forEach((r, i) => {
    if (r.ok) return;
    const key = `${r.rateLimited}|${r.error}`;
    if (!groups.has(key)) groups.set(key, { error: r.error, countAttempt: !r.rateLimited, items: [] });
    groups.get(key)!.items.push(items[i]);
  });
  return [...groups.values()];
}

/** Bytes as base64 (Resend's attachments), a chunk at a time so a large file doesn't overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}
