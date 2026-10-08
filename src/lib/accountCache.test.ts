import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const listeners = vi.hoisted(() => [] as ((event: string) => void)[]);
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string) => void) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));

import { forgetAccountOnSignInOut } from './accountCache';
import { queryKeys } from './queryClient';

const fire = (event: string) => listeners.forEach((l) => l(event));

describe('forgetAccountOnSignInOut', () => {
  it('a sign-in after sign-out does not reuse the "no permissions" answer cached during sign-out', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } } });
    forgetAccountOnSignInOut(client);

    // fetched while signing out, with no screen open to hear the next sign-in
    client.setQueryData(queryKeys.myPermissions, { role: null, permissions: [] });
    expect(client.getQueryState(queryKeys.myPermissions)?.isInvalidated).toBe(false);

    fire('SIGNED_IN');
    expect(client.getQueryState(queryKeys.myPermissions)?.isInvalidated).toBe(true);
  });

  it('signing out forgets the permissions and companies', () => {
    const client = new QueryClient();
    forgetAccountOnSignInOut(client);
    client.setQueryData(queryKeys.myPermissions, { role: 'ADMIN', permissions: ['x'] });
    client.setQueryData(queryKeys.myCompanies, [{ tenant_id: 'a' }]);

    fire('SIGNED_OUT');
    expect(client.getQueryData(queryKeys.myPermissions)).toBeUndefined();
    expect(client.getQueryData(queryKeys.myCompanies)).toBeUndefined();
  });
});
