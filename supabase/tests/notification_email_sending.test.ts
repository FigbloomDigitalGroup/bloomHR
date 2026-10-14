// How the send-notification-emails Edge Function talks to Resend (FIG-820): 100 emails per batch request, attachments
// one by one, requests paced, a refused batch retried one by one, and Resend's 429 stopping the run without using up
// a try.
import { describe, expect, it } from 'vitest';
import { BATCH_SIZE, createPacer, createResendSender, groupFailures, type OutgoingEmail } from '../functions/send-notification-emails/sending';

type Reply = { status: number; body?: unknown };

function fakeResend(reply: (url: string, body: any) => Reply) {
  const calls: { url: string; body: any }[] = [];
  const fetch = async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const r = reply(url, body);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body ?? {}),
    };
  };
  return { calls, sender: createResendSender({ apiKey: 're_key', fetch, pace: async () => {} }) };
}

const email = (i: number, extra: Partial<OutgoingEmail> = {}): OutgoingEmail => ({
  from: 'HR <hr@a.co>', to: `p${i}@a.co`, subject: `S${i}`, html: `<p>${i}</p>`, ...extra,
});
const ok = (url: string, body: any): Reply =>
  url.endsWith('/batch') ? { status: 200, body: { data: body.map((_: unknown, i: number) => ({ id: `re_${body[i].to[0]}` })) } } : { status: 200, body: { id: `re_${body.to[0]}` } };

describe('createResendSender', () => {
  it('sends 100 emails per batch request, each to one person, and returns their ids in order', async () => {
    const { calls, sender } = fakeResend(ok);
    const emails = Array.from({ length: 250 }, (_, i) => email(i));
    const results = await sender.send(emails);
    expect(calls.map((c) => [c.url, c.body.length])).toEqual([
      ['https://api.resend.com/emails/batch', BATCH_SIZE],
      ['https://api.resend.com/emails/batch', BATCH_SIZE],
      ['https://api.resend.com/emails/batch', 50],
    ]);
    expect(calls[0].body[0]).toEqual({ from: 'HR <hr@a.co>', to: ['p0@a.co'], subject: 'S0', html: '<p>0</p>' });
    expect(results[249]).toEqual({ ok: true, id: 're_p249@a.co' });
  });

  it('sends emails with attachments one by one (the batch endpoint takes none)', async () => {
    const { calls, sender } = fakeResend(ok);
    const files = [{ filename: 'a.pdf', content: 'aGk=' }];
    const results = await sender.send([email(0, { attachments: files }), email(1), email(2)]);
    expect(calls.map((c) => c.url)).toEqual(['https://api.resend.com/emails', 'https://api.resend.com/emails/batch']);
    expect(calls[0].body.attachments).toEqual(files);
    expect(results.map((r) => r.ok && r.id)).toEqual(['re_p0@a.co', 're_p1@a.co', 're_p2@a.co']);
  });

  it('retries a refused batch one by one, so only the bad email fails', async () => {
    const { calls, sender } = fakeResend((url, body) =>
      url.endsWith('/batch') ? { status: 422, body: { message: 'invalid to' } } : body.to[0] === 'p1@a.co' ? { status: 422, body: {} } : ok(url, body)
    );
    const results = await sender.send([email(0), email(1), email(2)]);
    expect(calls).toHaveLength(4);
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1]).toMatchObject({ ok: false, rateLimited: false });
  });

  it("stops at Resend's 429: the rest are handed back without counting as a try", async () => {
    let n = 0;
    const { calls, sender } = fakeResend((url, body) => (++n === 2 ? { status: 429, body: {} } : ok(url, body)));
    const results = await sender.send(Array.from({ length: 300 }, (_, i) => email(i)));
    expect(calls).toHaveLength(2); // the third batch is never tried
    expect(sender.rateLimited).toBe(true);
    expect(results.slice(0, 100).every((r) => r.ok)).toBe(true);
    expect(results.slice(100).every((r) => !r.ok && r.rateLimited)).toBe(true);
  });

  it('counts a server error or a network failure as a failed try', async () => {
    const { sender } = fakeResend(() => ({ status: 500, body: {} }));
    expect(await sender.send([email(0), email(1)])).toEqual([
      { ok: false, error: 'Resend 500: {}', rateLimited: false },
      { ok: false, error: 'Resend 500: {}', rateLimited: false },
    ]);
    const down = createResendSender({ apiKey: 'k', fetch: async () => { throw new Error('connection reset'); }, pace: async () => {} });
    expect(await down.send([email(0)])).toEqual([{ ok: false, error: 'connection reset', rateLimited: false }]);
  });
});

describe('createPacer', () => {
  it('spaces requests evenly at the given rate', async () => {
    let t = 1000;
    const waits: number[] = [];
    const pace = createPacer(2, () => t, async (ms) => {
      waits.push(ms);
      t += ms;
    });
    await pace();
    await pace();
    await pace();
    t += 2000; // idle: no wait after a pause
    await pace();
    expect(waits).toEqual([500, 500]);
  });
});

describe('groupFailures', () => {
  it('groups failures by error and whether they count as a try', () => {
    const groups = groupFailures(['a', 'b', 'c', 'd'], [
      { ok: true, id: '1' },
      { ok: false, error: 'Resend 500', rateLimited: false },
      { ok: false, error: 'Resend 429', rateLimited: true },
      { ok: false, error: 'Resend 500', rateLimited: false },
    ]);
    expect(groups).toEqual([
      { error: 'Resend 500', countAttempt: true, items: ['b', 'd'] },
      { error: 'Resend 429', countAttempt: false, items: ['c'] },
    ]);
  });
});
