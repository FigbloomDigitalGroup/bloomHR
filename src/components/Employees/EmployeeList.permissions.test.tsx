import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The employee list's buttons follow the modules of the person's role, never its name:
// Add employee / Manage = employee-edit; Duplicates, Bulk add, Relocate = hr-admin; Terminate = approve-exits;
// Bulk Edit (the pay sheet) = hr-admin and payroll together; ID cards (print several staff ID cards) = staff-id-cards.
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
vi.mock('../../hooks/useBranches', () => ({ useBranches: () => ({ branches: [] }) }));
vi.mock('../../lib/supabase', () => {
  const rows = (table: string) =>
    table === 'employees' ? [{ id: 1, 'Employee Number': 'E1', 'First Name': 'Jane', 'Last Name': 'Doe', Town: 'Nairobi', Branch: 'HQ' }] : [];
  const builder = (table: string) => {
    const result = () => ({ data: rows(table), error: null });
    const b: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'in', 'order', 'range']) b[k] = () => b;
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
    return b;
  };
  return { supabase: { from: builder } };
});
vi.mock('./DuplicateCheckModal', () => ({ default: () => null }));
vi.mock('./BulkEditModal', () => ({ default: () => null }));
vi.mock('./BulkTerminateModal', () => ({ default: () => null }));
vi.mock('../StaffIdCard/StaffIdCardsPrintDialog', () => ({
  default: ({ selectedNumbers }: { selectedNumbers: string[] }) => <div role="dialog">Print ID cards for {selectedNumbers.join(', ') || 'nobody'}</div>,
}));

import EmployeeList from './EmployeeList';
import { DEFAULT_ROLE_MODULES_AFTER } from '../../lib/__fixtures__/defaultRoleModules';

// what each system role holds by default (after 20261021200000_roles_everywhere.sql)
const DEFAULTS = DEFAULT_ROLE_MODULES_AFTER;

const BUTTONS = ['Add Employee', 'Manage', 'Duplicates', 'Bulk add', 'Bulk Edit', 'Relocate', 'ID cards', 'Bulk Terminate', 'Terminate'] as const;

/** the list's buttons someone sees, once the list has loaded (read in one go: the list reloads while it settles) */
const expectButtons = async (role: string, modules: string[], expected: readonly string[]) => {
  state.role = role;
  state.modules = modules;
  render(
    <MemoryRouter>
      <EmployeeList selectedTown="" onTownChange={() => {}} selectedRegion="" onRegionChange={() => {}} />
    </MemoryRouter>
  );
  await waitFor(() => {
    screen.getByText(/Jane/);
    const seen = BUTTONS.filter((name) => screen.queryByRole('button', { name: new RegExp(`^${name}$`) }));
    expect(seen, role).toEqual(expected);
  });
  cleanup();
};

beforeEach(() => {
  state.role = 'HR';
  state.modules = DEFAULTS.HR;
});
afterEach(() => cleanup());

describe('employee list buttons by module', () => {
  it('keep what each system role saw with its default modules', async () => {
    await expectButtons('ADMIN', [], BUTTONS);
    await expectButtons('HR', DEFAULTS.HR, ['Add Employee', 'Manage', 'Duplicates', 'Bulk add', 'Relocate', 'Bulk Terminate', 'Terminate']);
    await expectButtons('MANAGER', DEFAULTS.MANAGER, ['Add Employee', 'Manage']);
    await expectButtons('REGIONAL', DEFAULTS.REGIONAL, ['Add Employee', 'Manage']);
    await expectButtons('CHECKER', DEFAULTS.CHECKER, []);
    await expectButtons('OPERATIONS', DEFAULTS.OPERATIONS, []);
    await expectButtons('STAFF', DEFAULTS.STAFF, []);
  });

  it('a role of the company’s own based on Manager with hr-admin gets HR’s list tools, but not terminations', async () => {
    await expectButtons('MANAGER', [...DEFAULTS.MANAGER, 'hr-admin'], ['Add Employee', 'Manage', 'Duplicates', 'Bulk add', 'Relocate']);
  });

  it('approve-exits alone gives Terminate; hr-admin with payroll gives Bulk Edit', async () => {
    await expectButtons('OPERATIONS', [...DEFAULTS.OPERATIONS, 'approve-exits'], ['Bulk Terminate', 'Terminate']);
    await expectButtons('HR', [...DEFAULTS.HR, 'payroll'], ['Add Employee', 'Manage', 'Duplicates', 'Bulk add', 'Bulk Edit', 'Relocate', 'Bulk Terminate', 'Terminate']);
  });

  it('staff-id-cards alone gives ID cards: tick employees, then print their cards', async () => {
    await expectButtons('OPERATIONS', [...DEFAULTS.OPERATIONS, 'staff-id-cards'], ['ID cards']);
    await expectButtons('HR', [...DEFAULTS.HR, 'staff-id-cards'], ['Add Employee', 'Manage', 'Duplicates', 'Bulk add', 'Relocate', 'ID cards', 'Bulk Terminate', 'Terminate']);

    state.role = 'OPERATIONS';
    state.modules = [...DEFAULTS.OPERATIONS, 'staff-id-cards'];
    render(
      <MemoryRouter>
        <EmployeeList selectedTown="" onTownChange={() => {}} selectedRegion="" onRegionChange={() => {}} />
      </MemoryRouter>
    );
    // the list reloads while it settles: let it finish before ticking
    await waitFor(() => {
      screen.getByText(/Jane/);
      expect(screen.queryByRole('status', { name: 'Loading employees' })).toBeNull();
    });
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.click(await screen.findByRole('button', { name: 'ID cards' }));
    fireEvent.click(await screen.findByText(/Jane/));
    fireEvent.click(await screen.findByRole('button', { name: 'Print ID cards (1)' }));
    expect(screen.getByRole('dialog').textContent).toBe('Print ID cards for E1');
  });

  it('HR whose role lost hr-admin, approve-exits and employee-edit sees none of them', async () => {
    await expectButtons('HR', ['dashboard', 'employees', 'leaves'], []);
  });
  it('shows the Figbloom logo loader while the list loads, then the list', async () => {
    state.role = 'HR';
    state.modules = DEFAULTS.HR;
    render(
      <MemoryRouter>
        <EmployeeList selectedTown="" onTownChange={() => {}} selectedRegion="" onRegionChange={() => {}} />
      </MemoryRouter>
    );
    expect(screen.getByRole('status', { name: 'Loading employees' }).querySelector('.fb-arc')).toBeTruthy();
    await waitFor(() => screen.getByText(/Jane/));
  });
});
