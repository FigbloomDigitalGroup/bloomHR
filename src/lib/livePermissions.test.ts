import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

type Handler = () => void;
const h = vi.hoisted(() => ({
  auth: [] as ((event: string, session: { user: { id: string } } | null) => void)[],
  channels: [] as { name: string; on: { table: string; filter?: string; cb: Handler }[]; removed: boolean }[],
}));
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: { user: { id: string } } | null) => void) => {
        h.auth.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    channel: (name: string) => {
      const ch = { name, on: [] as { table: string; filter?: string; cb: Handler }[], removed: false };
      h.channels.push(ch);
      const api = {
        on: (_type: string, opts: { table: string; filter?: string }, cb: Handler) => {
          ch.on.push({ table: opts.table, filter: opts.filter, cb });
          return api;
        },
        subscribe: () => ch,
      };
      return api;
    },
    removeChannel: async (ch: { removed: boolean }) => {
      ch.removed = true;
    },
  },
}));

import { refreshPermissionsOnRoleChange } from './livePermissions';
import { queryKeys } from './queryClient';

const fire = (event: string, userId: string | null) => h.auth.forEach((l) => l(event, userId ? { user: { id: userId } } : null));

describe('refreshPermissionsOnRoleChange', () => {
  it('a change to the roles, or to your own profile, makes the permissions reload', () => {
    const client = new QueryClient();
    refreshPermissionsOnRoleChange(client);
    fire('INITIAL_SESSION', 'u1');

    expect(h.channels).toHaveLength(1);
    const ch = h.channels[0];
    expect(ch.on.map((o) => o.table)).toEqual(['role_permissions', 'company_roles', 'user_profiles']);
    expect(ch.on.find((o) => o.table === 'user_profiles')?.filter).toBe('user_id=eq.u1');

    client.setQueryData(queryKeys.myPermissions, { role: 'STAFF', permissions: [] });
    ch.on[0].cb();
    expect(client.getQueryState(queryKeys.myPermissions)?.isInvalidated).toBe(true);
  });

  it('listens once per person: a token refresh keeps the channel, signing out drops it', () => {
    h.channels.length = 0;
    h.auth.length = 0;
    refreshPermissionsOnRoleChange(new QueryClient());
    fire('SIGNED_IN', 'u2');
    fire('TOKEN_REFRESHED', 'u2');
    expect(h.channels).toHaveLength(1);

    fire('SIGNED_OUT', null);
    expect(h.channels[0].removed).toBe(true);

    fire('SIGNED_IN', 'u3');
    expect(h.channels).toHaveLength(2);
    expect(h.channels[1].name).toBe('my-permissions-u3');
  });
});
