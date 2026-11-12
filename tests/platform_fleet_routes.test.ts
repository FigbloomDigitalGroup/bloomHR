// @vitest-environment node
//
// Figbloom Fleet's companies in the console (platform_fleet_routes.js, ERP/FLEET_PLATFORM_CONTRACT.md 3). The caller is
// a signed-in platform admin whose console role allows the action. The list is Fleet's summaries (GET
// /api/platform/companies, shared secret in x-platform-secret) joined to the platform's fleet organisations (local ID =
// Company.id); decisions go to the platform's POST /organizations/{id}/status. Fleet's API, Cognito's token endpoint and
// the platform API are one fake HTTP server here, answering as the contract and the platform README say.
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

const FLEET_SECRET = 'fleet-console-secret-0123456789abcdefghij';
const CLIENT_ID = '24bd770dufp2irb5m5tia1nr88';
const CLIENT_SECRET = 'console-client-secret-0123456789abcdefghijkl';
const PENDING = '11111111-1111-4111-8111-111111111111';
const ACTIVE = '22222222-2222-4222-8222-222222222222';
const SUSPENDED = '33333333-3333-4333-8333-333333333333';
const REJECTED = '44444444-4444-4444-8444-444444444444';
const ORPHAN = '55555555-5555-4555-8555-555555555555';

const summary = (id: string, name: string, extra: Row = {}) => ({
  id, name, status: 'pending', created_at: '2026-10-01T08:00:00.000Z',
  owner: { name: `Owner of ${name}`, email: `owner@${id}.co.ke` },
  plan: 'trial',
  counts: { vehicles: 12, drivers: 9, admins: 2, trips_last_30_days: 340 },
  last_location_at: '2026-11-12T07:55:00.000Z',
  ...extra,
});
const org = (id: string, status: string, localId: string, extra: Row = {}) => ({
  id, name: `Org ${localId}`, status, status_reason: null, owner_email: `owner@${localId}.co.ke`, created_at: '2026-10-01T08:00:00.000Z',
  links: [{ module: 'fleet', local_organization_id: localId }], tenant_count: 1, tenants: [],
  ...extra,
});

const fake = {
  fleetCalls: [] as { path: string; headers: IncomingMessage['headers'] }[],
  tokenCalls: [] as { body: string }[],
  apiCalls: [] as { method: string; path: string; headers: IncomingMessage['headers']; body: Row }[],
  companies: [] as Row[],
  orgs: [] as Row[],
  fleetOverride: null as null | (() => { status: number; json?: unknown; raw?: string; delayMs?: number }),
  platformOverride: null as null | ((method: string, path: string) => { status: number; json?: unknown } | null),
};
let fakeServer: Server;
let fakeUrl: string;
let server: Server;
let base: string;
let slowBase: string;
let mod: typeof import('../platform_fleet_routes.js');
let groups: typeof import('../platform_school_groups_routes.js');
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
      // Fleet's console API
      if (req.url?.startsWith('/fleet/api/platform/')) {
        fake.fleetCalls.push({ path: req.url, headers: req.headers });
        if (req.headers['x-platform-secret'] !== FLEET_SECRET) return reply(401, { error: 'unauthorized' });
        const o = fake.fleetOverride?.();
        if (o) return reply(o.status, o.json, o.delayMs, o.raw);
        if (req.url === '/fleet/api/platform/companies') return reply(200, { generated_at: '2026-11-12T08:00:00.000Z', companies: fake.companies });
        return reply(404, { error: { code: 'not_found', message: 'Not found' } });
      }
      if (req.url === '/oauth2/token') {
        fake.tokenCalls.push({ body: raw });
        return reply(200, { access_token: `tok-${fake.tokenCalls.length}`, expires_in: 3600 });
      }
      const body = raw ? JSON.parse(raw) : {};
      fake.apiCalls.push({ method: req.method || '', path: req.url || '', headers: req.headers, body });
      const o = fake.platformOverride?.(req.method || '', req.url || '');
      if (o) return reply(o.status, o.json);
      if (req.method === 'GET' && req.url?.startsWith('/organizations?')) {
        const url = new URL(req.url, 'http://x');
        const limit = Number(url.searchParams.get('limit'));
        const offset = Number(url.searchParams.get('offset'));
        return reply(200, { organizations: fake.orgs.slice(offset, offset + limit), counts: {}, limit, offset });
      }
      const m = req.url?.match(/^\/organizations\/([^/]+)\/status$/);
      if (req.method === 'POST' && m) {
        const found = fake.orgs.find((x) => x.id === m[1]);
        if (!found) return reply(404, { error: { code: 'organization_not_found', message: 'No such organisation' } });
        found.status = body.status;
        found.status_reason = body.reason ?? null;
        return reply(200, { organization: { ...found, links: undefined, tenants: undefined }, change: {}, deliveries: [{ id: 7 }] });
      }
      return reply(404, { error: { code: 'not_found', message: 'Not found' } });
    });
  });
  await new Promise<void>((resolve) => fakeServer.listen(0, resolve));
  fakeUrl = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`;

  const express = (await import('express')).default;
  mod = await import('../platform_fleet_routes.js');
  groups = await import('../platform_school_groups_routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/platform/fleet', mod.default);
  app.use('/slow/fleet', mod.createFleetRouter({ timeoutMs: 150 }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  base = `${root}/api/platform/fleet`;
  slowBase = `${root}/slow/fleet`;
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
  fake.fleetCalls = [];
  fake.tokenCalls = [];
  fake.apiCalls = [];
  fake.companies = [
    summary('cmp_pending', 'Swift Couriers'),
    summary('cmp_active', 'Rift Valley Haulage', { status: 'active', plan: 'pro' }),
    summary('cmp_suspended', 'Coast Movers', { status: 'suspended' }),
    summary('cmp_rejected', 'Fake Fleet Ltd'),
    summary('cmp_new', 'Brand New Logistics'),
  ];
  fake.orgs = [
    org(PENDING, 'pending', 'cmp_pending'),
    org(ACTIVE, 'active', 'cmp_active'),
    org(SUSPENDED, 'suspended', 'cmp_suspended', { status_reason: 'Unpaid' }),
    org(REJECTED, 'rejected', 'cmp_rejected', { status_reason: 'Not a business' }),
    org(ORPHAN, 'pending', 'cmp_gone', { name: 'Gone Transport' }),
  ];
  fake.fleetOverride = null;
  fake.platformOverride = null;
  process.env.FLEET_PLATFORM_URL = `${fakeUrl}/fleet/`;
  process.env.FLEET_PLATFORM_SECRET = FLEET_SECRET;
  process.env.PLATFORM_API_URL = fakeUrl;
  process.env.PLATFORM_TOKEN_URL = `${fakeUrl}/oauth2/token`;
  process.env.PLATFORM_CONSOLE_CLIENT_ID = CLIENT_ID;
  process.env.PLATFORM_CONSOLE_CLIENT_SECRET = CLIENT_SECRET;
  groups.resetPlatformToken();
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
    expect(line).not.toContain(FLEET_SECRET);
    expect(line).not.toContain(CLIENT_SECRET);
    expect(line).not.toMatch(/tok-\d/);
  }
});

const call = (as: string | null, path = '/companies', init: { method?: string; body?: unknown } = {}, root = base) =>
  fetch(`${root}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(as ? { authorization: `Bearer ${as}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const decide = (as: string, id: string, action: string, reason?: string) =>
  call(as, `/companies/${id}/status`, { method: 'POST', body: { action, ...(reason !== undefined ? { reason } : {}) } });
const posts = () => fake.apiCalls.filter((c) => c.method === 'POST');

describe('GET /api/platform/fleet/companies', () => {
  it("joins Fleet's summaries to the platform's status for each company", async () => {
    const res = await call('view');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generated_at).toBe('2026-11-12T08:00:00.000Z');
    expect(body.platform).toEqual({ ok: true });
    expect(body.truncated).toBe(false);
    expect(body.companies).toHaveLength(6);
    expect(body.companies[0]).toEqual({
      id: 'cmp_pending', name: 'Swift Couriers', fleet_status: 'pending', plan: 'trial', created_at: '2026-10-01T08:00:00.000Z',
      owner_name: 'Owner of Swift Couriers', owner_email: 'owner@cmp_pending.co.ke',
      vehicles: 12, drivers: 9, admins: 2, trips_last_30_days: 340, last_location_at: '2026-11-12T07:55:00.000Z',
      in_fleet: true, organization_id: PENDING, status: 'pending', status_reason: null, platform_tenant_id: null, hr: null,
    });
    // the platform's decision wins over Fleet's own status
    expect(body.companies[3]).toMatchObject({ id: 'cmp_rejected', fleet_status: 'pending', status: 'rejected', status_reason: 'Not a business' });
    // not on the platform yet: no status
    expect(body.companies[4]).toMatchObject({ id: 'cmp_new', organization_id: null, status: null });
    // on the platform but not in Fleet's list: still shown, so nothing waiting is hidden
    expect(body.companies[5]).toMatchObject({ id: 'cmp_gone', name: 'Gone Transport', in_fleet: false, organization_id: ORPHAN, status: 'pending', vehicles: null });
    expect(body.counts).toEqual({ pending: 2, active: 1, suspended: 1, rejected: 1, unregistered: 1 });

    expect(fake.fleetCalls).toHaveLength(1);
    expect(fake.fleetCalls[0].path).toBe('/fleet/api/platform/companies');
    expect(fake.fleetCalls[0].headers['x-platform-secret']).toBe(FLEET_SECRET);
    expect(fake.fleetCalls[0].headers.authorization).toBeUndefined();
    expect(fake.apiCalls.map((c) => c.path)).toEqual(['/organizations?module=fleet&limit=200&offset=0']);
    expect(fake.apiCalls[0].headers.authorization).toBe('Bearer tok-1');
    expect(Object.fromEntries(new URLSearchParams(fake.tokenCalls[0].body))).toEqual({ grant_type: 'client_credentials', scope: 'platform/console' });
  });

  it('reads flat and camelCase summaries too, and takes FLEET_PLATFORM_URL with or without /api', async () => {
    process.env.FLEET_PLATFORM_URL = `${fakeUrl}/fleet/api`;
    fake.fleetOverride = () => ({
      status: 200,
      json: [{ id: 'cmp_active', name: 'Rift', status: 'active', createdAt: '2026-09-01T00:00:00Z', ownerName: 'Wanjiru', ownerEmail: 'w@rift.co.ke',
        subscriptionPlan: 'pro', vehicles: '4', drivers: 3, admins: 1, trips_last_30_days: 0, lastLocationAt: null }],
    });
    const body = await (await call('view')).json();
    expect(body.companies[0]).toMatchObject({
      id: 'cmp_active', plan: 'pro', created_at: '2026-09-01T00:00:00Z', owner_name: 'Wanjiru', owner_email: 'w@rift.co.ke',
      vehicles: 4, drivers: 3, admins: 1, trips_last_30_days: 0, last_location_at: null, status: 'active',
    });
    expect(fake.fleetCalls[0].path).toBe('/fleet/api/platform/companies');
  });

  it('reads every page of the platform', async () => {
    fake.orgs = Array.from({ length: 450 }, (_, i) => org(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 'active', `c${i}`));
    fake.companies = [];
    const body = await (await call('view')).json();
    expect(body.companies).toHaveLength(450);
    expect(fake.apiCalls.map((c) => new URL(c.path, 'http://x').searchParams.get('offset'))).toEqual(['0', '200', '400']);
  });

  it('needs a signed-in platform admin, and calls nothing otherwise', async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call('nobody')).status).toBe(401);
    expect((await call('company-admin')).status).toBe(403);
    expect(fake.fleetCalls).toEqual([]);
    expect(fake.apiCalls).toEqual([]);
  });

  it.each(['FLEET_PLATFORM_URL', 'FLEET_PLATFORM_SECRET'])('without %s: 503 fleet_not_connected, and Fleet is not called', async (name) => {
    process.env[name] = ' ';
    const res = await call('view');
    expect(res.status).toBe(503);
    expect((await res.json()).error).toEqual({ code: 'fleet_not_connected', message: "Figbloom Fleet isn't connected to the console yet." });
    expect(fake.fleetCalls).toEqual([]);
  });

  it("without the platform, the companies still show, with no status, and say why", async () => {
    process.env.PLATFORM_CONSOLE_CLIENT_SECRET = '';
    const body = await (await call('view')).json();
    expect(body.platform).toEqual({ ok: false, code: 'platform_not_connected', message: "The Figbloom platform isn't connected to the console yet." });
    expect(body.companies).toHaveLength(5);
    expect(body.companies.every((c: Row) => c.status === null && c.organization_id === null)).toBe(true);
    expect(body.counts.unregistered).toBe(5);
  });

  it('a platform without the fleet product yet is the same: companies without a status', async () => {
    fake.platformOverride = (method) => (method === 'GET' ? { status: 404, json: { error: { code: 'unknown_product', message: 'No product fleet' } } } : null);
    const body = await (await call('view')).json();
    expect(body.platform).toMatchObject({ ok: false, code: 'unknown_product' });
    expect(body.companies).toHaveLength(5);
  });

  it('a refused secret is a 502, without the secret anywhere', async () => {
    process.env.FLEET_PLATFORM_SECRET = 'wrong-secret';
    const res = await call('view');
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error).toEqual({ code: 'fleet_unavailable', message: "Figbloom Fleet refused the console's connection. Check its settings." });
    expect(text).not.toContain('wrong-secret');
    expect(logs.join('\n')).not.toContain('wrong-secret');
  });

  it('an unreachable Fleet, a 5xx, a non-JSON answer, an answer without companies or a slow Fleet is a 502', async () => {
    fake.fleetOverride = () => ({ status: 500, json: { error: 'db down' } });
    expect((await call('view')).status).toBe(502);
    fake.fleetOverride = () => ({ status: 200, raw: '<html>' });
    expect((await call('view')).status).toBe(502);
    fake.fleetOverride = () => ({ status: 200, json: { rows: [] } });
    expect((await (await call('view')).json()).error.code).toBe('fleet_unavailable');
    fake.fleetOverride = () => ({ status: 200, json: { companies: [] }, delayMs: 400 });
    const slow = await call('view', '/companies', {}, slowBase);
    expect(slow.status).toBe(502);
    expect((await slow.json()).error.message).toMatch(/didn't answer in time/);
    fake.fleetOverride = null;
    process.env.FLEET_PLATFORM_URL = 'http://127.0.0.1:9';
    expect((await (await call('view')).json()).error.code).toBe('fleet_unavailable');
  });

  it("passes Fleet's 4xx through", async () => {
    fake.fleetOverride = () => ({ status: 400, json: { error: { code: 'bad_request', message: 'No such filter' } } });
    const res = await call('view');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: 'bad_request', message: 'No such filter' });
  });
});

describe('POST /api/platform/fleet/companies/:organizationId/status', () => {
  it('approves a pending company on the platform, recording the owner\'s email', async () => {
    const res = await decide('own', PENDING, 'approve');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ company: { organization_id: PENDING, status: 'active', status_reason: null } });
    expect(posts()).toEqual([
      expect.objectContaining({ path: `/organizations/${PENDING}/status`, body: { status: 'active', actor_email: 'own@figbloom.org' } }),
    ]);
    // the status is checked on the platform, never by asking Fleet
    expect(fake.fleetCalls).toEqual([]);
  });

  it('rejects with a reason, as an admin', async () => {
    const res = await decide('adm', PENDING, 'reject', '  Not a real business ');
    expect(res.status).toBe(200);
    expect((await res.json()).company).toEqual({ organization_id: PENDING, status: 'rejected', status_reason: 'Not a real business' });
    expect(posts()[0].body).toEqual({ status: 'rejected', reason: 'Not a real business', actor_email: 'adm@figbloom.org' });
  });

  it('support suspends (with a reason) and reactivates, but cannot approve, reject or reactivate a rejected company', async () => {
    expect((await decide('sup', ACTIVE, 'suspend', 'Unpaid')).status).toBe(200);
    expect((await decide('sup', SUSPENDED, 'reactivate')).status).toBe(200);
    expect(posts().map((c) => c.body)).toEqual([
      { status: 'suspended', reason: 'Unpaid', actor_email: 'sup@figbloom.org' },
      { status: 'active', actor_email: 'sup@figbloom.org' },
    ]);
    for (const action of ['approve', 'reject']) expect((await decide('sup', PENDING, action, 'x')).status).toBe(403);
    const refused = await decide('sup', REJECTED, 'reactivate');
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.message).toBe('Only an owner or admin can reactivate a company that was not approved.');
    expect(posts()).toHaveLength(2);
    expect((await decide('adm', REJECTED, 'reactivate')).status).toBe(200);
  });

  it('a viewer decides nothing', async () => {
    for (const [action, id] of [['approve', PENDING], ['reject', PENDING], ['suspend', ACTIVE], ['reactivate', SUSPENDED]]) {
      expect((await decide('view', id, action, 'x')).status).toBe(403);
    }
    expect(posts()).toEqual([]);
  });

  it('each action only from its own statuses', async () => {
    const res = await decide('own', PENDING, 'reactivate');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code: 'invalid_transition', message: "A pending company can't be reactivated." });
    expect((await decide('own', ACTIVE, 'approve')).status).toBe(409);
    expect(posts()).toEqual([]);
  });

  it('needs a reason to reject or suspend, and a known action, company and email', async () => {
    expect((await (await decide('own', PENDING, 'reject')).json()).error.code).toBe('reason_required');
    expect((await (await decide('own', ACTIVE, 'suspend', '  ')).json()).error.code).toBe('reason_required');
    expect((await decide('own', ACTIVE, 'suspend', 'x'.repeat(501))).status).toBe(400);
    expect((await (await decide('own', PENDING, 'delete')).json()).error.code).toBe('invalid_action');
    expect((await (await decide('own', 'cmp_pending', 'approve')).json()).error.code).toBe('invalid_organization_id');
    expect((await decide('own', '99999999-9999-4999-8999-999999999999', 'approve')).status).toBe(404);
    expect((await (await decide('no-email', PENDING, 'approve')).json()).error.code).toBe('no_actor_email');
    expect(posts()).toEqual([]);
  });

  it("passes the platform's refusal through, and says when it isn't connected", async () => {
    fake.platformOverride = (method) =>
      method === 'POST' ? { status: 409, json: { error: { code: 'invalid_transition', message: 'A active organisation cannot become rejected' } } } : null;
    const res = await decide('own', PENDING, 'approve');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('invalid_transition');
    process.env.PLATFORM_API_URL = '';
    const off = await decide('own', PENDING, 'approve');
    expect(off.status).toBe(503);
    expect((await off.json()).error.code).toBe('platform_not_connected');
  });

  it('never sends the token or a secret back', async () => {
    const text = await (await decide('own', PENDING, 'approve')).text();
    expect(text).not.toMatch(/tok-\d/);
    expect(text).not.toContain(CLIENT_SECRET);
    expect(text).not.toContain('deliveries');
  });
});

describe('HR & Payroll per Fleet company (ERP/FLEET_HR_CONTRACT.md)', () => {
  const T_ACTIVE = '66666666-6666-4666-8666-666666666666';
  const T_PENDING = '77777777-7777-4777-8777-777777777777';
  const tenant = (id: string, localId: string, extra: Row = {}) => ({ id, name: localId, links: [{ module: 'fleet', local_tenant_id: localId, local_slug: localId }], ...extra });
  const tenants: Record<string, Row> = {};
  const hrOn = new Set<string>();

  beforeEach(() => {
    fake.orgs[0] = org(PENDING, 'pending', 'cmp_pending', { tenants: [tenant(T_PENDING, 'cmp_pending')] });
    fake.orgs[1] = org(ACTIVE, 'active', 'cmp_active', {
      tenants: [tenant(T_ACTIVE, 'cmp_active', { links: [{ module: 'fleet', local_tenant_id: 'cmp_active' }, { module: 'hr', local_tenant_id: 'hr-co-1' }] })],
    });
    tenants[T_PENDING] = { modules: [{ module: 'fleet', status: 'active' }], links: [{ module: 'fleet', local_tenant_id: 'cmp_pending' }] };
    tenants[T_ACTIVE] = { modules: [], links: [{ module: 'fleet', local_tenant_id: 'cmp_active' }, { module: 'hr', local_tenant_id: 'hr-co-1' }] };
    hrOn.clear();
    fake.platformOverride = (method, path) => {
      const g = path.match(/^\/tenants\/([^/]+)$/);
      if (method === 'GET' && g) {
        const t = tenants[g[1]];
        if (!t) return { status: 404, json: { error: { code: 'tenant_not_found', message: 'No such account' } } };
        const modules = [...(t.modules as Row[]), ...(hrOn.has(g[1]) ? [{ module: 'hr', status: 'active' }] : [])];
        return { status: 200, json: { tenant: { id: g[1], legal_name: 'X' }, modules, links: t.links } };
      }
      if (method === 'PUT' && /^\/tenants\/[^/]+\/modules\/hr$/.test(path)) {
        hrOn.add(path.split('/')[2]);
        return { status: 200, json: { module: { module: 'hr', status: 'active' }, event: {} } };
      }
      return null;
    };
  });

  it('each company shows its HR state: linked is on; not linked is asked about (off)', async () => {
    const body = await (await call('view')).json();
    const byId = Object.fromEntries(body.companies.map((c: Row) => [c.id, c]));
    expect(byId.cmp_active).toMatchObject({ platform_tenant_id: T_ACTIVE, hr: { state: 'on', hr_tenant_id: 'hr-co-1' } });
    expect(byId.cmp_pending).toMatchObject({ platform_tenant_id: T_PENDING, hr: { state: 'off' } });
    // a company with no platform tenant: no HR state, nothing asked
    expect(byId.cmp_new).toMatchObject({ platform_tenant_id: null, hr: null });
    expect(fake.apiCalls.filter((c) => c.path.startsWith('/tenants/')).map((c) => c.path)).toEqual([`/tenants/${T_PENDING}`]);
  });

  it('Enable: switches hr on for the company with its owner as a fleet_owner, recorded under the caller', async () => {
    const res = await call('adm', `/hr/${T_PENDING}/enable`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ company: { platform_tenant_id: T_PENDING, hr: { state: 'enabling', module_status: 'active', hr_tenant_id: null } } });
    const put = fake.apiCalls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe(`/tenants/${T_PENDING}/modules/hr`);
    expect(put.body).toEqual({
      status: 'active', actor_email: 'adm@figbloom.org',
      admins: [{ email: 'owner@cmp_pending.co.ke', name: 'Owner of Swift Couriers', role: 'fleet_owner' }],
    });
  });

  it('already on: nothing is changed', async () => {
    const res = await call('own', `/hr/${T_ACTIVE}/enable`, { method: 'POST' });
    expect((await res.json()).company.hr.state).toBe('on');
    expect(fake.apiCalls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('only approve_companies; a bad id is a 400; another product\'s account is a 404', async () => {
    expect((await call('sup', `/hr/${T_PENDING}/enable`, { method: 'POST' })).status).toBe(403);
    expect((await call('view', `/hr/${T_PENDING}/enable`, { method: 'POST' })).status).toBe(403);
    expect((await call('adm', '/hr/nope/enable', { method: 'POST' })).status).toBe(400);
    tenants[T_PENDING] = { modules: [], links: [{ module: 'schools', local_tenant_id: 's1' }] };
    expect((await call('adm', `/hr/${T_PENDING}/enable`, { method: 'POST' })).status).toBe(404);
    expect(fake.apiCalls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('Fleet down: still switched on, with nobody to invite', async () => {
    fake.fleetOverride = () => ({ status: 500, json: {} });
    const res = await call('adm', `/hr/${T_PENDING}/enable`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(fake.apiCalls.find((c) => c.method === 'PUT')!.body.admins).toEqual([]);
  });
});
