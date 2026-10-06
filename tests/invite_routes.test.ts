// @vitest-environment node
//
// Emailing an invitation. The route must only ever deliver an invitation that really exists in the caller's own
// company, with content it writes itself from the database, so it cannot be used to send arbitrary mail.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const TOKEN = 'a'.repeat(64);

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  authUsers: [] as { id: string; email: string }[],
  user_profiles: [] as Row[],
  invitations: [] as Row[],
  tenants: [] as Row[],
  sends: [] as Record<string, unknown>[],
  sendResult: { error: null } as { error: unknown },
}));

vi.mock('@supabase/supabase-js', () => {
  const table = (name: 'user_profiles' | 'invitations' | 'tenants') => {
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
    auth: { getUser: async (token: string) => ({ data: { user: state.authUsers.find((u) => u.id === token) ?? null }, error: null }) },
    from: (name: string) => table(name as 'user_profiles'),
  };
  return { createClient: () => client };
});

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (msg: Record<string, unknown>) => {
        state.sends.push(msg);
        return state.sendResult;
      },
    };
  },
}));

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

let server: Server;
let base: string;

beforeAll(async () => {
  const express = (await import('express')).default;
  const router = (await import('../invite_routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/invites', router);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/invites`;
});
afterAll(() => server.close());

const future = () => new Date(Date.now() + 5 * 86_400_000).toISOString();
const past = () => new Date(Date.now() - 86_400_000).toISOString();

beforeEach(() => {
  state.sends = [];
  state.sendResult = { error: null };
  process.env.RESEND_API_KEY = 're_test';
  process.env.SMTP_FROM = 'Figbloom HR <noreply@figbloom.org>';
  process.env.SITE_URL = 'https://bloom-hr-phi.vercel.app';
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  state.authUsers = [
    { id: 'admin-a', email: 'admin@a.co' },
    { id: 'hr-a', email: 'hr@a.co' },
    { id: 'staff-a', email: 'staff@a.co' },
    { id: 'admin-b', email: 'admin@b.co' },
  ];
  state.user_profiles = [
    { user_id: 'admin-a', role: 'ADMIN', account_status: 'ACTIVE', tenant_id: TENANT_A },
    { user_id: 'hr-a', role: 'HR', account_status: 'ACTIVE', tenant_id: TENANT_A },
    { user_id: 'staff-a', role: 'STAFF', account_status: 'ACTIVE', tenant_id: TENANT_A },
    { user_id: 'admin-b', role: 'ADMIN', account_status: 'ACTIVE', tenant_id: TENANT_B },
  ];
  state.tenants = [
    { id: TENANT_A, name: 'Favor Farm' },
    { id: TENANT_B, name: 'Other Co' },
  ];
  state.invitations = [{ id: 'i1', tenant_id: TENANT_A, email: 'new.person@gmail.com', role: 'STAFF', status: 'pending', expires_at: future(), token_hash: sha(TOKEN) }];
});

const send = (as: string | null, body: unknown = { token: TOKEN }, headers: Record<string, string> = {}) =>
  fetch(`${base}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(as ? { authorization: `Bearer ${as}` } : {}), ...headers },
    body: JSON.stringify(body),
  });

describe('POST /api/invites/send', () => {
  it('emails the invited address with a link that carries the token, written from the database', async () => {
    const res = await send('admin-a');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sentTo: 'new.person@gmail.com' });
    expect(state.sends).toHaveLength(1);
    const mail = state.sends[0] as { to: string; from: string; subject: string; html: string; text: string };
    expect(mail.to).toBe('new.person@gmail.com');
    expect(mail.from).toBe('Figbloom HR <noreply@figbloom.org>');
    expect(mail.subject).toContain('Favor Farm');
    expect(mail.html).toContain(`https://bloom-hr-phi.vercel.app/join?token=${TOKEN}`);
    expect(mail.text).toContain(`https://bloom-hr-phi.vercel.app/join?token=${TOKEN}`);
    expect(mail.html).toContain('Staff');
    expect(mail.html).toContain('admin@a.co'); // who invited them
  });

  it('cannot be used to mail anyone else: the recipient always comes from the invitation, never the request', async () => {
    await send('admin-a', { token: TOKEN, to: 'victim@example.com', html: '<b>phish</b>', subject: 'x' });
    expect(state.sends).toHaveLength(1);
    expect((state.sends[0] as { to: string }).to).toBe('new.person@gmail.com');
    expect(JSON.stringify(state.sends[0])).not.toContain('phish');
  });

  it('escapes the company name in the email', async () => {
    state.tenants[0].name = '<script>alert(1)</script> & Co';
    await send('admin-a');
    const html = (state.sends[0] as { html: string }).html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('refuses without a login, and for staff', async () => {
    expect((await send(null)).status).toBe(401);
    expect((await send('staff-a')).status).toBe(403);
    expect(state.sends).toHaveLength(0);
  });

  it('only finds invitations of the caller’s own company', async () => {
    const res = await send('admin-b');
    expect(res.status).toBe(404);
    expect(state.sends).toHaveLength(0);
  });

  it('does not send a used, cancelled or expired invitation', async () => {
    for (const patch of [{ status: 'accepted' }, { status: 'revoked' }, { expires_at: past() }]) {
      state.invitations[0] = { ...state.invitations[0], status: 'pending', expires_at: future(), ...patch };
      expect((await send('admin-a')).status).toBe(404);
    }
    expect(state.sends).toHaveLength(0);
  });

  it('rejects a missing or malformed token, and an unknown one', async () => {
    expect((await send('admin-a', {})).status).toBe(400);
    expect((await send('admin-a', { token: 'short' })).status).toBe(400);
    expect((await send('admin-a', { token: 'b'.repeat(64) })).status).toBe(404);
  });

  it('lets HR send staff invitations but not others', async () => {
    expect((await send('hr-a')).status).toBe(200);
    state.invitations[0].role = 'ADMIN';
    expect((await send('hr-a')).status).toBe(403);
    expect(state.sends).toHaveLength(1);
  });

  it('says so when email is not set up, without trying to send', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await send('admin-a');
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not set up/i);
    expect(state.sends).toHaveLength(0);
  });

  it('does not leak the provider’s error to the browser', async () => {
    state.sendResult = { error: { name: 'validation_error', message: 'The figbloom.org domain is not verified, key re_secret' } };
    const res = await send('admin-a');
    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).toMatch(/could not be sent/i);
    expect(text).not.toContain('re_secret');
    expect(text).not.toContain('domain');
  });

  it('builds the link from the production address when SITE_URL is not set', async () => {
    delete process.env.SITE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'bloom-hr-phi.vercel.app';
    await send('admin-a', { token: TOKEN }, { origin: 'https://evil.example' });
    expect((state.sends[0] as { html: string }).html).toContain('https://bloom-hr-phi.vercel.app/join?token=');
    expect((state.sends[0] as { html: string }).html).not.toContain('evil.example');
  });
});
