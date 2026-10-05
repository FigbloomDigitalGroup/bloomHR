import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const db = vi.hoisted(() => ({
  upserts: [] as unknown[],
}));

vi.mock('../../lib/supabase', () => {
  const permissions = [
    { id: 'p1', module_name: 'Dashboard', module_id: 'dashboard', description: 'Main dashboard', category: 'overview' },
    { id: 'p2', module_name: 'SMS Center', module_id: 'sms', description: 'Send SMS', category: 'workspace' },
  ];
  const rolePermissions = [
    { role_name: 'ADMIN', permissions: ['dashboard', 'sms'] },
    { role_name: 'HR', permissions: ['dashboard'] },
  ];
  const query = (rows: unknown[]) => {
    const b: Record<string, unknown> = {
      select: () => b,
      order: () => b,
      then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) =>
        table === 'permissions'
          ? query(permissions)
          : {
              ...query(rolePermissions),
              upsert: async (row: unknown) => {
                db.upserts.push(row);
                return { error: null };
              },
            },
    },
  };
});

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import RolePermissions from './RolePermissions';
import { queryClient, queryKeys } from '../../lib/queryClient';

let invalidate: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
  db.upserts = [];
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => cleanup());

const open = async () => {
  render(<RolePermissions />);
  await screen.findByRole('switch', { name: /Dashboard/ });
};
const role = (name: string) => screen.getByRole('button', { name: new RegExp(name) });
const smsSwitch = () => screen.getByRole('switch', { name: /SMS Center/ });

describe('RolePermissions', () => {
  it('shows each role\'s permission count and the selected role\'s switches', async () => {
    await open();
    expect(role('Administrator').textContent).toContain('2');
    expect(role('Human Resources').textContent).toContain('1');
    expect(smsSwitch().getAttribute('aria-checked')).toBe('true'); // ADMIN starts selected
    expect(screen.getByText(/Administrators always have access/)).toBeTruthy();
  });

  it('toggles by keyboard-reachable switches and saves only the selected role', async () => {
    await open();
    fireEvent.click(role('Human Resources'));
    expect(smsSwitch().getAttribute('aria-checked')).toBe('false');

    fireEvent.click(smsSwitch());
    expect(smsSwitch().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(db.upserts).toHaveLength(1));
    expect(db.upserts[0]).toMatchObject({ role_name: 'HR', permissions: ['dashboard', 'sms'] });
    // the sidebar's cached permissions are refreshed so the change shows without a reload
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myPermissions });
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
  });

  it('really discards unsaved edits when you switch roles', async () => {
    await open();
    fireEvent.click(role('Human Resources'));
    fireEvent.click(smsSwitch()); // HR now has sms, unsaved
    expect(role('Human Resources').textContent).toContain('2');

    fireEvent.click(role('Administrator')); // confirm -> discard
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.queryByText('Unsaved changes')).toBeNull();

    // the old behaviour kept the edit in memory, showing 2 with no Save button
    expect(role('Human Resources').textContent).toContain('1');
    fireEvent.click(role('Human Resources'));
    expect(smsSwitch().getAttribute('aria-checked')).toBe('false');
    expect(db.upserts).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled(); // nothing was saved, so nothing to refresh
  });

  it('stays on the role when you decline to discard', async () => {
    await open();
    fireEvent.click(role('Human Resources'));
    fireEvent.click(smsSwitch());
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);

    fireEvent.click(role('Administrator'));
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
});
