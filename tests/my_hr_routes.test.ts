// @vitest-environment node
//
// "My HR" for Figbloom Schools staff (my_hr_routes.js, ERP/SCHOOLS_HR_PHASE2_CONTRACT.md section 2): the switch, the
// platform token (signature, issuer, client, expiry, access not id), the school's link (cached), the person only
// through external_people, a draft employee, each route's answer and that it is for that one employee, the rate limit,
// the audit, and that no token reaches a log. The token is checked for real (jose, with keys made here); the database
// is a fake store (its functions run on a real schema in supabase/tests/my_hr_api.test.ts); the platform a fake client.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { achievement as portalAchievement, overallScore as portalOverall } from '../src/lib/kpis';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

const ISSUER = 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_TESTPOOL';
const SCHOOLS_CLIENT = 'schools-client-id';
const PT = '7a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c10';
const PT_OTHER = '8b2c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c11';
const HR_CO = '1b1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c20';
const HR_OTHER = '2b1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c21';
const SCHOOL = '3c1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c30';
const SCHOOL_OTHER = '4c1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c31';
const SCHOOL_UNLINKED = '5c1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c32';
const SCHOOL_MISMATCH = '6c1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c33';
const MARY = 'a0000000-0000-4000-8000-000000000001'; // linked, approved (E1)
const NEW = 'a0000000-0000-4000-8000-000000000002'; // linked, draft (E3)
const STRANGER = 'a0000000-0000-4000-8000-000000000003'; // not linked
const OTHER_PERSON = 'a0000000-0000-4000-8000-000000000004'; // linked in the other company (its E1)
const PAYSLIP = 'b0000000-0000-4000-8000-000000000001';
// Figbloom Fleet (ERP/FLEET_HR_CONTRACT.md): its own client, cuid ids
const FLEET_CLIENT = 'fleet-client-id';
const PT_FLEET = '9d2c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c12';
const HR_FLEET = '3b1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c22';
const FLEET_CO = 'clx0company0000000000001';
const DRIVER = 'clx0driver00000000000001';

type Row = Record<string, unknown>;
let mod: typeof import('../my_hr_routes.js');
let PlatformError: new (status: number, code: string, message: string) => Error;

// ---- keys: the platform's and an attacker's
let sign: (claims: Row, opts?: { key?: 'platform' | 'attacker'; exp?: string | number; iss?: string }) => Promise<string>;
let keys: ReturnType<typeof createLocalJWKSet>;

// ---- a store that behaves as the database functions do
type Emp = { tenant: string; number: string; onboarding: string };
const people = new Map<string, Emp>(); // `${tenant}|${person}` -> employee
const companies = new Map<string, string>(); // HR company -> platform tenant
const calls: Row[] = [];
const sources: unknown[] = [];
const logRows: Row[] = [];
const store = {
  person: async ({ tenantId, platformTenantId, externalId, source }: Row) => {
    calls.push({ fn: 'person', tenantId, platformTenantId, externalId });
    sources.push(source);
    if (companies.get(String(tenantId)) !== platformTenantId) return { outcome: 'unknown_company' };
    const e = people.get(`${tenantId}|${externalId}`);
    if (!e) return { outcome: 'not_linked' };
    return { outcome: 'found', employee_number: e.number, onboarding_status: e.onboarding, employment_status: 'Active' };
  },
  summary: async ({ tenantId, employee }: Row) => {
    calls.push({ fn: 'summary', tenantId, employee });
    return { employee: { employee_number: employee, name: `Name of ${employee}@${tenantId}` }, company: { name: 'Hillside Primary' }, latest_payslip: null, leave_pending: 0 };
  },
  payslips: async ({ tenantId, employee }: Row) => {
    calls.push({ fn: 'payslips', tenantId, employee });
    return tenantId === HR_CO && employee === 'E1' ? [{ id: PAYSLIP, pay_period: '2026-01', net_pay: 80000, run_status: 'approved' }] : [];
  },
  payslip: async ({ tenantId, employee, id }: Row) => {
    calls.push({ fn: 'payslip', tenantId, employee, id });
    return tenantId === HR_CO && employee === 'E1' && id === PAYSLIP ? { id: PAYSLIP, employee_id: 'E1', pay_period: '2026-01', gross_pay: 100000, net_pay: 80000 } : null;
  },
  leave: async ({ tenantId, employee }: Row) => {
    calls.push({ fn: 'leave', tenantId, employee });
    return { leave_types: [{ id: 't1', name: 'Annual Leave' }], balances: [{ leave_type: 'Annual Leave', available_days: 18, pending_days: 3 }], applications: [] };
  },
  attendance: async ({ tenantId, employee, from, to }: Row) => {
    calls.push({ fn: 'attendance', tenantId, employee, from, to });
    return { from, to, days: [{ day: from, status: 'present', late_minutes: 0 }], possible_absence_notices: [], missed_scan_requests: [], absences_recorded: [] };
  },
  kpis: async ({ tenantId, employee }: Row) => {
    calls.push({ fn: 'kpis', tenantId, employee });
    return {
      period: { id: 'p1', name: 'Term 1', status: 'open' },
      items: [
        { name: 'Lessons', unit: 'number', direction: 'higher_is_better', target: '10', weight: '60', actual_value: '8', auto_value: null },
        { name: 'Late days', unit: 'number', direction: 'lower_is_better', target: '2', weight: '40', actual_value: null, auto_value: '4' },
      ],
      attendance: { present: 40, late: 4, absent: 1 },
    };
  },
  log: async (entry: Row) => {
    logRows.push(entry);
  },
};

// ---- the platform's /links/resolve
const platform = {
  calls: [] as string[],
  down: false,
  call: async (_method: string, path: string) => {
    platform.calls.push(path);
    if (platform.down) throw new PlatformError(502, 'platform_unavailable', 'down');
    const school = new URL(path, 'https://p.invalid').searchParams.get('local_id');
    if (school === SCHOOL) return { platform_tenant_id: PT, module: 'schools', local_id: SCHOOL, caller_local_id: HR_CO };
    if (school === SCHOOL_OTHER) return { platform_tenant_id: PT_OTHER, module: 'schools', local_id: SCHOOL_OTHER, caller_local_id: HR_OTHER };
    // the platform says HR_CO, but HR_CO is another platform tenant's company here
    if (school === FLEET_CO && path.includes('module=fleet')) return { platform_tenant_id: PT_FLEET, module: 'fleet', local_id: FLEET_CO, caller_local_id: HR_FLEET };
    if (school === SCHOOL_MISMATCH) return { platform_tenant_id: PT_OTHER, module: 'schools', local_id: SCHOOL_MISMATCH, caller_local_id: HR_CO };
    throw new PlatformError(404, 'not_found', 'Not found');
  },
  configured: () => true,
  resetToken: () => {},
};

let limitOn = false;
const limited = new Map<string, number>();
let server: Server;
let base: string;
const logged: string[] = [];
let links: ReturnType<typeof import('../my_hr_routes.js')['createLinkResolver']>;

beforeAll(async () => {
  mod = await import('../my_hr_routes.js');
  PlatformError = (await import('../platform_client.js')).PlatformError as never;
  const platformKeys = await generateKeyPair('RS256');
  const attackerKeys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(platformKeys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' } as JWK;
  keys = createLocalJWKSet({ keys: [jwk] });
  sign = async (claims, { key = 'platform', exp = '1h', iss = ISSUER } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(iss)
      .setIssuedAt(typeof exp === 'number' ? exp - 3600 : undefined)
      .setExpirationTime(exp)
      .sign(key === 'platform' ? platformKeys.privateKey : attackerKeys.privateKey);

  links = mod.createLinkResolver({ platform: platform as never });
  const express = (await import('express')).default;
  const app = express();
  app.use('/api/integrations/my-hr', mod.createMyHrRouter({
    store: store as never,
    links,
    verifyToken: (header: string) => mod.verifySchoolsToken(header, keys),
    rateLimit: async ({ tenantId, employee }: { tenantId: string; employee: string }) => {
      if (!limitOn) return true;
      const k = `${tenantId}:${employee}`;
      limited.set(k, (limited.get(k) ?? 0) + 1);
      return (limited.get(k) ?? 0) <= 2;
    },
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
  process.env.MY_HR_API_ENABLED = 'true';
  process.env.PLATFORM_ISSUER = ISSUER;
  process.env.PLATFORM_SCHOOLS_CLIENT_ID = SCHOOLS_CLIENT;
  companies.clear();
  companies.set(HR_CO, PT);
  companies.set(HR_OTHER, PT_OTHER);
  companies.set(HR_FLEET, PT_FLEET);
  delete process.env.PLATFORM_FLEET_CLIENT_ID;
  sources.length = 0;
  people.clear();
  people.set(`${HR_CO}|${MARY}`, { tenant: HR_CO, number: 'E1', onboarding: 'approved' });
  people.set(`${HR_CO}|${NEW}`, { tenant: HR_CO, number: 'E3', onboarding: 'draft' });
  people.set(`${HR_OTHER}|${OTHER_PERSON}`, { tenant: HR_OTHER, number: 'E1', onboarding: 'approved' });
  people.set(`${HR_FLEET}|${DRIVER}`, { tenant: HR_FLEET, number: 'F1', onboarding: 'approved' });
  calls.length = 0;
  logRows.length = 0;
  platform.calls = [];
  platform.down = false;
  links.clear();
  limitOn = false;
  limited.clear();
});

const access = (extra: Row = {}) => ({ token_use: 'access', client_id: SCHOOLS_CLIENT, scope: 'platform/tenants.read', sub: SCHOOLS_CLIENT, ...extra });
const get = async (path: string, { token, school = SCHOOL, person = MARY }: { token?: string; school?: string; person?: string } = {}) => {
  const t = token ?? (await sign(access()));
  return fetch(`${base}/api/integrations/my-hr/${path}`, {
    headers: { authorization: `Bearer ${t}`, 'x-figbloom-school': school, 'x-figbloom-person': person },
  });
};
const errorCode = async (res: Response) => ((await res.json()) as { error?: { code?: string } }).error?.code;

describe('the switch', () => {
  it('off: 503 and nothing looked up', async () => {
    process.env.MY_HR_API_ENABLED = 'false';
    const res = await get('summary');
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('my_hr_off');
    expect(platform.calls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('not configured (no issuer or client): 503', async () => {
    delete process.env.PLATFORM_SCHOOLS_CLIENT_ID;
    const res = await get('summary');
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('my_hr_not_configured');
  });
});

describe('the token', () => {
  const refused = async (token: string) => {
    const res = await fetch(`${base}/api/integrations/my-hr/summary`, {
      headers: { authorization: `Bearer ${token}`, 'x-figbloom-school': SCHOOL, 'x-figbloom-person': MARY },
    });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('invalid_token');
    expect(platform.calls).toEqual([]);
    expect(calls).toEqual([]);
  };

  it('a valid Schools access token is accepted', async () => {
    expect((await get('summary')).status).toBe(200);
  });
  it('a bad signature (another key) is refused', async () => refused(await sign(access(), { key: 'attacker' })));
  it('a tampered payload is refused', async () => {
    const t = (await sign(access())).split('.');
    const body = JSON.parse(Buffer.from(t[1], 'base64url').toString());
    t[1] = Buffer.from(JSON.stringify({ ...body, client_id: 'x' })).toString('base64url');
    await refused(t.join('.'));
  });
  it('another client\'s token is refused', async () => refused(await sign(access({ client_id: 'hr-client-id' }))));
  it('an expired token is refused', async () => refused(await sign(access(), { exp: Math.floor(Date.now() / 1000) - 600 })));
  it('another issuer is refused', async () => refused(await sign(access(), { iss: 'https://cognito-idp.af-south-1.amazonaws.com/other' })));
  it('an id token is refused', async () => refused(await sign({ token_use: 'id', aud: SCHOOLS_CLIENT, client_id: SCHOOLS_CLIENT })));
  it('no token, or not a JWT, is refused', async () => {
    const res = await fetch(`${base}/api/integrations/my-hr/summary`, { headers: { 'x-figbloom-school': SCHOOL, 'x-figbloom-person': MARY } });
    expect(res.status).toBe(401);
    await refused('not-a-token');
  });
  it('an unsigned token (alg none) is refused', async () => {
    const enc = (o: Row) => Buffer.from(JSON.stringify(o)).toString('base64url');
    await refused(`${enc({ alg: 'none' })}.${enc({ ...access(), iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 600 })}.x`);
  });
});

describe('the school and the person', () => {
  it('missing or malformed headers: 400', async () => {
    expect((await get('summary', { school: 'not-a-uuid' })).status).toBe(400);
    expect((await get('summary', { person: '' })).status).toBe(400);
  });

  it('a school the platform does not link to HR: 403 school_not_linked', async () => {
    const res = await get('summary', { school: SCHOOL_UNLINKED });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('school_not_linked');
    expect(calls).toEqual([]);
  });

  it('the platform\'s company is not that platform tenant\'s here (resolve mismatch): 403', async () => {
    const res = await get('summary', { school: SCHOOL_MISMATCH });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('school_not_linked');
    expect(calls).toEqual([{ fn: 'person', tenantId: HR_CO, platformTenantId: PT_OTHER, externalId: MARY }]);
  });

  it('the platform is down: 502, nothing read', async () => {
    platform.down = true;
    const res = await get('summary');
    expect(res.status).toBe(502);
    expect(calls).toEqual([]);
  });

  it('the link is asked once and kept (10 minutes)', async () => {
    await get('summary');
    await get('payslips');
    await get('leave');
    expect(platform.calls).toEqual([`/links/resolve?module=schools&local_id=${SCHOOL}`]);
  });

  it('the cache expires after 10 minutes', async () => {
    let now = 1_000_000;
    const r = mod.createLinkResolver({ platform: platform as never, now: () => now });
    await r.resolve(SCHOOL);
    now += mod.RESOLVE_CACHE_MS - 1;
    await r.resolve(SCHOOL);
    expect(platform.calls.length).toBe(1);
    now += 2;
    await r.resolve(SCHOOL);
    expect(platform.calls.length).toBe(2);
  });

  it('a person not linked: 404 not_linked', async () => {
    const res = await get('summary', { person: STRANGER });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('not_linked');
  });

  it('a person of another school is not found through this school', async () => {
    const res = await get('payslips', { person: OTHER_PERSON });
    expect(res.status).toBe(404);
    expect(calls.filter((c) => c.fn !== 'person')).toEqual([]);
  });

  it('a draft employee: {status: "pending_hr"} on every route, no data read', async () => {
    for (const path of ['summary', 'payslips', `payslips/${PAYSLIP}`, `payslips/${PAYSLIP}/pdf`, 'leave', 'attendance', 'kpis']) {
      const res = await get(path, { person: NEW });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'pending_hr' });
    }
    expect(calls.filter((c) => c.fn !== 'person')).toEqual([]);
  });

  it('an employee number from the caller is ignored', async () => {
    const t = await sign(access());
    const res = await fetch(`${base}/api/integrations/my-hr/payslips?employee=E2&employee_number=E2`, {
      headers: { authorization: `Bearer ${t}`, 'x-figbloom-school': SCHOOL, 'x-figbloom-person': MARY, 'x-employee-number': 'E2' },
    });
    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.fn === 'payslips')).toEqual([{ fn: 'payslips', tenantId: HR_CO, employee: 'E1' }]);
  });
});

describe('the routes', () => {
  it('summary', async () => {
    const res = await get('summary');
    expect(await res.json()).toEqual({
      status: 'active',
      employee: { employee_number: 'E1', name: `Name of E1@${HR_CO}` },
      company: { name: 'Hillside Primary' },
      latest_payslip: null,
      leave_pending: 0,
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('payslips: that employee in that company', async () => {
    const res = await get('payslips');
    expect(await res.json()).toEqual({ status: 'active', payslips: [{ id: PAYSLIP, pay_period: '2026-01', net_pay: 80000, run_status: 'approved' }] });
    // the other school's E1 gets their own company's (none here), never HR_CO's
    const other = await get('payslips', { school: SCHOOL_OTHER, person: OTHER_PERSON });
    expect(await other.json()).toEqual({ status: 'active', payslips: [] });
    expect(calls.filter((c) => c.fn === 'payslips')).toEqual([
      { fn: 'payslips', tenantId: HR_CO, employee: 'E1' },
      { fn: 'payslips', tenantId: HR_OTHER, employee: 'E1' },
    ]);
  });

  it('one payslip; another\'s or an unknown id is 404', async () => {
    const res = await get(`payslips/${PAYSLIP}`);
    expect(await res.json()).toEqual({ status: 'active', payslip: { id: PAYSLIP, employee_id: 'E1', pay_period: '2026-01', gross_pay: 100000, net_pay: 80000 } });
    expect((await get(`payslips/${PAYSLIP}`, { school: SCHOOL_OTHER, person: OTHER_PERSON })).status).toBe(404);
    expect((await get('payslips/b0000000-0000-4000-8000-000000000099')).status).toBe(404);
    expect((await get('payslips/not-an-id')).status).toBe(404);
  });

  it('the payslip PDF: 501, HR has no server-side PDF; the data is at payslips/:id', async () => {
    const res = await get(`payslips/${PAYSLIP}/pdf`);
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ error: { code: 'pdf_not_available' }, payslip_url: `payslips/${PAYSLIP}` });
    expect((await get('payslips/b0000000-0000-4000-8000-000000000099/pdf')).status).toBe(404);
  });

  it('leave', async () => {
    expect(await (await get('leave')).json()).toEqual({
      status: 'active',
      leave_types: [{ id: 't1', name: 'Annual Leave' }],
      balances: [{ leave_type: 'Annual Leave', available_days: 18, pending_days: 3 }],
      applications: [],
    });
  });

  it('attendance: the range asked for, the last 30 days by default, at most 93', async () => {
    const res = await get('attendance?from=2026-03-01&to=2026-03-31');
    expect(await res.json()).toMatchObject({ status: 'active', from: '2026-03-01', to: '2026-03-31', days: [{ day: '2026-03-01', status: 'present' }] });
    await get('attendance');
    const last = calls.filter((c) => c.fn === 'attendance').pop()!;
    expect(new Date(`${last.to}T00:00:00Z`).getTime() - new Date(`${last.from}T00:00:00Z`).getTime()).toBe(29 * 86400000);
    expect((await get('attendance?from=2026-01-01&to=2026-06-01')).status).toBe(400);
    expect((await get('attendance?from=2026-03-10&to=2026-03-01')).status).toBe(400);
    expect((await get('attendance?from=2026-02-30')).status).toBe(400);
    expect((await get('attendance?from=yesterday')).status).toBe(400);
  });

  it('kpis: with the staff portal\'s scores', async () => {
    const body = (await (await get('kpis')).json()) as { items: { achievement: number | null; actual: number | null }[]; overall: unknown; attendance: unknown };
    expect(body.items.map((i) => [i.actual, i.achievement])).toEqual([[8, 80], [4, 50]]);
    expect(body.overall).toEqual({ score: 68, scored: 2, total: 2 });
    expect(body.attendance).toEqual({ present: 40, late: 4, absent: 1 });
  });

  it('unknown routes: 404', async () => {
    expect((await get('loans')).status).toBe(404);
  });
});

describe('KPI scores match the staff portal (src/lib/kpis.ts)', () => {
  it('for every kind of KPI', () => {
    const cases = [
      { unit: 'number', direction: 'higher_is_better', target: 10, actual: 8 },
      { unit: 'number', direction: 'higher_is_better', target: 10, actual: 30 },
      { unit: 'number', direction: 'higher_is_better', target: 0, actual: 1 },
      { unit: 'number', direction: 'lower_is_better', target: 2, actual: 4 },
      { unit: 'number', direction: 'lower_is_better', target: 2, actual: 0 },
      { unit: 'number', direction: 'lower_is_better', target: 0, actual: 0 },
      { unit: 'yes_no', direction: 'higher_is_better', target: null, actual: 1 },
      { unit: 'yes_no', direction: 'lower_is_better', target: null, actual: 1 },
      { unit: 'rating_1_5', direction: 'higher_is_better', target: null, actual: 4 },
      { unit: 'percent', direction: 'higher_is_better', target: null, actual: 50 },
      { unit: 'percent', direction: 'higher_is_better', target: 80, actual: null },
    ] as const;
    for (const c of cases) expect(mod.achievement(c as never)).toBe(portalAchievement(c as never));
    const items = [{ weight: 60, achievement: 80 }, { weight: 40, achievement: 50 }, { weight: 0, achievement: 100 }, { weight: 10, achievement: null }];
    expect(mod.overallScore(items)).toEqual(portalOverall(items));
  });
});

describe('the rate limit', () => {
  it('per person: over the budget is 429', async () => {
    limitOn = true;
    expect((await get('summary')).status).toBe(200);
    expect((await get('summary')).status).toBe(200);
    const res = await get('summary');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
    // someone else still gets in
    expect((await get('summary', { school: SCHOOL_OTHER, person: OTHER_PERSON })).status).toBe(200);
  });
});

describe('the audit and the logs', () => {
  it('every call is audited: route, company, employee number, status; no payload', async () => {
    await get('payslips');
    await get('summary', { person: NEW });
    await get('summary', { person: STRANGER });
    expect(logRows).toEqual([
      { route: 'payslips', status: 200, outcome: 'ok', tenantId: HR_CO, employee: 'E1' },
      { route: 'summary', status: 200, outcome: 'pending_hr', tenantId: HR_CO, employee: 'E3' },
      { route: 'summary', status: 404, outcome: 'not_linked', tenantId: HR_CO },
    ]);
  });

  it('calls refused before the company is known are not written to the per-company table', async () => {
    await get('summary', { token: await sign(access(), { key: 'attacker' }) });
    await get('summary', { school: SCHOOL_UNLINKED });
    process.env.MY_HR_API_ENABLED = 'false';
    await get('summary');
    expect(logRows).toEqual([]);
    expect(logged.some((l) => l.includes('[my-hr] summary 401 invalid_token'))).toBe(true);
  });

  it('no token, header or answer ever reaches a log', async () => {
    logged.length = 0;
    const tokens = [await sign(access()), await sign(access(), { key: 'attacker' }), await sign(access({ client_id: 'x' }))];
    for (const t of tokens) {
      await get('payslips', { token: t });
      await get(`payslips/${PAYSLIP}`, { token: t });
      await get('payslips', { token: t, person: STRANGER });
    }
    platform.down = true;
    links.clear();
    await get('summary', { token: tokens[0] });
    const all = logged.join('\n') + JSON.stringify(logRows);
    for (const t of tokens) {
      expect(all).not.toContain(t);
      expect(all).not.toContain(t.split('.')[2]);
    }
    expect(all).not.toContain('Bearer');
    expect(all).not.toContain('80000');
    expect(all).not.toContain(MARY);
  });
});

describe('Figbloom Fleet (PLATFORM_FLEET_CLIENT_ID)', () => {
  const fleetGet = async (path: string, { client = FLEET_CLIENT, company = FLEET_CO, person = DRIVER, header = 'x-figbloom-company' } = {}) =>
    fetch(`${base}/api/integrations/my-hr/${path}`, {
      headers: { authorization: `Bearer ${await sign(access({ client_id: client, sub: client }))}`, [header]: company, 'x-figbloom-person': person },
    });

  it('productClients: client id -> product, only for the clients set', () => {
    process.env.PLATFORM_FLEET_CLIENT_ID = FLEET_CLIENT;
    expect([...mod.productClients()]).toEqual([[SCHOOLS_CLIENT, 'schools'], [FLEET_CLIENT, 'fleet']]);
    delete process.env.PLATFORM_SCHOOLS_CLIENT_ID;
    expect([...mod.productClients()]).toEqual([[FLEET_CLIENT, 'fleet']]);
  });

  it('a Fleet token is refused while Fleet\'s client isn\'t allowed', async () => {
    const res = await fleetGet('summary');
    expect(res.status).toBe(401);
    expect(platform.calls).toEqual([]);
  });

  it('allowed: the company is resolved as a Fleet one, the person with source fleet', async () => {
    process.env.PLATFORM_FLEET_CLIENT_ID = FLEET_CLIENT;
    const res = await fleetGet('summary');
    expect(res.status).toBe(200);
    expect(platform.calls).toEqual([`/links/resolve?module=fleet&local_id=${FLEET_CO}`]);
    expect(calls[0]).toEqual({ fn: 'person', tenantId: HR_FLEET, platformTenantId: PT_FLEET, externalId: DRIVER });
    expect(sources).toEqual(['fleet']);
    // x-figbloom-tenant works too
    expect((await fleetGet('summary', { header: 'x-figbloom-tenant' })).status).toBe(200);
  });

  it('Schools\' token still resolves Schools people with source schools', async () => {
    process.env.PLATFORM_FLEET_CLIENT_ID = FLEET_CLIENT;
    expect((await get('summary')).status).toBe(200);
    expect(sources).toEqual(['schools']);
  });

  it('the product comes from the token, never the headers: Schools\' token with Fleet ids is not Fleet', async () => {
    process.env.PLATFORM_FLEET_CLIENT_ID = FLEET_CLIENT;
    const res = await fleetGet('summary', { client: SCHOOLS_CLIENT, header: 'x-figbloom-school' });
    expect(res.status).toBe(400); // cuids aren't Schools ids
    expect(platform.calls).toEqual([]);
  });

  it('a company the platform does not link: 403 company_not_linked; malformed ids: 400', async () => {
    process.env.PLATFORM_FLEET_CLIENT_ID = FLEET_CLIENT;
    const res = await fleetGet('summary', { company: 'clx0unknown0000000000001' });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('company_not_linked');
    expect((await fleetGet('summary', { person: 'a b' })).status).toBe(400);
    expect((await fleetGet('summary', { company: '' })).status).toBe(400);
  });
});
