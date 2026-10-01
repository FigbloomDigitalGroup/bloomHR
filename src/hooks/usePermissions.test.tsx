import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getUser = vi.fn();
const single = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => getUser() },
    from: () => ({ select: () => ({ eq: () => ({ single: () => single() }) }) }),
  },
}));

import { usePermissions } from './usePermissions';

const loginAs = (role?: string) =>
  getUser.mockResolvedValue({ data: { user: role === undefined ? null : { user_metadata: { role } } } });

const load = async () => {
  const hook = renderHook(() => usePermissions());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook.result.current;
};

beforeEach(() => {
  vi.clearAllMocks();
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
});
