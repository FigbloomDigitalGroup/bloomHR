import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toDirectoryEmployee } from '../../lib/employeeDirectory';
import type { Branch } from '../../lib/branches';

const state = vi.hoisted(() => ({ canEdit: true, branches: [] as Branch[] }));
const addBranch = vi.hoisted(() => vi.fn());
const updateBranch = vi.hoisted(() => vi.fn());
const moveBranchStaff = vi.hoisted(() => vi.fn());
const reload = vi.hoisted(() => vi.fn());

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasAnyPermission: () => state.canEdit, hasPermission: () => state.canEdit }),
}));
vi.mock('../../hooks/useBranches', () => ({
  useBranches: () => ({ branches: state.branches, loading: false, error: null, reload }),
}));
vi.mock('../../hooks/useEmployeeDirectory', () => ({
  useEmployeeDirectory: () => ({
    employees: [
      toDirectoryEmployee({ 'Employee Number': 'E1', 'First Name': 'Ann', Branch: 'Dar es Salaam' }),
      toDirectoryEmployee({ 'Employee Number': 'E2', 'First Name': 'Ben', Branch: 'dar es salaam' }),
      toDirectoryEmployee({ 'Employee Number': 'E3', 'First Name': 'Cat', Branch: null }),
    ],
    loading: false,
    error: null,
  }),
}));
vi.mock('../../lib/branches', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/branches')>()),
  addBranch,
  updateBranch,
  moveBranchStaff,
}));

import Branches from './Branches';

const branch = (id: string, name: string, country: string, extra: Partial<Branch> = {}): Branch => ({
  id, name, country, currency: country === 'Tanzania' ? 'TZS' : country === 'Uganda' ? 'UGX' : 'KES',
  city: null, address: null, active: true, is_default: false, ...extra,
});

beforeEach(() => {
  state.canEdit = true;
  state.branches = [
    branch('hq', 'Nairobi HQ', 'Kenya', { is_default: true, city: 'Nairobi' }),
    branch('dar', 'Dar es Salaam', 'Tanzania'),
    branch('kla', 'Kampala', 'Uganda'),
    branch('old', 'Old office', 'Kenya', { active: false }),
  ];
  addBranch.mockReset();
  updateBranch.mockReset();
  moveBranchStaff.mockReset();
  reload.mockReset();
});
afterEach(() => cleanup());

describe('Branches page', () => {
  it('lists the active branches, the default first, with country, currency and headcount', () => {
    render(<Branches />);
    const items = within(screen.getByRole('list', { name: 'Branches' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Nairobi HQ'),
      expect.stringContaining('Dar es Salaam'),
      expect.stringContaining('Kampala'),
    ]);
    expect(items[0].textContent).toContain('Default');
    // people with no branch count in the default one
    expect(items[0].textContent).toContain('Kenya · KES · Nairobi · 1 person');
    expect(items[1].textContent).toContain('Tanzania · TZS · 2 people');
    expect(screen.queryByText('Old office')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show inactive'));
    expect(screen.getByText('Old office')).toBeTruthy();
  });

  it('adds a branch, the currency following the country', async () => {
    addBranch.mockResolvedValue(branch('new', 'Arusha', 'Tanzania'));
    render(<Branches />);
    fireEvent.click(screen.getByRole('button', { name: /Add branch/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Arusha' } });
    fireEvent.change(within(dialog).getByLabelText('Country'), { target: { value: 'Tanzania' } });
    expect((within(dialog).getByLabelText('Currency') as HTMLInputElement).value).toBe('TZS');
    fireEvent.change(within(dialog).getByLabelText('City'), { target: { value: 'Arusha' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(addBranch).toHaveBeenCalledWith({ name: 'Arusha', country: 'Tanzania', currency: 'TZS', city: 'Arusha', address: null })
    );
    expect(reload).toHaveBeenCalled();
  });

  it('takes another country typed in', async () => {
    addBranch.mockResolvedValue(branch('new', 'Lusaka', 'Zambia'));
    render(<Branches />);
    fireEvent.click(screen.getByRole('button', { name: /Add branch/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Lusaka' } });
    fireEvent.change(within(dialog).getByLabelText('Country'), { target: { value: '__other__' } });
    fireEvent.change(within(dialog).getByLabelText('Other country'), { target: { value: 'Zambia' } });
    fireEvent.change(within(dialog).getByLabelText('Currency'), { target: { value: 'zmw' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(addBranch).toHaveBeenCalledWith(expect.objectContaining({ country: 'Zambia', currency: 'ZMW' })));
  });

  it('edits a branch', async () => {
    updateBranch.mockResolvedValue(branch('kla', 'Kampala Central', 'Uganda'));
    render(<Branches />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kampala' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Kampala Central' } });
    fireEvent.change(within(dialog).getByLabelText('Address'), { target: { value: 'Plot 4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateBranch).toHaveBeenCalledWith('kla', { name: 'Kampala Central', country: 'Uganda', currency: 'UGX', city: null, address: 'Plot 4' })
    );
  });

  it('deactivates an empty branch straight away', async () => {
    updateBranch.mockResolvedValue(branch('kla', 'Kampala', 'Uganda', { active: false }));
    render(<Branches />);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Kampala' }));
    await waitFor(() => expect(updateBranch).toHaveBeenCalledWith('kla', { active: false }));
  });

  it('asks where to move the people of a branch before deactivating it', async () => {
    moveBranchStaff.mockResolvedValue(2);
    updateBranch.mockResolvedValue(branch('dar', 'Dar es Salaam', 'Tanzania', { active: false }));
    render(<Branches />);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Dar es Salaam' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('2 people are in Dar es Salaam');
    expect(updateBranch).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Move them to'), { target: { value: 'kla' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move and deactivate' }));
    await waitFor(() => expect(moveBranchStaff).toHaveBeenCalledWith('dar', 'kla'));
    await waitFor(() => expect(updateBranch).toHaveBeenCalledWith('dar', { active: false }));
  });

  it('makes another branch the default; the default has no deactivate', async () => {
    updateBranch.mockResolvedValue(branch('dar', 'Dar es Salaam', 'Tanzania', { is_default: true }));
    render(<Branches />);
    expect(screen.queryByRole('button', { name: 'Deactivate Nairobi HQ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make Nairobi HQ the default' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Make Dar es Salaam the default' }));
    await waitFor(() => expect(updateBranch).toHaveBeenCalledWith('dar', { is_default: true }));
  });

  it('is read-only for people who cannot manage employees or settings', () => {
    state.canEdit = false;
    render(<Branches />);
    expect(screen.getByText('Kampala')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add branch/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
  });
});
