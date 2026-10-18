import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rows: [] as unknown[], error: null as unknown, rpc: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        order: () => Promise.resolve({ data: db.rows, error: db.error }),
      };
      return b;
    },
    rpc: (...args: unknown[]) => db.rpc(...args),
  },
}));

import {
  fallbackRoles,
  grantableRoles,
  moduleAllowedForBase,
  normaliseRoles,
  roleDisplayName,
  roleKeyFor,
  roleSelection,
  rolesApi,
  type CompanyRole,
} from './roles';

const sys = (key: string, name: string): CompanyRole => ({ id: `id-${key}`, role_key: key, name, description: null, base_role: key as CompanyRole['base_role'], is_system: true, active: true });
const own = (id: string, name: string, base: CompanyRole['base_role'], active = true): CompanyRole => ({
  id, role_key: `CR_${id}`, name, description: null, base_role: base, is_system: false, active,
});

describe('module limits (the same as the database)', () => {
  it('keeps settings and role management to roles based on Administrator', () => {
    expect(moduleAllowedForBase('ADMIN', 'settings')).toBe(true);
    expect(moduleAllowedForBase('HR', 'settings')).toBe(false);
    expect(moduleAllowedForBase('MANAGER', 'role-permissions')).toBe(false);
  });

  it('lets a role based on Staff hold the task modules but not payroll', () => {
    expect(moduleAllowedForBase('STAFF', 'task-manager')).toBe(true);
    expect(moduleAllowedForBase('STAFF', 'task-projects')).toBe(true);
    expect(moduleAllowedForBase('STAFF', 'invite-people')).toBe(true);
    expect(moduleAllowedForBase('STAFF', 'payroll')).toBe(false);
    expect(moduleAllowedForBase('MANAGER', 'payroll')).toBe(true);
  });
});

describe('normaliseRoles', () => {
  it('lists the system roles in the usual order, then the company’s own by name, and fills in missing system roles', () => {
    const roles = normaliseRoles([
      own('b', 'Supervisors', 'MANAGER'),
      sys('HR', 'People Team'),
      own('a', 'Operators', 'STAFF'),
      { nonsense: true },
    ]);
    expect(roles.map((r) => r.name)).toEqual([
      'Administrator', 'People Team', 'Checker', 'Manager', 'Regional Manager', 'Operations', 'Staff', 'Operators', 'Supervisors',
    ]);
    expect(roles.find((r) => r.role_key === 'ADMIN')?.id).toBeNull(); // made up: the company has no row for it
  });

  it('falls back to the seven system roles', () => {
    expect(normaliseRoles(null)).toEqual(fallbackRoles());
  });
});

describe('names, keys and selections', () => {
  const roles = normaliseRoles([sys('HR', 'People Team'), own('a', 'Operators', 'STAFF')]);

  it('shows the custom role’s name, else the company’s name for the system role', () => {
    expect(roleDisplayName(roles, 'STAFF', 'a')).toBe('Operators');
    expect(roleDisplayName(roles, 'HR', null)).toBe('People Team');
    expect(roleDisplayName(roles, 'MANAGER')).toBe('Manager');
    expect(roleDisplayName([], 'CHECKER')).toBe('Checker');
    expect(roleDisplayName(roles, 'STAFF', 'gone')).toBe('Staff');
  });

  it('picking a role sets the base role and the company role (none for a system role)', () => {
    expect(roleSelection(roles.find((r) => r.name === 'Operators')!)).toEqual({ role: 'STAFF', companyRoleId: 'a' });
    expect(roleSelection(roles.find((r) => r.name === 'People Team')!)).toEqual({ role: 'HR', companyRoleId: null });
    expect(roleKeyFor(roles, 'STAFF', 'a')).toBe('CR_a');
    expect(roleKeyFor(roles, 'HR', null)).toBe('HR');
  });
});

describe('grantableRoles (as user_may_grant in the database)', () => {
  const roles = normaliseRoles([own('a', 'Operators', 'STAFF'), own('b', 'Supervisors', 'MANAGER'), own('c', 'Old', 'STAFF', false), own('d', 'Cashiers', 'STAFF')]);
  const modules: Record<string, string[]> = { CR_a: ['dashboard'], CR_d: ['expenses'] };

  it('an administrator gives any active role', () => {
    expect(grantableRoles(roles, 'ADMIN').map((r) => r.name)).toEqual([
      'Administrator', 'Human Resources', 'Checker', 'Manager', 'Regional Manager', 'Operations', 'Staff', 'Cashiers', 'Operators', 'Supervisors',
    ]);
  });

  it('anyone else gives roles based on Staff whose modules they hold', () => {
    expect(grantableRoles(roles, 'HR', ['dashboard'], (r) => modules[r.role_key]).map((r) => r.name)).toEqual(['Staff', 'Operators']);
    // not knowing a role's modules, it is offered and the database decides
    expect(grantableRoles(roles, 'HR').map((r) => r.name)).toEqual(['Staff', 'Cashiers', 'Operators']);
  });
});

describe('rolesApi', () => {
  it('lists the company’s roles, or the system roles when they cannot be loaded', async () => {
    db.rows = [own('a', 'Operators', 'STAFF')];
    db.error = null;
    expect((await rolesApi.list()).map((r) => r.name)).toContain('Operators');
    db.error = { message: 'relation "company_roles" does not exist' };
    expect(await rolesApi.list()).toEqual(fallbackRoles());
  });

  it('calls the database functions and passes their errors on as messages', async () => {
    db.rpc.mockResolvedValueOnce({ data: 'new-id', error: null });
    expect(await rolesApi.create({ name: 'Pickers', baseRole: 'STAFF', modules: ['dashboard'] })).toBe('new-id');
    expect(db.rpc).toHaveBeenCalledWith('create_company_role', { p_name: 'Pickers', p_base_role: 'STAFF', p_description: null, p_modules: ['dashboard'] });

    db.rpc.mockResolvedValueOnce({ data: null, error: { message: '1 person has this role. Move them to another role first.' } });
    await expect(rolesApi.remove('a')).rejects.toThrow(/Move them to another role first/);

    db.rpc.mockResolvedValueOnce({ data: null, error: null });
    await rolesApi.assign('u1', 'a');
    expect(db.rpc).toHaveBeenLastCalledWith('assign_company_role', { p_user: 'u1', p_role: 'a' });

    db.rpc.mockResolvedValueOnce({ data: [{ role_key: 'CR_a', people: 2 }], error: null });
    expect(await rolesApi.holders()).toEqual({ CR_a: 2 });
  });
});
