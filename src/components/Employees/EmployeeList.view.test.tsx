import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The list opens on current employees; those who have left (a Terminated or Inactive status, or a termination date
// that has passed) are under Former employees, and All shows both.
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    userRole: 'ADMIN',
    permissions: [],
    loading: false,
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));
vi.mock('../../hooks/useBranches', () => ({ useBranches: () => ({ branches: [] }) }));
vi.mock('../../lib/supabase', () => {
  const people = [
    { id: 1, 'Employee Number': 'E1', 'First Name': 'Jane', 'Last Name': 'Doe', Status: 'Active', Town: 'Nairobi' },
    { id: 2, 'Employee Number': 'E2', 'First Name': 'Lena', 'Last Name': 'Going', Status: 'Active', 'Termination Date': '2999-12-31', Town: 'Nairobi' },
    { id: 3, 'Employee Number': 'E3', 'First Name': 'Tom', 'Last Name': 'Gone', Status: 'Terminated', 'Termination Date': '2026-11-03', Town: 'Nairobi' },
    // the date cleared but the status left behind: still former, as the sign-in check sees them
    { id: 4, 'Employee Number': 'E4', 'First Name': 'Ivy', 'Last Name': 'Left', Status: 'Terminated', 'Termination Date': null, Town: 'Nairobi' },
  ];
  const builder = (table: string) => {
    const result = () => ({ data: table === 'employees' ? people : [], error: null });
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
vi.mock('../StaffIdCard/StaffIdCardsPrintDialog', () => ({ default: () => null }));

import EmployeeList from './EmployeeList';

afterEach(() => cleanup());

const open = async (url = '/employees') => {
  render(
    <MemoryRouter initialEntries={[url]}>
      <EmployeeList selectedTown="" onTownChange={() => {}} selectedRegion="" onRegionChange={() => {}} />
    </MemoryRouter>
  );
  // the list reloads while it settles (as in EmployeeList.permissions.test.tsx): let it finish
  await waitFor(() => {
    screen.getByRole('combobox', { name: 'Show current or former employees' });
    expect(screen.queryByRole('status', { name: 'Loading employees' })).toBeNull();
  });
  await new Promise((r) => setTimeout(r, 50));
  await screen.findByRole('combobox', { name: 'Show current or former employees' });
};
const names = () => ['Jane', 'Lena', 'Tom', 'Ivy'].filter((n) => screen.queryByText(new RegExp(n)));
const view = () => screen.getByRole('combobox', { name: 'Show current or former employees' });

describe('current and former employees', () => {
  it('opens on current employees (those leaving included); Former shows who has left; All shows everyone', async () => {
    await open();
    await waitFor(() => expect(names()).toEqual(['Jane', 'Lena']));
    expect((view() as HTMLSelectElement).value).toBe('current');
    expect(screen.getByText('Leaving')).toBeTruthy();

    fireEvent.change(view(), { target: { value: 'former' } });
    await waitFor(() => expect(names()).toEqual(['Tom', 'Ivy']));
    expect(screen.getAllByText('Former')).toHaveLength(2);
    // nobody who has left can be terminated again
    for (const b of screen.queryAllByRole('button', { name: 'Terminate' })) expect((b as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(view(), { target: { value: 'all' } });
    await waitFor(() => expect(names()).toEqual(['Jane', 'Lena', 'Tom', 'Ivy']));
  });

  it('?view=former opens on former employees', async () => {
    await open('/employees?view=former');
    await waitFor(() => expect(names()).toEqual(['Tom', 'Ivy']));
  });

  it('searching current employees for someone who has left offers to show them', async () => {
    await open('/employees?q=Tom');
    const empty = await screen.findByText('No employees found');
    const card = empty.closest('div')!.parentElement!;
    expect(within(card).getByText(/1 former employee matches/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show former employees' }));
    await waitFor(() => expect(names()).toEqual(['Tom']));
  });
});
