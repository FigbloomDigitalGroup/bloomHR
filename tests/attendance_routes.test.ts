// @vitest-environment node
//
// The staff portal's clock through the server (attendance_routes.js, FIG-1200), run through the real app: the sign-in
// is checked, the address is the one the request came from (the proxy's headers believed only on Vercel), the browser
// can't name its own address, and the company's refusal comes back as 403 with its reason. The database function is
// stood in for here; supabase/tests/attendance_clock_in_policy.test.ts checks what it does.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Row }[],
  refuse: null as null | { message: string; code: string; hint?: string },
  profiles: [{ user_id: 'u1', role: 'STAFF', account_status: 'ACTIVE', tenant_id: 't1', company_role_id: null }] as Row[],
}));

vi.mock('@supabase/supabase-js', () => {
  const table = (rows: () => Row[]) => {
    const filters: ((r: Row) => boolean)[] = [];
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
        return b;
      },
      maybeSingle: async () => ({ data: rows().find((r) => filters.every((f) => f(r))) ?? null, error: null }),
    };
    return b;
  };
  const rpc = async (fn: string, args: Row) => {
    state.calls.push({ fn, args });
    if (state.refuse) return { data: null, error: state.refuse };
    return { data: { employee_number: 'A-1', clock_in: '2026-10-22T05:00:00Z', place: 'office' }, error: null };
  };
  return {
    createClient: () => ({
      rpc,
      auth: { getUser: async (token: string) => ({ data: { user: token === 'good' ? { id: 'u1', email: 'a@a.co' } : null }, error: null }) },
      from: (name: string) => {
        if (name === 'user_profiles') return table(() => state.profiles);
        throw new Error(`unexpected table ${name}`);
      },
    }),
  };
});

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

let server: Server;
let base: string;
let routes: typeof import('../attendance_routes.js');

beforeAll(async () => {
  const { buildApp } = await import('../app.js');
  routes = await import('../attendance_routes.js');
  server = createServer(buildApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/attendance`;
});
afterAll(() => server.close());

beforeEach(() => {
  state.calls = [];
  state.refuse = null;
  delete process.env.VERCEL;
  delete process.env.ATTENDANCE_TRUST_PROXY;
});

const clock = (body: unknown, headers: Record<string, string> = {}, token = 'good') =>
  fetch(`${base}/clock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });

describe('POST /api/attendance/clock', () => {
  it('clocks the signed-in person in, with their location and the address the request came from', async () => {
    process.env.VERCEL = '1';
    const res = await clock({ action: 'in', location: { latitude: -1.28, longitude: 36.82, accuracy: 12.4, extra: 'x' }, ip: '41.90.12.7' },
      { 'x-real-ip': '102.68.0.44', 'x-forwarded-for': '9.9.9.9' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ place: 'office' });
    expect(state.calls).toEqual([{
      fn: 'attendance_clock_for_user',
      args: { p_user: 'u1', p_kind: 'in', p_location: { latitude: -1.28, longitude: 36.82, accuracy: 12 }, p_ip: '102.68.0.44' },
    }]);
  });

  it('never believes the browser: an address in the body, or proxy headers off Vercel, are ignored', async () => {
    const res = await clock({ action: 'out', ip: '41.90.12.7' }, { 'x-real-ip': '41.90.12.7', 'x-forwarded-for': '41.90.12.7' });
    expect(res.status).toBe(200);
    expect(state.calls[0].args.p_ip).toBe('127.0.0.1');
    expect(state.calls[0].args.p_location).toBeNull();
  });

  it('answers the company’s refusal with 403 and its reason', async () => {
    state.refuse = { message: 'Clock in at the office scanner', code: 'P0001', hint: 'clock_policy' };
    const res = await clock({ action: 'in' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Clock in at the office scanner', reason: 'clock_policy' });
  });

  it('passes the database’s other refusals on as 409', async () => {
    state.refuse = { message: "You haven't clocked in today", code: 'P0001' };
    const res = await clock({ action: 'out' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "You haven't clocked in today" });
  });

  it('refuses without a valid sign-in, and an unknown action', async () => {
    expect((await clock({ action: 'in' }, {}, 'bad')).status).toBe(401);
    expect((await clock({ action: 'sideways' })).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
});

describe('helpers', () => {
  it('clientIp: proxy headers only on Vercel or when told to trust the proxy; IPv4-mapped addresses plain', () => {
    const req = { headers: { 'x-real-ip': '41.90.12.7', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, socket: { remoteAddress: '::ffff:10.0.0.5' } };
    expect(routes.clientIp(req, {})).toBe('10.0.0.5');
    expect(routes.clientIp(req, { VERCEL: '1' })).toBe('41.90.12.7');
    expect(routes.clientIp({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } }, { ATTENDANCE_TRUST_PROXY: '1' })).toBe('1.1.1.1');
    expect(routes.clientIp({ headers: {} }, {})).toBeNull();
  });

  it('cleanLocation keeps numbers only', () => {
    expect(routes.cleanLocation({ latitude: '1', longitude: 2 })).toEqual({ latitude: 1, longitude: 2 });
    expect(routes.cleanLocation({ latitude: 91, longitude: 2 })).toBeNull();
    expect(routes.cleanLocation('here')).toBeNull();
  });
});
