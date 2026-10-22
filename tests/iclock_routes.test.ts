// @vitest-environment node
//
// The door scanner receiver (iclock_routes.js), run through the real app: the push protocol's answers (the hello's
// settings, "OK: <lines>" for punches, "OK" for everything else and for unknown scanners), bodies read as text whatever
// their content type, the scanner's address (the relay's header believed only with its secret), and "ERROR" when the
// database can't take the punches so the scanner sends them again. The database functions are stood in for here;
// supabase/tests/attendance_scanners.test.ts checks what they do.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  known: new Set<string>(),
  calls: [] as { fn: string; args: Row }[],
  fail: false,
}));

vi.mock('@supabase/supabase-js', () => {
  const rpc = async (fn: string, args: Row) => {
    state.calls.push({ fn, args });
    if (state.fail) return { data: null, error: { message: 'database down' } };
    const accepted = state.known.has(String(args.p_serial));
    if (fn === 'attendance_scanner_seen') return { data: { accepted }, error: null };
    if (fn === 'attendance_scanner_receive') return { data: { accepted, received: 2, stored: accepted ? 2 : 0, applied: 0, unmatched: 0 }, error: null };
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  };
  return { createClient: () => ({ rpc, auth: { getUser: async () => ({ data: { user: null }, error: null }) } }) };
});

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

let server: Server;
let base: string;
let routes: typeof import('../iclock_routes.js');

beforeAll(async () => {
  const { buildApp } = await import('../app.js');
  routes = await import('../iclock_routes.js');
  server = createServer(buildApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/iclock`;
});
afterAll(() => server.close());

beforeEach(() => {
  state.known = new Set(['BRAV260421021']);
  state.calls = [];
  state.fail = false;
  delete process.env.ICLOCK_RELAY_SECRET;
});

const PUNCHES = '6\t2026-10-22 07:55:12\t0\t1\t0\t0\t0\n7\t2026-10-22 08:01:00\t0\t1\t0\t0\t0\n';
const text = async (res: Response) => ({ status: res.status, type: res.headers.get('content-type'), body: await res.text() });

describe('the push protocol', () => {
  it('answers a registered scanner’s hello with its settings', async () => {
    const res = await text(await fetch(`${base}/cdata?SN=BRAV260421021&options=all&pushver=2.2.14&language=69`, { headers: { 'x-real-ip': '41.90.12.34' } }));
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/^text\/plain/);
    expect(res.body.split('\n')).toEqual([
      'GET OPTION FROM: BRAV260421021',
      'ATTLOGStamp=None',
      'OPERLOGStamp=9999',
      'ATTPHOTOStamp=None',
      'ErrorDelay=30',
      'Delay=30',
      'TransTimes=00:00;14:05',
      'TransInterval=1',
      'TransFlag=TransData AttLog',
      'TimeZone=3',
      'Realtime=1',
      'Encrypt=None',
    ]);
    expect(state.calls).toEqual([{ fn: 'attendance_scanner_seen', args: { p_serial: 'BRAV260421021', p_ip: '41.90.12.34' } }]);
  });

  it('stores punches and answers with the number of lines, whatever the content type (or none)', async () => {
    for (const headers of [{ 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/octet-stream' }, { 'Content-Type': 'application/json' }, {}] as Record<string, string>[]) {
      state.calls = [];
      const res = await text(await fetch(`${base}/cdata?SN=brav260421021&table=ATTLOG&Stamp=9999`, { method: 'POST', headers, body: PUNCHES }));
      expect(res).toMatchObject({ status: 200, body: 'OK: 2' });
      expect(state.calls).toHaveLength(1);
      expect(state.calls[0]).toMatchObject({ fn: 'attendance_scanner_receive', args: { p_serial: 'BRAV260421021', p_lines: PUNCHES } });
    }
  });

  it('acknowledges other tables without storing them', async () => {
    const res = await text(await fetch(`${base}/cdata?SN=BRAV260421021&table=OPERLOG&Stamp=1`, { method: 'POST', body: 'OPLOG 4\t0\t2026-10-22 08:00:00\t0\t0\t0\t0' }));
    expect(res.body).toBe('OK');
    expect(state.calls).toEqual([]);
  });

  it('answers the check-in and command results with OK, the .aspx forms too', async () => {
    expect((await text(await fetch(`${base}/getrequest?SN=BRAV260421021`))).body).toBe('OK');
    expect(state.calls.map((c) => c.fn)).toEqual(['attendance_scanner_seen']);
    expect((await text(await fetch(`${base}/getrequest.aspx?SN=BRAV260421021`))).body).toBe('OK');
    expect((await text(await fetch(`${base}/devicecmd?SN=BRAV260421021`, { method: 'POST', body: 'ID=1&Return=0&CMD=INFO' }))).body).toBe('OK');
    expect((await text(await fetch(`${base}/cdata.aspx?SN=BRAV260421021&options=all`))).body).toMatch(/^GET OPTION FROM: BRAV260421021\n/);
    expect((await text(await fetch(`${base}/ping?SN=BRAV260421021`))).body).toBe('OK');
  });

  it('an unknown scanner just gets OK (its hello is recorded, nothing it sends is kept)', async () => {
    const hello = await text(await fetch(`${base}/cdata?SN=NEW0000001&options=all`));
    expect(hello.body).toBe('OK');
    const upload = await text(await fetch(`${base}/cdata?SN=NEW0000001&table=ATTLOG`, { method: 'POST', body: PUNCHES }));
    expect(upload).toMatchObject({ status: 200, body: 'OK' });
    expect(state.calls.map((c) => c.fn)).toEqual(['attendance_scanner_seen', 'attendance_scanner_receive']);
  });

  it('a missing or junk serial never reaches the database', async () => {
    expect((await text(await fetch(`${base}/cdata?options=all`))).body).toBe('OK');
    expect((await text(await fetch(`${base}/cdata?SN=${encodeURIComponent("x'; drop")}&table=ATTLOG`, { method: 'POST', body: PUNCHES }))).body).toBe('OK');
    expect(state.calls).toEqual([]);
  });

  it('when the database can’t take the punches the scanner is told to send them again', async () => {
    state.fail = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await text(await fetch(`${base}/cdata?SN=BRAV260421021&table=ATTLOG`, { method: 'POST', body: PUNCHES }));
    expect(res).toMatchObject({ status: 503, body: 'ERROR' });
    // logged without the punches
    expect(errors.mock.calls.flat().join(' ')).not.toContain('07:55');
    expect((await text(await fetch(`${base}/getrequest?SN=BRAV260421021`))).body).toBe('OK');
    errors.mockRestore();
  });

  it('doesn’t disturb the API next to it', async () => {
    const res = await fetch(`${base.replace('/iclock', '/api')}/does-not-exist`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});

describe('where the scanner is calling from', () => {
  const lastIp = () => state.calls.at(-1)?.args.p_ip;
  const hello = (headers: Record<string, string>) => fetch(`${base}/getrequest?SN=BRAV260421021`, { headers });

  it('directly: Vercel’s x-real-ip, else the first x-forwarded-for', async () => {
    await hello({ 'x-real-ip': '41.90.12.34', 'x-forwarded-for': '1.1.1.1' });
    expect(lastIp()).toBe('41.90.12.34');
    await hello({ 'x-forwarded-for': '41.90.12.35, 10.0.0.1' });
    expect(lastIp()).toBe('41.90.12.35');
  });

  it('through the relay with its secret: CloudFront’s viewer address, without the port', async () => {
    process.env.ICLOCK_RELAY_SECRET = 'relay-secret';
    await hello({ 'x-figbloom-relay': 'relay-secret', 'cloudfront-viewer-address': '41.90.12.36:46532', 'x-real-ip': '3.3.3.3' });
    expect(lastIp()).toBe('41.90.12.36');
    await hello({ 'x-figbloom-relay': 'relay-secret', 'cloudfront-viewer-address': '2001:db8::7:46532', 'x-real-ip': '3.3.3.3' });
    expect(lastIp()).toBe('2001:db8::7');
  });

  it('never believes the viewer address without the right secret, or when no secret is set', async () => {
    await hello({ 'x-figbloom-relay': '', 'cloudfront-viewer-address': '41.90.12.36:1', 'x-real-ip': '5.5.5.5' });
    expect(lastIp()).toBe('5.5.5.5');
    await hello({ 'x-figbloom-relay': 'anything', 'cloudfront-viewer-address': '41.90.12.36:1', 'x-real-ip': '5.5.5.5' });
    expect(lastIp()).toBe('5.5.5.5');
    process.env.ICLOCK_RELAY_SECRET = 'relay-secret';
    await hello({ 'x-figbloom-relay': 'relay-secreT', 'cloudfront-viewer-address': '41.90.12.36:1', 'x-real-ip': '5.5.5.5' });
    expect(lastIp()).toBe('5.5.5.5');
  });

  it('helpers', () => {
    expect(routes.stripPort('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(routes.stripPort('198.51.100.10')).toBe('198.51.100.10');
    expect(routes.relaySecretMatches('a', '')).toBe(false);
    expect(routes.readSerial({ SN: ['  abc123 ', 'x'] })).toBe('ABC123');
    expect(routes.countLines('a\r\n\r\nb\n \n')).toBe(2);
  });
});
