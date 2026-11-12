// @vitest-environment node
//
// The Figbloom platform's events for HR (platform_events_routes.js, ERP/SCHOOLS_HR_PHASE1_CONTRACT.md section 2): the
// signature over the raw body, the switch, deliveries applied once, what each event does, and HR's outbox. The
// database is a fake store here (its functions are tested on a real schema in supabase/tests/platform_events_schools);
// the platform is a fake client.
import crypto from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

const SECRET = 'whsec-hr-staging-0123456789abcdefghijklmnop';
const CRON = 'cron-secret-0123456789abcdefghijklmnopqrstuv';
const PT = '7a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c10';
const NOW = Date.parse('2026-11-05T10:00:00Z');

type Row = Record<string, unknown>;
type PlatformErrorLike = Error & { status: number; code: string };

let mod: typeof import('../platform_events_routes.js');
let PlatformError: new (status: number, code: string, message: string) => PlatformErrorLike;

// ---- a store that behaves as the database functions do
const db = {
  receipts: new Map<string, Row>(),
  companies: new Map<string, { tenant_id: string; slug: string }>(),
  invites: [] as Row[],
  people: new Map<string, { employee_number: string; fields: Row }>(),
  left: [] as Row[],
  outbox: [] as Row[],
  finished: [] as unknown[][],
  calls: [] as string[],
  sources: [] as string[],
  fail: null as null | { fn: string; error: Error },
};
let next = 0;
const store = {
  getReceipt: async (id: string) => db.receipts.get(id) ?? null,
  saveReceipt: async (r: Row) => {
    if (!db.receipts.has(String(r.delivery_id))) db.receipts.set(String(r.delivery_id), r);
  },
  enableHr: async ({ platformTenantId, name, slug, admins, source }: Row) => {
    db.calls.push('enableHr');
    db.sources.push(String(source));
    if (db.fail?.fn === 'enableHr') throw db.fail.error;
    const found = db.companies.get(String(platformTenantId));
    if (found) return { ...found, name, created: false, invited: 0 };
    const c = { tenant_id: `hr-tenant-${db.companies.size + 1}`, slug: String(slug ?? 'school') };
    db.companies.set(String(platformTenantId), c);
    db.invites.push(...(admins as Row[]));
    return { ...c, name, created: true, invited: (admins as Row[]).length };
  },
  upsertStaff: async (args: Row) => {
    db.calls.push('upsertStaff');
    if (!db.companies.has(String(args.platformTenantId))) throw new mod.EventError(425, 'no_hr_company', 'There is no HR company for this school yet.');
    const key = `${args.platformTenantId}:${args.person}`;
    const found = db.people.get(key);
    if (found) {
      found.fields = { ...found.fields, ...args };
      return { employee_number: found.employee_number, created: false };
    }
    next += 1;
    const employee_number = `MCL-${String(next).padStart(6, '0')}`;
    db.people.set(key, { employee_number, fields: args });
    return { employee_number, created: true };
  },
  staffLeft: async (args: Row) => {
    db.left.push(args);
    const p = db.people.get(`${args.platformTenantId}:${args.person}`);
    return p ? { employee_number: p.employee_number, outcome: 'exit_started' } : { employee_number: null, outcome: 'unknown' };
  },
  claimEvents: async (limit: number) => db.outbox.splice(0, limit),
  finishEvent: async (id: string, ok: boolean, error: string | null = null, retry = true) => {
    db.finished.push([id, ok, error, retry]);
    return ok ? 'sent' : retry ? 'pending' : 'failed';
  },
};

// ---- the platform
const platform = {
  calls: [] as { method: string; path: string; body: unknown }[],
  answer: null as null | ((method: string, path: string) => unknown),
  connected: true,
  call: async (method: string, path: string, body: unknown) => {
    platform.calls.push({ method, path, body });
    const a = platform.answer?.(method, path);
    if (a instanceof Error) throw a;
    return a ?? {};
  },
  configured: () => platform.connected,
  resetToken: () => {},
};

let server: Server;
let base: string;

beforeAll(async () => {
  mod = await import('../platform_events_routes.js');
  PlatformError = (await import('../platform_client.js')).PlatformError as never;
  const express = (await import('express')).default;
  const app = express();
  app.use('/api/platform/events', mod.createPlatformEventsRouter({ store: store as never, platform: platform as never, now: () => NOW }));
  app.use(express.json());
  app.use('/api/platform/outbox', mod.createOutboxRouter({ store: store as never, platform: platform as never }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

beforeEach(() => {
  process.env.PLATFORM_EVENTS_ENABLED = 'true';
  process.env.PLATFORM_WEBHOOK_SECRET = SECRET;
  process.env.PLATFORM_OUTBOX_CRON_SECRET = CRON;
  db.receipts.clear();
  db.companies.clear();
  db.people.clear();
  db.invites = [];
  db.left = [];
  db.outbox = [];
  db.finished = [];
  db.calls = [];
  db.sources = [];
  db.fail = null;
  next = 0;
  platform.calls = [];
  platform.answer = null;
  platform.connected = true;
});

const sign = (ts: string, body: string, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
let deliveries = 0;
const event = (type: string, data: Row, extra: Row = {}) => ({
  event: { type, id: `evt-${type}-${deliveries}`, occurred_at: '2026-11-05T09:59:00Z', source: type.split('.')[0], platform_tenant_id: PT, tenant_local_id: null, data, ...extra },
  delivered_at: '2026-11-05T10:00:00Z',
});

async function deliver(body: unknown, { delivery, ts = String(Math.floor(NOW / 1000)), signature, raw }: { delivery?: string; ts?: string; signature?: string; raw?: string } = {}) {
  deliveries += 1;
  const text = raw ?? JSON.stringify(body);
  const res = await fetch(`${base}/api/platform/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-figbloom-signature': signature ?? sign(ts, text),
      'x-figbloom-timestamp': ts,
      'x-figbloom-delivery': delivery ?? `dlv-${deliveries}`,
      'x-figbloom-event': (body as { event?: { type?: string } })?.event?.type ?? '',
    },
    body: text,
  });
  return { status: res.status, json: (await res.json()) as Row };
}

const enabled = (extra: Row = {}) =>
  event('platform.module.enabled', {
    module: 'hr',
    tenant: { name: 'Hillside Primary', slug: 'hillside-primary', country: 'KE' },
    organization: { id: 'org-1', name: 'Hillside Group' },
    admins: [{ email: 'Head@Hillside.ac.ke', name: 'Head', role: 'school_admin' }, { email: 'nope' }],
    requested_by: 'console:michael@figbloom.org',
    ...extra,
  });
const staff = (type: string, data: Row = {}) =>
  event(type, { person_id: 'person-1', full_name: 'Grace Wanjiru Otieno', phone: '+254 712 345 678', email: 'grace@school.figbloom.internal', role: 'teacher', job_title: 'Class teacher', ...data });

describe('signature', () => {
  it('verifySignature: the platform\'s HMAC over "<ts>.<body>", within 5 minutes, nothing else', () => {
    const ts = String(Math.floor(NOW / 1000));
    const body = '{"event":{}}';
    const ok = { secret: SECRET, rawBody: body, signature: sign(ts, body), timestamp: ts, nowMs: NOW };
    expect(mod.verifySignature(ok)).toBe(true);
    expect(mod.signBody(SECRET, ts, body)).toBe(sign(ts, body));
    expect(mod.verifySignature({ ...ok, rawBody: '{"event":{} }' })).toBe(false);
    expect(mod.verifySignature({ ...ok, secret: 'another-secret' })).toBe(false);
    expect(mod.verifySignature({ ...ok, signature: sign(ts, body).slice(0, -2) })).toBe(false);
    expect(mod.verifySignature({ ...ok, signature: sign(ts, body).replace('sha256=', 'sha1=') })).toBe(false);
    expect(mod.verifySignature({ ...ok, nowMs: NOW + 301 * 1000 })).toBe(false);
    expect(mod.verifySignature({ ...ok, nowMs: NOW - 301 * 1000 })).toBe(false);
    expect(mod.verifySignature({ ...ok, nowMs: NOW + 299 * 1000 })).toBe(true);
    expect(mod.verifySignature({ ...ok, timestamp: `${ts}.5` })).toBe(false);
    expect(mod.verifySignature({ ...ok, secret: '' })).toBe(false);
    expect(mod.verifySignature({ ...ok, signature: undefined as never })).toBe(false);
  });

  it('refuses a bad signature, an old timestamp or a changed body with 401, and applies nothing', async () => {
    const body = enabled();
    const ts = String(Math.floor(NOW / 1000));
    expect((await deliver(body, { signature: sign(ts, JSON.stringify(body), 'wrong') })).status).toBe(401);
    const old = String(Math.floor(NOW / 1000) - 6 * 60);
    expect((await deliver(body, { ts: old, signature: sign(old, JSON.stringify(body)) })).status).toBe(401);
    expect((await deliver(body, { signature: sign(ts, JSON.stringify(body)), raw: `${JSON.stringify(body)} ` })).status).toBe(401);
    expect(db.calls).toEqual([]);
    expect(db.receipts.size).toBe(0);
  });

  it('a signed body that is not an event is a 400', async () => {
    expect((await deliver(null, { raw: 'not json' })).status).toBe(400);
    expect((await deliver({ nothing: true })).status).toBe(400);
  });
});

describe('the switch', () => {
  it('off: 503, so the platform tries again later; nothing is applied', async () => {
    process.env.PLATFORM_EVENTS_ENABLED = 'false';
    const r = await deliver(enabled());
    expect(r.status).toBe(503);
    expect(r.json).toEqual({ error: { code: 'events_off', message: expect.any(String) } });
    delete process.env.PLATFORM_EVENTS_ENABLED;
    expect((await deliver(enabled())).status).toBe(503);
    expect(db.calls).toEqual([]);
  });

  it('on but without the secret: 503 too', async () => {
    delete process.env.PLATFORM_WEBHOOK_SECRET;
    expect((await deliver(enabled())).status).toBe(503);
    expect(db.calls).toEqual([]);
  });
});

describe('deliveries are applied once', () => {
  it('a repeated x-figbloom-delivery answers 200 and applies nothing again', async () => {
    const first = await deliver(staff('schools.staff.created'), { delivery: 'dlv-same' });
    expect(first.status).toBe(425); // no company yet: not kept, so it is applied when delivered again
    await deliver(enabled());
    const ok = await deliver(staff('schools.staff.created'), { delivery: 'dlv-same' });
    expect(ok.status).toBe(200);
    const again = await deliver(staff('schools.staff.created'), { delivery: 'dlv-same' });
    expect(again).toEqual({ status: 200, json: { ok: true, duplicate: true, result: 'created MCL-000001' } });
    expect(db.calls.filter((c) => c === 'upsertStaff')).toHaveLength(2);
  });

  it('needs a delivery id', async () => {
    expect((await deliver(enabled(), { delivery: '' })).status).toBe(400);
  });

  it('an unknown event type is acknowledged (200) and ignored', async () => {
    const r = await deliver(event('schools.timetable.changed', {}));
    expect(r).toEqual({ status: 200, json: { ok: true, result: 'ignored' } });
    expect(db.calls).toEqual([]);
    expect([...db.receipts.values()][0]).toMatchObject({ event_type: 'schools.timetable.changed', result: 'ignored' });
  });
});

describe('platform.module.enabled', () => {
  it('creates the HR company, invites the admins with valid emails, then links it on the platform', async () => {
    const r = await deliver(enabled());
    expect(r.status).toBe(200);
    expect(db.invites).toEqual([{ email: 'head@hillside.ac.ke' }]);
    expect(platform.calls).toEqual([
      { method: 'PUT', path: `/tenants/${PT}/links/hr`, body: { local_tenant_id: 'hr-tenant-1', local_slug: 'hillside-primary' } },
    ]);
    expect([...db.receipts.values()][0]).toMatchObject({ event_type: 'platform.module.enabled', event_id: expect.stringMatching(/^evt-/) });
  });

  it('a repeat (a new delivery of the same) re-sends nothing and links again', async () => {
    await deliver(enabled());
    const again = await deliver(enabled());
    expect(again.status).toBe(200);
    expect(again.json.result).toMatch(/already there, linked again/);
    expect(db.companies.size).toBe(1);
    expect(db.invites).toHaveLength(1);
    expect(platform.calls.map((c) => c.path)).toEqual([`/tenants/${PT}/links/hr`, `/tenants/${PT}/links/hr`]);
  });

  it('when the link fails, answers 502 and keeps no receipt, so the platform delivers it again', async () => {
    platform.answer = () => new PlatformError(502, 'platform_unavailable', 'down');
    const r = await deliver(enabled(), { delivery: 'dlv-link' });
    expect(r.status).toBe(502);
    expect(db.receipts.has('dlv-link')).toBe(false);
    platform.answer = null;
    expect((await deliver(enabled(), { delivery: 'dlv-link' })).status).toBe(200);
    expect(db.invites).toHaveLength(1);
  });

  it('for another module: 200, ignored', async () => {
    const r = await deliver(enabled({ module: 'fleet' }));
    expect(r.json.result).toMatch(/ignored/);
    expect(db.calls).toEqual([]);
  });

  it('without a platform tenant or a school name: 400', async () => {
    expect((await deliver(event('platform.module.enabled', { module: 'hr', tenant: { name: 'X School' } }, { platform_tenant_id: 'nope' }))).status).toBe(400);
    expect((await deliver(enabled({ tenant: {} }))).status).toBe(400);
  });
});

describe('schools.staff.*', () => {
  it('staffToEmployee: names split, phone tidied, a made-up login email dropped, the job title', () => {
    expect(mod.staffToEmployee({ full_name: '  Grace  Wanjiru Akinyi Otieno ', phone: '+254 (712) 345-678', email: 'g@school.figbloom.internal', role: 'teacher', job_title: 'Class teacher' }))
      .toEqual({ first: 'Grace', middle: 'Wanjiru Akinyi', last: 'Otieno', phone: '+254712345678', email: null, job_title: 'Class teacher' });
    expect(mod.staffToEmployee({ full_name: 'Juma', phone: null, email: 'Juma@Gmail.com ', role: 'school_admin' }))
      .toEqual({ first: 'Juma', middle: null, last: null, phone: null, email: 'juma@gmail.com', job_title: 'School admin' });
    expect(mod.staffToEmployee({ full_name: 'A B', email: 'not-an-email' }).email).toBeNull();
    expect(mod.realEmail('x@example.com')).toBeNull();
  });

  it('created: a draft employee from the mapped fields; updated: the same one; never by email', async () => {
    await deliver(enabled());
    const created = await deliver(staff('schools.staff.created'));
    expect(created.json.result).toBe('created MCL-000001');
    const p = db.people.get(`${PT}:person-1`)!;
    expect(p.fields).toMatchObject({ first: 'Grace', middle: 'Wanjiru', last: 'Otieno', phone: '+254712345678', email: null, jobTitle: 'Class teacher' });
    const updated = await deliver(staff('schools.staff.updated', { full_name: 'Grace Achieng' }));
    expect(updated.json.result).toBe('updated MCL-000001');
    // someone else, with the same (real) email: another person, another employee
    const other = await deliver(staff('schools.staff.created', { person_id: 'person-2', email: 'grace@gmail.com' }));
    expect(other.json.result).toBe('created MCL-000002');
  });

  it('for a school with no HR company yet: 425, so the platform tries again later', async () => {
    const r = await deliver(staff('schools.staff.created'));
    expect(r.status).toBe(425);
    expect(r.json).toMatchObject({ error: { code: 'no_hr_company' } });
  });

  it('without a person or a name: 400', async () => {
    await deliver(enabled());
    expect((await deliver(staff('schools.staff.created', { person_id: '' }))).status).toBe(400);
    expect((await deliver(staff('schools.staff.updated', { full_name: '  ' }))).status).toBe(400);
  });

  it('left: starts HR\'s exit with the day they left; a bad date is a 400', async () => {
    await deliver(enabled());
    await deliver(staff('schools.staff.created'));
    const r = await deliver(event('schools.staff.left', { person_id: 'person-1', left_on: '2026-11-04' }));
    expect(r.json.result).toBe('exit_started MCL-000001');
    expect(db.left).toEqual([{ platformTenantId: PT, source: 'schools', person: 'person-1', leftOn: '2026-11-04' }]);
    expect((await deliver(event('schools.staff.left', { person_id: 'person-1', left_on: '4/11/2026' }))).status).toBe(400);
  });

  it('a database failure is a 500 (tried again), with no receipt', async () => {
    db.fail = { fn: 'enableHr', error: new Error('connection reset') };
    const r = await deliver(enabled(), { delivery: 'dlv-db' });
    expect(r.status).toBe(500);
    expect(db.receipts.has('dlv-db')).toBe(false);
  });
});

describe('Figbloom Fleet (fleet.staff.*, ERP/FLEET_HR_CONTRACT.md)', () => {
  const fleetEnabled = (extra: Row = {}) =>
    event('platform.module.enabled', {
      module: 'hr',
      tenant: { name: 'Swift Haulage', slug: 'swift-haulage', country: 'KE' },
      admins: [{ email: 'owner@swift.co.ke', name: 'Owen Owner', role: 'fleet_owner' }],
      ...extra,
    });
  const driver = (type: string, data: Row = {}) =>
    event(type, { person_id: 'ckdriver0001', full_name: 'Dan Kamau', phone: '+254 700 000 001', email: null, role: 'DRIVER', job_title: null, ...data });

  it('enabledSource: the platform\'s word, else Fleet\'s admins, else schools', () => {
    expect(mod.enabledSource({ source: 'fleet' })).toBe('fleet');
    expect(mod.enabledSource({ admins: [{ role: 'fleet_owner' }] })).toBe('fleet');
    expect(mod.enabledSource({ admins: [{ role: 'school_admin' }] })).toBe('schools');
    expect(mod.enabledSource({})).toBe('schools');
  });

  it('module.enabled for a Fleet company passes source fleet; a school still passes schools', async () => {
    await deliver(fleetEnabled());
    await deliver(enabled(), {});
    expect(db.sources).toEqual(['fleet', 'schools']);
  });

  it('created / updated / left: mapped with source fleet, the role in words as the job title', async () => {
    await deliver(fleetEnabled());
    const created = await deliver(driver('fleet.staff.created'));
    expect(created.json.result).toBe('created MCL-000001');
    expect(db.people.get(`${PT}:ckdriver0001`)!.fields).toMatchObject({ source: 'fleet', first: 'Dan', last: 'Kamau', jobTitle: 'Driver', phone: '+254700000001' });
    expect((await deliver(driver('fleet.staff.updated', { full_name: 'Daniel Kamau' }))).json.result).toBe('updated MCL-000001');
    const left = await deliver(event('fleet.staff.left', { person_id: 'ckdriver0001', left_on: '2026-11-10' }));
    expect(left.json.result).toBe('exit_started MCL-000001');
    expect(db.left).toEqual([{ platformTenantId: PT, source: 'fleet', person: 'ckdriver0001', leftOn: '2026-11-10' }]);
  });

  it('before HR is switched on: 425; another product\'s staff events: ignored', async () => {
    expect((await deliver(driver('fleet.staff.created'))).status).toBe(425);
    const other = await deliver(event('crm.staff.created', { person_id: 'x', full_name: 'X' }));
    expect(other.json).toMatchObject({ ok: true, result: 'ignored' });
  });
});

describe('the outbox (hr.employee.left)', () => {
  const flush = (secret: string | null = CRON) =>
    fetch(`${base}/api/platform/outbox/flush`, { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {} });
  const left = (id: string) => ({
    id, tenant_id: 'hr-tenant-1', event_type: 'hr.employee.left', occurred_at: '2026-11-05T09:00:00Z',
    data: { employee_number: 'MCL-000001', external_id: 'person-1', left_on: '2026-11-04' }, attempts: 1,
  });

  it('needs the cron secret', async () => {
    expect((await flush(null)).status).toBe(403);
    expect((await flush('wrong')).status).toBe(403);
  });

  it('off, or without the HR client: 503, and nothing is claimed', async () => {
    db.outbox = [left('e1')];
    process.env.PLATFORM_EVENTS_ENABLED = 'false';
    expect((await flush()).status).toBe(503);
    process.env.PLATFORM_EVENTS_ENABLED = 'true';
    platform.connected = false;
    expect((await flush()).status).toBe(503);
    expect(db.outbox).toHaveLength(1);
  });

  it('sends each event as POST /events with this company as tenant_local_id', async () => {
    db.outbox = [left('e1')];
    const r = await flush();
    expect(await r.json()).toEqual({ ok: true, sent: 1, retrying: 0, failed: 0 });
    expect(platform.calls).toEqual([{
      method: 'POST', path: '/events',
      body: { type: 'hr.employee.left', id: 'e1', occurred_at: '2026-11-05T09:00:00.000Z', tenant_local_id: 'hr-tenant-1',
        data: { employee_number: 'MCL-000001', external_id: 'person-1', left_on: '2026-11-04' } },
    }]);
    expect(db.finished).toEqual([['e1', true, null, true]]);
  });

  it('retries what may work later; a refusal is final', async () => {
    db.outbox = [left('e1'), left('e2'), left('e3')];
    platform.answer = (_m, _p) => {
      const n = platform.calls.length;
      if (n === 1) return new PlatformError(502, 'platform_unavailable', 'down');
      if (n === 2) return new PlatformError(403, 'forbidden', 'This client speaks for hr');
      return new PlatformError(429, 'too_many', 'slow down');
    };
    expect(await (await flush()).json()).toEqual({ ok: true, sent: 0, retrying: 2, failed: 1 });
    expect(db.finished.map(([id, , , retry]) => [id, retry])).toEqual([['e1', true], ['e2', false], ['e3', true]]);
    expect(mod.retryable(new PlatformError(404, 'tenant_not_found', 'x'))).toBe(true);
    expect(mod.retryable(new PlatformError(400, 'invalid', 'x'))).toBe(false);
    expect(mod.retryable(new Error('network'))).toBe(true);
  });
});
