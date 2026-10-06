import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const result = vi.hoisted(() => ({ value: { data: null as unknown, error: null as unknown } }));
const eq = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (...args: unknown[]) => {
          eq(table, ...args);
          return b;
        },
        maybeSingle: () => Promise.resolve(result.value),
      };
      return b;
    },
  },
}));

import { useCompanyProfile } from './useCompanyProfile';

beforeEach(() => {
  eq.mockClear();
  result.value = { data: null, error: null };
});

describe('useCompanyProfile', () => {
  it('reads the role from user_profiles for the signed-in user', async () => {
    result.value = { data: { role: 'HR', tenant_id: 't1', account_status: 'ACTIVE' }, error: null };
    const { result: hook } = renderHook(() => useCompanyProfile('u1'));
    expect(hook.current.status).toBe('loading');
    await waitFor(() => expect(hook.current).toEqual({ status: 'ready', profile: { role: 'HR', tenantId: 't1', accountStatus: 'ACTIVE' } }));
    expect(eq).toHaveBeenCalledWith('user_profiles', 'user_id', 'u1');
  });

  it('reports "none" for someone who belongs to no company yet', async () => {
    const { result: hook } = renderHook(() => useCompanyProfile('u2'));
    await waitFor(() => expect(hook.current.status).toBe('none'));
  });

  it('reports an error instead of guessing a role', async () => {
    result.value = { data: null, error: { message: 'network down' } };
    const { result: hook } = renderHook(() => useCompanyProfile('u3'));
    await waitFor(() => expect(hook.current).toEqual({ status: 'error', message: 'network down' }));
  });

  it('stays loading while there is no user, and reloads when asked to', async () => {
    const { result: hook, rerender } = renderHook(({ id, key }) => useCompanyProfile(id, key), { initialProps: { id: undefined as string | undefined, key: 0 } });
    expect(hook.current.status).toBe('loading');
    result.value = { data: { role: 'STAFF', tenant_id: 't1', account_status: 'ACTIVE' }, error: null };
    rerender({ id: 'u4', key: 0 });
    await waitFor(() => expect(hook.current.status).toBe('ready'));
    result.value = { data: { role: 'ADMIN', tenant_id: 't2', account_status: 'ACTIVE' }, error: null };
    rerender({ id: 'u4', key: 1 });
    await waitFor(() => expect(hook.current).toMatchObject({ status: 'ready', profile: { role: 'ADMIN', tenantId: 't2' } }));
  });
});
