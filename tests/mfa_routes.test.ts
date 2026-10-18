// @vitest-environment node
//
// FIG-834 / FIG-658: two-step sign-in codes are made and checked on the server. These tests run the real
// mfa_routes.js against an in-memory fake of the Supabase client (the database functions it calls behave as in the
// migration; they are tested on a real Postgres in supabase/tests/mfa_server_side.test.ts) and fake Resend / Celcom.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-a';

type Code = {
  id: number; tenant_id: string; user_id: string; session_id: string; email: string; method: string; sent_to: string;
  code_hash: string; expires_at: string; created_at: string; used: boolean; attempts: number;
};
const state = vi.hoisted(() => ({
  authUsers: [] as { id: string; email: string }[],
  profiles: [] as Record<string, unknown>[],
  mfaNumbers: [] as Record<string, unknown>[],
  // modules per role (role_permissions) and the company's own roles: "privileged" goes by modules
  rolePermissions: [] as Record<string, unknown>[],
  companyRoles: [] as Record<string, unknown>[],
  tenants: [{ id: 'tenant-a', name: 'Acme Ltd' }] as Record<string, unknown>[],
  policy: { mode: 'privileged', method: 'email' },
  // people's own setting (personal_two_step), by user id
  personal: {} as Record<string, { enabled: boolean; method: string }>,
  codes: [] as Code[],
  passes: [] as { user_id: string; session_id: string }[],
  budgets: new Map<string, number>(),
  emails: [] as Record<string, any>[],
  emailError: null as unknown,
  sms: [] as URL[],
}));

vi.mock('@supabase/supabase-js', () => {
  const table = (rows: () => Record<string, any>[]) => {
    const filters: ((r: Record<string, any>) => boolean)[] = [];
    let sorted = false;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
        return b;
      },
      gt: (k: string, v: string) => {
        filters.push((r) => r[k] > v);
        return b;
      },
      order: () => {
        sorted = true;
        return b;
      },
      limit: () => b,
      maybeSingle: async () => {
        const found = rows().filter((r) => filters.every((f) => f(r)));
        if (sorted) found.sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
        return { data: found[0] ?? null, error: null };
      },
    };
    return b;
  };
  const decode = (token: string) => {
    try {
      return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    } catch {
      return {};
    }
  };
  const client = {
    // the bearer token is a JWT-shaped string whose payload carries sub and session_id
    auth: { getUser: async (token: string) => ({ data: { user: state.authUsers.find((u) => u.id === decode(token).sub) ?? null }, error: null }) },
    from: (name: string) => {
      if (name === 'user_profiles') return table(() => state.profiles);
      if (name === 'mfa_numbers') return table(() => state.mfaNumbers);
      if (name === 'mfa_codes') return table(() => state.codes);
      if (name === 'tenants') return table(() => state.tenants);
      if (name === 'role_permissions') return table(() => state.rolePermissions);
      if (name === 'company_roles') return table(() => state.companyRoles);
      throw new Error(`unexpected table ${name}`);
    },
    rpc: async (fn: string, a: Record<string, any>) => {
      if (fn === 'take_rate_limit') {
        const key = `${a.p_tenant}/${a.p_bucket}`;
        const used = state.budgets.get(key) ?? 0;
        if (used + a.p_cost > a.p_limit) return { data: false, error: null };
        state.budgets.set(key, used + a.p_cost);
        return { data: true, error: null };
      }
      if (fn === 'two_step_policy') return { data: [state.policy], error: null };
      if (fn === 'personal_two_step') return { data: [state.personal[a.p_user] ?? { enabled: false, method: 'email' }], error: null };
      if (fn === 'mfa_issue_code') {
        for (const c of state.codes) if (c.user_id === a.p_user && c.session_id === a.p_session) c.used = true;
        const expires = new Date(Date.now() + a.p_ttl_seconds * 1000).toISOString();
        state.codes.push({
          id: state.codes.length + 1, tenant_id: a.p_tenant, user_id: a.p_user, session_id: a.p_session, email: a.p_email,
          method: a.p_method, sent_to: a.p_sent_to, code_hash: a.p_code_hash, expires_at: expires,
          created_at: new Date(Date.now() + state.codes.length).toISOString(), used: false, attempts: 0,
        });
        return { data: expires, error: null };
      }
      if (fn === 'mfa_check_code') {
        const c = state.codes.filter((x) => x.user_id === a.p_user && x.session_id === a.p_session && !x.used).pop();
        const out = (outcome: string, attempts_left = 0) => ({ data: [{ outcome, attempts_left }], error: null });
        if (!c) return out('none');
        if (c.expires_at <= new Date().toISOString()) return out('expired');
        if (c.attempts >= a.p_max_attempts) return out('too_many');
        c.attempts += 1;
        if (c.code_hash === a.p_code_hash) {
          c.used = true;
          state.passes.push({ user_id: a.p_user, session_id: a.p_session });
          return out('ok', a.p_max_attempts - c.attempts);
        }
        const left = a.p_max_attempts - c.attempts;
        return out(left === 0 ? 'too_many' : 'wrong', left);
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return { createClient: () => client };
});

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (msg: Record<string, unknown>) => {
        state.emails.push(msg);
        return { data: { id: 're_1' }, error: state.emailError };
      },
    };
  },
}));

process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
process.env.RESEND_API_KEY = 're_test_key';
process.env.CELCOM_API_KEY = 'test-key';
process.env.CELCOM_PARTNER_ID = '111';

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.includes('celcomafrica.com')) return realFetch(input, init);
  state.sms.push(new URL(url));
  return new Response(JSON.stringify({ responses: [{ 'response-code': 200 }] }), { status: 200 });
}) as typeof fetch;

let server: Server;
let base: string;

beforeAll(async () => {
  const express = (await import('express')).default;
  const router = (await import('../mfa_routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/mfa', router);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mfa`;
});

afterAll(() => {
  server.close();
  globalThis.fetch = realFetch;
});

const jwt = (sub: string, session_id?: string) =>
  `h.${Buffer.from(JSON.stringify({ sub, ...(session_id ? { session_id } : {}) })).toString('base64url')}.sig`;

let n = 0;
let ADMIN = '';
let OTHER = '';
let STAFF = '';
beforeEach(() => {
  n += 1;
  ADMIN = `admin-${n}`;
  OTHER = `hr-${n}`;
  STAFF = `staff-${n}`;
  state.authUsers = [
    { id: ADMIN, email: `jane${n}@acme.co` },
    { id: OTHER, email: `hr${n}@acme.co` },
    { id: STAFF, email: `staff${n}@acme.co` },
  ];
  state.profiles = [
    { user_id: ADMIN, role: 'ADMIN', account_status: 'ACTIVE', tenant_id: TENANT },
    { user_id: OTHER, role: 'HR', account_status: 'ACTIVE', tenant_id: TENANT },
    { user_id: STAFF, role: 'STAFF', account_status: 'ACTIVE', tenant_id: TENANT },
  ];
  state.mfaNumbers = [];
  state.rolePermissions = [
    { tenant_id: TENANT, role_name: 'HR', permissions: ['dashboard', 'invite-people'] },
    { tenant_id: TENANT, role_name: 'STAFF', permissions: ['dashboard', 'task-manager', 'teams'] },
  ];
  state.companyRoles = [];
  state.policy = { mode: 'privileged', method: 'email' };
  state.personal = {};
  state.codes = [];
  state.passes = [];
  state.budgets = new Map();
  state.emails = [];
  state.emailError = null;
  state.sms = [];
});

const post = (path: string, token: string | null, body: unknown = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const lastEmailedCode = () => /(\d{6})/.exec(String(state.emails.at(-1)?.text))![1];
const wrongFor = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('POST /send', () => {
  it('needs a signed-in session with a session id', async () => {
    expect((await post('/send', null)).status).toBe(401);
    expect((await post('/send', jwt(ADMIN))).status).toBe(401);
    expect(state.emails).toHaveLength(0);
  });

  it('emails a fresh code to the login email, branded with a plain-text part, and keeps only its hash', async () => {
    const res = await post('/send', jwt(ADMIN, 's1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ sent: true, method: 'email', destination: `j***@acme.co`, resendIn: 30 });
    const mail = state.emails[0];
    expect(mail.to).toBe(`jane${n}@acme.co`);
    const code = lastEmailedCode();
    expect(mail.subject).toContain(code);
    expect(mail.html).toContain('Figbloom HR');
    expect(mail.text).toContain('Acme Ltd');
    expect(state.codes).toHaveLength(1);
    expect(JSON.stringify(state.codes)).not.toContain(code);
    expect(state.codes[0]).toMatchObject({ user_id: ADMIN, session_id: 's1', method: 'email' });
    expect(JSON.stringify(body)).not.toContain(code);
  });

  it('reuses the code already sent on a page reload, and sends a new one on resend after the cooldown', async () => {
    await post('/send', jwt(ADMIN, 's1'));
    const again = await (await post('/send', jwt(ADMIN, 's1'))).json();
    expect(again).toMatchObject({ sent: false, destination: 'j***@acme.co' });
    expect(state.emails).toHaveLength(1);
    const tooSoon = await post('/send', jwt(ADMIN, 's1'), { resend: true });
    expect(tooSoon.status).toBe(429);
    expect(await tooSoon.json()).toMatchObject({ reason: 'cooldown', retryAfter: 30 });
  });

  it('is rate limited to 5 codes per 15 minutes', async () => {
    for (let i = 0; i < 6; i++) {
      state.budgets.delete(`${TENANT}/mfa-send-cooldown:default:${ADMIN}`); // as if 30 seconds had passed
      const res = await post('/send', jwt(ADMIN, 's1'), { resend: true });
      expect(res.status).toBe(i < 5 ? 200 : 429);
    }
    expect(state.emails).toHaveLength(5);
  });

  it('answers 409 when the company does not ask this person for a code', async () => {
    const res = await post('/send', jwt(STAFF, 's1'));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('not_required');
    state.policy = { mode: 'off', method: 'email' };
    expect((await post('/send', jwt(ADMIN, 's1'))).status).toBe(409);
    state.policy = { mode: 'everyone', method: 'email' };
    expect((await post('/send', jwt(STAFF, 's1'))).status).toBe(200);
  });

  it('"privileged" goes by modules, not role names', async () => {
    // a MANAGER-based company role with payroll is asked
    const cr = '55555555-5555-4555-8555-555555555555';
    const lead = `lead-${n}`;
    state.authUsers.push({ id: lead, email: `lead${n}@acme.co` });
    state.profiles.push({ user_id: lead, role: 'MANAGER', company_role_id: cr, account_status: 'ACTIVE', tenant_id: TENANT });
    state.companyRoles.push({ id: cr, tenant_id: TENANT, role_key: `CR_${cr.replace(/-/g, '')}`, name: 'Payroll lead', base_role: 'MANAGER', is_system: false, active: true });
    state.rolePermissions.push({ tenant_id: TENANT, role_name: `CR_${cr.replace(/-/g, '')}`, permissions: ['dashboard', 'payroll'] });
    expect((await post('/send', jwt(lead, 's1'))).status).toBe(200);
    // HR whose role lost "Invite people" (and holds no other privileged module) is not
    state.rolePermissions[0].permissions = ['dashboard'];
    const res = await post('/send', jwt(OTHER, 's1'));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('not_required');
  });

  it('sends a code to someone who turned it on for themselves, by the way they chose', async () => {
    state.personal[STAFF] = { enabled: true, method: 'email' };
    const res = await post('/send', jwt(STAFF, 's1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: true, method: 'email' });
  });

  it('sends by SMS to the registered number when the company chose SMS, else falls back to email', async () => {
    state.policy = { mode: 'privileged', method: 'sms' };
    state.mfaNumbers = [{ email: `jane${n}@acme.co`, phone_number: '0712345678', tenant_id: TENANT }];
    const body = await (await post('/send', jwt(ADMIN, 's1'))).json();
    expect(body).toMatchObject({ sent: true, method: 'sms', destination: '+254 *** *** 678' });
    expect(state.sms[0].searchParams.get('mobile')).toBe('254712345678');
    expect(state.emails).toHaveLength(0);

    const hr = await (await post('/send', jwt(OTHER, 's2'))).json(); // no number registered
    expect(hr).toMatchObject({ sent: true, method: 'email' });
    expect(state.emails).toHaveLength(1);
  });

  it('reports a provider failure', async () => {
    state.emailError = { name: 'validation_error', message: 'daily quota' };
    expect((await post('/send', jwt(ADMIN, 's1'))).status).toBe(502);
  });
});

describe('POST /verify', () => {
  it('accepts the right code once and records the pass for this sign-in only', async () => {
    await post('/send', jwt(ADMIN, 's1'));
    const code = lastEmailedCode();
    const ok = await post('/verify', jwt(ADMIN, 's1'), { code });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ verified: true });
    expect(state.passes).toEqual([{ user_id: ADMIN, session_id: 's1' }]);
    const again = await post('/verify', jwt(ADMIN, 's1'), { code });
    expect(again.status).toBe(400);
    expect((await again.json()).reason).toBe('none');
  });

  it('rejects a malformed code without using a try', async () => {
    await post('/send', jwt(ADMIN, 's1'));
    expect((await post('/verify', jwt(ADMIN, 's1'), { code: '12ab' })).status).toBe(400);
    expect(state.codes[0].attempts).toBe(0);
  });

  it('counts wrong codes and stops after 5', async () => {
    await post('/send', jwt(ADMIN, 's1'));
    const code = lastEmailedCode();
    for (let i = 1; i <= 4; i++) {
      const res = await post('/verify', jwt(ADMIN, 's1'), { code: wrongFor(code) });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ reason: 'wrong', attemptsLeft: 5 - i });
    }
    const fifth = await post('/verify', jwt(ADMIN, 's1'), { code: wrongFor(code) });
    expect(fifth.status).toBe(429);
    expect((await fifth.json()).reason).toBe('too_many');
    // even the right code no longer works
    const right = await post('/verify', jwt(ADMIN, 's1'), { code });
    expect(right.status).toBe(429);
    expect(state.passes).toEqual([]);
  });

  it('refuses an expired code', async () => {
    await post('/send', jwt(ADMIN, 's1'));
    const code = lastEmailedCode();
    state.codes[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await post('/verify', jwt(ADMIN, 's1'), { code });
    expect(res.status).toBe(410);
    expect((await res.json()).reason).toBe('expired');
  });

  it('cannot use a code sent to another person, or to another sign-in of the same person', async () => {
    await post('/send', jwt(ADMIN, 's1'));
    const code = lastEmailedCode();
    await post('/send', jwt(OTHER, 's9'));
    expect((await post('/verify', jwt(OTHER, 's9'), { code })).status).toBe(400);
    expect((await post('/verify', jwt(ADMIN, 's-other'), { code })).status).toBe(400);
    expect(state.passes).toEqual([]);
    expect((await post('/verify', jwt(ADMIN, 's1'), { code })).status).toBe(200);
  });

  it('is rate limited across codes', async () => {
    await post('/send', jwt(ADMIN, 's1'));
    for (let i = 0; i < 20; i++) await post('/verify', jwt(ADMIN, 's1'), { code: '000000' });
    const res = await post('/verify', jwt(ADMIN, 's1'), { code: '000000' });
    expect(res.status).toBe(429);
    expect((await res.json()).reason).toBe('rate_limited');
  });

  it('a person the company does not ask cannot get a pass either', async () => {
    expect((await post('/verify', jwt(STAFF, 's1'), { code: '123456' })).status).toBe(400);
    expect(state.passes).toEqual([]);
  });
});
