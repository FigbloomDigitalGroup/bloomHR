// @vitest-environment node
//
// The AI features used to call the model straight from the browser with a VITE_ key, which Vite builds into the
// JavaScript every visitor downloads. These tests run the real ai_routes.js against an in-memory fake of the Supabase
// client and a fake model API, and check who may ask, what is rejected before the model is called, and that the
// model's error text never reaches the browser.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-a';

const state = vi.hoisted(() => ({
  profiles: [] as { user_id: string; role: string; account_status: string; tenant_id: string }[],
  permissions: [] as { tenant_id: string; role_name: string; permissions: string[] }[],
  authUsers: [] as { id: string; email: string }[],
  modelCalls: [] as { url: string; auth: string; body: any }[],
  modelReply: { ok: true, status: 200, json: { choices: [{ message: { content: 'An answer' } }], usage: { total_tokens: 7 } } } as {
    ok: boolean;
    status: number;
    json: unknown;
  },
}));

vi.mock('@supabase/supabase-js', () => {
  const table = (rows: () => Record<string, unknown>[]) => {
    const filters: [string, unknown][] = [];
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return b;
      },
      maybeSingle: async () => ({ data: rows().find((r) => filters.every(([k, v]) => r[k] === v)) ?? null, error: null }),
    };
    return b;
  };
  const client = {
    // the bearer token is simply the caller's user id in these tests
    auth: { getUser: async (token: string) => ({ data: { user: state.authUsers.find((u) => u.id === token) ?? null }, error: null }) },
    from: (name: string) => {
      if (name === 'user_profiles') return table(() => state.profiles);
      if (name === 'role_permissions') return table(() => state.permissions);
      throw new Error(`unexpected table ${name}`);
    },
  };
  return { createClient: () => client };
});

vi.mock('node-fetch', () => ({
  default: async (url: string, init: { headers: Record<string, string>; body: string }) => {
    state.modelCalls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return {
      ok: state.modelReply.ok,
      status: state.modelReply.status,
      json: async () => state.modelReply.json,
      text: async () => 'model said: secret internal detail',
    };
  },
}));

process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
process.env.OPENAI_API_KEY = 'sk-server-only';

let server: Server;
let base: string;

beforeAll(async () => {
  const express = (await import('express')).default;
  const router = (await import('../ai_routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/ai', router);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ai`;
});

afterAll(() => {
  server.close();
});

let uid = 0;
beforeEach(() => {
  // fresh users per test so the in-memory budget never carries over
  uid += 1;
  const mk = (name: string, role: string) => ({ id: `${name}-${uid}`, email: `${name}${uid}@a.co`, role });
  const users = [mk('admin', 'ADMIN'), mk('hr', 'HR'), mk('staff', 'STAFF')];
  state.authUsers = users.map(({ id, email }) => ({ id, email }));
  state.profiles = users.map((u) => ({ user_id: u.id, role: u.role, account_status: 'ACTIVE', tenant_id: TENANT }));
  state.permissions = [
    { tenant_id: TENANT, role_name: 'HR', permissions: ['ai-assistant'] },
    { tenant_id: 'other-tenant', role_name: 'STAFF', permissions: ['ai-assistant', 'staffcheck'] }, // must never apply to tenant-a staff
  ];
  state.modelCalls = [];
  state.modelReply = { ok: true, status: 200, json: { choices: [{ message: { content: 'An answer' } }], usage: { total_tokens: 7 } } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const who = (name: string) => state.authUsers.find((u) => u.id.startsWith(`${name}-`))!.id;
const ask = (token: string | null, body: Record<string, unknown>) =>
  fetch(`${base}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const question = { purpose: 'hr-assistant', prompt: 'Who is on leave?', context: '{"employees":[]}' };

describe('who may use the AI features', () => {
  it('needs a signed-in caller', async () => {
    expect((await ask(null, question)).status).toBe(401);
    expect((await ask('nobody', question)).status).toBe(401);
    expect(state.modelCalls).toHaveLength(0);
  });

  it("needs the feature's module, ignoring another company's grant", async () => {
    expect((await ask(who('staff'), question)).status).toBe(403);
    expect((await ask(who('hr'), { ...question, purpose: 'warning' })).status).toBe(403);
    expect(state.modelCalls).toHaveLength(0);
  });

  it('lets ADMIN and roles with the module through, and any member summarise a meeting', async () => {
    expect((await ask(who('admin'), { ...question, purpose: 'warning' })).status).toBe(200);
    expect((await ask(who('hr'), question)).status).toBe(200);
    expect((await ask(who('staff'), { purpose: 'meeting-summary', prompt: 'transcript...' })).status).toBe(200);
  });
});

describe('asking the model', () => {
  it('uses the server key and the fixed instruction for the purpose', async () => {
    const res = await ask(who('hr'), question);
    expect(await res.json()).toEqual({ response: 'An answer', metadata: { total_tokens: 7 } });
    const call = state.modelCalls[0];
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.body.model).toBe('gpt-4.1-mini');
    expect(call.body).not.toHaveProperty('temperature');
    expect(call.auth).toBe('Bearer sk-server-only');
    expect(call.body.messages).toEqual([
      { role: 'system', content: 'You are an HR assistant. Analyze this HR data and respond helpfully: {"employees":[]}' },
      { role: 'user', content: 'Who is on leave?' },
    ]);
  });

  it('rejects bad input before calling the model', async () => {
    const admin = who('admin');
    expect((await ask(admin, { ...question, purpose: 'anything' })).status).toBe(400);
    expect((await ask(admin, { ...question, prompt: '' })).status).toBe(400);
    expect((await ask(admin, { ...question, prompt: 'x'.repeat(50_001) })).status).toBe(400);
    expect((await ask(admin, { ...question, context: 42 })).status).toBe(400);
    expect(state.modelCalls).toHaveLength(0);
  });

  it("does not pass the model's error text on to the browser", async () => {
    state.modelReply = { ok: false, status: 401, json: {} };
    const res = await ask(who('admin'), question);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('secret internal detail');
  });

  it('stops one user asking more than 100 times an hour', async () => {
    const admin = who('admin');
    for (let i = 0; i < 100; i++) expect((await ask(admin, question)).status).toBe(200);
    expect((await ask(admin, question)).status).toBe(429);
  }, 30000); // 101 requests: allow for a busy machine
});
