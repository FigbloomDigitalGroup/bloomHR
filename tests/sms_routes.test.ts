// @vitest-environment node
//
// FIG-679: the Celcom key lives only on the server. These tests run the real sms_routes.js router against an
// in-memory fake of the Supabase client and a fake Celcom, and check who may send, what is rejected before
// anything is sent, and that provider failures are reported as failures.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-a';

const state = vi.hoisted(() => ({
  profiles: [] as { user_id: string; email: string; role: string; account_status: string; tenant_id: string }[],
  permissions: [] as { tenant_id: string; role_name: string; permissions: string[] }[],
  mfaNumbers: [] as { email: string; phone_number: string }[],
  authUsers: [] as { id: string; email: string }[],
}));

vi.mock('@supabase/supabase-js', () => {
  const table = (rows: () => Record<string, unknown>[]) => {
    const filters: [string, unknown][] = [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return builder;
      },
      maybeSingle: async () => ({ data: rows().find((r) => filters.every(([k, v]) => r[k] === v)) ?? null, error: null }),
    };
    return builder;
  };
  const client = {
    // the bearer token is simply the caller's user id in these tests
    auth: { getUser: async (token: string) => ({ data: { user: state.authUsers.find((u) => u.id === token) ?? null }, error: null }) },
    from: (name: string) => {
      if (name === 'user_profiles') return table(() => state.profiles);
      if (name === 'role_permissions') return table(() => state.permissions);
      if (name === 'mfa_numbers') return table(() => state.mfaNumbers);
      throw new Error(`unexpected table ${name}`);
    },
  };
  return { createClient: () => client };
});

process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
process.env.CELCOM_API_KEY = 'test-key';
process.env.CELCOM_PARTNER_ID = '111';
process.env.CELCOM_SHORTCODE = 'FIGBLOOM';

// Celcom is faked; calls to the local test server still go through the real fetch.
const celcom = vi.hoisted(() => ({
  sendCalls: [] as URL[],
  balanceCalls: [] as { url: string; body: unknown }[],
  reply: (_mobile: string): { status?: number; json?: unknown; text?: string } => ({ json: { responses: [{ 'response-code': 200, messageid: 'm-1' }] } }),
  balance: { json: { 'response-code': 200, credit: '1234.50' } } as { status?: number; json?: unknown },
}));
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.includes('celcomafrica.com')) return realFetch(input, init);
  const respond = (r: { status?: number; json?: unknown; text?: string }) =>
    new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  if (url.includes('/sendsms/')) {
    const u = new URL(url);
    celcom.sendCalls.push(u);
    return respond(celcom.reply(u.searchParams.get('mobile') || ''));
  }
  celcom.balanceCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
  return respond(celcom.balance);
}) as typeof fetch;

let server: Server;
let base: string;

beforeAll(async () => {
  const express = (await import('express')).default;
  const router = (await import('../sms_routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/sms', router);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sms`;
});

afterAll(() => {
  server.close();
  globalThis.fetch = realFetch;
});

let uid = 0;
beforeEach(() => {
  // a fresh set of users per test so the in-memory rate limit never carries over
  uid += 1;
  const mk = (name: string, role: string) => ({ id: `${name}-${uid}`, email: `${name}${uid}@a.co`, role });
  const users = [mk('admin', 'ADMIN'), mk('hr', 'HR'), mk('staff', 'STAFF'), mk('checker', 'CHECKER')];
  state.authUsers = users.map(({ id, email }) => ({ id, email }));
  state.profiles = users.map((u) => ({ user_id: u.id, email: u.email, role: u.role, account_status: 'ACTIVE', tenant_id: TENANT }));
  state.permissions = [
    { tenant_id: TENANT, role_name: 'HR', permissions: ['sms'] },
    { tenant_id: TENANT, role_name: 'CHECKER', permissions: ['salaryadmin'] },
    { tenant_id: 'other-tenant', role_name: 'STAFF', permissions: ['sms'] }, // must never apply to tenant-a staff
  ];
  state.mfaNumbers = [{ email: users[0].email, phone_number: '0712345678' }];
  celcom.sendCalls = [];
  celcom.balanceCalls = [];
  celcom.reply = () => ({ json: { responses: [{ 'response-code': 200, messageid: 'm-1' }] } });
  celcom.balance = { json: { 'response-code': 200, credit: '1234.50' } };
});

const who = (name: string) => state.authUsers.find((u) => u.id.startsWith(`${name}-`))!.id;
const post = (path: string, token: string | null, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const send = (token: string | null, body: Record<string, unknown>) => post('/send', token, body);
const one = { messages: [{ phone: '0712345678', message: 'Hello' }] };

describe('sign-in and permission checks happen before anything is sent', () => {
  it('rejects a request with no token', async () => {
    expect((await send(null, one)).status).toBe(401);
    expect(celcom.sendCalls).toHaveLength(0);
  });

  it('rejects a token that is not a real session', async () => {
    expect((await send('nobody', one)).status).toBe(401);
    expect(celcom.sendCalls).toHaveLength(0);
  });

  it('rejects a role without the sms module, and ignores another tenant’s grant', async () => {
    const res = await send(who('staff'), one);
    expect(res.status).toBe(403);
    expect(celcom.sendCalls).toHaveLength(0);
  });

  it('lets ADMIN and any role granted the module send', async () => {
    expect((await send(who('admin'), one)).status).toBe(200);
    expect((await send(who('hr'), one)).status).toBe(200);
    expect(celcom.sendCalls).toHaveLength(2);
  });

  it('ties each purpose to its own module', async () => {
    // CHECKER only has salaryadmin: allowed for salary-advance, not for the SMS Center
    expect((await send(who('checker'), { ...one, purpose: 'salary-advance' })).status).toBe(200);
    expect((await send(who('checker'), { ...one, purpose: 'sms-center' })).status).toBe(403);
    expect((await send(who('checker'), { ...one, purpose: 'nonsense' })).status).toBe(400);
  });
});

describe('request validation', () => {
  it('rejects empty, oversized and over-long requests', async () => {
    const admin = who('admin');
    expect((await send(admin, { messages: [] })).status).toBe(400);
    expect((await send(admin, { messages: [{ phone: '0712345678', message: '   ' }] })).status).toBe(400);
    expect((await send(admin, { messages: [{ phone: '0712345678', message: 'x'.repeat(613) }] })).status).toBe(400);
    const many = Array.from({ length: 1001 }, () => ({ phone: '0712345678', message: 'Hi' }));
    expect((await send(admin, { messages: many })).status).toBe(400);
    expect(celcom.sendCalls).toHaveLength(0);
  });

  it('reports a bad number per message without failing the batch', async () => {
    const res = await send(who('admin'), {
      messages: [
        { phone: '12345', message: 'a' },
        { phone: '+254 712 345 678', message: 'b' },
      ],
    });
    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results[0]).toMatchObject({ success: false, error: 'Invalid phone number' });
    expect(body.results[1]).toMatchObject({ success: true, phone: '254712345678' });
    expect(celcom.sendCalls).toHaveLength(1);
  });
});

describe('what is sent to Celcom', () => {
  it('uses the server-side key, normalised number and default sender id', async () => {
    await send(who('admin'), { messages: [{ phone: '0712345678', message: 'Hi there & welcome' }] });
    const q = celcom.sendCalls[0].searchParams;
    expect(q.get('apikey')).toBe('test-key');
    expect(q.get('partnerID')).toBe('111');
    expect(q.get('mobile')).toBe('254712345678');
    expect(q.get('message')).toBe('Hi there & welcome');
    expect(q.get('shortcode')).toBe('FIGBLOOM');
  });

  it('accepts a valid custom sender id and ignores a malformed one', async () => {
    await send(who('admin'), { ...one, senderId: 'MyCompany' });
    await send(who('admin'), { ...one, senderId: 'bad id!!' });
    expect(celcom.sendCalls[0].searchParams.get('shortcode')).toBe('MyCompany');
    expect(celcom.sendCalls[1].searchParams.get('shortcode')).toBe('FIGBLOOM');
  });

  it('never returns the API key', async () => {
    const res = await send(who('admin'), one);
    expect(JSON.stringify(await res.json())).not.toContain('test-key');
  });
});

describe('provider results are real', () => {
  it('reports a provider rejection as failed, with its reason', async () => {
    celcom.reply = () => ({ json: { responses: [{ 'response-code': 1004, 'response-description': 'Insufficient balance' }] } });
    const body = await (await send(who('admin'), one)).json();
    expect(body).toMatchObject({ sent: 0, failed: 1 });
    expect(body.results[0]).toMatchObject({ success: false, error: 'Insufficient balance' });
  });

  it('treats a plain 200 with an unreadable body as accepted but unconfirmed', async () => {
    celcom.reply = () => ({ text: 'OK' });
    const body = await (await send(who('admin'), one)).json();
    expect(body.results[0]).toMatchObject({ success: true, confirmed: false });
  });

  it('reports an HTTP error from the provider as failed', async () => {
    celcom.reply = () => ({ status: 500, text: 'oops' });
    const body = await (await send(who('admin'), one)).json();
    expect(body.results[0]).toMatchObject({ success: false });
  });
});

describe('MFA codes', () => {
  const mfa = (phone: string) => ({ purpose: 'mfa', messages: [{ phone, message: 'Your code is 123456' }] });

  it('goes to the caller’s own registered number, in any format', async () => {
    expect((await send(who('admin'), mfa('+254712345678'))).status).toBe(200);
    expect(celcom.sendCalls[0].searchParams.get('mobile')).toBe('254712345678');
  });

  it('refuses any other number, and callers with no registered number', async () => {
    expect((await send(who('admin'), mfa('0799999999'))).status).toBe(403);
    expect((await send(who('hr'), mfa('0712345678'))).status).toBe(403);
    expect(celcom.sendCalls).toHaveLength(0);
  });

  it('allows a role with no SMS permission (it is a login code), but one message only', async () => {
    const two = { purpose: 'mfa', messages: [{ phone: '0712345678', message: 'a' }, { phone: '0712345678', message: 'b' }] };
    expect((await send(who('admin'), two)).status).toBe(400);
  });

  it('is rate limited to 5 codes per 10 minutes', async () => {
    const admin = who('admin');
    for (let i = 0; i < 5; i++) expect((await send(admin, mfa('0712345678'))).status).toBe(200);
    expect((await send(admin, mfa('0712345678'))).status).toBe(429);
  });
});

describe('limits and set-up', () => {
  it('stops one user sending more than 3000 recipients an hour', async () => {
    const admin = who('admin');
    const batch = (n: number) => ({ messages: Array.from({ length: n }, () => ({ phone: '0712345678', message: 'Hi' })) });
    expect((await send(admin, batch(1000))).status).toBe(200);
    expect((await send(admin, batch(1000))).status).toBe(200);
    expect((await send(admin, batch(1000))).status).toBe(200);
    expect((await send(admin, batch(1))).status).toBe(429);
  });

  it('says so when the server has no Celcom key, but only to someone allowed to send', async () => {
    const saved = process.env.CELCOM_API_KEY;
    process.env.CELCOM_API_KEY = '';
    try {
      expect((await send(who('admin'), one)).status).toBe(503);
      expect((await send(who('staff'), one)).status).toBe(403);
    } finally {
      process.env.CELCOM_API_KEY = saved;
    }
  });
});

describe('GET /balance', () => {
  const get = (token: string | null) =>
    fetch(`${base}/balance`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('needs a session and the sms (or salaryadmin) module', async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get(who('staff'))).status).toBe(403);
    expect((await get(who('hr'))).status).toBe(200);
    expect((await get(who('checker'))).status).toBe(200);
  });

  it('reads the real balance from Celcom with the server-side key', async () => {
    const res = await get(who('admin'));
    expect(await res.json()).toEqual({ balance: 1234.5 });
    expect(celcom.balanceCalls[0].body).toEqual({ apikey: 'test-key', partnerID: '111' });
  });

  it('finds the balance in a nested reply and returns null when there is none', async () => {
    celcom.balance = { json: { data: { Balance: '77' } } };
    expect(await (await get(who('admin'))).json()).toEqual({ balance: 77 });
    celcom.balance = { json: { message: 'ok' } };
    expect(await (await get(who('admin'))).json()).toEqual({ balance: null });
  });

  it('reports a provider failure as 502', async () => {
    celcom.balance = { status: 500, json: {} };
    expect((await get(who('admin'))).status).toBe(502);
  });
});
