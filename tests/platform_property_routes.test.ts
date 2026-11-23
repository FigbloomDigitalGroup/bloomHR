// @vitest-environment node
//
// Figbloom Property's workspaces in the console (platform_property_routes.js, ERP/PROPERTY_PLATFORM_CONTRACT.md 3). The
// caller is a signed-in platform admin whose console role allows the action. The list is Property's summaries (GET
// /api/platform/workspaces/, Django's trailing slash, shared secret in x-platform-secret) joined to the platform's
// property organisations; suspending and reactivating go to the platform's POST /organizations/{id}/status. Nothing is
// created or approved here. Property's API, Cognito's token endpoint and the platform API are one fake HTTP server
// here, answering as the contract says.
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

const PROPERTY_SECRET = 'property-console-secret-0123456789abcdefghij';
const CLIENT_ID = '24bd770dufp2irb5m5tia1nr88';
const CLIENT_SECRET = 'console-client-secret-0123456789abcdefghijkl';
// the platform's IDs
const ACTIVE = '11111111-1111-4111-8111-111111111111';
const SUSPENDED = '22222222-2222-4222-8222-222222222222';
const BY_LOCAL = '33333333-3333-4333-8333-333333333333';
const ORPHAN = '44444444-4444-4444-8444-444444444444';
const OWNER_OFF = '55555555-5555-4555-8555-555555555555';
// Property's workspace IDs
const W_ACTIVE = 'aaaaaaaa-0000-4000-8000-000000000001';
const W_PAUSED = 'aaaaaaaa-0000-4000-8000-000000000002';
const W_LOCAL = 'aaaaaaaa-0000-4000-8000-000000000003';
const W_FRESH = 'aaaaaaaa-0000-4000-8000-000000000004';
const W_OFF = 'aaaaaaaa-0000-4000-8000-000000000005';
const W_GONE = 'aaaaaaaa-0000-4000-8000-000000000006';

const summary = (id: string, name: string, platformId: string | null, extra: Row = {}) => ({
  id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), active: true, createdAt: '2026-10-01T08:00:00Z',
  creator: { name: `Owner of ${name}`, email: `owner@${name.toLowerCase().replace(/\s+/g, '')}.co.ke` },
  plan: { name: 'Growth', status: 'active', trialEndsAt: null },
  counts: { properties: 4, units: 60, occupiedUnits: 52, teamMembers: 3, tenants: 55 },
  platform: platformId ? { organizationId: platformId, tenantId: `t-${platformId}`, registeredAt: '2026-10-01T08:01:00Z' } : null,
  ...extra,
});
const org = (id: string, status: string, localId: string, extra: Row = {}) => ({
  id, name: `Org ${localId}`, status, status_reason: null, owner_email: `owner@${localId}.co.ke`, created_at: '2026-10-01T08:00:00.000Z',
  links: [{ module: 'property', local_organization_id: localId }], tenant_count: 1, tenants: [],
  ...extra,
});

const fake = {
  propertyCalls: [] as { method: string; path: string; headers: IncomingMessage['headers'] }[],
  tokenCalls: [] as { body: string }[],
  apiCalls: [] as { method: string; path: string; headers: IncomingMessage['headers']; body: Row }[],
  workspaces: [] as Row[],
  orgs: [] as Row[],
  propertyOverride: null as null | ((method: string, path: string) => { status: number; json?: unknown; raw?: string; delayMs?: number } | null),
  platformOverride: null as null | ((method: string, path: string) => { status: number; json?: unknown } | null),
};
let fakeServer: Server;
let fakeUrl: string;
let server: Server;
let base: string;
let slowBase: string;
let mod: typeof import('../platform_property_routes.js');
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
      // Property's console API (Django: trailing slashes)
      if (req.url?.startsWith('/property/api/platform/')) {
        fake.propertyCalls.push({ method: req.method || '', path: req.url, headers: req.headers });
        if (req.headers['x-platform-secret'] !== PROPERTY_SECRET) {
          return reply(401, { error: { code: 'unauthorized', message: 'Unauthorized' } });
        }
        const o = fake.propertyOverride?.(req.method || '', req.url);
        if (o) return reply(o.status, o.json, o.delayMs, o.raw);
        const path = req.url.slice('/property/api/platform'.length);
        if (req.method === 'GET' && path === '/workspaces/') {
          return reply(200, { workspaces: fake.workspaces, generatedAt: '2026-11-23T08:00:00Z' });
        }
        const one = path.match(/^\/workspaces\/([^/]+)\/$/);
        if (req.method === 'GET' && one) {
          const found = fake.workspaces.find((x) => x.id === decodeURIComponent(one[1]));
          return found
            ? reply(200, { workspace: found, generatedAt: '2026-11-23T08:00:00Z' })
            : reply(404, { error: { code: 'not_found', message: 'Workspace not found' } });
        }
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
  mod = await import('../platform_property_routes.js');
  groups = await import('../platform_school_groups_routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/platform/property', mod.default);
  app.use('/slow/property', mod.createPropertyRouter({ timeoutMs: 150 }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  base = `${root}/api/platform/property`;
  slowBase = `${root}/slow/property`;
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
  fake.propertyCalls = [];
  fake.tokenCalls = [];
  fake.apiCalls = [];
  fake.workspaces = [
    summary(W_ACTIVE, 'Kilimani Homes', ACTIVE),
    summary(W_PAUSED, 'Paused Estates', SUSPENDED, { active: false }),
    // registered, but Property's summary hasn't caught up with the platform's ID: joined on the local ID
    summary(W_LOCAL, 'Local Match', null),
    // signed up a moment ago: not on the platform yet
    summary(W_FRESH, 'Fresh Start', null, { plan: { name: 'Trial', status: 'trialing', trialEndsAt: '2026-12-07T00:00:00Z' } }),
    // its owner switched it off in Property; the platform still says active
    summary(W_OFF, 'Owner Off', OWNER_OFF, { active: false }),
  ];
  fake.orgs = [
    org(ACTIVE, 'active', W_ACTIVE),
    org(SUSPENDED, 'suspended', W_PAUSED, { status_reason: 'Unpaid' }),
    org(BY_LOCAL, 'active', W_LOCAL),
    org(ORPHAN, 'active', W_GONE, { name: 'Gone Lettings' }),
    org(OWNER_OFF, 'active', W_OFF),
  ];
  fake.propertyOverride = null;
  fake.platformOverride = null;
  process.env.PROPERTY_PLATFORM_URL = `${fakeUrl}/property/`;
  process.env.PROPERTY_PLATFORM_SECRET = PROPERTY_SECRET;
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
    expect(line).not.toContain(PROPERTY_SECRET);
    expect(line).not.toContain(CLIENT_SECRET);
    expect(line).not.toMatch(/tok-\d/);
  }
});

const call = (as: string | null, path = '/workspaces', init: { method?: string; body?: unknown } = {}, root = base) =>
  fetch(`${root}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(as ? { authorization: `Bearer ${as}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const decide = (as: string, id: string, action: string, reason?: string) =>
  call(as, `/workspaces/${id}/status`, { method: 'POST', body: { action, ...(reason !== undefined ? { reason } : {}) } });
const posts = () => fake.apiCalls.filter((c) => c.method === 'POST');

describe('GET /api/platform/property/workspaces', () => {
  it("joins Property's summaries to the platform's status for each workspace", async () => {
    const res = await call('view');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platform).toEqual({ ok: true });
    expect(body.truncated).toBe(false);
    expect(body.workspaces).toHaveLength(6);
    expect(body.workspaces[0]).toEqual({
      id: W_ACTIVE, name: 'Kilimani Homes', slug: 'kilimani-homes', property_active: true, created_at: '2026-10-01T08:00:00Z',
      creator_name: 'Owner of Kilimani Homes', creator_email: 'owner@kilimanihomes.co.ke',
      plan_name: 'Growth', plan_status: 'active', trial_ends_at: null,
      properties: 4, units: 60, occupied_units: 52, team_members: 3, tenants: 55,
      platform_organization_id: ACTIVE, platform_tenant_id: `t-${ACTIVE}`, registered_at: '2026-10-01T08:01:00Z',
      in_property: true, organization_id: ACTIVE, status: 'active', status_reason: null,
    });
    expect(body.workspaces[1]).toMatchObject({ id: W_PAUSED, property_active: false, status: 'suspended', status_reason: 'Unpaid' });
    expect(body.workspaces[2]).toMatchObject({ id: W_LOCAL, platform_organization_id: null, organization_id: BY_LOCAL, status: 'active' });
    // not on the platform yet: no platform status, Property's own still shows
    expect(body.workspaces[3]).toMatchObject({
      id: W_FRESH, organization_id: null, status: null, property_active: true, plan_status: 'trialing', trial_ends_at: '2026-12-07T00:00:00Z',
    });
    expect(body.workspaces[4]).toMatchObject({ id: W_OFF, property_active: false, status: 'active', organization_id: OWNER_OFF });
    // on the platform but not in Property's list: still shown
    expect(body.workspaces[5]).toMatchObject({ id: W_GONE, name: 'Gone Lettings', in_property: false, organization_id: ORPHAN, status: 'active', units: null });
    // the owner's own switch-off is told apart from a suspension
    expect(body.counts).toEqual({ active: 4, suspended: 1, deactivated: 1, inactive: 0, unregistered: 0 });

    expect(fake.propertyCalls).toHaveLength(1);
    expect(fake.propertyCalls[0].path).toBe('/property/api/platform/workspaces/');
    expect(fake.propertyCalls[0].headers['x-platform-secret']).toBe(PROPERTY_SECRET);
    expect(fake.propertyCalls[0].headers.authorization).toBeUndefined();
    expect(fake.apiCalls.map((c) => c.path)).toEqual(['/organizations?module=property&limit=200&offset=0']);
    expect(fake.apiCalls[0].headers.authorization).toBe('Bearer tok-1');
    expect(Object.fromEntries(new URLSearchParams(fake.tokenCalls[0].body))).toEqual({ grant_type: 'client_credentials', scope: 'platform/console' });
  });

  it('passes on only the summary fields: nothing else Property might send', async () => {
    fake.workspaces = [
      summary(W_ACTIVE, 'X', null, {
        tenantNames: ['Jane Tenant'], rentRoll: 1_234_567, creator: { name: 'O', email: 'o@x.co', phone: '+254700000000' },
        counts: { units: 3, arrears: 99 },
      }),
    ];
    const text = await (await call('view')).text();
    expect(text).not.toMatch(/Jane Tenant|rentRoll|1234567|arrears|\+254700000000/);
    expect(JSON.parse(text).workspaces[0]).toMatchObject({ units: 3, tenants: null, creator_email: 'o@x.co' });
  });

  it('takes PROPERTY_PLATFORM_URL with or without /api', async () => {
    process.env.PROPERTY_PLATFORM_URL = `${fakeUrl}/property/api`;
    expect((await call('view')).status).toBe(200);
    expect(fake.propertyCalls[0].path).toBe('/property/api/platform/workspaces/');
  });

  it('reads every page of the platform', async () => {
    fake.orgs = Array.from({ length: 450 }, (_, i) => org(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 'active', `w${i}`));
    fake.workspaces = [];
    const body = await (await call('view')).json();
    expect(body.workspaces).toHaveLength(450);
    expect(fake.apiCalls.map((c) => new URL(c.path, 'http://x').searchParams.get('offset'))).toEqual(['0', '200', '400']);
  });

  it('every console role sees it; anyone else is refused and nothing is called', async () => {
    for (const as of ['own', 'adm', 'sup', 'view']) expect((await call(as)).status).toBe(200);
    fake.propertyCalls = [];
    fake.apiCalls = [];
    expect((await call(null)).status).toBe(401);
    expect((await call('nobody')).status).toBe(401);
    expect((await call('company-admin')).status).toBe(403);
    expect(fake.propertyCalls).toEqual([]);
    expect(fake.apiCalls).toEqual([]);
  });

  it.each(['PROPERTY_PLATFORM_URL', 'PROPERTY_PLATFORM_SECRET'])('without %s: 503 property_not_connected, and Property is not called', async (name) => {
    process.env[name] = ' ';
    const res = await call('view');
    expect(res.status).toBe(503);
    expect((await res.json()).error).toEqual({ code: 'property_not_connected', message: "Figbloom Property isn't connected to the console yet." });
    expect(fake.propertyCalls).toEqual([]);
  });

  it("Property answering 503 not_configured (its own secret unset): 503 property_not_connected", async () => {
    fake.propertyOverride = () => ({ status: 503, json: { error: { code: 'not_configured', message: 'Console access is not configured' } } });
    const res = await call('view');
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('property_not_connected');
    const one = await call('view', `/workspaces/${W_ACTIVE}`);
    expect(one.status).toBe(503);
    expect((await one.json()).error.code).toBe('property_not_connected');
  });

  it("Property's console API not there (404 on the list): 503 property_not_connected", async () => {
    fake.propertyOverride = () => ({ status: 404, json: { error: { code: 'not_found', message: 'Not found' } } });
    const res = await call('view');
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('property_not_connected');
  });

  it("without the platform, the workspaces still show with Property's own status, and say why", async () => {
    process.env.PLATFORM_CONSOLE_CLIENT_SECRET = '';
    const body = await (await call('view')).json();
    expect(body.platform).toEqual({ ok: false, code: 'platform_not_connected', message: "The Figbloom platform isn't connected to the console yet." });
    expect(body.workspaces).toHaveLength(5);
    expect(body.workspaces.every((w: Row) => w.status === null && w.organization_id === null)).toBe(true);
    expect(body.counts).toEqual({ active: 3, suspended: 0, deactivated: 0, inactive: 2, unregistered: 0 });
  });

  it('a refused secret is a 502, without the secret anywhere', async () => {
    process.env.PROPERTY_PLATFORM_SECRET = 'wrong-secret';
    const res = await call('view');
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error).toEqual({ code: 'property_unavailable', message: "Figbloom Property refused the console's connection. Check its settings." });
    expect(text).not.toContain('wrong-secret');
    expect(logs.join('\n')).not.toContain('wrong-secret');
  });

  it('an unreachable Property, a 5xx, a non-JSON answer, an answer without workspaces or a slow Property is a 502', async () => {
    fake.propertyOverride = () => ({ status: 500, json: { error: 'db down' } });
    expect((await call('view')).status).toBe(502);
    fake.propertyOverride = () => ({ status: 503, json: { error: { code: 'maintenance', message: 'Down' } } });
    expect((await (await call('view')).json()).error.code).toBe('property_unavailable');
    fake.propertyOverride = () => ({ status: 200, raw: '<html>' });
    expect((await call('view')).status).toBe(502);
    fake.propertyOverride = () => ({ status: 200, json: { rows: [] } });
    expect((await (await call('view')).json()).error.code).toBe('property_unavailable');
    fake.propertyOverride = () => ({ status: 200, json: { workspaces: [] }, delayMs: 400 });
    const slow = await call('view', '/workspaces', {}, slowBase);
    expect(slow.status).toBe(502);
    expect((await slow.json()).error.message).toMatch(/didn't answer in time/);
    fake.propertyOverride = null;
    process.env.PROPERTY_PLATFORM_URL = 'http://127.0.0.1:9';
    expect((await (await call('view')).json()).error.code).toBe('property_unavailable');
  });
});

describe('GET /api/platform/property/workspaces/:id', () => {
  it('one workspace, with its platform status', async () => {
    const res = await call('view', `/workspaces/${W_PAUSED}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platform).toEqual({ ok: true });
    expect(body.workspace).toMatchObject({ id: W_PAUSED, organization_id: SUSPENDED, status: 'suspended', status_reason: 'Unpaid', units: 60 });
    expect(fake.propertyCalls[0].path).toBe(`/property/api/platform/workspaces/${W_PAUSED}/`);
  });

  it("Property's 404 is a 404; a bad ID is a 400 without calling Property", async () => {
    const res = await call('view', '/workspaces/bbbbbbbb-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
    fake.propertyCalls = [];
    expect((await call('view', '/workspaces/not-a-uuid')).status).toBe(400);
    expect(fake.propertyCalls).toEqual([]);
  });
});

describe('POST /api/platform/property/workspaces/:organizationId/status', () => {
  it("suspends an active workspace on the platform with a reason, recording the caller's email", async () => {
    const res = await decide('own', ACTIVE, 'suspend', '  Unpaid invoice ');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspace: { organization_id: ACTIVE, status: 'suspended', status_reason: 'Unpaid invoice' } });
    expect(posts()).toEqual([
      expect.objectContaining({ path: `/organizations/${ACTIVE}/status`, body: { status: 'suspended', reason: 'Unpaid invoice', actor_email: 'own@figbloom.org' } }),
    ]);
    // decided on the platform, never by asking Property
    expect(fake.propertyCalls).toEqual([]);
  });

  it('reactivates a suspended one, as an admin', async () => {
    const res = await decide('adm', SUSPENDED, 'reactivate');
    expect(res.status).toBe(200);
    expect((await res.json()).workspace).toEqual({ organization_id: SUSPENDED, status: 'active', status_reason: null });
    expect(posts()[0].body).toEqual({ status: 'active', actor_email: 'adm@figbloom.org' });
  });

  it('can suspend one its owner deactivated (the platform still has it active)', async () => {
    expect((await decide('own', OWNER_OFF, 'suspend', 'Fraud')).status).toBe(200);
  });

  it('support and viewers decide nothing (approve_companies)', async () => {
    for (const as of ['sup', 'view']) {
      const res = await decide(as, ACTIVE, 'suspend', 'x');
      expect(res.status).toBe(403);
      expect((await res.json()).error.message).toBe('Only an owner or admin can suspend or reactivate a Property workspace.');
      expect((await decide(as, SUSPENDED, 'reactivate')).status).toBe(403);
    }
    expect(posts()).toEqual([]);
  });

  it('each action only from its own status; nothing to approve or reject', async () => {
    const res = await decide('own', ACTIVE, 'reactivate');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code: 'invalid_transition', message: "An active workspace can't be reactivated." });
    expect((await decide('own', SUSPENDED, 'suspend', 'x')).status).toBe(409);
    for (const action of ['approve', 'reject', 'delete']) expect((await (await decide('own', ACTIVE, action, 'x')).json()).error.code).toBe('invalid_action');
    expect(posts()).toEqual([]);
  });

  it('needs a reason to suspend, a platform ID of a Property workspace, and an email', async () => {
    expect((await (await decide('own', ACTIVE, 'suspend')).json()).error.code).toBe('reason_required');
    expect((await (await decide('own', ACTIVE, 'suspend', '  ')).json()).error.code).toBe('reason_required');
    expect((await decide('own', ACTIVE, 'suspend', 'x'.repeat(501))).status).toBe(400);
    expect((await (await decide('own', 'kilimani', 'suspend', 'x')).json()).error.code).toBe('invalid_organization_id');
    // not a property organisation on the platform (another product's, or none)
    expect((await decide('own', '99999999-9999-4999-8999-999999999999', 'suspend', 'x')).status).toBe(404);
    expect((await (await decide('no-email', ACTIVE, 'suspend', 'x')).json()).error.code).toBe('no_actor_email');
    expect(posts()).toEqual([]);
  });

  it("passes the platform's refusal through, and says when it isn't connected", async () => {
    fake.platformOverride = (method) =>
      method === 'POST' ? { status: 409, json: { error: { code: 'invalid_transition', message: 'Already suspended' } } } : null;
    const res = await decide('own', ACTIVE, 'suspend', 'x');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('invalid_transition');
    process.env.PLATFORM_API_URL = '';
    const off = await decide('own', ACTIVE, 'suspend', 'x');
    expect(off.status).toBe(503);
    expect((await off.json()).error.code).toBe('platform_not_connected');
  });

  it('never sends the token or a secret back', async () => {
    const text = await (await decide('own', ACTIVE, 'suspend', 'x')).text();
    expect(text).not.toMatch(/tok-\d/);
    expect(text).not.toContain(CLIENT_SECRET);
    expect(text).not.toContain(PROPERTY_SECRET);
    expect(text).not.toContain('deliveries');
  });
});

describe('shownStatus', () => {
  it("the platform's decision, an owner's own switch-off apart, else Property's own, else unregistered", () => {
    const w = (status: string | null, property_active: boolean | null) => ({ status, property_active });
    expect(mod.shownStatus(w('active', true))).toBe('active');
    expect(mod.shownStatus(w('active', false))).toBe('deactivated');
    expect(mod.shownStatus(w('suspended', false))).toBe('suspended');
    expect(mod.shownStatus(w('suspended', true))).toBe('suspended');
    expect(mod.shownStatus(w(null, true))).toBe('active');
    expect(mod.shownStatus(w(null, false))).toBe('inactive');
    expect(mod.shownStatus(w(null, null))).toBe('unregistered');
  });
});
