import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// The termination screen decides by the modules of the person's role (Approve exits, My team's work, HR administration
// and Payroll), never by the role's name; the base role only labels the badge.
const state = vi.hoisted(() => ({
  role: 'ADMIN',
  modules: [] as string[],
  employee: {} as Record<string, unknown>,
  pending: [] as unknown[],
}));

vi.mock('../ProtectedRoutes/UserContext', () => ({
  useUser: () => ({ user: { id: 'u1', email: 'me@a.co', role: state.role, town: '' }, loading: false }),
}));
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
vi.mock('../../hooks/useEmployeeDirectory', () => ({ useEmployeeDirectory: () => ({ employees: [] }) }));
vi.mock('../../hooks/useDepartments', () => ({ useDepartments: () => ({ departments: [] }) }));
vi.mock('../../lib/emailApi', () => ({ sendEmailViaServer: vi.fn() }));
vi.mock('../../lib/supabase', () => {
  const builder = (table: string) => {
    const result = () =>
      table === 'employees'
        ? { data: state.employee, error: null }
        : table === 'termination_requests'
          ? { data: state.pending, error: null }
          : { data: { id: 'u1' }, error: null };
    const b: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'order', 'update', 'insert']) b[k] = () => b;
    b.single = () => Promise.resolve(result());
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
    return b;
  };
  return { supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) }, from: builder } };
});

import ViewEmployeePage from './EmployeeDetails';
import { DEFAULT_ROLE_MODULES_AFTER } from '../../lib/__fixtures__/defaultRoleModules';

// what each system role holds by default (after 20261021200000_roles_everywhere.sql)
const DEFAULTS = DEFAULT_ROLE_MODULES_AFTER;

const as = (role: string, modules: string[] = DEFAULTS[role] ?? []) => {
  state.role = role;
  state.modules = modules;
};

const open = () =>
  render(
    <MemoryRouter initialEntries={['/view/E1']}>
      <Routes>
        <Route path="/view/:id" element={<ViewEmployeePage />} />
      </Routes>
    </MemoryRouter>
  );

const REQUEST = {
  id: 'tr1',
  created_at: '2026-10-01T09:00:00Z',
  termination_date: '2026-10-31',
  termination_reason: 'Redundancy',
  requester: { full_name: 'Max Manager' },
};

beforeEach(() => {
  as('ADMIN', []);
  state.employee = { id: 1, 'Employee Number': 'E1', 'First Name': 'Jane', 'Last Name': 'Doe', 'Job Title': 'Branch Manager', 'Basic Salary': 50000 };
  state.pending = [REQUEST];
});
afterEach(() => cleanup());

describe('pending exit requests (approve by Approve exits)', () => {
  it('administrators see them and can approve', async () => {
    open();
    await screen.findByText('Pending Approval Requests');
    expect(screen.getByRole('button', { name: /Approve/ })).toBeTruthy();
  });

  it('managers (My team’s work, no Approve exits) see them waiting', async () => {
    as('MANAGER');
    open();
    await screen.findByText('Pending Approval Requests');
    expect(screen.getByText('Waiting for admin approval')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });

  it('a manager-based role of the company’s own with Approve exits can approve', async () => {
    as('MANAGER', [...DEFAULTS.MANAGER, 'approve-exits']);
    open();
    await screen.findByText('Pending Approval Requests');
    expect(screen.getByRole('button', { name: /Approve/ })).toBeTruthy();
  });

  it('HR (no My team’s work) does not see the list, as before', async () => {
    as('HR');
    open();
    await screen.findByText('Terminate Employee');
    expect(screen.queryByText('Pending Approval Requests')).toBeNull();
  });
});

describe('terminating', () => {
  it('Approve exits terminates a manager without asking for approval (HR)', async () => {
    as('HR');
    open();
    await screen.findByText('Terminate Employee');
    expect(screen.queryByText('Permission Denied')).toBeNull();
    expect(screen.queryByText('Approval Required')).toBeNull();
    expect(screen.getByRole('button', { name: /Process Termination/ })).toBeTruthy();
  });

  it('HR whose role lost Approve exits needs approval, and without My team’s work may not terminate', async () => {
    as('HR', DEFAULTS.HR.filter((m) => m !== 'approve-exits'));
    open();
    await screen.findByText('Terminate Employee');
    expect(screen.getByText('Permission Denied')).toBeTruthy();
  });

  it('managers terminate but a manager-titled employee needs approval', async () => {
    as('MANAGER');
    open();
    await screen.findByText('Terminate Employee');
    expect(screen.queryByText('Permission Denied')).toBeNull();
    expect(screen.getByText('Approval Required')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Submit for Approval/ })).toBeTruthy();
  });

  it('checkers and regional managers may not terminate', async () => {
    for (const role of ['CHECKER', 'REGIONAL']) {
      as(role);
      open();
      await screen.findByText('Terminate Employee');
      expect(screen.getByText('Permission Denied'), role).toBeTruthy();
      cleanup();
    }
  });
});

describe('pay on the record (HR administration and Payroll together)', () => {
  it('administrators see the basic salary; HR and checkers do not', async () => {
    open();
    expect(await screen.findByText('Basic Salary')).toBeTruthy();
    cleanup();
    for (const role of ['HR', 'CHECKER']) {
      as(role);
      open();
      await screen.findByText('Terminate Employee');
      expect(screen.queryByText('Basic Salary'), role).toBeNull();
      cleanup();
    }
  });

  it('a role of the company’s own with both sees it', async () => {
    as('HR', [...DEFAULTS.HR, 'payroll']);
    open();
    expect(await screen.findByText('Basic Salary')).toBeTruthy();
  });
});
