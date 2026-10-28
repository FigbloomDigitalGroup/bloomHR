import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { JobGroup } from '../../lib/jobGroups';

const state = vi.hoisted(() => ({ allowed: true, groups: [] as JobGroup[] }));
const saveJobGroup = vi.hoisted(() => vi.fn());
const saveJobGroupRate = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasAnyPermission: (m: string[]) => state.allowed && m.includes('payroll') }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/jobGroups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/jobGroups')>()),
  loadJobGroups: () => Promise.resolve(state.groups),
  saveJobGroup,
  saveJobGroupRate,
}));

import JobGroupsPage from './JobGroups';

const G1: JobGroup = {
  id: 'g1', code: 'JG5', name: 'Senior officers', active: true, employee_count: 12, effective_from: '2026-01-01',
  basic_salary: 55000, basic_min: null, basic_max: null, house_allowance: 11000, travel_allowance: 5000, other_allowances: 1000, per_diem: 0,
  next_effective_from: null,
};
const OLD: JobGroup = {
  ...G1, id: 'g2', code: 'Clerical', name: 'Clerical', employee_count: 3, effective_from: null, basic_salary: null,
  house_allowance: null, travel_allowance: null, other_allowances: null,
};

const page = () => render(<MemoryRouter><JobGroupsPage /></MemoryRouter>);

beforeEach(() => {
  state.allowed = true;
  state.groups = [G1, OLD];
  saveJobGroup.mockReset().mockResolvedValue('new-id');
  saveJobGroupRate.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('Job groups page', () => {
  it('lists each group with its current amounts and how many employees are on it', async () => {
    page();
    const row = (await screen.findByText('JG5')).closest('tr')!;
    expect(within(row).getByText('Senior officers')).toBeTruthy();
    expect(within(row).getByText(/55,000/)).toBeTruthy();
    expect(within(row).getByText(/11,000/)).toBeTruthy();
    expect(within(row).getByText('12')).toBeTruthy();
    const old = screen.getByText('Clerical').closest('tr')!;
    expect(within(old).getByText('No amounts yet')).toBeTruthy();
  });

  it('adds a group with its amounts from a date', async () => {
    state.groups = [];
    page();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add job group' }))[0]);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Code/), { target: { value: 'JG6' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Managers' } });
    fireEvent.change(within(dialog).getByLabelText(/^Basic salary/), { target: { value: '80000' } });
    fireEvent.change(within(dialog).getByLabelText(/House allowance/), { target: { value: '15000' } });
    // the job level's monthly per diem (a reimbursement on the payroll page)
    fireEvent.change(within(dialog).getByLabelText(/^Per diem/), { target: { value: '6000' } });
    fireEvent.change(within(dialog).getByLabelText(/Amounts start on/), { target: { value: '2026-11-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveJobGroupRate).toHaveBeenCalled());
    expect(saveJobGroup).toHaveBeenCalledWith(null, { code: 'JG6', name: 'Managers' });
    expect(saveJobGroupRate).toHaveBeenCalledWith('new-id', {
      effective_from: '2026-11-01', basic_salary: 80000, basic_min: null, basic_max: null,
      house_allowance: 15000, travel_allowance: 0, other_allowances: 0, per_diem: 6000,
    });
  });

  it('a band needs its lowest and highest basic salary', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Clerical' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText(/A band/));
    fireEvent.change(within(dialog).getByLabelText(/Lowest basic salary/), { target: { value: '40000' } });
    fireEvent.change(within(dialog).getByLabelText(/Highest basic salary/), { target: { value: '30000' } });
    expect(within(dialog).getByText(/lowest basic salary is more than the highest/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renaming a group without touching its amounts saves no new rate', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit JG5' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Senior staff' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveJobGroup).toHaveBeenCalledWith('g1', { code: 'JG5', name: 'Senior staff' }));
    expect(saveJobGroupRate).not.toHaveBeenCalled();
  });

  it('deactivates a group', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate JG5' }));
    await waitFor(() => expect(saveJobGroup).toHaveBeenCalledWith('g1', { code: 'JG5', name: 'Senior officers', active: false }));
  });

  it('people without Payroll or Employees see no amounts', async () => {
    state.allowed = false;
    page();
    expect(await screen.findByText(/Only an admin or someone with Payroll or Employees/)).toBeTruthy();
    expect(screen.queryByText('JG5')).toBeNull();
  });
});
