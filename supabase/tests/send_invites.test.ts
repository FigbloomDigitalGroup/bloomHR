// The send-invites Edge Function's work (FIG-818): the invitation email, and the loop that claims queued invitations,
// sends them through Resend in batches and records each result. The database and Resend are fakes here.
import { describe, expect, it } from 'vitest';
import { emailFor, invitationEmail, isTransient, joinLink, processInviteQueue, type ClaimedInvite, type OutgoingEmail, type QueueDeps, type SendResult } from '../functions/send-invites/invites';

const invite = (id: number, email = `p${id}@gmail.com`): ClaimedInvite => ({
  id, tenant_id: 't', email, role: 'STAFF', token: `tok${id}`.padEnd(64, '0'), expires_at: '2026-10-21T10:00:00Z',
  company_name: 'Acme <Ltd>', inviter_email: 'hr@acme.co',
});

/** A queue of `total` invitations and a Resend that answers with `answer` (per call). */
function fakes(total: number, answer: (emails: OutgoingEmail[], kind: 'batch' | 'one') => SendResult = () => ({ ok: true })) {
  let next = 1;
  let clock = 0;
  const log = {
    batches: [] as number[][],
    singles: [] as string[],
    finished: [] as number[],
    released: [] as { ids: number[]; error: string; retry: boolean }[],
    sleeps: 0,
  };
  const deps: QueueDeps = {
    claim: async (limit) => {
      const out: ClaimedInvite[] = [];
      while (out.length < limit && next <= total) out.push(invite(next++));
      return out;
    },
    sendBatch: async (emails) => {
      log.batches.push(emails.map((e) => Number(e.to[0].replace(/\D/g, ''))));
      return answer(emails, 'batch');
    },
    sendOne: async (email) => {
      log.singles.push(email.to[0]);
      return answer([email], 'one');
    },
    finish: async (ids) => void log.finished.push(...ids),
    release: async (ids, error, retry) => void log.released.push({ ids, error, retry }),
    sleep: async (ms) => {
      log.sleeps++;
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, log, tick: (ms: number) => (clock += ms) };
}

const options = { from: 'Figbloom HR <hr@figbloom.org>', siteUrl: 'https://hr.figbloom.org/' };

describe('the invitation email', () => {
  it('links to the join page with the token, and escapes what it inserts', () => {
    expect(joinLink('https://hr.figbloom.org/', 'a b')).toBe('https://hr.figbloom.org/join?token=a%20b');
    const email = emailFor(invite(1), options.from, options.siteUrl);
    expect(email.to).toEqual(['p1@gmail.com']);
    expect(email.subject).toBe("You're invited to join Acme <Ltd> on Figbloom HR");
    expect(email.html).toContain('Join Acme &lt;Ltd&gt;');
    expect(email.html).toContain(`href="https://hr.figbloom.org/join?token=${invite(1).token}"`);
    expect(email.text).toContain('hr@acme.co has invited you to join Acme <Ltd> on Figbloom HR as Staff.');
    expect(email.text).toContain('expires on 21 October 2026');
  });

  it('reads well without an inviter or a company name', () => {
    const { text } = invitationEmail({ company: 'your company', role: 'MANAGER', inviter: null, link: 'https://x/join?token=t', expires: null });
    expect(text).toContain('You have been invited to join your company on Figbloom HR as Manager.');
    expect(text).toContain('expires on 7 days from now');
  });
});

describe('processInviteQueue', () => {
  it('sends in batches of 100, spaced out, and marks each sent', async () => {
    const { deps, log } = fakes(250);
    expect(await processInviteQueue(deps, options)).toEqual({ sent: 250, retrying: 0, failed: 0 });
    expect(log.batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(log.finished).toHaveLength(250);
    expect(log.sleeps).toBe(3); // a pause after every call to Resend
  });

  it('hands a batch back to be tried later when Resend is down, and stops for the run when told to slow down', async () => {
    const down = fakes(150, () => ({ ok: false, status: 503, error: 'unavailable' }));
    expect(await processInviteQueue(down.deps, options)).toEqual({ sent: 0, retrying: 150, failed: 0 });
    expect(down.log.released[0]).toMatchObject({ retry: true, error: 'Resend 503: unavailable' });

    const busy = fakes(300, () => ({ ok: false, status: 429, error: 'rate limited' }));
    expect(await processInviteQueue(busy.deps, options)).toEqual({ sent: 0, retrying: 100, failed: 0 });
    expect(busy.log.batches).toHaveLength(1); // the other 200 wait for the next run
  });

  it('a batch refused because of one bad address is sent one at a time, so only that one fails', async () => {
    const { deps, log } = fakes(3, (emails, kind) =>
      kind === 'batch' || emails[0].to[0] === 'p2@gmail.com' ? { ok: false, status: 422, error: 'invalid `to`' } : { ok: true }
    );
    expect(await processInviteQueue(deps, options)).toEqual({ sent: 2, retrying: 0, failed: 1 });
    expect(log.singles).toEqual(['p1@gmail.com', 'p2@gmail.com', 'p3@gmail.com']);
    expect(log.finished).toEqual([1, 3]);
    expect(log.released).toEqual([{ ids: [2], error: 'Resend 422: invalid `to`', retry: false }]);
  });

  it('stops claiming once the time budget is spent', async () => {
    const { deps, log } = fakes(1000);
    const slow = { ...deps, sendBatch: async (emails: OutgoingEmail[]) => (await deps.sendBatch(emails), deps.sleep(9_400).then(() => ({ ok: true }) as const)) };
    const run = await processInviteQueue(slow, { ...options, budgetMs: 20_000 });
    expect(run.sent).toBe(200); // two 10-second rounds
    expect(log.batches).toHaveLength(2);
  });

  it('when time runs out sending one at a time, the rest go back to the queue', async () => {
    const f = fakes(5, (_emails, kind) => (kind === 'batch' ? { ok: false, status: 400, error: 'bad' } : { ok: true }));
    const slowOne = { ...f.deps, sendOne: async (e: OutgoingEmail) => (f.tick(5_000), f.deps.sendOne(e)) };
    const run = await processInviteQueue(slowOne, { ...options, budgetMs: 12_000 });
    expect(run.sent + run.retrying).toBe(5);
    expect(run.retrying).toBeGreaterThan(0);
    expect(f.log.released.at(-1)).toMatchObject({ retry: true });
  });

  it('nothing waiting: nothing sent', async () => {
    const { deps, log } = fakes(0);
    expect(await processInviteQueue(deps, options)).toEqual({ sent: 0, retrying: 0, failed: 0 });
    expect(log.batches).toEqual([]);
  });

  it('only busy, down or unreachable is worth retrying', () => {
    expect([0, 429, 500, 503].map(isTransient)).toEqual([true, true, true, true]);
    expect([400, 401, 403, 422].map(isTransient)).toEqual([false, false, false, false]);
  });
});
