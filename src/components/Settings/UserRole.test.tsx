import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// User management with the company's own roles (FIG-827): roles are shown and picked by the company's names, and a
// new role is given through the database (assign_company_role), which checks who may give it.
const api = vi.hoisted(() => ({ listUsers: vi.fn(), updateUser: vi.fn(), createUser: vi.fn(), assign: vi.fn() }));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/adminApi', () => ({ adminApi: { listUsers: api.listUsers, updateUser: api.updateUser, createUser: api.createUser } }));
vi.mock('../../lib/staffEmployee', () => ({ assertEmployeeForStaffLogin: async () => undefined }));
vi.mock('./EmployeeNumbering', () => ({ default: () => null }));
vi.mock('./ApprovalWorkflows', () => ({ default: () => null }));
vi.mock('./TwoStepSignIn', () => ({ default: () => null }));
vi.mock('./MyTwoStep', () => ({ default: () => null }));
vi.mock('./CareersSettings', () => ({ default: () => null }));
vi.mock('../Loans/LoanSettingsCard', () => ({ default: () => null }));
vi.mock('../../lib/roles', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/roles')>();
  const roles = real.normaliseRoles([
    { id: 'r-staff', role_key: 'STAFF', name: 'Staff', description: null, base_role: 'STAFF', is_system: true, active: true },
    { id: 'r-op', role_key: 'CR_op', name: 'Operators', description: null, base_role: 'STAFF', is_system: false, active: true },
    { id: 'r-sup', role_key: 'CR_sup', name: 'Supervisors', description: null, base_role: 'MANAGER', is_system: false, active: true },
  ]);
  return {
    ...real,
    useCompanyRoles: () => ({ roles, loaded: true, reload: async () => roles }),
    rolesApi: { ...real.rolesApi, assign: api.assign },
  };
});

import UserRolesSettings from './UserRole';

beforeEach(() => {
  api.listUsers.mockReset().mockResolvedValue([
    { id: 'u1', email: 'op@a.co', role: 'STAFF', company_role_id: 'r-op', account_status: 'ACTIVE', last_sign_in_at: null, created_at: '2026-10-01' },
    { id: 'u2', email: 'plain@a.co', role: 'STAFF', company_role_id: null, account_status: 'ACTIVE', last_sign_in_at: null, created_at: '2026-10-01' },
  ]);
  api.updateUser.mockReset().mockResolvedValue({});
  api.createUser.mockReset().mockResolvedValue({ id: 'u3' });
  api.assign.mockReset().mockResolvedValue(null);
});
afterEach(() => cleanup());

const open = async () => {
  render(<MemoryRouter><UserRolesSettings /></MemoryRouter>);
  await screen.findByText('op@a.co');
};

describe('UserRolesSettings with company roles', () => {
  it('shows each person’s role by the company’s name and filters by it', async () => {
    await open();
    expect(screen.getByText('Operators', { selector: 'span' })).toBeTruthy();
    const filter = screen.getByLabelText('Filter by role');
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining(['Operators', 'Supervisors']));
    fireEvent.change(filter, { target: { value: 'CR_op' } });
    expect(screen.queryByText('plain@a.co')).toBeNull();
    expect(screen.getByText('op@a.co')).toBeTruthy();
  });

  it('gives a new role through the database, then saves the rest through the admin API', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for plain@a.co' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit User/ }));
    const picker = screen.getByRole('group', { name: 'Role' });
    expect(within(picker).getByRole('button', { name: 'Staff' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(picker).getByRole('button', { name: 'Supervisors' }));
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith('u2', 'r-sup'));
    expect(api.updateUser).toHaveBeenCalledWith('u2', expect.not.objectContaining({ role: expect.anything() }));
  });

  it('creates a login with a custom role (its base role and its id)', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Add New User/ }));
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), { target: { value: 'new@a.co' } });
    const [pw, confirm] = screen.getAllByPlaceholderText('••••••');
    fireEvent.change(pw, { target: { value: 'secret12' } });
    fireEvent.change(confirm, { target: { value: 'secret12' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Role' })).getByRole('button', { name: 'Operators' }));
    fireEvent.click(screen.getByRole('button', { name: /Create User/ }));
    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@a.co', role: 'STAFF', company_role_id: 'r-op' })));
  });
});
