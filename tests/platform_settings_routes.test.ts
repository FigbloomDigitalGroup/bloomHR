// @vitest-environment node
//
// The platform's auto-approve switch per product in the console (platform_settings_routes.js). The caller is a signed-in
// platform admin: anyone sees the switches, Owner/Admin change them. Changes go to the platform's PUT
// /settings/auto-approve with the module, the caller's email (actor_email) and the reason. Cognito's token endpoint and
// the platform API are one fake HTTP server here, answering as the platform README says.
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

const fake = {
  apiCalls: [] as { method: string; path: string; headers: IncomingMessage['headers']; body: Row }[],
  global: false,
  own: {} as Record<string, boolean | null>,
  override: null as null | ((method: string, path: string) => { status: number; json?: unknown } | null),
};
let fakeServer: Server;
let fakeUrl: string;
let server: Server;
let base: string;
let mod: typeof import('../platform_settings_routes.js');
let groups: typeof import('../platform_school_groups_routes.js');
const logs: string[] = [];

const products = ['accounting', 'cctv', 'crm', 'fleet', 'hr', 'inventory', 'property', 'schools', 'smart_cart'];
const settings = () => ({
  auto_approve: fake.global,
  products: products.map((m) => {
    const own = fake.own[m] ?? null;
    return { module: m, name: m, auto_approve: own, effective: own ?? fake.global, inherited: own === null };
  }),
});

beforeAll(async () => {
  fakeServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.url === '/oauth2/token') return reply(200, { access_token: 'tok-1', expires_in: 3600 });
      const body = raw ? JSON.parse(raw) : {};
      fake.apiCalls.push({ method: req.method || '', path: req.url || '', headers: req.headers, body });
      const o = fake.override?.(req.method || '', req.url || '');
      if (o) return reply(o.status, o.json);
      if (req.method === 'GET' && req.url === '/settings') return reply(200, settings());
      if (req.method === 'PUT' && req.url === '/settings/auto-approve') {
        fake.own[body.module] = body.enabled;
        return reply(200, { module: body.module, auto_approve: body.enabled });
      }
      return reply(404, { error: { code: 'not_found', message: 'Not found' } });
    });
  });
  await new Promise<void>((resolve) => fakeServer.listen(0, resolve));
  fakeUrl = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`;

  const express = (await import('express')).default;
  mod = await import('../platform_settings_routes.js');
  groups = await import('../platform_school_groups_routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/platform/settings', mod.default);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/platform/settings`;
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
  fake.apiCalls = [];
  fake.global = false;
  fake.own = {};
  fake.override = null;
  process.env.PLATFORM_API_URL = fakeUrl;
  process.env.PLATFORM_TOKEN_URL = `${fakeUrl}/oauth2/token`;
  process.env.PLATFORM_CONSOLE_CLIENT_ID = CLIENT_ID;
  process.env.PLATFORM_CONSOLE_CLIENT_SECRET = CLIENT_SECRET;
  groups.resetPlatformToken();
  logs.length = 0;
  for (const level of ['error', 'warn', 'log', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const line of logs) {
    expect(line).not.toContain(CLIENT_SECRET);
    expect(line).not.toMatch(/tok-\d/);
  }
});

const call = (as: string | null, path = '/auto-approve', init: { method?: string; body?: unknown } = {}) =>
  fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(as ? { authorization: `Bearer ${as}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const put = (as: string, module: string, body: unknown) => call(as, `/auto-approve/${module}`, { method: 'PUT', body });
const puts = () => fake.apiCalls.filter((c) => c.method === 'PUT');

describe('GET /api/platform/settings/auto-approve', () => {
  it("shows HR, Schools and Fleet: each one's own switch, the one in effect, and whether it follows the default", async () => {
    fake.global = true;
    fake.own = { fleet: false };
    const res = await call('view');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      default: true,
      can_change: false,
      products: [
        { module: 'hr', label: 'Figbloom HR', own: null, effective: true, inherited: true },
        { module: 'schools', label: 'Figbloom Schools', own: null, effective: true, inherited: true },
        { module: 'fleet', label: 'Figbloom Fleet', own: false, effective: false, inherited: false },
      ],
    });
    expect(fake.apiCalls[0].headers.authorization).toBe('Bearer tok-1');
  });

  it('says who may change them', async () => {
    for (const [who, can] of [['own', true], ['adm', true], ['sup', false], ['view', false]] as const) {
      expect((await (await call(who)).json()).can_change).toBe(can);
    }
  });

  it('refuses anyone who is not a platform admin', async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call('company-admin')).status).toBe(403);
    expect(fake.apiCalls).toEqual([]);
  });

  it("passes on the platform's errors as the console's", async () => {
    fake.override = () => ({ status: 500, json: {} });
    const res = await call('own');
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('platform_unavailable');
    delete process.env.PLATFORM_API_URL;
    expect((await call('own')).status).toBe(503);
  });
});

describe('PUT /api/platform/settings/auto-approve/:module', () => {
  it('switches Fleet on, naming the person and the reason, and answers the settings now', async () => {
    const res = await put('adm', 'fleet', { enabled: true, reason: '  No real clients to vet yet ' });
    expect(res.status).toBe(200);
    expect(puts()).toEqual([
      expect.objectContaining({
        path: '/settings/auto-approve',
        body: { module: 'fleet', enabled: true, reason: 'No real clients to vet yet', actor_email: 'adm@figbloom.org' },
      }),
    ]);
    const body = await res.json();
    expect(body.products.find((p: Row) => p.module === 'fleet')).toEqual({ module: 'fleet', label: 'Figbloom Fleet', own: true, effective: true, inherited: false });
    expect(body.products.find((p: Row) => p.module === 'schools')).toMatchObject({ effective: false, inherited: true });
  });

  it('sets a product back to the platform default with null, without a reason', async () => {
    fake.own = { hr: true };
    const res = await put('own', 'hr', { enabled: null });
    expect(res.status).toBe(200);
    expect(puts()[0].body).toEqual({ module: 'hr', enabled: null, actor_email: 'own@figbloom.org' });
    expect((await res.json()).products[0]).toMatchObject({ module: 'hr', own: null, inherited: true });
  });

  it('lets only owners and admins change one', async () => {
    for (const who of ['sup', 'view', 'company-admin']) {
      const res = await put(who, 'fleet', { enabled: true });
      expect(res.status).toBe(403);
    }
    expect((await put('sup', 'fleet', { enabled: true }).then((r) => r.json())).error.message).toMatch(/Only an owner or admin/);
    expect(puts()).toEqual([]);
  });

  it('refuses other products, bad values, a long reason and a login with no email', async () => {
    expect((await put('own', 'crm', { enabled: true })).status).toBe(400);
    expect((await put('own', 'fleet', { enabled: 'yes' })).status).toBe(400);
    expect((await put('own', 'fleet', {})).status).toBe(400);
    expect((await put('own', 'fleet', { enabled: true, reason: 5 })).status).toBe(400);
    expect((await put('own', 'fleet', { enabled: true, reason: 'x'.repeat(501) })).status).toBe(400);
    const res = await put('no-email', 'fleet', { enabled: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('no_actor_email');
    expect(puts()).toEqual([]);
  });

  it("passes on the platform's 4xx", async () => {
    fake.override = (method) => (method === 'PUT' ? { status: 404, json: { error: { code: 'unknown_product', message: 'No product fleet' } } } : null);
    const res = await put('own', 'fleet', { enabled: true });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'unknown_product', message: 'No product fleet' } });
  });
});

describe('toAutoApprove', () => {
  it('treats anything but a boolean as not set, and a missing answer as the default off', () => {
    expect(mod.toAutoApprove({ auto_approve: true, products: [{ module: 'fleet', auto_approve: 'yes' }] }).products[2]).toEqual({
      module: 'fleet', label: 'Figbloom Fleet', own: null, effective: true, inherited: true,
    });
    expect(mod.toAutoApprove(null)).toMatchObject({ default: false, products: [{ effective: false }, { effective: false }, { effective: false }] });
  });
});
