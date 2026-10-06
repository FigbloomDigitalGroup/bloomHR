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
type Membership = { user_id: string; tenant_id: string; role: string; account_status: string };

const state = vi.hoisted(() => ({
  profiles: [] as Profile[],
  memberships: [] as Membership[],
  updates: [] as Record<string, unknown>[],
  authUsers: [] as { id: string; email: string; user_metadata: Record<string, unknown> }[],
  calls: [] as string[],
}));

vi.mock('@supabase/supabase-js', () => {
  // Minimal query builder over state[table]: select / eq / maybeSingle / upsert / delete.
  // user_profiles is read-only here (authenticate); the database mirrors memberships into it.
  const makeTable = (name: 'profiles' | 'memberships') => {
    const filters: [string, unknown][] = [];
    const rowsOf = () => state[name] as Record<string, unknown>[];
    const run = () => rowsOf().filter((p) => filters.every(([k, v]) => p[k] === v));
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return builder;
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: run(), error: null }),
      upsert: async (row: Record<string, unknown>) => {
        state.calls.push(`upsert:${name}:${row.user_id}:${row.tenant_id}`);
        state.updates.push(row);
        const keys = name === 'memberships' ? ['user_id', 'tenant_id'] : ['user_id'];
        const i = rowsOf().findIndex((p) => keys.every((k) => p[k] === row[k]));
        if (i >= 0) rowsOf()[i] = { ...rowsOf()[i], ...row };
        else rowsOf().push(row);
        return { error: null };
      },
      delete: () => {
        const del: Record<string, unknown> = {
          eq: (k: string, v: unknown) => {
            filters.push([k, v]);
            return del;
          },
          then: (resolve: (v: unknown) => void) => {
            state.calls.push(`delete:${name}:${filters.map(([, v]) => v).join(':')}`);
            const doomed = new Set(run());
            (state[name] as unknown[]) = rowsOf().filter((r) => !doomed.has(r));
            resolve({ error: null });
          },
        };
        return del;
      },
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
        updateUserById: async (id: string, update: Record<string, unknown>) => {
          state.calls.push(`updateUser:${id}${update?.ban_duration ? `:ban=${update.ban_duration}` : ''}`);
          return { data: { user: state.authUsers.find((u) => u.id === id) }, error: null };
        },
        deleteUser: async (id: string) => {
          state.calls.push(`deleteUser:${id}`);
          return { error: null };
        },
      },
    },
    from: (table: string) => {
      if (table === 'user_profiles') return makeTable('profiles');
      if (table === 'memberships') return makeTable('memberships');
      throw new Error(`unexpected table ${table}`);
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
  state.memberships = state.profiles.map((p) => ({ user_id: p.user_id, tenant_id: p.tenant_id as string, role: p.role, account_status: p.account_status }));
  state.updates = [];
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
    expect(state.calls).toContain(`upsert:memberships:new-new@a.co:${TENANT_A}`);
  });

  it('cannot change a user in another tenant', async () => {
    const res = await call('PATCH', '/users/staff-b', 'admin-a', { role: 'ADMIN' });
    expect(res.status).toBe(404);
    expect(state.calls.filter((c) => c.startsWith('updateUser'))).toEqual([]);
    expect(state.memberships.find((m) => m.user_id === 'staff-b')?.role).toBe('STAFF');
  });

  it('can change a user in its own tenant, which stays in that tenant', async () => {
    const res = await call('PATCH', '/users/staff-a', 'admin-a', { account_status: 'SUSPENDED' });
    expect(res.status).toBe(200);
    expect(state.memberships.find((m) => m.user_id === 'staff-a')).toMatchObject({ tenant_id: TENANT_A, account_status: 'SUSPENDED' });
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

  it('never writes a membership for any company but the caller’s', async () => {
    await call('POST', '/users', 'admin-a', { email: 'x@a.co', password: 'secret1', role: 'STAFF' });
    await call('PATCH', '/users/staff-a', 'admin-a', { role: 'HR' });
    expect(state.updates.length).toBeGreaterThan(0);
    expect(state.updates.every((u) => u.tenant_id === TENANT_A)).toBe(true);
  });
});

describe('a person in several companies', () => {
  // dual works in A as STAFF and in B as HR; their login is shared, their roles and statuses are not
  beforeEach(() => {
    state.authUsers.push({ id: 'dual', email: 'dual@x.co', user_metadata: {} });
    state.profiles.push({ user_id: 'dual', email: 'dual@x.co', role: 'STAFF', account_status: 'ACTIVE', tenant_id: TENANT_A });
    state.memberships.push(
      { user_id: 'dual', tenant_id: TENANT_A, role: 'STAFF', account_status: 'ACTIVE' },
      { user_id: 'dual', tenant_id: TENANT_B, role: 'HR', account_status: 'ACTIVE' }
    );
  });

  it('shows up in both companies, with the role they have in each', async () => {
    const a = (await (await call('GET', '/users', 'admin-a')).json()).users;
    const b = (await (await call('GET', '/users', 'admin-b')).json()).users;
    expect(a.find((u: { id: string }) => u.id === 'dual').role).toBe('STAFF');
    expect(b.find((u: { id: string }) => u.id === 'dual').role).toBe('HR');
  });

  it('can be managed by the other company’s admin even while working in the first company', async () => {
    // profile (current company) is A, but admin-b can still see and change their B membership
    const res = await call('PATCH', '/users/dual', 'admin-b', { role: 'MANAGER' });
    expect(res.status).toBe(200);
    expect(state.memberships.find((m) => m.user_id === 'dual' && m.tenant_id === TENANT_B)?.role).toBe('MANAGER');
    expect(state.memberships.find((m) => m.user_id === 'dual' && m.tenant_id === TENANT_A)?.role).toBe('STAFF');
  });

  it('an admin of one company cannot change the password or email of a login that also belongs to another company', async () => {
    for (const body of [{ password: 'takeover1' }, { email: 'attacker@x.co' }, { role: 'HR', password: 'takeover1' }]) {
      const res = await call('PATCH', '/users/dual', 'admin-a', body);
      expect(res.status, JSON.stringify(body)).toBe(409);
    }
    expect(state.calls.filter((c) => c.startsWith('updateUser:dual'))).toEqual([]);
  });

  it('can still change the role or status of that login, and the password of a login that is only theirs', async () => {
    expect((await call('PATCH', '/users/dual', 'admin-a', { role: 'MANAGER' })).status).toBe(200);
    expect((await call('PATCH', '/users/staff-a', 'admin-a', { password: 'newsecret1' })).status).toBe(200);
  });

  it('suspending them in one company does not ban the login they use for the other', async () => {
    await call('PATCH', '/users/dual', 'admin-a', { account_status: 'SUSPENDED' });
    expect(state.calls).toContain('updateUser:dual:ban=none'); // explicitly not banned
    expect(state.calls.some((c) => c.includes(':ban=876000h'))).toBe(false);
  });

  it('suspending someone whose only company this is still bans the login', async () => {
    await call('PATCH', '/users/staff-a', 'admin-a', { account_status: 'SUSPENDED' });
    expect(state.calls).toContain('updateUser:staff-a:ban=876000h');
  });

  it('removing them from one company keeps their login and their other company', async () => {
    const res = await call('DELETE', '/users/dual', 'admin-a');
    expect(res.status).toBe(200);
    expect(state.memberships.filter((m) => m.user_id === 'dual').map((m) => m.tenant_id)).toEqual([TENANT_B]);
    expect(state.calls.filter((c) => c.startsWith('deleteUser'))).toEqual([]);
  });

  it('removing someone from their only company deletes the login', async () => {
    await call('DELETE', '/users/staff-a', 'admin-a');
    expect(state.calls).toContain('deleteUser:staff-a');
    expect(state.memberships.some((m) => m.user_id === 'staff-a')).toBe(false);
  });
});
