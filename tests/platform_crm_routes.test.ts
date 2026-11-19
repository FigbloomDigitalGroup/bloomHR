// @vitest-environment node
//
// Figbloom CRM's organisations in the console (platform_crm_routes.js, ERP/CRM_PLATFORM_CONTRACT.md 3). The caller is a
// signed-in platform admin whose console role allows the action. The list is CRM's summaries (GET
// /api/platform/organizations, shared secret in x-platform-secret) joined to the platform's crm organisations; creating
// goes to CRM's POST /api/platform/organizations with the staff member's email; suspending and reactivating go to the
// platform's POST /organizations/{id}/status. CRM's API, Cognito's token endpoint and the platform API are one fake HTTP
// server here, answering as the contract says.
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

const CRM_SECRET = 'crm-console-secret-0123456789abcdefghij';
const CLIENT_ID = '24bd770dufp2irb5m5tia1nr88';
const CLIENT_SECRET = 'console-client-secret-0123456789abcdefghijkl';
const FIGBLOOM = '11111111-1111-4111-8111-111111111111';
const SUSPENDED = '22222222-2222-4222-8222-222222222222';
const BY_LOCAL = '33333333-3333-4333-8333-333333333333';
const ORPHAN = '44444444-4444-4444-8444-444444444444';

const summary = (id: string, name: string, extra: Row = {}) => ({
  id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), status: 'active', createdAt: '2026-10-01T08:00:00.000Z',
  admin: { name: `Admin of ${name}`, email: `admin@${id}.co.ke` },
  counts: { activeMembers: 7, pendingInvitations: 1, leads: 120, openDeals: 9, companies: 40 },
  lastActivityAt: '2026-11-18T07:55:00.000Z',
  platformOrganizationId: null,
  ...extra,
});
const org = (id: string, status: string, localId: string, extra: Row = {}) => ({
  id, name: `Org ${localId}`, status, status_reason: null, owner_email: `admin@${localId}.co.ke`, created_at: '2026-10-01T08:00:00.000Z',
  links: [{ module: 'crm', local_organization_id: localId }], tenant_count: 1, tenants: [],
  ...extra,
});

const fake = {
  crmCalls: [] as { method: string; path: string; headers: IncomingMessage['headers']; body: Row | null }[],
  tokenCalls: [] as { body: string }[],
  apiCalls: [] as { method: string; path: string; headers: IncomingMessage['headers']; body: Row }[],
  organizations: [] as Row[],
  orgs: [] as Row[],
  crmOverride: null as null | ((method: string, path: string) => { status: number; json?: unknown; raw?: string; delayMs?: number } | null),
  platformOverride: null as null | ((method: string, path: string) => { status: number; json?: unknown } | null),
};
let fakeServer: Server;
let fakeUrl: string;
let server: Server;
let base: string;
let slowBase: string;
let mod: typeof import('../platform_crm_routes.js');
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
      // CRM's console API
      if (req.url?.startsWith('/crm/api/platform/')) {
        const body = raw ? JSON.parse(raw) : null;
        fake.crmCalls.push({ method: req.method || '', path: req.url, headers: req.headers, body });
        if (req.headers['x-platform-secret'] !== CRM_SECRET) {
          return reply(401, { error: 'Unauthorized', code: 'UNAUTHORIZED', message: 'Unauthorized' });
        }
        const o = fake.crmOverride?.(req.method || '', req.url);
        if (o) return reply(o.status, o.json, o.delayMs, o.raw);
        const path = req.url.slice('/crm/api/platform'.length);
        if (req.method === 'GET' && path === '/organizations') return reply(200, { organizations: fake.organizations });
        const one = path.match(/^\/organizations\/([^/]+)$/);
        if (req.method === 'GET' && one) {
          const found = fake.organizations.find((x) => x.id === decodeURIComponent(one[1]));
          return found
            ? reply(200, { organization: found })
            : reply(404, { error: 'Organisation not found', code: 'NOT_FOUND', message: 'Organisation not found' });
        }
        if (req.method === 'POST' && path === '/organizations') {
          if (fake.organizations.some((x) => x.slug === body.slug)) {
            return reply(409, {
              error: 'That slug is taken', code: 'SLUG_TAKEN', message: 'That slug is taken',
              fieldErrors: [{ path: 'slug', message: 'That slug is taken' }],
            });
          }
          const created = summary('org_new', body.name, {
            slug: body.slug ?? 'acme', admin: { name: body.adminName, email: body.adminEmail },
            counts: { activeMembers: 0, pendingInvitations: 1, leads: 0, openDeals: 0, companies: 0 }, lastActivityAt: null,
          });
          fake.organizations.push(created);
          return reply(201, { organization: created });
        }
        return reply(404, { error: 'Not found', code: 'NOT_FOUND', message: 'Not found' });
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
  mod = await import('../platform_crm_routes.js');
  groups = await import('../platform_school_groups_routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/platform/crm', mod.default);
  app.use('/slow/crm', mod.createCrmRouter({ timeoutMs: 150, createTimeoutMs: 150 }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  base = `${root}/api/platform/crm`;
  slowBase = `${root}/slow/crm`;
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
  fake.crmCalls = [];
  fake.tokenCalls = [];
  fake.apiCalls = [];
  fake.organizations = [
    summary('org_figbloom', 'Figbloom', { platformOrganizationId: FIGBLOOM }),
    summary('org_paused', 'Paused Ltd', { status: 'suspended', platformOrganizationId: SUSPENDED }),
    // registered, but CRM's summary hasn't caught up with the platform's ID: joined on the local ID
    summary('org_local', 'Local Match', { platformOrganizationId: null }),
    // created a moment ago: not on the platform yet
    summary('org_fresh', 'Fresh Start', { admin: null, lastActivityAt: null }),
  ];
  fake.orgs = [
    org(FIGBLOOM, 'active', 'org_figbloom'),
    org(SUSPENDED, 'suspended', 'org_paused', { status_reason: 'Unpaid' }),
    org(BY_LOCAL, 'active', 'org_local'),
    org(ORPHAN, 'active', 'org_gone', { name: 'Gone Traders' }),
  ];
  fake.crmOverride = null;
  fake.platformOverride = null;
  process.env.CRM_PLATFORM_URL = `${fakeUrl}/crm/`;
  process.env.CRM_PLATFORM_SECRET = CRM_SECRET;
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
    expect(line).not.toContain(CRM_SECRET);
    expect(line).not.toContain(CLIENT_SECRET);
    expect(line).not.toMatch(/tok-\d/);
  }
});

const call = (as: string | null, path = '/organizations', init: { method?: string; body?: unknown } = {}, root = base) =>
  fetch(`${root}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(as ? { authorization: `Bearer ${as}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const create = (as: string, body: unknown, root = base) => call(as, '/organizations', { method: 'POST', body }, root);
const decide = (as: string, id: string, action: string, reason?: string) =>
  call(as, `/organizations/${id}/status`, { method: 'POST', body: { action, ...(reason !== undefined ? { reason } : {}) } });
const posts = () => fake.apiCalls.filter((c) => c.method === 'POST');
const crmPosts = () => fake.crmCalls.filter((c) => c.method === 'POST');
const NEW_ORG = { name: 'Acme Insurance', slug: 'acme', adminName: 'Wanjiru Kamau', adminEmail: 'Wanjiru@Acme.co.ke' };

describe('GET /api/platform/crm/organizations', () => {
  it("joins CRM's summaries to the platform's status for each organisation", async () => {
    const res = await call('view');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platform).toEqual({ ok: true });
    expect(body.truncated).toBe(false);
    expect(body.organizations).toHaveLength(5);
    expect(body.organizations[0]).toEqual({
      id: 'org_figbloom', name: 'Figbloom', slug: 'figbloom', crm_status: 'active', created_at: '2026-10-01T08:00:00.000Z',
      admin_name: 'Admin of Figbloom', admin_email: 'admin@org_figbloom.co.ke',
      active_members: 7, pending_invitations: 1, leads: 120, open_deals: 9, companies: 40,
      last_activity_at: '2026-11-18T07:55:00.000Z', platform_organization_id: FIGBLOOM,
      in_crm: true, organization_id: FIGBLOOM, status: 'active', status_reason: null,
    });
    expect(body.organizations[1]).toMatchObject({ id: 'org_paused', status: 'suspended', status_reason: 'Unpaid' });
    expect(body.organizations[2]).toMatchObject({ id: 'org_local', platform_organization_id: null, organization_id: BY_LOCAL, status: 'active' });
    // not on the platform yet: no platform status, CRM's own still shows
    expect(body.organizations[3]).toMatchObject({ id: 'org_fresh', organization_id: null, status: null, crm_status: 'active', admin_name: null });
    // on the platform but not in CRM's list: still shown
    expect(body.organizations[4]).toMatchObject({ id: 'org_gone', name: 'Gone Traders', in_crm: false, organization_id: ORPHAN, status: 'active', leads: null });
    expect(body.counts).toEqual({ active: 4, suspended: 1, inactive: 0, unregistered: 0 });

    expect(fake.crmCalls).toHaveLength(1);
    expect(fake.crmCalls[0].path).toBe('/crm/api/platform/organizations');
    expect(fake.crmCalls[0].headers['x-platform-secret']).toBe(CRM_SECRET);
    expect(fake.crmCalls[0].headers.authorization).toBeUndefined();
    expect(fake.apiCalls.map((c) => c.path)).toEqual(['/organizations?module=crm&limit=200&offset=0']);
    expect(fake.apiCalls[0].headers.authorization).toBe('Bearer tok-1');
    expect(Object.fromEntries(new URLSearchParams(fake.tokenCalls[0].body))).toEqual({ grant_type: 'client_credentials', scope: 'platform/console' });
  });

  it('passes on only the summary fields: nothing else CRM might send', async () => {
    fake.organizations = [summary('org_x', 'X', { dealValue: 1_000_000, contacts: [{ email: 'customer@x.co' }], counts: { leads: 3, pipelineValue: 99 } })];
    const text = await (await call('view')).text();
    expect(text).not.toMatch(/dealValue|pipelineValue|customer@x\.co|1000000/);
    expect(JSON.parse(text).organizations[0]).toMatchObject({ leads: 3, active_members: null });
  });

  it('takes CRM_PLATFORM_URL with or without /api', async () => {
    process.env.CRM_PLATFORM_URL = `${fakeUrl}/crm/api`;
    expect((await call('view')).status).toBe(200);
    expect(fake.crmCalls[0].path).toBe('/crm/api/platform/organizations');
  });

  it('reads every page of the platform', async () => {
    fake.orgs = Array.from({ length: 450 }, (_, i) => org(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 'active', `o${i}`));
    fake.organizations = [];
    const body = await (await call('view')).json();
    expect(body.organizations).toHaveLength(450);
    expect(fake.apiCalls.map((c) => new URL(c.path, 'http://x').searchParams.get('offset'))).toEqual(['0', '200', '400']);
  });

  it('every console role sees it; anyone else is refused and nothing is called', async () => {
    for (const as of ['own', 'adm', 'sup', 'view']) expect((await call(as)).status).toBe(200);
    fake.crmCalls = [];
    fake.apiCalls = [];
    expect((await call(null)).status).toBe(401);
    expect((await call('nobody')).status).toBe(401);
    expect((await call('company-admin')).status).toBe(403);
    expect(fake.crmCalls).toEqual([]);
    expect(fake.apiCalls).toEqual([]);
  });

  it.each(['CRM_PLATFORM_URL', 'CRM_PLATFORM_SECRET'])('without %s: 503 crm_not_connected, and CRM is not called', async (name) => {
    process.env[name] = ' ';
    const res = await call('view');
    expect(res.status).toBe(503);
    expect((await res.json()).error).toEqual({ code: 'crm_not_connected', message: "Figbloom CRM isn't connected to the console yet." });
    expect(fake.crmCalls).toEqual([]);
  });

  it("without the platform, the organisations still show with CRM's own status, and say why", async () => {
    process.env.PLATFORM_CONSOLE_CLIENT_SECRET = '';
    const body = await (await call('view')).json();
    expect(body.platform).toEqual({ ok: false, code: 'platform_not_connected', message: "The Figbloom platform isn't connected to the console yet." });
    expect(body.organizations).toHaveLength(4);
    expect(body.organizations.every((c: Row) => c.status === null && c.organization_id === null)).toBe(true);
    expect(body.counts).toEqual({ active: 3, suspended: 1, inactive: 0, unregistered: 0 });
  });

  it("CRM's link switched off (its API answers 404): 503 crm_not_connected", async () => {
    fake.crmOverride = () => ({ status: 404, json: { error: 'Not found', code: 'NOT_FOUND', message: 'Not found' } });
    const res = await call('view');
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('crm_not_connected');
    const created = await create('own', NEW_ORG);
    expect(created.status).toBe(503);
    expect((await created.json()).error.code).toBe('crm_not_connected');
  });

  it('a refused secret is a 502, without the secret anywhere', async () => {
    process.env.CRM_PLATFORM_SECRET = 'wrong-secret';
    const res = await call('view');
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error).toEqual({ code: 'crm_unavailable', message: "Figbloom CRM refused the console's connection. Check its settings." });
    expect(text).not.toContain('wrong-secret');
    expect(logs.join('\n')).not.toContain('wrong-secret');
  });

  it('an unreachable CRM, a 5xx, a non-JSON answer, an answer without organisations or a slow CRM is a 502', async () => {
    fake.crmOverride = () => ({ status: 500, json: { error: 'db down' } });
    expect((await call('view')).status).toBe(502);
    fake.crmOverride = () => ({ status: 200, raw: '<html>' });
    expect((await call('view')).status).toBe(502);
    fake.crmOverride = () => ({ status: 200, json: { rows: [] } });
    expect((await (await call('view')).json()).error.code).toBe('crm_unavailable');
    fake.crmOverride = () => ({ status: 200, json: { organizations: [] }, delayMs: 400 });
    const slow = await call('view', '/organizations', {}, slowBase);
    expect(slow.status).toBe(502);
    expect((await slow.json()).error.message).toMatch(/didn't answer in time/);
    fake.crmOverride = null;
    process.env.CRM_PLATFORM_URL = 'http://127.0.0.1:9';
    expect((await (await call('view')).json()).error.code).toBe('crm_unavailable');
  });
});

describe('GET /api/platform/crm/organizations/:id', () => {
  it('one organisation, with its platform status', async () => {
    const res = await call('view', '/organizations/org_paused');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platform).toEqual({ ok: true });
    expect(body.organization).toMatchObject({ id: 'org_paused', organization_id: SUSPENDED, status: 'suspended', status_reason: 'Unpaid', leads: 120 });
    expect(fake.crmCalls[0].path).toBe('/crm/api/platform/organizations/org_paused');
  });

  it("CRM's 404 passes through; a bad ID is a 400 without calling CRM", async () => {
    const res = await call('view', '/organizations/org_nope');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: 'not_found', message: 'Organisation not found' });
    fake.crmCalls = [];
    expect((await call('view', '/organizations/a%20b')).status).toBe(400);
    expect(fake.crmCalls).toEqual([]);
  });
});

describe('POST /api/platform/crm/organizations', () => {
  it("creates it in CRM with the staff member's email, and answers 201 with the summary", async () => {
    const res = await create('adm', { ...NEW_ORG, name: '  Acme Insurance ' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.organization).toMatchObject({
      id: 'org_new', name: 'Acme Insurance', slug: 'acme', admin_name: 'Wanjiru Kamau', admin_email: 'wanjiru@acme.co.ke',
      pending_invitations: 1, in_crm: true, organization_id: null, status: null, platform_organization_id: null,
    });
    expect(crmPosts()).toHaveLength(1);
    expect(crmPosts()[0].path).toBe('/crm/api/platform/organizations');
    expect(crmPosts()[0].headers['x-platform-secret']).toBe(CRM_SECRET);
    expect(crmPosts()[0].headers['content-type']).toBe('application/json');
    expect(crmPosts()[0].body).toEqual({ name: 'Acme Insurance', slug: 'acme', adminName: 'Wanjiru Kamau', adminEmail: 'wanjiru@acme.co.ke', staffEmail: 'adm@figbloom.org' });
    // the platform is not involved: CRM registers it itself
    expect(fake.apiCalls).toEqual([]);
  });

  it('leaves the slug out when none is given', async () => {
    expect((await create('own', { ...NEW_ORG, slug: '  ' })).status).toBe(201);
    expect(crmPosts()[0].body).not.toHaveProperty('slug');
  });

  it('only an owner or admin creates', async () => {
    for (const as of ['sup', 'view']) {
      const res = await create(as, NEW_ORG);
      expect(res.status).toBe(403);
      expect((await res.json()).error.message).toBe('Only an owner or admin can create a CRM organisation.');
    }
    expect((await create('company-admin', NEW_ORG)).status).toBe(403);
    expect(crmPosts()).toEqual([]);
  });

  it('checks the fields first, and says which', async () => {
    const res = await create('own', { name: ' ', adminName: '', adminEmail: 'not-an-email', slug: 5 });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe('validation_failed');
    expect(error.field_errors).toEqual([
      { path: 'name', message: 'Required.' },
      { path: 'slug', message: 'Must be text.' },
      { path: 'adminName', message: 'Required.' },
      { path: 'adminEmail', message: 'Enter a valid email address.' },
    ]);
    expect(crmPosts()).toEqual([]);
  });

  it("passes CRM's 409 slug taken through, with the field", async () => {
    const res = await create('own', { ...NEW_ORG, slug: 'figbloom' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({
      code: 'slug_taken', message: 'That slug is taken', field_errors: [{ path: 'slug', message: 'That slug is taken' }],
    });
  });

  it("passes CRM's 400 validation errors through", async () => {
    fake.crmOverride = (method) =>
      method === 'POST'
        ? { status: 400, json: { error: 'Invalid', code: 'VALIDATION_FAILED', message: 'Invalid', fieldErrors: [{ path: 'adminEmail', message: 'Already a member elsewhere' }] } }
        : null;
    const res = await create('own', NEW_ORG);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({
      code: 'validation_failed', message: 'Invalid', field_errors: [{ path: 'adminEmail', message: 'Already a member elsewhere' }],
    });
  });

  it('needs a staff email, and CRM connected', async () => {
    expect((await (await create('no-email', NEW_ORG)).json()).error.code).toBe('no_actor_email');
    process.env.CRM_PLATFORM_URL = '';
    const off = await create('own', NEW_ORG);
    expect(off.status).toBe(503);
    expect((await off.json()).error.code).toBe('crm_not_connected');
    expect(crmPosts()).toEqual([]);
  });

  it('a slow or failing CRM is a 502, and the create is not retried', async () => {
    fake.crmOverride = (method) => (method === 'POST' ? { status: 201, json: { organization: summary('org_slow', 'Slow') }, delayMs: 400 } : null);
    const res = await create('own', NEW_ORG, slowBase);
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toMatch(/didn't answer in time/);
    fake.crmOverride = (method) => (method === 'POST' ? { status: 500, json: { error: 'boom' } } : null);
    expect((await create('own', NEW_ORG)).status).toBe(502);
    expect(crmPosts()).toHaveLength(2);
  });
});

describe('POST /api/platform/crm/organizations/:organizationId/status', () => {
  it("suspends an active organisation on the platform with a reason, recording the caller's email", async () => {
    const res = await decide('own', FIGBLOOM, 'suspend', '  Unpaid invoice ');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ organization: { organization_id: FIGBLOOM, status: 'suspended', status_reason: 'Unpaid invoice' } });
    expect(posts()).toEqual([
      expect.objectContaining({ path: `/organizations/${FIGBLOOM}/status`, body: { status: 'suspended', reason: 'Unpaid invoice', actor_email: 'own@figbloom.org' } }),
    ]);
    // decided on the platform, never by asking CRM
    expect(fake.crmCalls).toEqual([]);
  });

  it('reactivates a suspended one, as an admin', async () => {
    const res = await decide('adm', SUSPENDED, 'reactivate');
    expect(res.status).toBe(200);
    expect((await res.json()).organization).toEqual({ organization_id: SUSPENDED, status: 'active', status_reason: null });
    expect(posts()[0].body).toEqual({ status: 'active', actor_email: 'adm@figbloom.org' });
  });

  it('support and viewers decide nothing (approve_companies)', async () => {
    for (const as of ['sup', 'view']) {
      expect((await decide(as, FIGBLOOM, 'suspend', 'x')).status).toBe(403);
      expect((await decide(as, SUSPENDED, 'reactivate')).status).toBe(403);
    }
    expect(posts()).toEqual([]);
  });

  it('each action only from its own status; nothing to approve or reject', async () => {
    const res = await decide('own', FIGBLOOM, 'reactivate');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code: 'invalid_transition', message: "An active organisation can't be reactivated." });
    expect((await decide('own', SUSPENDED, 'suspend', 'x')).status).toBe(409);
    for (const action of ['approve', 'reject', 'delete']) expect((await (await decide('own', FIGBLOOM, action, 'x')).json()).error.code).toBe('invalid_action');
    expect(posts()).toEqual([]);
  });

  it('needs a reason to suspend, a platform ID of a CRM organisation, and an email', async () => {
    expect((await (await decide('own', FIGBLOOM, 'suspend')).json()).error.code).toBe('reason_required');
    expect((await (await decide('own', FIGBLOOM, 'suspend', '  ')).json()).error.code).toBe('reason_required');
    expect((await decide('own', FIGBLOOM, 'suspend', 'x'.repeat(501))).status).toBe(400);
    expect((await (await decide('own', 'org_figbloom', 'suspend', 'x')).json()).error.code).toBe('invalid_organization_id');
    // not a crm organisation on the platform (another product's, or none)
    expect((await decide('own', '99999999-9999-4999-8999-999999999999', 'suspend', 'x')).status).toBe(404);
    expect((await (await decide('no-email', FIGBLOOM, 'suspend', 'x')).json()).error.code).toBe('no_actor_email');
    expect(posts()).toEqual([]);
  });

  it("passes the platform's refusal through, and says when it isn't connected", async () => {
    fake.platformOverride = (method) =>
      method === 'POST' ? { status: 409, json: { error: { code: 'invalid_transition', message: 'Already suspended' } } } : null;
    const res = await decide('own', FIGBLOOM, 'suspend', 'x');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('invalid_transition');
    process.env.PLATFORM_API_URL = '';
    const off = await decide('own', FIGBLOOM, 'suspend', 'x');
    expect(off.status).toBe(503);
    expect((await off.json()).error.code).toBe('platform_not_connected');
  });

  it('never sends the token or a secret back', async () => {
    const text = await (await decide('own', FIGBLOOM, 'suspend', 'x')).text();
    expect(text).not.toMatch(/tok-\d/);
    expect(text).not.toContain(CLIENT_SECRET);
    expect(text).not.toContain(CRM_SECRET);
    expect(text).not.toContain('deliveries');
  });
});
