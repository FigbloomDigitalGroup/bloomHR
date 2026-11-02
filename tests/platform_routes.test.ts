// @vitest-environment node
//
// Inviting a platform admin from the console (platform_routes.js). The caller must be a signed-in platform admin, who
// may belong to no company. A new email gets a login and an invitation whose link goes back to a console address
// only; an existing login is just added. The grant runs as grant_platform_admin_as(), so it is logged as the caller.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  authUsers: [] as { id: string; email: string }[],
  platform_admins: [] as Row[],
  // logins by email (lowercase)
  logins: new Map<string, string>(),
  invites: [] as { email: string; options: Record<string, unknown> }[],
  inviteError: null as { status?: number; message: string } | null,
  grants: [] as Row[],
  sends: [] as Record<string, unknown>[],
  sendResult: { error: null } as { error: unknown },
  sendThrows: false,
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (msg: Record<string, unknown>) => {
        if (state.sendThrows) throw new Error('network down');
        state.sends.push(msg);
        return state.sendResult;
      },
    };
  },
}));

vi.mock('@supabase/supabase-js', () => {
  const table = (name: 'platform_admins') => {
    const filters: [string, unknown][] = [];
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return b;
      },
      maybeSingle: async () => ({ data: state[name].find((r) => filters.every(([k, v]) => r[k] === v)) ?? null, error: null }),
    };
    return b;
  };
  const client = {
    auth: {
      getUser: async (token: string) => ({ data: { user: state.authUsers.find((u) => u.id === token) ?? null }, error: null }),
      admin: {
        inviteUserByEmail: async (email: string, options: Record<string, unknown>) => {
          state.invites.push({ email, options });
          if (state.inviteError) {
            // "already registered": someone created the login in the meantime
            if (state.inviteError.status === 422) state.logins.set(email, 'late');
            return { data: null, error: state.inviteError };
          }
          const id = `new-${state.logins.size}`;
          state.logins.set(email, id);
          return { data: { user: { id, email } }, error: null };
        },
      },
    },
    from: (name: string) => table(name as 'platform_admins'),
    // grant_platform_admin_as(), as the migration behaves
    rpc: async (fn: string, args: Row) => {
      if (fn !== 'grant_platform_admin_as') return { data: null, error: { message: `unexpected ${fn}` } };
      if (!state.platform_admins.some((a) => a.user_id === args.p_by)) {
        return { data: null, error: { code: '42501', message: 'Only a platform admin can add a platform admin' } };
      }
      const userId = state.logins.get(String(args.p_email));
      if (!userId) return { data: null, error: { code: 'P0002', message: 'No login with this email' } };
      state.grants.push(args);
      const added = !state.platform_admins.some((a) => a.user_id === userId);
      if (added) state.platform_admins.push({ user_id: userId });
      return { data: { user_id: userId, email: args.p_email, added }, error: null };
    },
  };
  return { createClient: () => client };
});

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

let server: Server;
let base: string;
let mod: typeof import('../platform_routes.js');

beforeAll(async () => {
  const express = (await import('express')).default;
  mod = await import('../platform_routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/platform', mod.default);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/platform`;
});
afterAll(() => server.close());

beforeEach(() => {
  state.authUsers = [
    { id: 'ops', email: 'ops@figbloom.org' }, // platform admin, no company
    { id: 'admin-a', email: 'admin@a.co' }, // a company's administrator, not a platform admin
    { id: 'busy', email: 'busy@figbloom.org' }, // a platform admin for the rate limit
  ];
  state.platform_admins = [{ user_id: 'ops' }, { user_id: 'busy' }];
  state.logins = new Map([
    ['ops@figbloom.org', 'ops'],
    ['admin@a.co', 'admin-a'],
    ['mary@figbloom.org', 'mary'],
  ]);
  state.invites = [];
  state.inviteError = null;
  state.grants = [];
  state.sends = [];
  state.sendResult = { error: null };
  state.sendThrows = false;
  process.env.RESEND_API_KEY = 're_test';
  process.env.SMTP_FROM = 'Figbloom <noreply@figbloom.org>';
});

type Mail = { to: string; from: string; subject: string; html: string; text: string };

const invite = (as: string | null, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/staff/invite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(as ? { authorization: `Bearer ${as}` } : {}), ...headers },
    body: JSON.stringify(body),
  });

describe('POST /api/platform/staff/invite', () => {
  it('needs a signed-in caller', async () => {
    expect((await invite(null, { email: 'sam@figbloom.org' })).status).toBe(401);
    expect((await invite('nobody', { email: 'sam@figbloom.org' })).status).toBe(401);
    expect(state.invites).toEqual([]);
  });

  it('refuses anyone who is not a platform admin, even a company administrator', async () => {
    const res = await invite('admin-a', { email: 'sam@figbloom.org' });
    expect(res.status).toBe(403);
    expect(state.invites).toEqual([]);
    expect(state.grants).toEqual([]);
  });

  it('creates a login for a new email, with a link back to the console it was asked from, and adds them as the caller', async () => {
    const res = await invite('ops', { email: ' Sam@Figbloom.org ', note: ' Support lead ' }, { origin: 'https://console-staging.figbloom.org' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, email: 'sam@figbloom.org', userId: 'new-3', origin: 'https://console-staging.figbloom.org',
      result: 'invited', invited: true, notified: false, alreadyAdmin: false,
    });
    // Supabase sends the invitation itself: nothing from here
    expect(state.sends).toEqual([]);
    expect(state.invites).toEqual([
      { email: 'sam@figbloom.org', options: { redirectTo: 'https://console-staging.figbloom.org/update-password' } },
    ]);
    expect(state.grants).toEqual([{ p_by: 'ops', p_email: 'sam@figbloom.org', p_note: 'Support lead' }]);
  });

  it('adds someone who already has a login and emails them that they now have console access', async () => {
    const res = await invite('ops', { email: 'mary@figbloom.org', note: 'Payroll <lead>' }, { origin: 'https://console-staging.figbloom.org' });
    expect(await res.json()).toEqual({
      ok: true, email: 'mary@figbloom.org', userId: 'mary', origin: 'https://console-staging.figbloom.org',
      result: 'notified', invited: false, notified: true, alreadyAdmin: false,
    });
    expect(state.invites).toEqual([]);
    expect(state.grants).toEqual([{ p_by: 'ops', p_email: 'mary@figbloom.org', p_note: 'Payroll <lead>' }]);
    expect(state.sends).toHaveLength(1);
    const mail = state.sends[0] as Mail;
    expect(mail.to).toBe('mary@figbloom.org');
    expect(mail.from).toBe('Figbloom <noreply@figbloom.org>');
    expect(mail.text).toContain("You've been made a Figbloom platform admin by ops@figbloom.org.");
    expect(mail.text).toContain('Sign in at https://console-staging.figbloom.org with your usual password.');
    expect(mail.text).toContain('Note: Payroll <lead>');
    // the note is escaped in the HTML
    expect(mail.html).toContain('Payroll &lt;lead&gt;');
    expect(mail.html).not.toContain('<lead>');
    expect(mail.html).toContain('href="https://console-staging.figbloom.org"');
  });

  it('leaves the note out of the email when there is none', async () => {
    await invite('ops', { email: 'mary@figbloom.org' });
    expect((state.sends[0] as Mail).text).not.toContain('Note:');
  });

  it('still adds them when the email is refused, and says so', async () => {
    state.sendResult = { error: { name: 'validation_error', message: 'bad from' } };
    const res = await invite('ops', { email: 'mary@figbloom.org' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, result: 'notify_failed', notified: false, notifyError: 'The email service refused the message' });
    expect(state.platform_admins.some((a) => a.user_id === 'mary')).toBe(true);
  });

  it('still adds them when sending throws or email is not set up', async () => {
    state.sendThrows = true;
    expect(await (await invite('ops', { email: 'mary@figbloom.org' })).json()).toMatchObject({ result: 'notify_failed', notifyError: 'The email could not be sent' });
    state.platform_admins = state.platform_admins.filter((a) => a.user_id !== 'mary');
    state.sendThrows = false;
    delete process.env.RESEND_API_KEY;
    expect(await (await invite('ops', { email: 'mary@figbloom.org' })).json()).toMatchObject({
      result: 'notify_failed', notifyError: 'Email is not set up (RESEND_API_KEY)',
    });
    expect(state.sends).toEqual([]);
    expect(state.platform_admins.some((a) => a.user_id === 'mary')).toBe(true);
  });

  it('sends nothing when they already are a platform admin (only the note changes)', async () => {
    const res = await invite('ops', { email: 'ops@figbloom.org', note: 'New note' });
    expect(await res.json()).toMatchObject({ result: 'already_admin', alreadyAdmin: true, notified: false, invited: false });
    expect(state.sends).toEqual([]);
    expect(state.invites).toEqual([]);
  });

  it('sends the link to production for any other origin', async () => {
    for (const origin of ['https://evil.example', 'https://console.figbloom.org.evil.com', 'http://console.figbloom.org', 'https://hr.figbloom.org']) {
      state.invites = [];
      await invite('ops', { email: `x${state.logins.size}@figbloom.org` }, { origin });
      expect(state.invites[0]?.options).toEqual({ redirectTo: 'https://console.figbloom.org/update-password' });
    }
    expect(mod.consoleOrigin(undefined)).toBe('https://console.figbloom.org');
    expect(mod.consoleOrigin('not a url')).toBe('https://console.figbloom.org');
    expect(mod.consoleOrigin('https://console.figbloom.org')).toBe('https://console.figbloom.org');
    expect(mod.consoleOrigin('https://console.figbloom.org:8443')).toBe('https://console.figbloom.org');
  });

  it('carries on when the login appeared in the meantime', async () => {
    state.inviteError = { status: 422, message: 'A user with this email address has already been registered' };
    const res = await invite('ops', { email: 'late@figbloom.org' });
    expect(await res.json()).toMatchObject({ ok: true, email: 'late@figbloom.org', userId: 'late', result: 'notified', invited: false });
    expect(state.grants).toEqual([{ p_by: 'ops', p_email: 'late@figbloom.org', p_note: null }]);
  });

  it('reports a failed invitation without adding anyone', async () => {
    state.inviteError = { status: 500, message: 'SMTP down' };
    const res = await invite('ops', { email: 'fail@figbloom.org' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/could not be sent/);
    expect(state.grants).toEqual([]);
  });

  it('validates the email and the note', async () => {
    for (const email of ['', 'no-at-sign', 'a@b', 'two words@figbloom.org', `${'a'.repeat(250)}@x.co`, 42]) {
      const res = await invite('ops', { email });
      expect(res.status).toBe(400);
    }
    expect((await invite('ops', { email: 'ok@figbloom.org', note: { html: true } })).status).toBe(400);
    expect(state.invites).toEqual([]);
  });

  it('limits how many invitations an admin sends in an hour', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await invite('busy', { email: 'mary@figbloom.org' })).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe('the console addresses', () => {
  it('are the same as the app\'s (src/lib/console.ts)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'lib', 'console.ts'), 'utf8');
    const list = source.match(/CONSOLE_HOSTNAMES: readonly string\[\] = \[([^\]]*)\]/)?.[1] ?? '';
    const hosts = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(hosts).toEqual(mod.CONSOLE_HOSTNAMES);
  });
});
