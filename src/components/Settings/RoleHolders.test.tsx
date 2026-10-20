import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// "Who has this role" on the Roles screen: the people, and giving one of them another role.
const db = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => db.rpc(...args),
    auth: { getUser: async () => ({ data: { user: { id: 'u-me' } } }) },
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from 'react-hot-toast';
import RoleHolders from './RoleHolders';
import type { CompanyRole } from '../../lib/roles';

const role = (id: string, key: string, name: string, base: CompanyRole['base_role'], extra: Partial<CompanyRole> = {}): CompanyRole => ({
  id, role_key: key, name, description: null, base_role: base, is_system: !key.startsWith('CR_'), active: true, ...extra,
});
const roles: CompanyRole[] = [
  role('r-admin', 'ADMIN', 'Administrator', 'ADMIN'),
  role('r-hr', 'HR', 'Human Resources', 'HR', { description: 'People work' }),
  role('r-staff', 'STAFF', 'Staff', 'STAFF'),
  role('r-op', 'CR_op', 'Operators', 'STAFF'),
  role('r-old', 'CR_old', 'Old role', 'STAFF', { active: false }),
];
const people = [
  { user_id: 'u-1', full_name: 'Amina Otieno', email: 'amina@co.ke', location: 'Nairobi', account_status: 'ACTIVE' },
  { user_id: 'u-me', full_name: 'Me Myself', email: 'me@co.ke', location: null, account_status: 'ACTIVE' },
  { user_id: 'u-2', full_name: null, email: 'nobody@co.ke', location: 'Kisumu', account_status: 'SUSPENDED' },
];

beforeEach(() => {
  db.rpc.mockReset().mockImplementation(async (fn: string) => {
    if (fn === 'company_role_holder_list') return { data: people, error: null };
    return { data: null, error: null };
  });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => cleanup());

const open = async (onChanged = vi.fn()) => {
  render(<RoleHolders role={roles[3]} roles={roles} count={3} onChanged={onChanged} />);
  await screen.findByRole('list', { name: 'People with Operators' });
  return onChanged;
};

describe('RoleHolders', () => {
  it('lists the people with the role: name, email and location', async () => {
    await open();
    expect(db.rpc).toHaveBeenCalledWith('company_role_holder_list', { p_role_key: 'CR_op' });
    const list = screen.getByRole('list', { name: 'People with Operators' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Amina Otieno');
    expect(rows[0].textContent).toContain('amina@co.ke');
    expect(rows[0].textContent).toContain('Nairobi');
    // no name: shown by email; no location: said so
    expect(rows[2].textContent).toContain('nobody@co.ke');
    expect(rows[2].textContent).toContain('Suspended');
    expect(rows[1].textContent).toContain('No location');
  });

  it('nobody can change their own role', async () => {
    await open();
    expect((screen.getByRole('button', { name: 'Change role for Me Myself' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Change role for Amina Otieno' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('changes a role through assign_company_role, offering only active roles other than this one', async () => {
    const onChanged = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Change role for Amina Otieno' }));
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getByRole('combobox', { name: 'New role' }) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(['Choose a role', 'Administrator', 'Human Resources', 'Staff']);
    const confirm = within(dialog).getByRole('button', { name: 'Change role' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(select, { target: { value: 'HR' } });
    expect(within(dialog).getByText('People work')).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith('assign_company_role', { p_user: 'u-1', p_role: 'r-hr' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Amina Otieno now has the role Human Resources');
    expect(within(screen.getByRole('list', { name: 'People with Operators' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the database’s refusal and keeps the person listed', async () => {
    db.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'company_role_holder_list') return { data: people, error: null };
      if (fn === 'assign_company_role') return { data: null, error: { message: 'Only an administrator can give this role' } };
      return { data: null, error: null };
    });
    const onChanged = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Change role for Amina Otieno' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'New role' }), { target: { value: 'ADMIN' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change role' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only an administrator can give this role'));
    expect(onChanged).not.toHaveBeenCalled();
    expect(within(screen.getByRole('list', { name: 'People with Operators' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('says when nobody has the role, and when the list cannot be loaded', async () => {
    db.rpc.mockImplementation(async () => ({ data: [], error: null }));
    render(<RoleHolders role={roles[3]} roles={roles} count={0} />);
    expect(await screen.findByText(/Nobody has this role yet/)).toBeTruthy();
    cleanup();

    db.rpc.mockImplementation(async () => ({ data: null, error: { message: 'function does not exist' } }));
    render(<RoleHolders role={roles[3]} roles={roles} count={2} />);
    expect((await screen.findByRole('alert')).textContent).toContain('function does not exist');
  });
});
