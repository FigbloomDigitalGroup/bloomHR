// @vitest-environment node
//
// Accepting an invitation as a new person: the link itself proves they own the address, so the account is created
// already confirmed, in the inviting company, with no confirmation email. These tests run the real route against an
// in-memory fake of the Supabase client.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const TOKEN = 'c'.repeat(64);
const TENANT = 'tenant-a';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  invitations: [] as Row[],
  memberships: [] as Row[],
  user_profiles: [] as Row[],
  authUsers: [] as { id: string; email: string; email_confirm?: boolean; user_metadata?: Row }[],
  createdWith: [] as Row[],
  deleted: [] as string[],
  failMembership: false,
  lostRace: false,
}));

vi.mock('@supabase/supabase-js', () => {
  const table = (name: 'invitations' | 'memberships' | 'user_profiles') => {
    const filters: [string, unknown][] = [];
    let patch: Row | null = null;
    const match = () => state[name].filter((r) => filters.every(([k, v]) => r[k] === v));
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return b;
      },
      update: (p: Row) => {
        patch = p;
        return b;
      },
      insert: async (row: Row) => {
        if (name === 'memberships' && state.failMembership) return { error: new Error('insert failed') };
        state[name].push(row);
        return { error: null };
      },
      maybeSingle: async () => {
        // another request claimed the invitation between our lookup and our claim
        if (state.lostRace && patch && patch.status === 'accepted') return { data: null, error: null };
        const rows = match();
        if (patch) rows.forEach((r) => Object.assign(r, patch));
        return { data: rows[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        if (patch) match().forEach((r) => Object.assign(r, patch));
        resolve({ error: null });
      },
    };
    return b;
  };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      admin: {
        createUser: async (input: { email: string; email_confirm?: boolean; user_metadata?: Row }) => {
          state.createdWith.push(input as Row);
          if (state.authUsers.some((u) => u.email === input.email)) return { data: { user: null }, error: { status: 422, message: 'A user with this email address has already been registered' } };
          const user = { id: `user-${state.authUsers.length + 1}`, email: input.email, email_confirm: input.email_confirm, user_metadata: input.user_metadata };
          state.authUsers.push(user);
          return { data: { user }, error: null };
        },
        deleteUser: async (id: string) => {
          state.deleted.push(id);
          state.authUsers = state.authUsers.filter((u) => u.id !== id);
          return { error: null };
        },
      },
    },
    from: (name: string) => table(name as 'invitations'),
  };
  return { createClient: () => client };
});

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

let server: Server;
let base: string;

beforeAll(async () => {
  const express = (await import('express')).default;
  const router = (await import('../invite_routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/invites', router);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/invites`;
});
afterAll(() => server.close());

const future = () => new Date(Date.now() + 5 * 86_400_000).toISOString();
const past = () => new Date(Date.now() - 86_400_000).toISOString();

beforeEach(() => {
  state.authUsers = [];
  state.memberships = [];
  state.createdWith = [];
  state.deleted = [];
  state.failMembership = false;
  state.lostRace = false;
  state.user_profiles = [];
  state.invitations = [{ id: 'i1', tenant_id: TENANT, email: 'new.person@gmail.com', role: 'HR', status: 'pending', expires_at: future(), token_hash: sha(TOKEN) }];
});

const accept = (body: unknown) =>
  fetch(`${base}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('POST /api/invites/accept', () => {
  it('creates a confirmed account in the inviting company with the invited role, and needs no login', async () => {
    const res = await accept({ token: TOKEN, password: 'a-good-password', fullName: 'Jane Doe' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: 'new.person@gmail.com' });

    const created = state.createdWith[0] as { email: string; email_confirm: boolean; user_metadata: Row };
    expect(created.email).toBe('new.person@gmail.com'); // from the invitation, never from the request
    expect(created.email_confirm).toBe(true); // no confirmation email
    expect(created.user_metadata).toEqual({ full_name: 'Jane Doe' });
    expect(state.memberships).toEqual([{ user_id: 'user-1', tenant_id: TENANT, role: 'HR', account_status: 'ACTIVE' }]);
    expect(state.invitations[0]).toMatchObject({ status: 'accepted', accepted_by: 'user-1' });
  });

  it('cannot be pointed at another address or company: the invitation decides both', async () => {
    await accept({ token: TOKEN, password: 'a-good-password', email: 'victim@x.co', tenant_id: 'tenant-b', role: 'ADMIN' });
    expect((state.createdWith[0] as { email: string }).email).toBe('new.person@gmail.com');
    expect(state.memberships[0]).toMatchObject({ tenant_id: TENANT, role: 'HR' });
  });

  it('is single-use', async () => {
    expect((await accept({ token: TOKEN, password: 'a-good-password' })).status).toBe(200);
    const again = await accept({ token: TOKEN, password: 'another-password' });
    expect(again.status).toBe(404);
    expect(state.authUsers).toHaveLength(1);
  });

  it('refuses unknown, cancelled and expired invitations without creating anything', async () => {
    expect((await accept({ token: 'd'.repeat(64), password: 'a-good-password' })).status).toBe(404);
    for (const patch of [{ status: 'revoked' }, { expires_at: past() }]) {
      state.invitations[0] = { ...state.invitations[0], status: 'pending', expires_at: future(), ...patch };
      expect((await accept({ token: TOKEN, password: 'a-good-password' })).status).toBe(404);
    }
    expect(state.authUsers).toHaveLength(0);
    expect(state.memberships).toHaveLength(0);
  });

  it('rejects a bad token or a weak password before touching anything', async () => {
    expect((await accept({ password: 'a-good-password' })).status).toBe(400);
    expect((await accept({ token: 'short', password: 'a-good-password' })).status).toBe(400);
    expect((await accept({ token: TOKEN, password: 'short' })).status).toBe(400);
    expect((await accept({ token: TOKEN })).status).toBe(400);
    expect(state.invitations[0].status).toBe('pending');
    expect(state.authUsers).toHaveLength(0);
  });

  it('when the address already has an account, says so and leaves the invitation usable for signing in', async () => {
    state.authUsers = [{ id: 'old-user', email: 'new.person@gmail.com' }];
    const res = await accept({ token: TOKEN, password: 'a-good-password' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'account_exists' });
    expect(state.invitations[0].status).toBe('pending'); // still valid: they sign in and join with it
    expect(state.memberships).toHaveLength(0);
    expect(state.authUsers).toHaveLength(1); // the existing account is untouched
  });

  it('two requests with the same link cannot both create an account: the loser creates nothing', async () => {
    state.lostRace = true;
    const res = await accept({ token: TOKEN, password: 'a-good-password' });
    expect(res.status).toBe(404);
    expect(state.createdWith).toHaveLength(0);
    expect(state.memberships).toHaveLength(0);
  });

  it('undoes everything if joining the company fails, so the link still works', async () => {
    state.failMembership = true;
    const res = await accept({ token: TOKEN, password: 'a-good-password' });
    expect(res.status).toBe(500);
    expect(state.deleted).toEqual(['user-1']);
    expect(state.authUsers).toHaveLength(0);
    expect(state.invitations[0].status).toBe('pending');
  });
});
