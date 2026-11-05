// @vitest-environment node
//
// One-click sign-in from Figbloom Schools (platform_handoff_routes.js, ERP/SCHOOLS_HR_HANDOFF_CONTRACT.md section 2):
// the switch, redeeming the code, a linked person signed in, no access, a first-time person sent to sign in and then
// linked (same company, same browser, once, within 10 minutes), return_to, removing a link, and that the code never
// reaches a log. The database is a fake store here (its functions run on a real schema in
// supabase/tests/platform_handoff.test.ts); the platform is a fake client.
import crypto from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

const PT = '7a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c10';
const SCHOOL = '1b1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c20'; // the school's HR company
const OTHER = '2b1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c21';
const HEAD = '00000000-0000-0000-0000-00000000c001';
const OUTSIDER = '00000000-0000-0000-0000-00000000c003';
const CODE = 'Zx9_platform-one-time-code-0123456789abcdefghij';
const SITE = 'https://hr-staging.figbloom.org';

type Row = Record<string, unknown>;
type PlatformErrorLike = Error & { status: number; code: string };

let mod: typeof import('../platform_handoff_routes.js');
let PlatformError: new (status: number, code: string, message: string) => PlatformErrorLike;

const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

// ---- a store that behaves as the database functions do
const db = {
  companies: new Map<string, { platform: string; name: string }>(),
  members: new Set<string>(), // `${user}:${tenant}` active members of active companies
  links: [] as { tenant: string; source: string; external: string; user: string }[],
  pending: new Map<string, Row & { browser: string; expires: number; used: boolean }>(),
  log: [] as Row[],
  switched: [] as string[],
  tokens: new Map<string, { ok: boolean; reason?: string }>(),
};
const store = {
  begin: async (a: Row) => {
    const c = db.companies.get(String(a.tenantId));
    if (!c || c.platform !== a.platformTenantId) return { outcome: 'unknown_company', tenant_id: null, user_id: null };
    const link = db.links.find((l) => l.tenant === a.tenantId && l.source === a.source && l.external === a.externalId);
    if (link) {
      if (db.members.has(`${link.user}:${a.tenantId}`)) {
        db.switched.push(`${link.user}:${a.tenantId}`);
        return { outcome: 'linked', tenant_id: a.tenantId, user_id: link.user };
      }
      return { outcome: 'no_access', tenant_id: a.tenantId, user_id: link.user };
    }
    db.pending.set(String(a.tokenHash), { ...a, browser: String(a.browserHash), expires: Date.now() + 10 * 60 * 1000, used: false });
    return { outcome: 'pending', tenant_id: a.tenantId, user_id: null };
  },
  complete: async ({ tokenHash, browserHash, userId, confirm }: Row) => {
    const p = db.pending.get(String(tokenHash));
    if (!p) return { outcome: 'invalid' };
    if (p.browser !== browserHash) return { outcome: 'other_browser' };
    const base = { tenant_id: p.tenantId, source: p.source, company_name: db.companies.get(String(p.tenantId))?.name };
    if (p.used) return { ...base, outcome: 'used' };
    if (p.expires <= Date.now()) return { ...base, outcome: 'expired' };
    if (!db.members.has(`${userId}:${p.tenantId}`)) return { ...base, outcome: 'wrong_company' };
    if (!confirm) return { ...base, outcome: 'ready', person_name: (p.person as Row).name, return_to: p.returnTo };
    db.links.push({ tenant: String(p.tenantId), source: String(p.source), external: String(p.externalId), user: String(userId) });
    p.used = true;
    db.switched.push(`${userId}:${p.tenantId}`);
    return { ...base, outcome: 'linked', return_to: p.returnTo, external_id: p.externalId };
  },
  unlink: async ({ userId, tenantId, source }: Row) => {
    const before = db.links.length;
    db.links = db.links.filter((l) => !(l.user === userId && l.tenant === tenantId && l.source === source));
    return before - db.links.length;
  },
  log: async (entry: Row) => {
    db.log.push(entry);
  },
  signInToken: async (userId: string) => db.tokens.get(userId) ?? { ok: true, tokenHash: `hashed-token-for-${userId.slice(-4)}` },
};

// ---- the platform
const platform = {
  calls: [] as { method: string; path: string; body: unknown }[],
  answer: null as null | (() => unknown),
  call: async (method: string, path: string, body: unknown) => {
    platform.calls.push({ method, path, body });
    const a = platform.answer?.();
    if (a instanceof Error) throw a;
    return a;
  },
  configured: () => true,
  resetToken: () => {},
};
const claims = (extra: Row = {}, person: Row = {}) => ({
  source: 'schools', platform_tenant_id: PT, tenant_local_id: SCHOOL,
  person: { external_id: 'person-head', name: 'Mary Head', email: 'head@hillside.ac.ke', role: 'school_admin', ...person },
  return_to: '/payroll?month=2026-11', ...extra,
});

// the signed-in person, from the bearer token
const users: Record<string, { id: string; email: string; tenantId: string }> = {
  'session-head': { id: HEAD, email: 'head@hillside.ac.ke', tenantId: SCHOOL },
  'session-outsider': { id: OUTSIDER, email: 'x@other.ac.ke', tenantId: OTHER },
};
const bearer = (req: { headers: Row }) => {
  const u = users[String(req.headers.authorization ?? '').replace(/^Bearer /, '')];
  if (!u) throw Object.assign(new Error('Invalid or expired session'), { status: 401 });
  return u;
};

let server: Server;
let base: string;
const logged: string[] = [];

beforeAll(async () => {
  mod = await import('../platform_handoff_routes.js');
  PlatformError = (await import('../platform_client.js')).PlatformError as never;
  const express = (await import('express')).default;
  const app = express();
  app.use('/api/platform/handoff', mod.createPlatformHandoffRouter({
    store: store as never,
    platform: platform as never,
    verifyUser: async (req: never) => bearer(req),
    authenticateCaller: async (req: never) => bearer(req),
    site: () => SITE,
  }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const level of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }
});
afterAll(() => {
  server?.close();
  vi.restoreAllMocks();
});

beforeEach(() => {
  process.env.PLATFORM_HANDOFF_ENABLED = 'true';
  db.companies = new Map([[SCHOOL, { platform: PT, name: 'Hillside Primary' }], [OTHER, { platform: 'other-pt', name: 'Other School' }]]);
  db.members = new Set([`${HEAD}:${SCHOOL}`, `${OUTSIDER}:${OTHER}`]);
  db.links = [];
  db.pending.clear();
  db.log = [];
  db.switched = [];
  db.tokens.clear();
  platform.calls = [];
  platform.answer = () => claims();
});

const open = (query = `?code=${CODE}`) => fetch(`${base}/api/platform/handoff${query}`, { redirect: 'manual' });
const location = (res: Response) => res.headers.get('location') ?? '';
const fragment = (res: Response) => new URLSearchParams(location(res).split('#')[1] ?? '');
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0];
const post = (path: string, body: Row, { session = 'session-head', cookie = '' }: { session?: string; cookie?: string } = {}) =>
  fetch(`${base}/api/platform/handoff${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session}`, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

/** Opens a first-time handoff: the pending id the browser carries and the cookie it was given. */
async function firstTime() {
  const res = await open();
  expect(res.status).toBe(302);
  expect(location(res)).toMatch(new RegExp(`^${SITE}/handoff#connect=`));
  return { pending: fragment(res).get('connect') ?? '', cookie: cookieOf(res), res };
}

describe('the switch', () => {
  it('off: a friendly page, and the code is not redeemed', async () => {
    process.env.PLATFORM_HANDOFF_ENABLED = 'false';
    const res = await open();
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`${SITE}/handoff?status=off`);
    expect(platform.calls).toEqual([]);
    expect(db.log).toEqual([expect.objectContaining({ outcome: 'off' })]);
    expect((await post('/link', { pending: 'x'.repeat(43) })).status).toBe(503);
  });
});

describe('redeeming the code', () => {
  it('redeems it once on the platform with the hr client', async () => {
    await open();
    expect(platform.calls).toEqual([{ method: 'POST', path: '/handoffs/redeem', body: { code: CODE } }]);
  });

  it('an unknown, used or expired code (the platform\'s 410) is an "expired link" page; nobody is signed in', async () => {
    platform.answer = () => new PlatformError(410, 'handoff_invalid', 'This handoff is not valid.');
    const res = await open();
    expect(location(res)).toBe(`${SITE}/handoff?status=invalid`);
    expect(db.switched).toEqual([]);
    expect(db.log).toEqual([expect.objectContaining({ outcome: 'invalid', detail: 'redeem 410 handoff_invalid' })]);
  });

  it('the platform down is an error page (try again)', async () => {
    platform.answer = () => new PlatformError(502, 'platform_unavailable', 'down');
    expect(location(await open())).toBe(`${SITE}/handoff?status=error`);
  });

  it('no code, or a malformed one, is not sent to the platform', async () => {
    expect(location(await open(''))).toBe(`${SITE}/handoff?status=invalid`);
    expect(location(await open('?code=short'))).toBe(`${SITE}/handoff?status=invalid`);
    expect(location(await open('?code=has%20spaces%20in%20it%20which%20is%20wrong'))).toBe(`${SITE}/handoff?status=invalid`);
    expect(platform.calls).toEqual([]);
  });

  it('claims missing or malformed are refused', async () => {
    platform.answer = () => claims({ tenant_local_id: 'not-a-uuid' });
    expect(location(await open())).toBe(`${SITE}/handoff?status=invalid`);
    platform.answer = () => claims({}, { external_id: '' });
    expect(location(await open())).toBe(`${SITE}/handoff?status=invalid`);
  });

  it('a school whose HR company is not this one is "not set up"', async () => {
    platform.answer = () => claims({ tenant_local_id: OTHER });
    expect(location(await open())).toBe(`${SITE}/handoff?status=not_set_up`);
  });

  it('answers are never cached nor passed on as a Referer', async () => {
    const res = await open();
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('linked: straight in', () => {
  beforeEach(() => {
    db.links.push({ tenant: SCHOOL, source: 'schools', external: 'person-head', user: HEAD });
  });

  it('switches that very login into the school\'s company and signs it in, then opens return_to', async () => {
    const res = await open();
    expect(res.status).toBe(302);
    expect(location(res).startsWith(`${SITE}/handoff#`)).toBe(true);
    expect(Object.fromEntries(fragment(res))).toEqual({ token_hash: 'hashed-token-for-c001', next: '/payroll?month=2026-11' });
    expect(db.switched).toEqual([`${HEAD}:${SCHOOL}`]);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(db.log).toEqual([expect.objectContaining({ outcome: 'signed_in', userId: HEAD, tenantId: SCHOOL, source: 'schools', externalId: 'person-head' })]);
  });

  it('no return_to, or one that leaves the site, opens the dashboard', async () => {
    for (const bad of [undefined, 'https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/login', '/api/admin/users']) {
      platform.answer = () => claims({ return_to: bad });
      expect(fragment(await open()).get('next')).toBe('/dashboard');
    }
  });

  it('no longer a member: "no access", and nobody is signed in', async () => {
    db.members.delete(`${HEAD}:${SCHOOL}`);
    const res = await open();
    expect(location(res)).toBe(`${SITE}/handoff?status=no_access`);
    expect(location(res)).not.toContain('token_hash');
    expect(db.log).toEqual([expect.objectContaining({ outcome: 'no_access', userId: HEAD })]);
  });

  it('a login that cannot sign in (blocked) is "no access" too', async () => {
    db.tokens.set(HEAD, { ok: false, reason: 'blocked' });
    expect(location(await open())).toBe(`${SITE}/handoff?status=no_access`);
  });
});

describe('not linked yet: sign in once, then connect', () => {
  it('sends the browser to sign in with only a pending id, and ties it to this browser with an HttpOnly cookie', async () => {
    const { pending, res } = await firstTime();
    expect(pending).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location(res)).not.toContain('head@hillside');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^fb_hr_handoff=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\/api\/platform\/handoff/);
    expect(cookie).toMatch(/Max-Age=600/);
    // only hashes are stored, never the id or the cookie; and nobody is linked by the email in the claims
    const [hash, record] = [...db.pending.entries()][0];
    expect(hash).toBe(sha(pending));
    expect(record.browser).toBe(sha(cookie.split(';')[0].split('=')[1]));
    expect(db.links).toEqual([]);
    expect(db.log).toEqual([expect.objectContaining({ outcome: 'not_linked', externalId: 'person-head' })]);
  });

  it('a member of that same company sees who is connected, then connects; next time is straight in', async () => {
    const { pending, cookie } = await firstTime();
    const look = await post('/pending', { pending }, { cookie });
    expect(look.status).toBe(200);
    expect(await look.json()).toEqual({ outcome: 'ready', person_name: 'Mary Head', company_name: 'Hillside Primary' });
    expect(db.links).toEqual([]);

    const done = await post('/link', { pending }, { cookie });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ ok: true, outcome: 'linked', company_name: 'Hillside Primary', return_to: '/payroll?month=2026-11' });
    expect(done.headers.get('set-cookie')).toMatch(/fb_hr_handoff=;/); // cleared
    expect(db.links).toEqual([{ tenant: SCHOOL, source: 'schools', external: 'person-head', user: HEAD }]);
    expect(db.switched).toEqual([`${HEAD}:${SCHOOL}`]);
    expect(db.log.map((e) => e.outcome)).toEqual(['not_linked', 'linked']);

    db.switched = [];
    const again = await open();
    expect(fragment(again).get('token_hash')).toBe('hashed-token-for-c001');
  });

  it('a login of another company is told so and nothing is linked', async () => {
    const { pending, cookie } = await firstTime();
    const res = await post('/link', { pending }, { cookie, session: 'session-outsider' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('wrong_company');
    expect(body.error.message).toContain('x@other.ac.ke');
    expect(body.error.message).toContain('Hillside Primary');
    expect(db.links).toEqual([]);
    expect(db.log.at(-1)).toMatchObject({ outcome: 'link_wrong_company', userId: OUTSIDER });
    // the right login can still use it
    expect((await post('/link', { pending }, { cookie })).status).toBe(200);
  });

  it('works once', async () => {
    const { pending, cookie } = await firstTime();
    expect((await post('/link', { pending }, { cookie })).status).toBe(200);
    const again = await post('/link', { pending }, { cookie });
    expect(again.status).toBe(410);
    expect((await again.json()).error.code).toBe('used');
  });

  it('expires after 10 minutes', async () => {
    const { pending, cookie } = await firstTime();
    db.pending.get(sha(pending))!.expires = Date.now() - 1;
    const res = await post('/link', { pending }, { cookie });
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe('expired');
    expect(db.links).toEqual([]);
  });

  it('only in the browser that started it: no cookie, or another browser\'s, links nothing', async () => {
    const { pending } = await firstTime();
    const other = await firstTime();
    expect((await (await post('/link', { pending })).json()).error.code).toBe('other_browser');
    expect((await (await post('/link', { pending }, { cookie: other.cookie })).json()).error.code).toBe('other_browser');
    expect(db.links).toEqual([]);
  });

  it('needs a signed-in person', async () => {
    const { pending, cookie } = await firstTime();
    expect((await post('/link', { pending }, { cookie, session: 'nobody' })).status).toBe(401);
    expect((await post('/link', { pending: 'bad' }, { cookie })).status).toBe(400);
  });
});

describe('removing one\'s own link', () => {
  it('removes the caller\'s link in their company, and is logged', async () => {
    db.links.push({ tenant: SCHOOL, source: 'schools', external: 'person-head', user: HEAD });
    const del = await fetch(`${base}/api/platform/handoff/link`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', authorization: 'Bearer session-head' },
      body: JSON.stringify({ source: 'schools' }),
    });
    expect(await del.json()).toEqual({ ok: true, removed: 1 });
    expect(db.links).toEqual([]);
    expect(db.log.at(-1)).toMatchObject({ outcome: 'unlinked', userId: HEAD, tenantId: SCHOOL });
  });

  it('works with the switch off, and needs a signed-in person', async () => {
    process.env.PLATFORM_HANDOFF_ENABLED = 'false';
    const del = (session: string) => fetch(`${base}/api/platform/handoff/link`, {
      method: 'DELETE', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: '{}',
    });
    expect((await del('session-head')).status).toBe(200);
    expect((await del('nobody')).status).toBe(401);
  });
});

describe('return_to', () => {
  it('safeReturnTo keeps paths on this site only', () => {
    const s = mod.safeReturnTo;
    expect(s('/payroll')).toBe('/payroll');
    expect(s('/employees/MCL-000001?tab=leave#notes')).toBe('/employees/MCL-000001?tab=leave#notes');
    expect(s('/a/../payroll')).toBe('/payroll');
    for (const bad of ['', 'payroll', 'https://evil.example', '//evil.example/x', '/\\evil.example', '\\\\evil', '/\tx', '/x\ny',
      'javascript:alert(1)', '/login', '/handoff#token_hash=x', '/api/admin/users', '/mfa', '/join?token=x', `/${'a'.repeat(600)}`, null, 42]) {
      expect(s(bad as never)).toBe('/dashboard');
    }
  });
});

describe('secrets stay out of the logs', () => {
  it('neither the code, the pending id, the cookie nor the sign-in token is ever logged', async () => {
    db.links.push({ tenant: SCHOOL, source: 'schools', external: 'person-x', user: HEAD });
    const { pending, cookie } = await firstTime();
    await post('/link', { pending }, { cookie });
    platform.answer = () => claims({}, { external_id: 'person-x' });
    await open();
    platform.answer = () => new PlatformError(410, 'handoff_invalid', 'gone');
    await open();
    const all = [...logged, ...db.log.map((e) => JSON.stringify(e))].join('\n');
    expect(all).not.toContain(CODE);
    expect(all).not.toContain(pending);
    expect(all).not.toContain(cookie.split('=')[1]);
    expect(all).not.toContain('hashed-token-for');
  });
});
