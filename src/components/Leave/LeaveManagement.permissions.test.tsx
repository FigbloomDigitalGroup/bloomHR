import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// Adding, editing and deleting leave types (and holidays) is HR administration (hr-admin), never the role's name.
const state = vi.hoisted(() => ({ role: 'HR', modules: [] as string[] }));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => {
    const has = (m: string) => state.role === 'ADMIN' || state.modules.includes(m);
    return {
      userRole: state.role,
      permissions: state.modules,
      loading: false,
      hasPermission: has,
      hasAnyPermission: (ms: string[]) => ms.some(has),
      hasAllPermissions: (ms: string[]) => ms.every(has),
    };
  },
}));
vi.mock('@supabase/supabase-js', () => {
  const rows = (table: string) =>
    table === 'leave_types'
      ? [{ id: 'lt1', name: 'Annual Leave', description: '', is_deductible: true, is_continuous: false, icon: 'sun' }]
      : [];
  const builder = (table: string) => {
    const result = () => ({ data: rows(table), error: null, count: 0 });
    const b: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'neq', 'in', 'is', 'or', 'not', 'gte', 'lte', 'gt', 'lt', 'ilike', 'order', 'range', 'limit', 'update', 'insert', 'upsert', 'delete', 'match'])
      b[k] = () => b;
    b.single = () => Promise.resolve({ data: null, error: null });
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
    return b;
  };
  const client = {
    from: builder,
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => {
      const ch: Record<string, unknown> = {};
      ch.on = () => ch;
      ch.subscribe = () => ch;
      ch.unsubscribe = () => Promise.resolve();
      return ch;
    },
    removeChannel: () => Promise.resolve(),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }), getSession: () => Promise.resolve({ data: { session: null } }) },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
  };
  return { createClient: () => client };
});
vi.mock('../../lib/leaveYearDb', () => ({ loadLeaveYearSettings: () => Promise.resolve({ startMonth: 1 }) }));
vi.mock('../../lib/approvals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/approvals')>()),
  loadApprovalChains: () => Promise.resolve({}),
}));
vi.mock('./LeaveYearSetting', () => ({ default: () => null }));
vi.mock('./LeaveForfeitReport', () => ({ default: () => null }));
vi.mock('./LeaveScheduler', () => ({ default: () => null }));
vi.mock('./LeaveDocuments', () => ({ default: () => null }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import LeaveManagementSystem from './LeaveManagement';
import { DEFAULT_ROLE_MODULES_AFTER } from '../../lib/__fixtures__/defaultRoleModules';

// what each system role holds by default (after 20261021200000_roles_everywhere.sql)
const { HR, MANAGER } = DEFAULT_ROLE_MODULES_AFTER;

const openTypes = async () => {
  render(<LeaveManagementSystem selectedTown="" onTownChange={() => {}} selectedRegion="" onRegionChange={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Leave Types' }));
  await screen.findByText('Annual Leave');
};

beforeEach(() => {
  state.role = 'HR';
  state.modules = HR;
});
afterEach(() => cleanup());

describe('leave types by module (hr-admin)', () => {
  it('administrators and HR (hr-admin) add, edit and delete leave types', async () => {
    for (const role of ['ADMIN', 'HR']) {
      state.role = role;
      state.modules = role === 'HR' ? HR : [];
      await openTypes();
      expect(screen.getByRole('button', { name: /Add Leave Type/ }), role).toBeTruthy();
      expect(screen.getByRole('button', { name: /Edit/ }), role).toBeTruthy();
      expect(screen.getByRole('button', { name: /Delete/ }), role).toBeTruthy();
      cleanup();
    }
  });

  it('managers (no hr-admin) do not', async () => {
    state.role = 'MANAGER';
    state.modules = MANAGER;
    await openTypes();
    expect(screen.queryByRole('button', { name: /Add Leave Type/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('a role of the company’s own based on Manager, with hr-admin, does', async () => {
    state.role = 'MANAGER';
    state.modules = [...MANAGER, 'hr-admin'];
    await openTypes();
    expect(screen.getByRole('button', { name: /Add Leave Type/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeTruthy();
  });

  it('HR whose role lost hr-admin does not', async () => {
    state.modules = HR.filter((m) => m !== 'hr-admin');
    await openTypes();
    expect(screen.queryByRole('button', { name: /Add Leave Type/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
  });
});
