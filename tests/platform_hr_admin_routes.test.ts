// @vitest-environment node
//
// "Invite admin" for a customer's HR company in the console (platform_hr_admin_routes.js): Owner/Admin only (the
// permission Enable needs), a real email address, then platform_invite_hr_admin() (faked here as the migration
// behaves), whose outcome comes back as is; 20 invitations an hour per staff member.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  authUsers: [] as { id: string; email: string | null }[],
  platform_admins: [] as Row[],
  calls: [] as Row[],
  answer: null as Row | null,
  error: null as Row | null,
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
    rpc: async (fn: string, args: Row) => {
      if (fn !== 'platform_invite_hr_admin') return { data: null, error: { message: `unexpected ${fn}` } };
      state.calls.push(args);
      if (state.error) return { data: null, error: state.error };
      return { data: state.answer ? [state.answer] : [], error: null };
    },
  };
  return { createClient: () => client };
});

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

const PT = '11111111-1111-4111-8111-111111111111';
const HR = '99999999-9999-4999-8999-999999999999';

let server: Server;
let base: string;
let mod: typeof import('../platform_hr_admin_routes.js');
let createBudget: typeof import('../authz.js').createBudget;
const HOUR = 60 * 60 * 1000;

/** A server for one router; resolves its URL and a close function. */
async function serve(router: import('express').Router) {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/platform/hr-admin', router);
  const s = createServer(app);
  await new Promise<void>((resolve) => s.listen(0, resolve));
  return { s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/platform/hr-admin` };
}

beforeAll(async () => {
  ({ createBudget } = await import('../authz.js'));
  mod = await import('../platform_hr_admin_routes.js');
  // plenty for the tests that are not about the rate limit
  ({ s: server, url: base } = await serve(mod.createHrAdminRouter({ budget: createBudget({ default: { limit: 1000, windowMs: HOUR } }) })));
});
afterAll(() => server.close());

beforeEach(() => {
  state.authUsers = [
    { id: 'own', email: 'own@figbloom.org' },
    { id: 'adm', email: 'adm@figbloom.org' },
    { id: 'sup', email: 'sup@figbloom.org' },
    { id: 'view', email: 'view@figbloom.org' },
    { id: 'noemail', email: null },
    { id: 'outsider', email: 'someone@a.co' },
  ];
  state.platform_admins = [
    { user_id: 'own', role: 'owner' },
    { user_id: 'adm', role: 'admin' },
    { user_id: 'sup', role: 'support' },
    { user_id: 'view', role: 'viewer' },
    { user_id: 'noemail', role: 'owner' },
  ];
  state.calls = [];
  state.answer = { outcome: 'queued', tenant_id: HR, tenant_name: 'Hillside Primary', member_role: null };
  state.error = null;
});

const invite = async (body: unknown, token: string | null = 'own', id = PT, at = base) => {
  const res = await fetch(`${at}/${id}/invite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Row & { error?: { code: string; message: string } } };
};

describe('POST /api/platform/hr-admin/:id/invite', () => {
  it('queues the invitation for an Owner, with the caller recorded, and says so', async () => {
    const r = await invite({ email: '  New.Admin@Hillside.ac.ke ', name: '  Jane   Head ' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ outcome: 'queued', email: 'new.admin@hillside.ac.ke', company: { id: HR, name: 'Hillside Primary' }, member_role: null });
    expect(state.calls).toEqual([{
      p_platform_tenant: PT, p_email: 'new.admin@hillside.ac.ke', p_actor: 'own', p_actor_email: 'own@figbloom.org', p_name: 'Jane Head',
    }]);
  });

  it('an Admin may too; the name is optional', async () => {
    const r = await invite({ email: 'a@school.ac.ke' }, 'adm');
    expect(r.status).toBe(200);
    expect(state.calls[0]).toMatchObject({ p_actor: 'adm', p_name: null });
  });

  it('refuses Support and Viewer (403), non-staff (403) and no session (401), before calling the database', async () => {
    for (const who of ['sup', 'view', 'outsider']) {
      const r = await invite({ email: 'a@school.ac.ke' }, who);
      expect(r.status).toBe(403);
    }
    expect((await invite({ email: 'a@school.ac.ke' }, null)).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it('refuses a malformed or placeholder address, a bad id or name, and a login with no email', async () => {
    for (const email of [undefined, '', 'nobody', 'a@b', 'a b@c.co', 'a@b..co', 'a,b@c.co', 42, 'x@example.com', 'x@test', 'x@school.invalid',
      'staff-1@figbloom.internal', `${'x'.repeat(250)}@b.co`]) {
      const r = await invite({ email });
      expect(r.status, String(email)).toBe(400);
      expect(r.json.error?.code).toBe('invalid_email');
    }
    expect((await invite({ email: 'a@b.co' }, 'own', 'not-a-uuid')).json.error?.code).toBe('invalid_tenant_id');
    expect((await invite({ email: 'a@b.co', name: 5 })).json.error?.code).toBe('invalid_name');
    expect((await invite({ email: 'a@b.co', name: 'x'.repeat(201) })).json.error?.code).toBe('invalid_name');
    expect((await invite({ email: 'a@b.co' }, 'noemail')).json.error?.code).toBe('no_actor_email');
    expect(state.calls).toEqual([]);
  });

  it('passes already_invited and already_member (with the role) through', async () => {
    state.answer = { outcome: 'already_invited', tenant_id: HR, tenant_name: 'Hillside Primary', member_role: null };
    expect((await invite({ email: 'a@b.co' })).json).toMatchObject({ outcome: 'already_invited', email: 'a@b.co' });
    state.answer = { outcome: 'already_member', tenant_id: HR, tenant_name: 'Hillside Primary', member_role: 'ADMIN' };
    expect((await invite({ email: 'a@b.co' })).json).toMatchObject({ outcome: 'already_member', member_role: 'ADMIN' });
  });

  it('no_company is a 404 saying HR has no company yet', async () => {
    state.answer = { outcome: 'no_company', tenant_id: null, tenant_name: null, member_role: null };
    const r = await invite({ email: 'a@b.co' });
    expect(r.status).toBe(404);
    expect(r.json.error?.code).toBe('no_company');
  });

  it('the database refusing the actor is a 403; anything else a 500 that says nothing more', async () => {
    state.error = { code: '42501', message: 'Only a platform owner or admin can invite' };
    expect((await invite({ email: 'a@b.co' })).status).toBe(403);
    state.error = { code: 'XX000', message: 'secret internals' };
    const r = await invite({ email: 'a@b.co' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toContain('secret');
    state.error = null;
    state.answer = null;
    expect((await invite({ email: 'a@b.co' })).status).toBe(500);
  });

  it('rate-limits each staff member (429), without touching the database', async () => {
    const { s: small, url } = await serve(mod.createHrAdminRouter({ budget: createBudget({ default: { limit: 2, windowMs: HOUR } }) }));
    try {
      expect((await invite({ email: 'a1@b.co' }, 'adm', PT, url)).status).toBe(200);
      expect((await invite({ email: 'a2@b.co' }, 'adm', PT, url)).status).toBe(200);
      const r = await invite({ email: 'a3@b.co' }, 'adm', PT, url);
      expect(r.status).toBe(429);
      expect(r.json.error?.code).toBe('rate_limited');
      expect(state.calls).toHaveLength(2);
      // someone else still may
      expect((await invite({ email: 'a4@b.co' }, 'own', PT, url)).status).toBe(200);
    } finally {
      small.close();
    }
  });

  it('the default router allows 20 an hour', async () => {
    const { s: dflt, url } = await serve(mod.createHrAdminRouter());
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) statuses.push((await invite({ email: `p${i}@b.co` }, 'own', PT, url)).status);
      expect(statuses.filter((x) => x === 200)).toHaveLength(20);
      expect(statuses[20]).toBe(429);
    } finally {
      dflt.close();
    }
  });
});
