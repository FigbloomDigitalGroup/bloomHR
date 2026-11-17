// @vitest-environment node
//
// Figbloom Schools in the console (platform_schools_routes.js, ERP/SCHOOLS_CONSOLE_CONTRACT.md). The caller is a
// signed-in platform admin whose console role allows the action; the backend calls Schools' platform-schools function
// with the shared secret. Schools is a fake HTTP server here, answering as the contract says.
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

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const SCHOOL_ID = '6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
const school = (extra: Row = {}) => ({
  id: SCHOOL_ID, name: 'Kilimani Secondary', slug: 'kilimani-secondary', status: 'active', status_reason: null,
  organization: { id: '11111111-2222-3333-4444-555555555555', name: 'Group' }, created_at: '2026-09-14T08:00:00Z',
  admin_email: 'head@school.ac.ke', students: 412, teachers: 23, parents: 380, last_activity_at: '2026-11-01T17:22:00Z',
  ...extra,
});

// the fake Schools function
const schools = {
  calls: [] as { path: string; headers: IncomingMessage['headers']; body: Row }[],
  answer: (_body: Row): { status: number; json?: unknown; raw?: string; delayMs?: number } => ({ status: 200, json: {} }),
};
let schoolsServer: Server;
let schoolsUrl: string;

let server: Server;
let base: string;
let slowBase: string;
let mod: typeof import('../platform_schools_routes.js');
const logs: string[] = [];

beforeAll(async () => {
  schoolsServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      schools.calls.push({ path: req.url || '', headers: req.headers, body });
      // as the contract: a missing or wrong secret is a 401, whatever else is sent
      if (req.headers['x-platform-secret'] !== SECRET) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'unauthorized', message: 'Bad secret' } }));
        return;
      }
      const a = schools.answer(body);
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(a.status, { 'content-type': 'application/json' });
        res.end(a.raw ?? JSON.stringify(a.json));
      }, a.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => schoolsServer.listen(0, resolve));
  schoolsUrl = `http://127.0.0.1:${(schoolsServer.address() as AddressInfo).port}`;

  const express = (await import('express')).default;
  mod = await import('../platform_schools_routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/platform/schools', mod.default);
  // the same routes with a short timeout, so a slow Schools needn't take 8 seconds here
  app.use('/slow/schools', mod.createSchoolsRouter({ timeoutMs: 150 }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  base = `${root}/api/platform/schools`;
  slowBase = `${root}/slow/schools`;
});
afterAll(() => {
  server.close();
  schoolsServer.closeAllConnections();
  schoolsServer.close();
});

beforeEach(() => {
  state.authUsers = [
    { id: 'own', email: 'own@figbloom.org' },
    { id: 'adm', email: 'adm@figbloom.org' },
    { id: 'sup', email: 'sup@figbloom.org' },
    { id: 'view', email: 'view@figbloom.org' },
    { id: 'company-admin', email: 'admin@a.co' }, // a company's administrator, not a platform admin
  ];
  state.platform_admins = [
    { user_id: 'own', role: 'owner' },
    { user_id: 'adm', role: 'admin' },
    { user_id: 'sup', role: 'support' },
    { user_id: 'view', role: 'viewer' },
  ];
  schools.calls = [];
  schools.answer = (body) =>
    body.action === 'list'
      ? { status: 200, json: { generated_at: '2026-11-02T10:00:00Z', schools: [school()] } }
      : { status: 200, json: { school: school({ status: body.status, status_reason: body.reason ?? null }) } };
  process.env.SCHOOLS_PLATFORM_URL = `${schoolsUrl}/`; // a trailing slash is fine
  process.env.SCHOOLS_PLATFORM_SECRET = SECRET;
  logs.length = 0;
  for (const level of ['error', 'warn', 'log', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

const list = (as: string | null, at = base) =>
  fetch(at, { headers: as ? { authorization: `Bearer ${as}` } : {} });
const setStatus = (as: string | null, body: unknown, id = SCHOOL_ID, at = base) =>
  fetch(`${at}/${id}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(as ? { authorization: `Bearer ${as}` } : {}) },
    body: JSON.stringify(body),
  });

/** The response, and a check that the secret is in neither it nor anything logged. */
async function read(res: Response) {
  const text = await res.text();
  expect(text).not.toContain(SECRET);
  expect(logs.join('\n')).not.toContain(SECRET);
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('GET /api/platform/schools', () => {
  it('needs a signed-in platform admin', async () => {
    expect(await read(await list(null))).toEqual({ status: 401, body: { error: { code: 'unauthorized', message: 'Missing bearer token' } } });
    expect((await read(await list('nobody'))).status).toBe(401);
    const company = await read(await list('company-admin'));
    expect(company.status).toBe(403);
    expect(company.body.error.code).toBe('forbidden');
    expect(schools.calls).toEqual([]);
  });

  it.each(['own', 'adm', 'sup', 'view'])('lists the schools for every role (%s), as Schools sends them', async (as) => {
    const { status, body } = await read(await list(as));
    expect(status).toBe(200);
    expect(body).toEqual({ generated_at: '2026-11-02T10:00:00Z', schools: [school()] });
  });

  it("calls Schools' platform-schools function with the shared secret and action list", async () => {
    await read(await list('view'));
    expect(schools.calls).toHaveLength(1);
    const [call] = schools.calls;
    expect(call.path).toBe('/functions/v1/platform-schools');
    expect(call.headers['x-platform-secret']).toBe(SECRET);
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.body).toEqual({ action: 'list' });
  });

  it.each([
    ['SCHOOLS_PLATFORM_URL'],
    ['SCHOOLS_PLATFORM_SECRET'],
  ])('is 503 schools_not_connected when %s is unset, without calling Schools', async (name) => {
    delete process.env[name];
    const { status, body } = await read(await list('own'));
    expect(status).toBe(503);
    expect(body.error.code).toBe('schools_not_connected');
    expect(body.error.message).toMatch(/isn't connected yet/);
    expect(schools.calls).toEqual([]);
  });

  it('checks the caller before saying whether Schools is connected', async () => {
    delete process.env.SCHOOLS_PLATFORM_URL;
    expect((await read(await list(null))).status).toBe(401);
  });

  it('is 502 schools_unavailable when Schools does not answer in time', async () => {
    schools.answer = () => ({ status: 200, json: { schools: [] }, delayMs: 1000 });
    const started = Date.now();
    const { status, body } = await read(await list('own', slowBase));
    expect(status).toBe(502);
    expect(body.error.code).toBe('schools_unavailable');
    expect(Date.now() - started).toBeLessThan(900);
  });

  it('waits 8 seconds for Schools', () => {
    expect(mod.SCHOOLS_TIMEOUT_MS).toBe(8000);
  });

  it('is 502 schools_unavailable when Schools cannot be reached', async () => {
    process.env.SCHOOLS_PLATFORM_URL = 'http://127.0.0.1:9';
    const { status, body } = await read(await list('own'));
    expect(status).toBe(502);
    expect(body.error.code).toBe('schools_unavailable');
  });

  it('is 502 when Schools fails (5xx) or answers without JSON', async () => {
    schools.answer = () => ({ status: 500, json: { error: { code: 'boom', message: 'Internal' } } });
    expect((await read(await list('own'))).body.error.code).toBe('schools_unavailable');
    schools.answer = () => ({ status: 200, raw: '<html>not json</html>' });
    const r = await read(await list('own'));
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe('schools_unavailable');
  });

  it('is 502 (a setting to fix, not the session) when Schools refuses the secret', async () => {
    process.env.SCHOOLS_PLATFORM_SECRET = 'not-the-secret-not-the-secret-not-the-secret';
    const { status, body } = await read(await list('own'));
    expect(status).toBe(502);
    expect(body.error.code).toBe('schools_unavailable');
    expect(JSON.stringify(body)).not.toContain('not-the-secret');
  });

  it("passes Schools' 4xx answers through with their code and message", async () => {
    schools.answer = () => ({ status: 400, json: { error: { code: 'bad_action', message: 'Unknown action' }, extra: 'dropped' } });
    expect(await read(await list('own'))).toEqual({ status: 400, body: { error: { code: 'bad_action', message: 'Unknown action' } } });
  });
});

describe('POST /api/platform/schools/:id/status', () => {
  it('needs a signed-in platform admin', async () => {
    expect((await read(await setStatus(null, { status: 'active' }))).status).toBe(401);
    expect((await read(await setStatus('company-admin', { status: 'active' }))).status).toBe(403);
    expect(schools.calls).toEqual([]);
  });

  it.each([
    ['own', 200],
    ['adm', 200],
    ['sup', 200],
    ['view', 403],
  ])('needs suspend_companies: %s gets %i', async (as, expected) => {
    const { status, body } = await read(await setStatus(as, { status: 'suspended', reason: 'Unpaid invoice' }));
    expect(status).toBe(expected);
    if (expected === 403) {
      expect(body.error.code).toBe('forbidden');
      expect(schools.calls).toEqual([]);
    } else {
      expect(body.school.status).toBe('suspended');
    }
  });

  it("suspends with the reason, the caller's email as actor_email, and the secret", async () => {
    const { status, body } = await read(await setStatus('sup', { status: 'suspended', reason: '  Unpaid invoice  ' }));
    expect(status).toBe(200);
    expect(body).toEqual({ school: school({ status: 'suspended', status_reason: 'Unpaid invoice' }) });
    expect(schools.calls).toHaveLength(1);
    expect(schools.calls[0].path).toBe('/functions/v1/platform-schools');
    expect(schools.calls[0].headers['x-platform-secret']).toBe(SECRET);
    expect(schools.calls[0].body).toEqual({
      action: 'set_status', school_id: SCHOOL_ID, status: 'suspended', reason: 'Unpaid invoice', actor_email: 'sup@figbloom.org',
    });
  });

  it('reactivates with or without a reason', async () => {
    expect((await read(await setStatus('own', { status: 'active' }))).status).toBe(200);
    expect(schools.calls[0].body).toEqual({ action: 'set_status', school_id: SCHOOL_ID, status: 'active', actor_email: 'own@figbloom.org' });
    expect((await read(await setStatus('own', { status: 'active', reason: 'Paid' }))).status).toBe(200);
    expect(schools.calls[1].body.reason).toBe('Paid');
  });

  it.each([
    ['a non-UUID id', { status: 'active' }, 'not-a-uuid', 'invalid_school_id'],
    ['no status', {}, SCHOOL_ID, 'invalid_status'],
    ['another status', { status: 'deleted' }, SCHOOL_ID, 'invalid_status'],
    ['a status that is not text', { status: ['active'] }, SCHOOL_ID, 'invalid_status'],
    ['suspending without a reason', { status: 'suspended' }, SCHOOL_ID, 'reason_required'],
    ['suspending with a blank reason', { status: 'suspended', reason: '   ' }, SCHOOL_ID, 'reason_required'],
    ['a reason over 500 characters', { status: 'suspended', reason: 'x'.repeat(501) }, SCHOOL_ID, 'invalid_reason'],
    ['a reason that is not text', { status: 'active', reason: 42 }, SCHOOL_ID, 'invalid_reason'],
  ])('refuses %s (400) without calling Schools', async (_what, body, id, code) => {
    const r = await read(await setStatus('own', body, id));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe(code);
    expect(schools.calls).toEqual([]);
  });

  it('takes a reason of exactly 500 characters', async () => {
    expect((await read(await setStatus('own', { status: 'suspended', reason: 'x'.repeat(500) }))).status).toBe(200);
  });

  it.each([
    [404, 'school_not_found', 'No such school'],
    [409, 'already_in_status', 'The school is already suspended'],
    [422, 'status_not_allowed', "That status can't be set from here"],
    [400, 'bad_input', 'Reason is required'],
  ])("passes Schools' %i through with its code and message", async (code, errorCode, message) => {
    schools.answer = () => ({ status: code, json: { error: { code: errorCode, message } } });
    expect(await read(await setStatus('own', { status: 'suspended', reason: 'Unpaid' }))).toEqual({
      status: code,
      body: { error: { code: errorCode, message } },
    });
  });

  it('is 503 when Schools is not connected', async () => {
    delete process.env.SCHOOLS_PLATFORM_SECRET;
    const r = await read(await setStatus('own', { status: 'active' }));
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('schools_not_connected');
  });

  it('is 502 when Schools times out', async () => {
    schools.answer = () => ({ status: 200, json: { school: school() }, delayMs: 1000 });
    const r = await read(await setStatus('own', { status: 'active' }, SCHOOL_ID, slowBase));
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe('schools_unavailable');
  });
});
