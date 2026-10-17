import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { JobTitleOverview } from '../../lib/jobTitles';

const state = vi.hoisted(() => ({ role: 'HR' as string | null, perms: [] as string[], titles: [] as JobTitleOverview[] }));
const api = vi.hoisted(() => ({ saveJobTitle: vi.fn(), mergeJobTitles: vi.fn() }));
const confirm = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, userRole: state.role, hasPermission: (m: string) => state.role === 'ADMIN' || state.perms.includes(m) }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: confirm }));
vi.mock('../../lib/orgStructure', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/orgStructure')>()),
  loadDepartments: () => Promise.resolve([{ id: 'd1', name: 'Sales', parent_id: null, head_employee_id: null, active: true }]),
}));
vi.mock('../../lib/jobTitles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/jobTitles')>()),
  loadJobTitlesOverview: () => Promise.resolve(state.titles),
  loadJobGroupChoices: () => Promise.resolve([{ id: 'g1', code: 'JG5', name: 'Officers', active: true }]),
  ...api,
}));

import JobTitles, { canManageJobTitles } from './JobTitles';

const title = (over: Partial<JobTitleOverview>): JobTitleOverview => ({
  id: 't1', name: 'Sales Rep', department_id: 'd1', job_group_id: 'g1', active: true, employee_count: 4, template_count: 1, ...over,
});

const page = () => render(<MemoryRouter><JobTitles /></MemoryRouter>);

beforeEach(() => {
  state.role = 'HR';
  state.perms = [];
  state.titles = [title({}), title({ id: 't2', name: 'Sales Rep.', department_id: null, job_group_id: null, employee_count: 1, template_count: 0 }), title({ id: 't3', name: 'Driver', active: false, employee_count: 0, template_count: 0, department_id: null, job_group_id: null })];
  api.saveJobTitle.mockReset().mockResolvedValue(undefined);
  api.mergeJobTitles.mockReset().mockResolvedValue(1);
  confirm.mockReset().mockResolvedValue(true);
});
afterEach(() => cleanup());

describe('canManageJobTitles', () => {
  it('HR, admins, the Employees module and Performance (not line managers)', () => {
    const has = (list: string[]) => (m: string) => list.includes(m);
    expect(canManageJobTitles('HR', has([]))).toBe(true);
    expect(canManageJobTitles('CLERK', has(['employees']))).toBe(true);
    expect(canManageJobTitles('ANALYST', has(['performance']))).toBe(true);
    expect(canManageJobTitles('MANAGER', has(['performance']))).toBe(false);
    expect(canManageJobTitles('STAFF', has(['dashboard']))).toBe(false);
  });
});

describe('Job titles page', () => {
  it('lists active titles with their usual department, job group and employees; inactive on request', async () => {
    page();
    const row = (await screen.findByText('Sales Rep')).closest('tr')!;
    expect(within(row).getByText('Sales')).toBeTruthy();
    expect(within(row).getByText('JG5 – Officers')).toBeTruthy();
    expect(within(row).getByText('4')).toBeTruthy();
    expect(within(row).getByText('1 KPI template')).toBeTruthy();
    expect(screen.queryByText('Driver')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show inactive'));
    expect(screen.getByText('Driver')).toBeTruthy();
  });

  it('points out likely duplicates', async () => {
    page();
    expect((await screen.findByRole('alert')).textContent).toMatch(/“Sales Rep” and “Sales Rep\.”/);
  });

  it('adds a title, refusing a name already used', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Add job title' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' sales rep ' } });
    expect(within(dialog).getByText('There is already a job title with that name')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Agronomist' } });
    fireEvent.change(within(dialog).getByLabelText('Usual department (optional)'), { target: { value: 'd1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveJobTitle).toHaveBeenCalledWith(null, { name: 'Agronomist', department_id: 'd1', job_group_id: null }));
  });

  it('renaming says the employees will show the new name', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sales Rep' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Sales Representative' } });
    expect(within(dialog).getByText('4 employees will show the new name.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveJobTitle).toHaveBeenCalledWith('t1', { name: 'Sales Representative', department_id: 'd1', job_group_id: 'g1' }));
  });

  it('merges a duplicate into another title', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Merge Sales Rep.' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Merge into'), { target: { value: 't1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(api.mergeJobTitles).toHaveBeenCalledWith('t2', 't1'));
  });

  it('deactivates a title in use after asking', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate Sales Rep' }));
    await waitFor(() => expect(api.saveJobTitle).toHaveBeenCalledWith('t1', { active: false }));
    expect(confirm).toHaveBeenCalled();
  });

  it('tells anyone else they may not manage job titles', () => {
    state.role = 'STAFF';
    page();
    expect(screen.getByRole('status').textContent).toMatch(/Only HR/);
    expect(screen.queryByRole('button', { name: 'Add job title' })).toBeNull();
  });
});
