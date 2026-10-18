import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { RoleSummary, lockedReason, workspaceOf } from './RolePermissions';
import type { CompanyRole } from '../../lib/roles';

afterEach(cleanup);

const role = (over: Partial<CompanyRole>): CompanyRole => ({
  id: 'r1', role_key: 'CR_x', name: 'Payroll clerk', description: null, base_role: 'MANAGER', is_system: false, active: true, ...over,
});

describe('What this role can do', () => {
  it('a Manager-based role with Payroll: admin app, and the screens Payroll opens', () => {
    render(<RoleSummary role={role({})} modules={['payroll']} />);
    expect(screen.getByText('Admin app')).toBeTruthy();
    const list = within(screen.getByRole('list', { name: 'Screens it opens' }));
    expect(list.getByText('Payroll')).toBeTruthy();
    expect(list.getByText('Overtime')).toBeTruthy();
    expect(list.queryByText('Employees')).toBeNull();
    expect(list.queryByText('Settings')).toBeNull();
  });

  it('a Staff-based role: the staff portal, what its modules add there, and why some modules are locked', () => {
    render(<RoleSummary role={role({ name: 'Team lead', base_role: 'STAFF' })} modules={['task-projects', 'payroll']} />);
    expect(screen.getByText('Staff portal')).toBeTruthy();
    expect(screen.getByText('Manage projects (create projects, assign tasks to teams)')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Screens it opens' })).toBeNull();
    expect(screen.getByText(/Roles based on Staff never get Payroll/)).toBeTruthy();
  });

  it('a module the base role may not hold opens nothing even if it is in the list', () => {
    render(<RoleSummary role={role({ base_role: 'HR' })} modules={['settings']} />);
    const list = within(screen.getByRole('list', { name: 'Screens it opens' }));
    expect(list.queryByText('Settings')).toBeNull();
    expect(list.queryByText('Audit Trail')).toBeNull();
    // only the screens open to everyone in the admin app
    expect(list.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Organogram', 'Company profile', 'Appearance']);
  });

  it('administrators can do everything', () => {
    render(<RoleSummary role={role({ name: 'Owner', base_role: 'ADMIN' })} modules={[]} />);
    expect(screen.getByText(/Every screen and every action/)).toBeTruthy();
  });

  it('says where each base role works and why a module is locked', () => {
    expect(workspaceOf('STAFF').label).toBe('Staff portal');
    expect(workspaceOf('CHECKER').label).toBe('Admin app');
    expect(lockedReason('MANAGER', 'settings')).toBe('Only for roles based on Administrator');
    expect(lockedReason('STAFF', 'hr-admin')).toBe('Not for roles based on Staff');
    expect(lockedReason('STAFF', 'task-projects')).toBeNull();
  });
});
