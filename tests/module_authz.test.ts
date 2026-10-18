// @vitest-environment node
//
// The server authorises by MODULES (Role & Permissions), not by the role's name. These tests run the real
// admin_routes.js and invite_routes.js against an in-memory fake of the Supabase client with company roles
// (company_roles, role_permissions under CR_<id>) and check:
//   * creating / editing logins needs "invite-people"; listing, deleting and reset emails need "role-permissions";
//   * the granting rule is user_may_grant(): the administrator gives any role, others only roles based on STAFF whose
//     modules they hold themselves;
//   * emailing an invitation follows the same rule.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const T = 'tenant-a';
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const TOKEN = 'c'.repeat(64);

// company roles (uuids, as the server checks the shape)
const CR_MGR_INVITE = '11111111-1111-4111-8111-111111111111'; // MANAGER-based, with invite-people
const CR_MGR_PLAIN = '22222222-2222-4222-8222-222222222222'; // MANAGER-based, without invite-people
const CR_STAFF_TASKS = '33333333-3333-4333-8333-333333333333'; // STAFF-based: dashboard + task-manager
const CR_STAFF_RECRUIT = '44444444-4444-4444-8444-444444444444'; // STAFF-based: dashboard + recruitment
const CR_MGR_PAYROLL = '55555555-5555-4555-8555-555555555555'; // MANAGER-based, with payroll
const key = (id: string) => `CR_${id.replace(/-/g, '')}`;

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  authUsers: [] as { id: string; email: string; user_metadata: Record<string, unknown> }[],
  user_profiles: [] as Row[],
  memberships: [] as Row[],
  company_roles: [] as Row[],
  role_permissions: [] as Row[],
  invitations: [] as Row[],
  tenants: [] as Row[],
  calls: [] as string[],
  sends: [] as Row[],
}));

vi.mock('@supabase/supabase-js', () => {
  type Name = 'user_profiles' | 'memberships' | 'company_roles' | 'role_permissions' | 'invitations' | 'tenants';
  const table = (name: Name) => {
    const filters: [string, unknown][] = [];
    const rows = () => state[name] as Row[];
    const run = () => rows().filter((r) => filters.every(([k, v]) => r[k] === v));
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return b;
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: run(), error: null }),
      upsert: async (row: Row) => {
        state.calls.push(`upsert:${name}:${row.user_id}`);
        const i = rows().findIndex((r) => r.user_id === row.user_id && r.tenant_id === row.tenant_id);
        if (i >= 0) rows()[i] = { ...rows()[i], ...row };
        else rows().push(row);
        return { error: null };
      },
      delete: () => {
        const del: Record<string, unknown> = {
          eq: (k: string, v: unknown) => {
            filters.push([k, v]);
            return del;
          },
          then: (resolve: (v: unknown) => void) => {
            state.calls.push(`delete:${name}`);
            const doomed = new Set(run());
            (state[name] as Row[]) = rows().filter((r) => !doomed.has(r));
            resolve({ error: null });
          },
        };
        return del;
      },
    };
    return b;
  };
  const client = {
    auth: {
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
    from: (name: string) => table(name as Name),
  };
  return { createClient: () => client };
});

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (msg: Row) => {
        state.sends.push(msg);
        return { error: null };
      },
    };
  },
}));

process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

let server: Server;
let base: string;

beforeAll(async () => {
  const express = (await import('express')).default;
  const adminRouter = (await import('../admin_routes.js')).default;
  const inviteRouter = (await import('../invite_routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  app.use('/api/invites', inviteRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server.close());

// people: id -> [base role, company role id or null]
const PEOPLE: Record<string, [string, string | null]> = {
  admin: ['ADMIN', null],
  hr: ['HR', null],
  checker: ['CHECKER', null],
  manager: ['MANAGER', null],
  'mgr-invite': ['MANAGER', CR_MGR_INVITE],
  'mgr-plain': ['MANAGER', CR_MGR_PLAIN],
  staff: ['STAFF', null],
  'staff-tasks': ['STAFF', CR_STAFF_TASKS],
  'staff-recruit': ['STAFF', CR_STAFF_RECRUIT],
};

const perms = (role_name: string, permissions: string[]) => ({ tenant_id: T, role_name, permissions });

beforeEach(() => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.SITE_URL = 'https://bloom-hr-phi.vercel.app';
  state.calls = [];
  state.sends = [];
  state.authUsers = Object.keys(PEOPLE).map((id) => ({ id, email: `${id}@a.co`, user_metadata: {} }));
  state.user_profiles = Object.entries(PEOPLE).map(([user_id, [role, company_role_id]]) => ({
    user_id,
    role,
    company_role_id,
    account_status: 'ACTIVE',
    tenant_id: T,
  }));
  state.memberships = state.user_profiles.map((p) => ({ ...p }));
  const cr = (id: string, base_role: string, name: string) => ({ id, tenant_id: T, role_key: key(id), name, base_role, is_system: false, active: true });
  state.company_roles = [
    cr(CR_MGR_INVITE, 'MANAGER', 'Team lead who invites'),
    cr(CR_MGR_PLAIN, 'MANAGER', 'Team lead'),
    cr(CR_STAFF_TASKS, 'STAFF', 'Project staff'),
    cr(CR_STAFF_RECRUIT, 'STAFF', 'Recruiting staff'),
    cr(CR_MGR_PAYROLL, 'MANAGER', 'Payroll lead'),
  ];
  // default modules per system role (default company) and the company's own roles
  state.role_permissions = [
    perms('HR', ['dashboard', 'invite-people', 'task-manager', 'teams', 'recruitment']),
    perms('CHECKER', ['dashboard', 'payroll', 'settings']),
    perms('MANAGER', ['dashboard', 'teams']),
    perms('STAFF', ['dashboard', 'task-manager', 'teams']),
    perms(key(CR_MGR_INVITE), ['dashboard', 'invite-people', 'task-manager']),
    perms(key(CR_MGR_PLAIN), ['dashboard', 'teams']),
    perms(key(CR_STAFF_TASKS), ['dashboard', 'task-manager']),
    perms(key(CR_STAFF_RECRUIT), ['dashboard', 'recruitment']),
    perms(key(CR_MGR_PAYROLL), ['dashboard', 'payroll']),
  ];
  state.tenants = [{ id: T, name: 'Favor Farm' }];
  state.invitations = [
    { id: 'i1', tenant_id: T, email: 'new@gmail.com', role: 'STAFF', company_role_id: null, status: 'pending', expires_at: new Date(Date.now() + 86_400_000).toISOString(), token_hash: sha(TOKEN) },
  ];
});

const call = (method: string, path: string, as: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${as}` },
    body: body ? JSON.stringify(body) : undefined,
  });
const create = (as: string, extra: Row) => call('POST', '/admin/users', as, { email: `n${Math.random()}@a.co`, password: 'secret1', ...extra });
const dropModule = (role_name: string, m: string) => {
  const row = state.role_permissions.find((r) => r.role_name === role_name)!;
  row.permissions = (row.permissions as string[]).filter((x) => x !== m);
};

describe('creating a login (POST /api/admin/users) needs "invite-people"', () => {
  it('is refused for a CHECKER and for a MANAGER-based custom role without it', async () => {
    expect((await create('checker', { role: 'STAFF' })).status).toBe(403);
    expect((await create('mgr-plain', { role: 'STAFF' })).status).toBe(403);
    expect(state.calls.filter((c) => c.startsWith('createUser'))).toEqual([]);
  });

  it('is allowed for HR and for a MANAGER-based custom role with it, giving a STAFF role', async () => {
    expect((await create('hr', { role: 'STAFF' })).status).toBe(201);
    expect((await create('mgr-invite', { role: 'STAFF' })).status).toBe(201);
    expect((await create('mgr-invite', { company_role_id: CR_STAFF_TASKS })).status).toBe(201);
  });

  it('HR whose role had "invite-people" removed is refused', async () => {
    dropModule('HR', 'invite-people');
    expect((await create('hr', { role: 'STAFF' })).status).toBe(403);
  });

  it('a non-admin cannot give a role that is not based on STAFF', async () => {
    for (const as of ['hr', 'mgr-invite']) {
      const res = await create(as, { role: 'MANAGER' });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/only an administrator/i);
    }
    expect((await create('hr', { company_role_id: CR_MGR_PLAIN })).status).toBe(403);
  });

  it('a non-admin cannot give a STAFF-based custom role holding a module they lack', async () => {
    // mgr-invite has no "recruitment"
    const res = await create('mgr-invite', { company_role_id: CR_STAFF_RECRUIT });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/access you do not have yourself/i);
    // HR has it, so HR may
    expect((await create('hr', { company_role_id: CR_STAFF_RECRUIT })).status).toBe(201);
  });

  it('the administrator may give any role', async () => {
    expect((await create('admin', { role: 'ADMIN' })).status).toBe(201);
    expect((await create('admin', { role: 'MANAGER' })).status).toBe(201);
    expect((await create('admin', { company_role_id: CR_MGR_PAYROLL })).status).toBe(201);
  });
});

describe('editing a login (PATCH /api/admin/users/:id)', () => {
  it('is refused without "invite-people"', async () => {
    expect((await call('PATCH', '/admin/users/staff', 'checker', { account_status: 'SUSPENDED' })).status).toBe(403);
    expect((await call('PATCH', '/admin/users/staff', 'mgr-plain', { account_status: 'SUSPENDED' })).status).toBe(403);
    expect(state.calls.filter((c) => c.startsWith('updateUser'))).toEqual([]);
  });

  it('is allowed for HR and a MANAGER-based custom role with it, on someone holding a STAFF role', async () => {
    expect((await call('PATCH', '/admin/users/staff', 'hr', { account_status: 'SUSPENDED' })).status).toBe(200);
    expect((await call('PATCH', '/admin/users/staff', 'mgr-invite', { company_role_id: CR_STAFF_TASKS })).status).toBe(200);
    expect(state.memberships.find((m) => m.user_id === 'staff')?.company_role_id).toBe(CR_STAFF_TASKS);
  });

  it('a non-admin cannot edit someone holding a role that is not based on STAFF, nor promote anyone to one', async () => {
    expect((await call('PATCH', '/admin/users/manager', 'hr', { account_status: 'SUSPENDED' })).status).toBe(403);
    expect((await call('PATCH', '/admin/users/staff', 'hr', { role: 'MANAGER' })).status).toBe(403);
    expect((await call('PATCH', '/admin/users/staff', 'mgr-invite', { role: 'HR' })).status).toBe(403);
  });

  it('a non-admin cannot edit someone holding a custom role they could not give', async () => {
    // staff-recruit holds "recruitment", which mgr-invite lacks: not even a status change, nor moving them down
    expect((await call('PATCH', '/admin/users/staff-recruit', 'mgr-invite', { account_status: 'SUSPENDED' })).status).toBe(403);
    expect((await call('PATCH', '/admin/users/staff-recruit', 'mgr-invite', { role: 'STAFF' })).status).toBe(403);
    // HR holds recruitment, so HR may
    expect((await call('PATCH', '/admin/users/staff-recruit', 'hr', { role: 'STAFF' })).status).toBe(200);
  });

  it('the administrator may edit anyone and give any role, but not their own role', async () => {
    expect((await call('PATCH', '/admin/users/manager', 'admin', { company_role_id: CR_MGR_PAYROLL })).status).toBe(200);
    expect((await call('PATCH', '/admin/users/staff', 'admin', { role: 'ADMIN' })).status).toBe(200);
    expect((await call('PATCH', '/admin/users/admin', 'admin', { role: 'STAFF' })).status).toBe(400);
  });

  it('nobody with "invite-people" changes their own role', async () => {
    // mgr-invite is MANAGER-based, so refused by the grant rule first; a STAFF-based inviter is refused as themselves
    state.role_permissions.find((r) => r.role_name === key(CR_STAFF_TASKS))!.permissions = ['dashboard', 'task-manager', 'invite-people'];
    const res = await call('PATCH', '/admin/users/staff-tasks', 'staff-tasks', { role: 'STAFF' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/your own role/i);
  });
});

describe('listing, removing and reset emails need "role-permissions"', () => {
  it('are refused for HR and CHECKER, allowed for the administrator', async () => {
    for (const as of ['hr', 'checker', 'mgr-invite']) {
      expect((await call('GET', '/admin/users', as)).status).toBe(403);
      expect((await call('DELETE', '/admin/users/staff', as)).status).toBe(403);
      expect((await call('POST', '/admin/users/staff/reset-email', as, {})).status).toBe(403);
    }
    expect(state.calls).toEqual([]);
    expect((await call('GET', '/admin/users', 'admin')).status).toBe(200);
    expect((await call('POST', '/admin/users/staff/reset-email', 'admin', {})).status).toBe(200);
    expect((await call('DELETE', '/admin/users/staff', 'admin')).status).toBe(200);
  });

  it('GET /auth-users needs "invite-people"', async () => {
    expect((await call('GET', '/admin/auth-users', 'hr')).status).toBe(200);
    expect((await call('GET', '/admin/auth-users', 'mgr-invite')).status).toBe(200);
    expect((await call('GET', '/admin/auth-users', 'checker')).status).toBe(403);
    expect((await call('GET', '/admin/auth-users', 'staff')).status).toBe(403);
  });
});

describe('emailing an invitation (POST /api/invites/send) follows the modules', () => {
  const send = (as: string) => call('POST', '/invites/send', as, { token: TOKEN });

  it('needs "invite-people": HR whose role lost it is refused, a custom role with it is allowed', async () => {
    expect((await send('hr')).status).toBe(200);
    dropModule('HR', 'invite-people');
    expect((await send('hr')).status).toBe(403);
    expect((await send('mgr-invite')).status).toBe(200);
    expect((await send('checker')).status).toBe(403);
    expect(state.sends).toHaveLength(2);
  });

  it('a non-admin cannot send an invitation for a role not based on STAFF', async () => {
    state.invitations[0].role = 'MANAGER';
    expect((await send('hr')).status).toBe(403);
    expect((await send('mgr-invite')).status).toBe(403);
    expect((await send('admin')).status).toBe(200);
  });

  it('a non-admin cannot send a custom-role invitation above their own modules', async () => {
    state.invitations[0].company_role_id = CR_STAFF_RECRUIT;
    const res = await send('mgr-invite');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/access you do not have yourself/i);
    expect((await send('hr')).status).toBe(200);
    state.invitations[0].company_role_id = CR_STAFF_TASKS;
    expect((await send('mgr-invite')).status).toBe(200);
  });
});
