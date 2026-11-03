// @vitest-environment node
//
// Figbloom Schools' school groups in the console (platform_school_groups_routes.js, design 5.8). The caller is a
// signed-in platform admin whose console role allows the action; the backend signs in to the Figbloom platform with
// client credentials (scope platform/console) and calls its /organizations routes. Cognito's token endpoint and the
// platform API are fake HTTP servers here, answering as the platform README says.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  authUsers: [] as { id: string; email: string | null }[],
  platform_admins: [] as Row[],
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
    auth: { getUser: async (token: string) => ({ data: { user: state.authUsers.find((u) => u.id === token) ?? null }, error: null }) },
    from: (name: string) => table(name as 'platform_admins'),
  };
  return { createClient: () => client };
});

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

const CLIENT_ID = '24bd770dufp2irb5m5tia1nr88';
const CLIENT_SECRET = 'console-client-secret-0123456789abcdefghijkl';
const PENDING = '11111111-1111-4111-8111-111111111111';
const ACTIVE = '22222222-2222-4222-8222-222222222222';
const SUSPENDED = '33333333-3333-4333-8333-333333333333';
const REJECTED = '44444444-4444-4444-8444-444444444444';

const org = (id: string, status: string, extra: Row = {}) => ({
  id, name: `Group ${status}`, status, status_reason: null, owner_email: `owner@${status}.ac.ke`, created_at: '2026-10-01T08:00:00.000Z',
  links: [{ module: 'schools', local_organization_id: `local-${status}` }],
  tenant_count: 2,
  tenants: [
    { id: `t1-${status}`, name: 'Hillside Primary', slug: 'hillside-primary', status: 'active',
      links: [{ module: 'schools', local_tenant_id: `school-1-${status}`, local_slug: 'hillside-primary' }] },
    { id: `t2-${status}`, name: 'Hillside Secondary', slug: 'hillside-secondary-x2', status: 'active',
      links: [{ module: 'schools', local_tenant_id: `school-2-${status}`, local_slug: 'hillside-secondary' }] },
  ],
  ...extra,
});

// the fake Cognito token endpoint and platform API, on one server
const fake = {
  tokenCalls: [] as { headers: IncomingMessage['headers']; body: string }[],
  apiCalls: [] as { method: string; path: string; headers: IncomingMessage['headers']; body: Row }[],
  tokenAnswer: (): { status: number; json?: unknown } => ({ status: 200, json: { access_token: `tok-${fake.tokenCalls.length}`, expires_in: 3600, token_type: 'Bearer' } }),
  orgs: [] as Row[],
  // the platform's own answer to a request, before the defaults below
  override: null as null | ((method: string, path: string, body: Row) => { status: number; json?: unknown; raw?: string; delayMs?: number } | null),
  // tokens the platform accepts (a refused one is a 401)
  validTokens: null as Set<string> | null,
};
let fakeServer: Server;
let fakeUrl: string;

let server: Server;
let base: string;
let slowBase: string;
let mod: typeof import('../platform_school_groups_routes.js');
const logs: string[] = [];

beforeAll(async () => {
  fakeServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const reply = (status: number, json: unknown, delayMs = 0, rawBody?: string) =>
        setTimeout(() => {
          if (res.destroyed) return;
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(rawBody ?? JSON.stringify(json));
        }, delayMs);
      if (req.url === '/oauth2/token') {
        fake.tokenCalls.push({ headers: req.headers, body: raw });
        const a = fake.tokenAnswer();
        return reply(a.status, a.json);
      }
      const body = raw ? JSON.parse(raw) : {};
      fake.apiCalls.push({ method: req.method || '', path: req.url || '', headers: req.headers, body });
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (fake.validTokens && !fake.validTokens.has(token)) return reply(401, { message: 'Unauthorized' });
      const o = fake.override?.(req.method || '', req.url || '', body);
      if (o) return reply(o.status, o.json, o.delayMs, o.raw);
      if (req.method === 'GET' && req.url?.startsWith('/organizations?')) {
        const url = new URL(req.url, 'http://x');
        const limit = Number(url.searchParams.get('limit'));
        const offset = Number(url.searchParams.get('offset'));
        const counts = fake.orgs.reduce<Record<string, number>>((c, x) => ({ ...c, [String(x.status)]: (c[String(x.status)] ?? 0) + 1 }), {});
        return reply(200, { organizations: fake.orgs.slice(offset, offset + limit), counts, limit, offset });
      }
      const m = req.url?.match(/^\/organizations\/([^/]+)\/status$/);
      if (req.method === 'POST' && m) {
        const found = fake.orgs.find((x) => x.id === m[1]);
        if (!found) return reply(404, { error: { code: 'organization_not_found', message: 'No such organisation' } });
        found.status = body.status;
        found.status_reason = body.reason ?? null;
        return reply(200, { organization: { ...found, links: undefined, tenants: undefined }, change: { new_status: body.status }, deliveries: [{ id: 7 }] });
      }
      return reply(404, { error: { code: 'not_found', message: 'Not found' } });
    });
  });
  await new Promise<void>((resolve) => fakeServer.listen(0, resolve));
  fakeUrl = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`;

  const express = (await import('express')).default;
  mod = await import('../platform_school_groups_routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/platform/school-groups', mod.default);
  app.use('/slow/school-groups', mod.createSchoolGroupsRouter({ timeoutMs: 150 }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  base = `${root}/api/platform/school-groups`;
  slowBase = `${root}/slow/school-groups`;
});
afterAll(() => {
  server.close();
  fakeServer.closeAllConnections();
  fakeServer.close();
});

beforeEach(() => {
  state.authUsers = [
    { id: 'own', email: 'own@figbloom.org' },
    { id: 'adm', email: 'adm@figbloom.org' },
    { id: 'sup', email: 'sup@figbloom.org' },
    { id: 'view', email: 'view@figbloom.org' },
    { id: 'company-admin', email: 'admin@a.co' },
    { id: 'no-email', email: null },
  ];
  state.platform_admins = [
    { user_id: 'own', role: 'owner' },
    { user_id: 'adm', role: 'admin' },
    { user_id: 'sup', role: 'support' },
    { user_id: 'view', role: 'viewer' },
    { user_id: 'no-email', role: 'owner' },
  ];
  fake.tokenCalls = [];
  fake.apiCalls = [];
  fake.tokenAnswer = () => ({ status: 200, json: { access_token: `tok-${fake.tokenCalls.length}`, expires_in: 3600, token_type: 'Bearer' } });
  fake.orgs = [org(PENDING, 'pending'), org(ACTIVE, 'active'), org(SUSPENDED, 'suspended', { status_reason: 'Fees unpaid' }), org(REJECTED, 'rejected')];
  fake.override = null;
  fake.validTokens = null;
  process.env.PLATFORM_API_URL = `${fakeUrl}/`;
  process.env.PLATFORM_TOKEN_URL = `${fakeUrl}/oauth2/token`;
  process.env.PLATFORM_CONSOLE_CLIENT_ID = CLIENT_ID;
  process.env.PLATFORM_CONSOLE_CLIENT_SECRET = CLIENT_SECRET;
  delete process.env.SCHOOL_GROUP_DECISIONS_LIVE;
  mod.resetPlatformToken();
  logs.length = 0;
  for (const level of ['error', 'warn', 'log', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  // never a secret or a token in a log line
  for (const line of logs) {
    expect(line).not.toContain(CLIENT_SECRET);
    expect(line).not.toMatch(/tok-\d/);
  }
});

const call = (as: string | null, path = '', init: { method?: string; body?: unknown } = {}, root = base) =>
  fetch(`${root}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(as ? { authorization: `Bearer ${as}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const decide = (as: string, id: string, action: string, reason?: string) =>
  call(as, `/${id}/status`, { method: 'POST', body: { action, ...(reason !== undefined ? { reason } : {}) } });
const posts = () => fake.apiCalls.filter((c) => c.method === 'POST');

describe('GET /api/platform/school-groups', () => {
  it('lists every Schools group with its schools (Schools\' own IDs and addresses), the counts and the switch-on setting', async () => {
    const res = await call('view');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decisions_live).toBe(false);
    expect(body.truncated).toBe(false);
    expect(body.counts).toEqual({ pending: 1, active: 1, suspended: 1, rejected: 1 });
    expect(body.groups).toHaveLength(4);
    expect(body.groups[0]).toEqual({
      id: PENDING, name: 'Group pending', status: 'pending', status_reason: null, owner_email: 'owner@pending.ac.ke',
      created_at: '2026-10-01T08:00:00.000Z', local_organization_id: 'local-pending', tenant_count: 2,
      schools: [
        { id: 't1-pending', name: 'Hillside Primary', status: 'active', local_tenant_id: 'school-1-pending', local_slug: 'hillside-primary' },
        { id: 't2-pending', name: 'Hillside Secondary', status: 'active', local_tenant_id: 'school-2-pending', local_slug: 'hillside-secondary' },
      ],
    });
    const [get] = fake.apiCalls;
    expect(get.path).toBe('/organizations?module=schools&limit=200&offset=0');
    expect(get.headers.authorization).toBe('Bearer tok-1');
  });

  it('says when decisions are live', async () => {
    process.env.SCHOOL_GROUP_DECISIONS_LIVE = 'true';
    expect((await (await call('view')).json()).decisions_live).toBe(true);
  });

  it('reads every page', async () => {
    fake.orgs = Array.from({ length: 450 }, (_, i) => org(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 'active'));
    const body = await (await call('view')).json();
    expect(body.groups).toHaveLength(450);
    expect(fake.apiCalls.map((c) => new URL(c.path, 'http://x').searchParams.get('offset'))).toEqual(['0', '200', '400']);
  });

  it('needs a signed-in platform admin', async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call('nobody')).status).toBe(401);
    const res = await call('company-admin');
    expect(res.status).toBe(403);
    expect(fake.tokenCalls).toEqual([]);
    expect(fake.apiCalls).toEqual([]);
  });

  it('signs in with client credentials and the console scope, and keeps the token until shortly before it expires', async () => {
    await call('view');
    await call('own');
    await call('sup');
    expect(fake.tokenCalls).toHaveLength(1);
    const t = fake.tokenCalls[0];
    expect(t.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(t.headers.authorization).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(t.body))).toEqual({ grant_type: 'client_credentials', scope: 'platform/console' });
    expect(fake.apiCalls.every((c) => c.headers.authorization === 'Bearer tok-1')).toBe(true);
  });

  it('asks for a new token when the old one is about to expire', async () => {
    fake.tokenAnswer = () => ({ status: 200, json: { access_token: `tok-${fake.tokenCalls.length}`, expires_in: 30 } }); // under the 60-second margin
    await call('view');
    await call('view');
    expect(fake.tokenCalls).toHaveLength(2);
    expect(fake.apiCalls.map((c) => c.headers.authorization)).toEqual(['Bearer tok-1', 'Bearer tok-2']);
  });

  it('asks for one token for requests made at the same time', async () => {
    await Promise.all([call('view'), call('own'), call('sup')]);
    expect(fake.tokenCalls).toHaveLength(1);
  });

  it('gets a new token once when the platform refuses the old one, then gives up with a 502', async () => {
    fake.validTokens = new Set(['tok-2']);
    expect((await call('view')).status).toBe(200);
    expect(fake.tokenCalls).toHaveLength(2);
    fake.validTokens = new Set();
    const res = await call('view');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toEqual({ code: 'platform_unavailable', message: "The Figbloom platform refused the console's connection. Check its settings." });
  });

  it.each(['PLATFORM_API_URL', 'PLATFORM_TOKEN_URL', 'PLATFORM_CONSOLE_CLIENT_ID', 'PLATFORM_CONSOLE_CLIENT_SECRET'])(
    'without %s: 503 platform_not_connected, and nothing is called',
    async (name) => {
      process.env[name] = ' ';
      const res = await call('view');
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe('platform_not_connected');
      expect(fake.tokenCalls).toEqual([]);
      expect(fake.apiCalls).toEqual([]);
    }
  );

  it('a refused token request is a 502, without the secret anywhere', async () => {
    fake.tokenAnswer = () => ({ status: 400, json: { error: 'invalid_client', client_secret: CLIENT_SECRET } });
    const res = await call('view');
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain('platform_unavailable');
    expect(text).not.toContain(CLIENT_SECRET);
    expect(text).not.toContain(CLIENT_ID);
  });

  it('an unreachable platform is a 502', async () => {
    process.env.PLATFORM_API_URL = 'http://127.0.0.1:9';
    const res = await call('view');
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('platform_unavailable');
  });

  it('a 5xx, a non-JSON answer or a slow platform is a 502', async () => {
    fake.override = () => ({ status: 500, json: { error: { code: 'internal', message: 'db down' } } });
    expect((await call('view')).status).toBe(502);
    fake.override = () => ({ status: 200, raw: '<html>' });
    expect((await call('view')).status).toBe(502);
    fake.override = () => ({ status: 200, json: { organizations: [] }, delayMs: 400 });
    const res = await call('view', '', {}, slowBase);
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toMatch(/didn't answer in time/);
  });

  it("passes the platform's 4xx through", async () => {
    fake.override = () => ({ status: 400, json: { error: { code: 'invalid_query', message: 'limit must be 1 to 200' } } });
    const res = await call('view');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: 'invalid_query', message: 'limit must be 1 to 200' });
  });
});

describe('POST /api/platform/school-groups/:id/status', () => {
  it('approves a pending group for an owner or admin, recording their email', async () => {
    for (const [as, id] of [['own', PENDING]] as const) {
      const res = await decide(as, id, 'approve');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.group).toMatchObject({ id: PENDING, status: 'active', schools: expect.any(Array) });
      expect(body.decisions_live).toBe(false);
    }
    expect(posts()).toEqual([
      expect.objectContaining({ path: `/organizations/${PENDING}/status`, body: { status: 'active', actor_email: 'own@figbloom.org' } }),
    ]);
  });

  it('rejects with a reason, as an admin', async () => {
    const res = await decide('adm', PENDING, 'reject', '  Not a real school ');
    expect(res.status).toBe(200);
    expect(posts()[0].body).toEqual({ status: 'rejected', reason: 'Not a real school', actor_email: 'adm@figbloom.org' });
  });

  it('support suspends (with a reason) and reactivates, but cannot approve or reject', async () => {
    expect((await decide('sup', ACTIVE, 'suspend', 'Fees unpaid')).status).toBe(200);
    expect((await decide('sup', SUSPENDED, 'reactivate')).status).toBe(200);
    expect((await decide('sup', REJECTED, 'reactivate')).status).toBe(200);
    expect(posts().map((c) => c.body)).toEqual([
      { status: 'suspended', reason: 'Fees unpaid', actor_email: 'sup@figbloom.org' },
      { status: 'active', actor_email: 'sup@figbloom.org' },
      { status: 'active', actor_email: 'sup@figbloom.org' },
    ]);
    for (const action of ['approve', 'reject']) {
      const res = await decide('sup', PENDING, action, 'x');
      expect(res.status).toBe(403);
    }
    expect(posts()).toHaveLength(3);
  });

  it('a viewer decides nothing', async () => {
    for (const [action, id] of [['approve', PENDING], ['reject', PENDING], ['suspend', ACTIVE], ['reactivate', SUSPENDED]]) {
      expect((await decide('view', id, action, 'x')).status).toBe(403);
    }
    expect(posts()).toEqual([]);
  });

  it('reactivate never approves: each action only from its own statuses', async () => {
    const res = await decide('sup', PENDING, 'reactivate');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('invalid_transition');
    expect((await decide('own', ACTIVE, 'approve')).status).toBe(409);
    expect((await decide('own', SUSPENDED, 'suspend', 'again')).status).toBe(409);
    expect(posts()).toEqual([]);
  });

  it('needs a reason to reject or suspend, and a known action, group and email', async () => {
    expect((await (await decide('own', PENDING, 'reject')).json()).error.code).toBe('reason_required');
    expect((await (await decide('own', ACTIVE, 'suspend', '   ')).json()).error.code).toBe('reason_required');
    expect((await decide('own', ACTIVE, 'suspend', 'x'.repeat(501))).status).toBe(400);
    expect((await (await decide('own', PENDING, 'delete')).json()).error.code).toBe('invalid_action');
    expect((await (await decide('own', 'not-a-uuid', 'approve')).json()).error.code).toBe('invalid_group_id');
    expect((await decide('own', '99999999-9999-4999-8999-999999999999', 'approve')).status).toBe(404);
    expect((await (await decide('no-email', PENDING, 'approve')).json()).error.code).toBe('no_actor_email');
    expect(posts()).toEqual([]);
  });

  it("passes the platform's refusal through", async () => {
    fake.override = (method) =>
      method === 'POST' ? { status: 409, json: { error: { code: 'invalid_transition', message: 'A active organisation cannot become rejected' } } } : null;
    const res = await decide('own', PENDING, 'approve');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code: 'invalid_transition', message: 'A active organisation cannot become rejected' });
  });

  it('never sends the token or the secret back', async () => {
    const text = await (await decide('own', PENDING, 'approve')).text();
    expect(text).not.toMatch(/tok-\d/);
    expect(text).not.toContain(CLIENT_SECRET);
    expect(text).not.toContain('deliveries');
  });
});
