import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// The roles screen with a company's own roles (FIG-827).
const db = vi.hoisted(() => ({ rpc: vi.fn(), upserts: [] as unknown[] }));

vi.mock('../../lib/supabase', () => {
  const permissions = [
    { id: 'p1', module_name: 'Dashboard', module_id: 'dashboard', description: 'Main dashboard', category: 'overview' },
    { id: 'p2', module_name: 'Task Manager', module_id: 'task-manager', description: 'Tasks', category: 'workspace' },
    {
      id: 'p5', module_name: 'Manage projects', module_id: 'task-projects', category: 'workspace',
      description: 'Create projects, add members, assign tasks to a department or team, set up recurring tasks and labels.',
    },
    { id: 'p3', module_name: 'Payroll', module_id: 'payroll', description: 'Pay', category: 'finance' },
    { id: 'p4', module_name: 'Settings', module_id: 'settings', description: 'Set up', category: 'system' },
  ];
  const companyRoles = [
    { id: 'r-admin', role_key: 'ADMIN', name: 'Administrator', description: null, base_role: 'ADMIN', is_system: true, active: true },
    { id: 'r-hr', role_key: 'HR', name: 'Human Resources', description: null, base_role: 'HR', is_system: true, active: true },
    { id: 'r-staff', role_key: 'STAFF', name: 'Staff', description: null, base_role: 'STAFF', is_system: true, active: true },
    { id: 'r-op', role_key: 'CR_op', name: 'Operators', description: 'Machine operators', base_role: 'STAFF', is_system: false, active: true },
    { id: 'r-sup', role_key: 'CR_sup', name: 'Supervisors', description: null, base_role: 'MANAGER', is_system: false, active: true },
  ];
  const rolePermissions = [
    { role_name: 'ADMIN', permissions: ['dashboard'] },
    { role_name: 'STAFF', permissions: ['dashboard'] },
    { role_name: 'CR_op', permissions: ['dashboard'] },
    { role_name: 'CR_sup', permissions: [] },
  ];
  const query = (rows: unknown[]) => {
    const b: Record<string, unknown> = {
      select: () => b,
      order: () => b,
      then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
      upsert: async (row: unknown) => {
        db.upserts.push(row);
        return { error: null };
      },
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => query(table === 'permissions' ? permissions : table === 'company_roles' ? companyRoles : rolePermissions),
      rpc: (...args: unknown[]) => db.rpc(...args),
    },
  };
});
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from 'react-hot-toast';
import RolePermissions from './RolePermissions';
import { queryClient } from '../../lib/queryClient';

beforeEach(() => {
  vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  db.upserts = [];
  db.rpc.mockReset().mockImplementation(async (fn: string) => {
    if (fn === 'company_role_holders') return { data: [{ role_key: 'CR_op', people: 3 }], error: null };
    return { data: null, error: null };
  });
  vi.mocked(toast.error).mockClear();
});
afterEach(() => cleanup());

const open = async () => {
  render(<RolePermissions />);
  await screen.findByRole('button', { name: /Operators/ });
};
const sw = (name: string) => screen.getByRole('switch', { name: new RegExp(name) });

describe('RolePermissions with the company’s own roles', () => {
  it('lists the standard roles and the company’s own ones apart', async () => {
    await open();
    const own = screen.getByRole('group', { name: 'Your roles' });
    expect(within(own).getAllByRole('button').map((b) => b.textContent)).toEqual(['Operators1', 'Supervisors0']);
    expect(within(screen.getByRole('group', { name: 'Standard roles' })).getByRole('button', { name: /Human Resources/ })).toBeTruthy();
  });

  it('a role based on Staff can get tasks but not payroll or settings, and saving goes through the database function', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Operators/ }));
    expect(screen.getByText(/Based on Staff/)).toBeTruthy();
    expect(sw('Payroll').getAttribute('aria-disabled')).toBe('true');
    expect(sw('Settings').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(sw('Payroll'));
    expect(sw('Payroll').getAttribute('aria-checked')).toBe('false');

    fireEvent.click(sw('Task Manager'));
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith('set_company_role_modules', { p_role: 'r-op', p_modules: ['dashboard', 'task-manager'] }));
    expect(db.upserts).toEqual([]);
  });

  it('lists "Manage projects", which a role based on Staff may hold (FIG-901)', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Operators/ }));
    expect(screen.getByText('Create projects, add members, assign tasks to teams, recurring tasks and labels')).toBeTruthy();
    expect(sw('Manage projects').getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(sw('Manage projects'));
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith('set_company_role_modules', { p_role: 'r-op', p_modules: ['dashboard', 'task-projects'] }));
  });

  it('a role people hold cannot be switched off or deleted until they are moved', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Operators/ }));
    expect(screen.getByText(/3 people have it/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Delete role' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Switch off' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/first give the people who have it another role/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Supervisors/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete role' }));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith('delete_company_role', { p_role: 'r-sup' }));
  });

  it('renames how a standard role is shown', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Human Resources/ }));
    expect(screen.queryByRole('button', { name: 'Delete role' })).toBeNull(); // standard roles stay
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'People Team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith('update_company_role', { p_role: 'r-hr', p_name: 'People Team', p_description: '', p_active: null }));
  });

  it('creates a role on a base role, starting from what that role may hold', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /New role/ }));
    const form = screen.getByRole('form', { name: 'New role' });
    fireEvent.change(within(form).getByPlaceholderText('e.g. Supervisors'), { target: { value: 'Shift leads' } });
    fireEvent.change(within(form).getByRole('combobox'), { target: { value: 'STAFF' } });
    db.rpc.mockImplementation(async (fn: string) => (fn === 'create_company_role' ? { data: 'r-new', error: null } : { data: [], error: null }));
    fireEvent.click(within(form).getByRole('button', { name: 'Create role' }));
    await waitFor(() =>
      expect(db.rpc).toHaveBeenCalledWith('create_company_role', { p_name: 'Shift leads', p_base_role: 'STAFF', p_description: null, p_modules: ['dashboard'] })
    );
  });

  it('shows what the database refuses', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Supervisors/ }));
    db.rpc.mockResolvedValue({ data: null, error: { message: 'You cannot give a role access you do not have yourself' } });
    fireEvent.click(sw('Payroll'));
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to save permissions: You cannot give a role access you do not have yourself'));
  });
});

describe('Preview as this role and who has it', () => {
  it('the preview follows the ticks before they are saved', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Supervisors/ }));
    fireEvent.click(screen.getByRole('button', { name: /Preview as this role/ }));
    const overview = () => screen.getByRole('region', { name: 'Overview' });
    expect(within(overview()).getByRole('list', { name: 'Overview: not shown' }).textContent).toContain('Tick Dashboard');

    fireEvent.click(sw('Dashboard'));
    expect(within(overview()).getByRole('list', { name: 'Overview: shown' }).textContent).toContain('Dashboard');
    expect(db.rpc).not.toHaveBeenCalledWith('set_company_role_modules', expect.anything());
  });

  it('a role based on Staff previews the staff portal', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Operators/ }));
    fireEvent.click(screen.getByRole('button', { name: /Preview as this role/ }));
    expect(screen.getByRole('region', { name: 'Finance' }).textContent).toContain('Payslips');
    expect(screen.queryByRole('region', { name: 'System' })).toBeNull();
  });

  it('lists the people with the selected role', async () => {
    db.rpc.mockImplementation(async (fn: string, args?: { p_role_key?: string }) => {
      if (fn === 'company_role_holders') return { data: [{ role_key: 'CR_op', people: 1 }], error: null };
      if (fn === 'company_role_holder_list') {
        return {
          data: args?.p_role_key === 'CR_op' ? [{ user_id: 'u-1', full_name: 'Amina Otieno', email: 'amina@co.ke', location: 'Nairobi', account_status: 'ACTIVE' }] : [],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Operators/ }));
    const list = await screen.findByRole('list', { name: 'People with Operators' });
    expect(list.textContent).toContain('Amina Otieno');
    expect(screen.getByRole('button', { name: 'Change role for Amina Otieno' })).toBeTruthy();
  });
});
