import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const db = vi.hoisted(() => ({
  roles: [] as { role_name: string; display_name: string; description: string | null; is_system: boolean; permissions: string[] }[],
  updates: [] as { row: Record<string, unknown>; role: string }[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  updateError: null as null | { message: string },
}));

const freshRoles = () => [
  { role_name: 'ADMIN', display_name: 'Administrator', description: null, is_system: true, permissions: [] },
  { role_name: 'HR', display_name: 'Human Resources', description: 'Employee & payroll management', is_system: false, permissions: ['dashboard'] },
  { role_name: 'STAFF', display_name: 'Staff', description: null, is_system: true, permissions: [] },
  { role_name: 'FIELD_OFFICER', display_name: 'Field Officer', description: null, is_system: false, permissions: ['dashboard'] },
];

vi.mock('../../lib/supabase', () => {
  const permissions = [
    { id: 'p1', module_name: 'Dashboard', module_id: 'dashboard', description: 'Main dashboard', category: 'overview' },
    { id: 'p2', module_name: 'SMS Center', module_id: 'sms', description: 'Send SMS', category: 'workspace' },
  ];
  const query = (rows: () => unknown[]) => {
    const b: Record<string, unknown> = {
      select: () => b,
      order: () => b,
      then: (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null }),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) =>
        table === 'permissions'
          ? query(() => permissions)
          : {
              ...query(() => db.roles.map((r) => ({ ...r, permissions: [...r.permissions] }))),
              update: (row: Record<string, unknown>) => ({
                eq: (_col: string, role: string) => ({
                  select: async () => {
                    if (db.updateError) return { data: null, error: db.updateError };
                    db.updates.push({ row, role });
                    const r = db.roles.find((x) => x.role_name === role);
                    if (r) Object.assign(r, row);
                    return { data: [{ role_name: role }], error: null };
                  },
                }),
              }),
            },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        db.rpcs.push({ fn, args });
        if (fn === 'create_company_role') {
          db.roles.push({ role_name: 'DRIVER', display_name: String(args.p_name), description: null, is_system: false, permissions: [] });
          return { data: 'DRIVER', error: null };
        }
        if (fn === 'delete_company_role') {
          db.roles = db.roles.filter((r) => r.role_name !== args.p_role);
          return { data: 2, error: null };
        }
        return { data: null, error: { message: `unexpected ${fn}` } };
      },
    },
  };
});

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from 'react-hot-toast';
import RolePermissions from './RolePermissions';
import { queryClient, queryKeys } from '../../lib/queryClient';

const invalidateSpy = () => vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
let invalidate: ReturnType<typeof invalidateSpy>;
beforeEach(() => {
  invalidate = invalidateSpy();
  db.roles = freshRoles();
  db.updates = [];
  db.rpcs = [];
  db.updateError = null;
  vi.mocked(toast.error).mockClear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => cleanup());

const open = async () => {
  render(<RolePermissions />);
  await screen.findByRole('switch', { name: /Dashboard/ });
};
const roleList = () => within(screen.getByRole('group', { name: 'Select Role' }));
const role = (name: string) => roleList().getByRole('button', { name: new RegExp(name) });
const smsSwitch = () => screen.getByRole('switch', { name: /SMS Center/ });

describe('RolePermissions', () => {
  it('lists the company’s own roles by name; the administrator has everything and cannot be changed', async () => {
    await open();
    expect(roleList().getAllByRole('button').map((b) => b.textContent)).toEqual(['AdministratorAll', 'Staff0', 'Field Officer1', 'Human Resources1']);
    // ADMIN starts selected: every switch on, none can be flipped, nothing to rename or delete
    expect(smsSwitch().getAttribute('aria-checked')).toBe('true');
    expect((smsSwitch() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Administrators always have access/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Grant All' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete role/ })).toBeNull();
  });

  it('toggles by keyboard-reachable switches and saves only the selected role', async () => {
    await open();
    fireEvent.click(role('Human Resources'));
    expect(smsSwitch().getAttribute('aria-checked')).toBe('false');

    fireEvent.click(smsSwitch());
    expect(smsSwitch().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0]).toMatchObject({ role: 'HR', row: { permissions: ['dashboard', 'sms'] } });
    // the sidebar's cached permissions are refreshed so the change shows without a reload
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myPermissions });
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
  });

  it('shows why the database refused a save (e.g. a module you do not have yourself)', async () => {
    db.updateError = { message: 'You can only give a role modules you have yourself' };
    await open();
    fireEvent.click(role('Field Officer'));
    fireEvent.click(smsSwitch());
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/modules you have yourself/)));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('really discards unsaved edits when you switch roles', async () => {
    await open();
    fireEvent.click(role('Human Resources'));
    fireEvent.click(smsSwitch()); // HR now has sms, unsaved
    expect(role('Human Resources').textContent).toContain('2');

    fireEvent.click(role('Field Officer')); // confirm -> discard
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.queryByText('Unsaved changes')).toBeNull();

    expect(role('Human Resources').textContent).toContain('1');
    fireEvent.click(role('Human Resources'));
    expect(smsSwitch().getAttribute('aria-checked')).toBe('false');
    expect(db.updates).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled(); // nothing was saved, so nothing to refresh
  });

  it('stays on the role when you decline to discard', async () => {
    await open();
    fireEvent.click(role('Human Resources'));
    fireEvent.click(smsSwitch());
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);

    fireEvent.click(role('Field Officer'));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(smsSwitch().getAttribute('aria-checked')).toBe('true'); // still HR's edited view
    expect(role('Human Resources').getAttribute('aria-pressed')).toBe('true');
  });

  it('filters permissions by search', async () => {
    await open();
    fireEvent.change(screen.getByPlaceholderText('Search permissions...'), { target: { value: 'sms' } });
    expect(screen.queryByRole('switch', { name: /Dashboard/ })).toBeNull();
    expect(smsSwitch()).toBeTruthy();
  });

  it('creates a new role and selects it, ready for its modules', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /New role/ }));
    const form = within(screen.getByRole('form', { name: 'New role' }));
    fireEvent.change(form.getByPlaceholderText('e.g. Field Officer'), { target: { value: 'Driver' } });
    fireEvent.click(form.getByRole('button', { name: 'Create role' }));
    await waitFor(() => expect(db.rpcs).toEqual([{ fn: 'create_company_role', args: { p_name: 'Driver', p_description: null, p_permissions: [] } }]));
    await waitFor(() => expect(role('Driver').getAttribute('aria-pressed')).toBe('true'));
    expect(smsSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('renames a role: only its name changes', async () => {
    await open();
    fireEvent.click(role('Human Resources'));
    fireEvent.click(screen.getByRole('button', { name: /Rename/ }));
    const form = within(screen.getByRole('form', { name: 'Rename role' }));
    fireEvent.change(form.getByDisplayValue('Human Resources'), { target: { value: 'People Team' } });
    fireEvent.click(form.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0]).toMatchObject({ role: 'HR', row: { display_name: 'People Team' } });
    expect(await screen.findByRole('button', { name: /People Team/ })).toBeTruthy();
  });

  it('deletes a role, moving its people to the role you choose', async () => {
    await open();
    fireEvent.click(role('Field Officer'));
    fireEvent.click(screen.getByRole('button', { name: /Delete role/ }));
    const form = within(screen.getByRole('form', { name: 'Delete role' }));
    fireEvent.change(form.getByRole('combobox'), { target: { value: 'STAFF' } });
    fireEvent.click(form.getByRole('button', { name: /Delete Field Officer/ }));
    await waitFor(() => expect(db.rpcs).toEqual([{ fn: 'delete_company_role', args: { p_role: 'FIELD_OFFICER', p_replacement: 'STAFF' } }]));
    await waitFor(() => expect(roleList().queryByRole('button', { name: /Field Officer/ })).toBeNull());
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/2 people were moved to Staff/));
  });

  it('lets staff be renamed but never deleted', async () => {
    await open();
    fireEvent.click(role('Staff'));
    expect(screen.getByRole('button', { name: /Rename/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Delete role/ })).toBeNull();
    expect(screen.getByText('Built in')).toBeTruthy();
  });
});
