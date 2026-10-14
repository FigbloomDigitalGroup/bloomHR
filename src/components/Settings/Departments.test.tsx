import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDirectoryEmployee } from '../../lib/employeeDirectory';
import type { Department } from '../../lib/orgStructure';

const state = vi.hoisted(() => ({ canEdit: true, departments: [] as Department[] }));
const addDepartment = vi.hoisted(() => vi.fn());
const updateDepartment = vi.hoisted(() => vi.fn());
const reload = vi.hoisted(() => vi.fn());

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasPermission: () => state.canEdit }),
}));
vi.mock('../../hooks/useDepartments', () => ({
  useDepartments: () => ({ departments: state.departments, loading: false, error: null, reload }),
}));
vi.mock('../../hooks/useEmployeeDirectory', () => ({
  useEmployeeDirectory: () => ({
    employees: [
      toDirectoryEmployee({ id: 'e1', 'Employee Number': 'E1', 'First Name': 'Ann', 'Last Name': 'Head', department_id: 'fin' }),
      toDirectoryEmployee({ id: 'e2', 'Employee Number': 'E2', 'First Name': 'Ben', 'Last Name': 'Clerk', department_id: 'fin' }),
    ],
    loading: false,
    error: null,
  }),
}));
vi.mock('../../lib/orgStructure', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/orgStructure')>()),
  addDepartment,
  updateDepartment,
}));

import Departments from './Departments';

const dept = (id: string, name: string, parent_id: string | null = null, active = true, head: string | null = null): Department =>
  ({ id, name, parent_id, head_employee_id: head, active });

const show = () => render(<MemoryRouter><Departments /></MemoryRouter>);

beforeEach(() => {
  state.canEdit = true;
  state.departments = [dept('hq', 'Head Office'), dept('fin', 'Finance', 'hq', true, 'e1'), dept('old', 'Old Unit', null, false)];
  addDepartment.mockReset();
  updateDepartment.mockReset();
  reload.mockReset();
});
afterEach(() => cleanup());

describe('Departments page', () => {
  it('lists the active departments as a tree, with their people and head', () => {
    show();
    const list = screen.getByRole('list', { name: 'Departments' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Head Office'),
      expect.stringContaining('Finance'),
    ]);
    expect(items[1].textContent).toContain('2 people · Head: Ann Head');
    expect(screen.queryByText('Old Unit')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show inactive'));
    expect(screen.getByText('Old Unit')).toBeTruthy();
  });

  it('searches, keeping the path to a match', () => {
    show();
    fireEvent.change(screen.getByLabelText('Search departments'), { target: { value: 'fin' } });
    expect(screen.getByText('Finance')).toBeTruthy();
    expect(screen.getByText('Head Office')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search departments'), { target: { value: 'zzz' } });
    expect(screen.getByText('No departments match')).toBeTruthy();
  });

  it('adds a department under another', async () => {
    addDepartment.mockResolvedValue(dept('new', 'Payables', 'fin'));
    show();
    fireEvent.click(screen.getByRole('button', { name: /Add department/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Payables' } });
    fireEvent.change(within(dialog).getByLabelText('Part of'), { target: { value: 'fin' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(addDepartment).toHaveBeenCalledWith('Payables', 'fin'));
    expect(reload).toHaveBeenCalled();
  });

  it('never offers a department, or its sub-departments, as its own parent', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Head Office' }));
    const dialog = await screen.findByRole('dialog');
    const options = within(within(dialog).getByLabelText('Part of')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['None (top level)']);
  });

  it('renames and deactivates', async () => {
    updateDepartment.mockResolvedValue(dept('fin', 'Money', 'hq'));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Finance' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Money' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateDepartment).toHaveBeenCalledWith('fin', { name: 'Money', parent_id: 'hq', head_employee_id: 'e1' }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]);
    await waitFor(() => expect(updateDepartment).toHaveBeenCalledWith('hq', { active: false }));
  });

  it('is read-only for people who cannot manage employees', () => {
    state.canEdit = false;
    show();
    expect(screen.getByText('Finance')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add department/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
  });
});
