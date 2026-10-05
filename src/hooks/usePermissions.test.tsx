import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

const getUser = vi.fn();
const single = vi.fn();
const onAuthStateChange = vi.fn();
const unsubscribe = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => getUser(),
      onAuthStateChange: (cb: (event: string) => void) => {
        onAuthStateChange(cb);
        return { data: { subscription: { unsubscribe } } };
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ single: () => single() }) }) }),
  },
}));

import { usePermissions } from './usePermissions';
import { createQueryClient, queryKeys } from '../lib/queryClient';

// a fresh cache per test, with no retries so a failing request shows up straight away
const makeClient = () => {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity, staleTime: 5 * 60 * 1000 } });
  return client;
};
let client = makeClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const loginAs = (role?: string) =>
  getUser.mockResolvedValue({ data: { user: role === undefined ? null : { user_metadata: { role } } } });

const load = async () => {
  const hook = renderHook(() => usePermissions(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook.result.current;
};

beforeEach(() => {
  vi.clearAllMocks();
  client = makeClient();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('usePermissions', () => {
  it('grants nothing when nobody is signed in', async () => {
    loginAs(undefined);
    const p = await load();
    expect(p.userRole).toBeNull();
    expect(p.hasPermission('dashboard')).toBe(false);
  });

  it('grants nothing when the user has no role metadata', async () => {
    getUser.mockResolvedValue({ data: { user: { user_metadata: {} } } });
    const p = await load();
    expect(p.userRole).toBeNull();
    expect(p.hasAnyPermission(['dashboard'])).toBe(false);
  });

  it('gives ADMIN every permission without consulting role_permissions', async () => {
    loginAs('admin');
    single.mockResolvedValue({ data: { permissions: [] }, error: null });
    const p = await load();
    expect(p.userRole).toBe('ADMIN');
    expect(p.hasPermission('payroll')).toBe(true);
    expect(p.hasAllPermissions(['payroll', 'settings'])).toBe(true);
  });

  it('limits a STAFF user to the permissions stored for the role', async () => {
    loginAs('staff');
    single.mockResolvedValue({ data: { permissions: ['dashboard', 'teams'] }, error: null });
    const p = await load();
    expect(p.userRole).toBe('STAFF');
    expect(p.hasPermission('dashboard')).toBe(true);
    expect(p.hasPermission('payroll')).toBe(false);
    expect(p.hasAnyPermission(['payroll', 'teams'])).toBe(true);
    expect(p.hasAllPermissions(['dashboard', 'payroll'])).toBe(false);
  });

  it('fails closed when the permissions query errors', async () => {
    loginAs('MANAGER');
    single.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const p = await load();
    expect(p.userRole).toBe('MANAGER');
    expect(p.permissions).toEqual([]);
    expect(p.hasPermission('dashboard')).toBe(false);
  });

  it('shares one request between every component that asks, and across remounts', async () => {
    loginAs('staff');
    single.mockResolvedValue({ data: { permissions: ['dashboard'] }, error: null });

    const first = renderHook(() => usePermissions(), { wrapper });
    const second = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.hasPermission('dashboard')).toBe(true);

    first.unmount();
    const remounted = renderHook(() => usePermissions(), { wrapper });
    // already cached: no loading flash and no new request
    expect(remounted.result.current.loading).toBe(false);
    expect(remounted.result.current.hasPermission('dashboard')).toBe(true);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(single).toHaveBeenCalledTimes(1);
  });

  it('picks up changed permissions when the cache entry is invalidated', async () => {
    loginAs('staff');
    single.mockResolvedValue({ data: { permissions: ['dashboard'] }, error: null });
    const hook = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.hasPermission('payroll')).toBe(false);

    single.mockResolvedValue({ data: { permissions: ['dashboard', 'payroll'] }, error: null });
    await client.invalidateQueries({ queryKey: queryKeys.myPermissions });
    await waitFor(() => expect(hook.result.current.hasPermission('payroll')).toBe(true));
  });

  it('forgets the previous person when they sign out, and refreshes when someone signs in', async () => {
    loginAs('staff');
    single.mockResolvedValue({ data: { permissions: ['dashboard'] }, error: null });
    const hook = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const listener = onAuthStateChange.mock.calls[0][0] as (event: string) => void;

    // signing out: nobody is signed in any more, and the old person's permissions must be gone
    loginAs(undefined);
    listener('SIGNED_OUT');
    await waitFor(() => expect(hook.result.current.userRole).toBeNull());
    expect(hook.result.current.hasPermission('dashboard')).toBe(false);

    loginAs('admin');
    listener('SIGNED_IN');
    await waitFor(() => expect(hook.result.current.userRole).toBe('ADMIN'));
  });

  it('stops listening to sign-in changes when the component goes away', async () => {
    loginAs('staff');
    single.mockResolvedValue({ data: { permissions: [] }, error: null });
    const hook = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    hook.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
