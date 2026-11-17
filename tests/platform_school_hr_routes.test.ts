// @vitest-environment node
//
// HR & Payroll per school in the console (platform_school_hr_routes.js): each school's state from the platform (off,
// enabling, on), and Enable (Owner/Admin only) switching the hr module on with the school's admins from Figbloom
// Schools and the caller's email. The platform, its token endpoint and Schools' platform-schools function are one fake
// HTTP server here.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

const OFF = '11111111-1111-4111-8111-111111111111';
const ENABLING = '22222222-2222-4222-8222-222222222222';
const ON = '33333333-3333-4333-8333-333333333333';

const tenantsById: Record<string, Row> = {};
const fake = {
  apiCalls: [] as { method: string; path: string; body: Row }[],
  schools: [] as Row[],
  schoolsDown: false,
};

let fakeServer: Server;
let server: Server;
let base: string;

const resetTenants = () => {
  for (const k of Object.keys(tenantsById)) delete tenantsById[k];
  Object.assign(tenantsById, {
    [OFF]: { id: OFF, name: 'Hillside Primary', modules: [{ module: 'schools', status: 'active' }], links: [{ module: 'schools', local_tenant_id: 'school-off', local_slug: 'hillside' }] },
    [ENABLING]: { id: ENABLING, name: 'Lakeview', modules: [{ module: 'hr', status: 'active' }], links: [{ module: 'schools', local_tenant_id: 'school-enabling' }] },
    [ON]: { id: ON, name: 'Riverside', modules: [{ module: 'hr', status: 'active' }],
      links: [{ module: 'schools', local_tenant_id: 'school-on' }, { module: 'hr', local_tenant_id: 'hr-tenant-9', local_slug: 'riverside' }] },
  });
};

beforeAll(async () => {
  fakeServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.url === '/oauth2/token') return reply(200, { access_token: 'tok', expires_in: 3600 });
      if (req.url === '/functions/v1/platform-schools') {
        if (fake.schoolsDown) return reply(500, {});
        return reply(200, { generated_at: 'now', schools: fake.schools });
      }
      const body = raw ? JSON.parse(raw) : {};
      fake.apiCalls.push({ method: req.method || '', path: req.url || '', body });
      if (req.method === 'GET' && req.url?.startsWith('/organizations?')) {
        // the list carries each school's links, not its modules
        const tenants = Object.values(tenantsById).map((t) => ({ id: t.id, name: t.name, links: t.links }));
        return reply(200, { organizations: [{ id: 'org-1', name: 'Group', tenants }], counts: {} });
      }
      const m = req.url?.match(/^\/tenants\/([^/]+)(\/modules\/hr)?$/);
      if (m && tenantsById[m[1]]) {
        const t = tenantsById[m[1]];
        if (req.method === 'GET' && !m[2]) return reply(200, { tenant: { id: t.id, name: t.name }, modules: t.modules, links: t.links });
        if (req.method === 'PUT' && m[2]) {
          t.modules = [...(t.modules as Row[]), { module: 'hr', status: body.status }];
          return reply(201, { module: { module: 'hr', status: body.status } });
        }
      }
      return reply(404, { error: { code: 'not_found', message: 'Not found' } });
    });
  });
  await new Promise<void>((resolve) => fakeServer.listen(0, resolve));
  const fakeUrl = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`;
  process.env.PLATFORM_API_URL = fakeUrl;
  process.env.PLATFORM_TOKEN_URL = `${fakeUrl}/oauth2/token`;
  process.env.PLATFORM_CONSOLE_CLIENT_ID = 'console-client';
  process.env.PLATFORM_CONSOLE_CLIENT_SECRET = 'console-secret-0123456789';
  process.env.SCHOOLS_PLATFORM_URL = fakeUrl;
  process.env.SCHOOLS_PLATFORM_SECRET = 'schools-secret-0123456789';

  const express = (await import('express')).default;
  const mod = await import('../platform_school_hr_routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/platform/school-hr', mod.default);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  state.authUsers = [
    { id: 'owner', email: 'owner@figbloom.org' },
    { id: 'support', email: 'support@figbloom.org' },
  ];
  state.platform_admins = [
    { user_id: 'owner', role: 'owner' },
    { user_id: 'support', role: 'support' },
  ];
});
afterAll(() => {
  server?.close();
  fakeServer?.close();
});

beforeEach(() => {
  resetTenants();
  fake.apiCalls = [];
  fake.schoolsDown = false;
  fake.schools = [
    { id: 'school-off', name: 'Hillside Primary', admin_email: 'Head@Hillside.ac.ke' },
    { id: 'school-enabling', name: 'Lakeview', admin_email: 'admin@lakeview.figbloom.internal' },
  ];
});

const call = (method: string, path: string, user = 'owner') =>
  fetch(`${base}/api/platform/school-hr${path}`, { method, headers: { authorization: `Bearer ${user}` } });

describe('the HR state of each school', () => {
  it('on when HR is linked, enabling when the module is on without a link, off otherwise', async () => {
    const res = await call('GET', '');
    expect(res.status).toBe(200);
    const { schools } = (await res.json()) as { schools: Row[] };
    const states = Object.fromEntries(schools.map((s) => [s.schools_tenant_id, (s.hr as Row).state]));
    expect(states).toEqual({ 'school-off': 'off', 'school-enabling': 'enabling', 'school-on': 'on' });
    expect(schools.find((s) => s.platform_tenant_id === ON)?.hr).toEqual({ state: 'on', module_status: null, hr_tenant_id: 'hr-tenant-9' });
    // linked schools aren't asked about again
    expect(fake.apiCalls.filter((c) => c.path === `/tenants/${ON}`)).toHaveLength(0);
  });

  it('needs a platform admin', async () => {
    expect((await call('GET', '', 'stranger')).status).toBe(401);
  });
});

describe('Enable', () => {
  it('needs approve_companies (Owner or Admin)', async () => {
    const res = await call('POST', `/${OFF}/enable`, 'support');
    expect(res.status).toBe(403);
    expect(fake.apiCalls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('switches hr on with the school\'s real admin email from Schools and the caller\'s email', async () => {
    const res = await call('POST', `/${OFF}/enable`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { school: { hr: Row } }).school.hr.state).toBe('enabling');
    expect(fake.apiCalls.filter((c) => c.method === 'PUT')).toEqual([{
      method: 'PUT', path: `/tenants/${OFF}/modules/hr`,
      body: { status: 'active', admins: [{ email: 'head@hillside.ac.ke', name: null, role: 'school_admin' }], actor_email: 'owner@figbloom.org' },
    }]);
  });

  it("uses Schools' admins list when it sends one: real emails only, once each, at most 20, with their names", async () => {
    fake.schools = [{
      id: 'school-off', name: 'Hillside Primary', admin_email: 'head@hillside.ac.ke',
      admins: [
        { email: 'Bursar@Hillside.ac.ke', name: ' Jane Bursar ', role: 'bursar' },
        { email: 'bursar@hillside.ac.ke', name: 'Again', role: 'school_admin' },
        { email: 'login42@hillside.figbloom.internal', name: 'Login', role: 'school_admin' },
        { email: 'Head@hillside.ac.ke', name: 'Head Teacher', role: 'school_admin' },
        ...Array.from({ length: 25 }, (_, i) => ({ email: `admin${i}@hillside.ac.ke`, name: null, role: 'school_admin' })),
      ],
    }];
    await call('POST', `/${OFF}/enable`);
    const [put] = fake.apiCalls.filter((c) => c.method === 'PUT');
    const admins = put.body.admins as Row[];
    expect(admins).toHaveLength(20);
    expect(admins.slice(0, 3)).toEqual([
      { email: 'bursar@hillside.ac.ke', name: 'Jane Bursar', role: 'bursar' },
      { email: 'head@hillside.ac.ke', name: 'Head Teacher', role: 'school_admin' },
      { email: 'admin0@hillside.ac.ke', name: null, role: 'school_admin' },
    ]);
    expect(new Set(admins.map((a) => a.email)).size).toBe(20);
  });

  it('a made-up login email, or Schools not answering, sends no admins (HR & Payroll is still switched on)', async () => {
    await call('POST', `/${ENABLING}/enable`);
    fake.schoolsDown = true;
    await call('POST', `/${OFF}/enable`);
    expect(fake.apiCalls.filter((c) => c.method === 'PUT').map((c) => c.body.admins)).toEqual([[], []]);
  });

  it('already on: nothing is sent', async () => {
    const res = await call('POST', `/${ON}/enable`);
    expect(res.status).toBe(200);
    expect(fake.apiCalls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('refuses an ID that isn\'t the platform\'s', async () => {
    expect((await call('POST', '/school-off/enable')).status).toBe(400);
  });
});
