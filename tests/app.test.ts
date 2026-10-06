// @vitest-environment node
//
// The backend now also runs as a Vercel function (api/index.js). These tests start the real app and check what the
// website relies on: API answers are always JSON (never the site's home page), payments are not exposed on the
// public deployment, and CORS can be limited to the site.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import express from 'express';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

const servers: Server[] = [];
const serve = async (app: unknown) => {
  const server = createServer(app as never);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
afterAll(() => servers.forEach((s) => s.close()));

describe('backend app', () => {
  it('requires a login for the admin API and answers in JSON', async () => {
    const { buildApp } = await import('../app.js');
    const base = await serve(buildApp());
    const res = await fetch(`${base}/api/admin/users`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect((await res.json()).error).toMatch(/bearer token/i);
  });

  it('answers an unknown API path with a JSON 404, never the website home page', async () => {
    const { buildApp } = await import('../app.js');
    const base = await serve(buildApp());
    const res = await fetch(`${base}/api/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('mounts M-Pesa only when it is passed in (the local server), not on the public deployment', async () => {
    const { buildApp } = await import('../app.js');
    const stub = express.Router();
    stub.post('/b2c', (_req, res) => res.json({ paid: true }));

    const without = await serve(buildApp());
    expect((await fetch(`${without}/api/mpesa/b2c`, { method: 'POST' })).status).toBe(404);

    const withMpesa = await serve(buildApp({ mpesaRouter: stub }));
    expect(await (await fetch(`${withMpesa}/api/mpesa/b2c`, { method: 'POST' })).json()).toEqual({ paid: true });
  });

  it('the Vercel entry point is the same app without payments', async () => {
    const entry = (await import('../api/index.js')).default;
    expect(typeof entry).toBe('function');
    const base = await serve(entry);
    expect((await fetch(`${base}/api/mpesa/b2c`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${base}/api/admin/users`)).status).toBe(401);
  });

  it('limits which sites may call it when CORS_ORIGIN is set, and allows any when it is not', async () => {
    const { buildApp } = await import('../app.js');
    const saved = process.env.CORS_ORIGIN; // a developer's own .env may set it
    delete process.env.CORS_ORIGIN;
    const open = await serve(buildApp());
    const anySite = await fetch(`${open}/api/does-not-exist`, { headers: { Origin: 'https://evil.example' } });
    expect(anySite.headers.get('access-control-allow-origin')).toBe('*');

    process.env.CORS_ORIGIN = 'https://bloom-hr-phi.vercel.app';
    try {
      const limited = await serve(buildApp());
      const ours = await fetch(`${limited}/api/does-not-exist`, { headers: { Origin: 'https://bloom-hr-phi.vercel.app' } });
      expect(ours.headers.get('access-control-allow-origin')).toBe('https://bloom-hr-phi.vercel.app');
      const theirs = await fetch(`${limited}/api/does-not-exist`, { headers: { Origin: 'https://evil.example' } });
      expect(theirs.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = saved;
    }
  });
});
