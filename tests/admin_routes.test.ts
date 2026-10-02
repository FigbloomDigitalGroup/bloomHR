// @vitest-environment node
//
// FIG-516: admin_routes.js uses the service-role key, which bypasses RLS, so tenant isolation
// there is enforced in code. These tests run the real router against an in-memory fake of the
// Supabase client and check that one tenant's admin can never see or touch another tenant's users.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

type Profile = { user_id: string; email: string; role: string; account_status: string; tenant_id: string | null };

const state = vi.hoisted(() => ({
  profiles: [] as Profile[],
  authUsers: [] as { id: string; email: string; user_metadata: Record<string, unknown> }[],
  calls: [] as string[],
}));

vi.mock('@supabase/supabase-js', () => {
  // Minimal query builder over state.profiles: select / eq / maybeSingle / upsert / delete.
  const profilesTable = () => {
    const filters: [string, unknown][] = [];
    let columns = '*';
    const run = () => state.profiles.filter((p) => filters.every(([k, v]) => (p as Record<string, unknown>)[k] === v));
    const builder: Record<string, unknown> = {
      select: (cols: string) => {
        columns = cols;
        return builder;
      },
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return builder;
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: run(), error: null, columns }),
      upsert: async (row: Profile) => {
        state.calls.push(`upsert:${row.user_id}:${row.tenant_id}`);
        const i = state.profiles.findIndex((p) => p.user_id === row.user_id);
        if (i >= 0) state.profiles[i] = { ...state.profiles[i], ...row };
        else state.profiles.push(row);
        return { error: null };
      },
      delete: () => ({
        eq: async (k: string, v: unknown) => {
          state.calls.push(`delete-profile:${v}`);
          state.profiles = state.profiles.filter((p) => (p as Record<string, unknown>)[k] !== v);
          return { error: null };
        },
      }),
    };
    return builder;
  };

  const client = {
    auth: {
      // The bearer token is simply the caller's user id in these tests.
      getUser: async (token: string) => ({ data: { user: state.authUsers.find((u) => u.id === token) ?? null }, error: null }),
      resetPasswordForEmail: async (email: string) => {
        state.calls.push(`reset:${email}`);
        return { error: null };
      },
      admin: {
        listUsers: async () => ({ data: { users: state.authUsers }, error: null }),
        getUserById: async (id: string) => ({ data: { user: state.authUsers.find((u) => u.id === id) ?? null }, error: null }),
        createUser: async ({ email }: { email: string }) => {
          const user = { id: `new-${email}`, email, user_metadata: {} };
          state.authUsers.push(user);
          state.calls.push(`createUser:${email}`);
          return { data: { user }, error: null };
        },
        updateUserById: async (id: string) => {
          state.calls.push(`updateUser:${id}`);
          return { data: { user: state.authUsers.find((u) => u.id === id) }, error: null };
        },
        deleteUser: async (id: string) => {
          state.calls.push(`deleteUser:${id}`);
          return { error: null };
        },
      },
    },
    from: (table: string) => {
      if (table !== 'user_profiles') throw new Error(`unexpected table ${table}`);
      return profilesTable();
    },
  };
  return { createClient: () => client };
});

process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

let server: Server;
let base: string;

beforeAll(async () => {
  const express = (await import('express')).default;
  const router = (await import('../admin_routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  state.calls = [];
  state.authUsers = [
    { id: 'admin-a', email: 'admin@a.co', user_metadata: {} },
    { id: 'staff-a', email: 'staff@a.co', user_metadata: {} },
    { id: 'admin-b', email: 'admin@b.co', user_metadata: {} },
    { id: 'staff-b', email: 'staff@b.co', user_metadata: {} },
    { id: 'orphan', email: 'orphan@x.co', user_metadata: {} },
  ];
  state.profiles = [
    { user_id: 'admin-a', email: 'admin@a.co', role: 'ADMIN', account_status: 'ACTIVE', tenant_id: TENANT_A },
    { user_id: 'staff-a', email: 'staff@a.co', role: 'STAFF', account_status: 'ACTIVE', tenant_id: TENANT_A },
    { user_id: 'admin-b', email: 'admin@b.co', role: 'ADMIN', account_status: 'ACTIVE', tenant_id: TENANT_B },
    { user_id: 'staff-b', email: 'staff@b.co', role: 'STAFF', account_status: 'ACTIVE', tenant_id: TENANT_B },
  ];
});

const call = (method: string, path: string, as: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${as}` },
    body: body ? JSON.stringify(body) : undefined,
  });

describe('admin API tenant isolation', () => {
  it('lists only the caller’s tenant (and never logins without a profile)', async () => {
    const res = await call('GET', '/users', 'admin-a');
    const { users } = await res.json();
    expect(users.map((u: { id: string }) => u.id).sort()).toEqual(['admin-a', 'staff-a']);
  });

  it('auth-users (sign-up matching) is tenant scoped too', async () => {
    const res = await call('GET', '/auth-users', 'admin-b');
    const { users } = await res.json();
    expect(users.map((u: { id: string }) => u.id).sort()).toEqual(['admin-b', 'staff-b']);
  });

  it('creates new logins inside the caller’s tenant', async () => {
    const res = await call('POST', '/users', 'admin-a', { email: 'New@A.co', password: 'secret1', role: 'STAFF' });
    expect(res.status).toBe(201);
    expect(state.calls).toContain(`upsert:new-new@a.co:${TENANT_A}`);
  });

  it('cannot change a user in another tenant', async () => {
    const res = await call('PATCH', '/users/staff-b', 'admin-a', { role: 'ADMIN' });
    expect(res.status).toBe(404);
    expect(state.calls.filter((c) => c.startsWith('updateUser'))).toEqual([]);
    expect(state.profiles.find((p) => p.user_id === 'staff-b')?.role).toBe('STAFF');
  });

  it('can change a user in its own tenant, which stays in that tenant', async () => {
    const res = await call('PATCH', '/users/staff-a', 'admin-a', { account_status: 'SUSPENDED' });
    expect(res.status).toBe(200);
    expect(state.profiles.find((p) => p.user_id === 'staff-a')).toMatchObject({ tenant_id: TENANT_A, account_status: 'SUSPENDED' });
  });

  it('cannot delete a user in another tenant', async () => {
    const res = await call('DELETE', '/users/staff-b', 'admin-a');
    expect(res.status).toBe(404);
    expect(state.calls.filter((c) => c.startsWith('deleteUser'))).toEqual([]);
  });

  it('cannot send a password reset to a user in another tenant', async () => {
    const res = await call('POST', '/users/staff-b/reset-email', 'admin-a', {});
    expect(res.status).toBe(404);
    expect(state.calls.filter((c) => c.startsWith('reset'))).toEqual([]);
  });

  it('refuses callers whose profile has no tenant', async () => {
    state.profiles.push({ user_id: 'orphan', email: 'orphan@x.co', role: 'ADMIN', account_status: 'ACTIVE', tenant_id: null });
    const res = await call('GET', '/users', 'orphan');
    expect(res.status).toBe(403);
  });
});
