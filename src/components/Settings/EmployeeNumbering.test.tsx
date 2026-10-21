import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  canEdit: true,
  canRenumber: true,
  numbering: null as null | { mode: string; prefix: string; digits: number; next_number: number; preview: string },
}));
const saveEmployeeNumbering = vi.hoisted(() => vi.fn());
const renumberEmployees = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/usePermissions', () => ({
  // ['settings'] alone is the renumber check; ['settings', 'employees'] is editing
  usePermissions: () => ({ loading: false, hasAnyPermission: (m: string[]) => (m.length === 1 ? state.canRenumber : state.canEdit) }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/employeeNumbering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/employeeNumbering')>()),
  loadEmployeeNumbering: () => Promise.resolve(state.numbering),
  saveEmployeeNumbering,
  renumberEmployees,
}));

import EmployeeNumberingCard from './EmployeeNumbering';

const DEFAULTS = { mode: 'system', prefix: 'MCL-', digits: 6, next_number: 1501, preview: 'MCL-001501' };

beforeEach(() => {
  state.canEdit = true;
  state.canRenumber = true;
  state.numbering = { ...DEFAULTS };
  saveEmployeeNumbering.mockReset();
  renumberEmployees.mockReset();
});
afterEach(() => cleanup());

describe('Employee numbers card', () => {
  it('shows the system format with a live preview of the next number', async () => {
    render(<EmployeeNumberingCard />);
    expect(await screen.findByText('MCL-001501')).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Given by the system/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText(/Prefix/), { target: { value: 'EMP/' } });
    fireEvent.change(screen.getByLabelText(/Digits/), { target: { value: '4' } });
    expect(screen.getByText('EMP/1501')).toBeTruthy();
  });

  it('says what is wrong and will not save it', async () => {
    render(<EmployeeNumberingCard />);
    fireEvent.change(await screen.findByLabelText(/Prefix/), { target: { value: 'MC L' } });
    expect(screen.getByText(/The prefix may have/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the format, moving the count only when the next number changed', async () => {
    saveEmployeeNumbering.mockResolvedValue({ ...DEFAULTS, prefix: 'FIG', preview: 'FIG001501' });
    render(<EmployeeNumberingCard />);
    fireEvent.change(await screen.findByLabelText(/Prefix/), { target: { value: 'FIG' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveEmployeeNumbering).toHaveBeenCalledWith('system', 'FIG', 6, undefined));
    fireEvent.change(screen.getByLabelText(/Next number/), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveEmployeeNumbering).toHaveBeenLastCalledWith('system', 'FIG', 6, 2000));
  });

  it('switches to the company’s own numbers', async () => {
    saveEmployeeNumbering.mockResolvedValue({ ...DEFAULTS, mode: 'own' });
    render(<EmployeeNumberingCard />);
    fireEvent.click(await screen.findByRole('radio', { name: /Our own numbers/ }));
    expect(screen.queryByLabelText(/Prefix/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveEmployeeNumbering).toHaveBeenCalledWith('own', 'MCL-', 6));
  });

  it('is read-only for people who may not change it', async () => {
    state.canEdit = false;
    render(<EmployeeNumberingCard />);
    expect(await screen.findByText(/Given by the system. Next: MCL-001501/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows nothing to people who may not see it', async () => {
    state.numbering = null;
    const { container } = render(<EmployeeNumberingCard />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });
});

describe('changing the prefix for everyone', () => {
  it('offers to renumber existing employees when the prefix changes, and does it before saving', async () => {
    renumberEmployees.mockResolvedValue(23);
    saveEmployeeNumbering.mockResolvedValue({ ...DEFAULTS, prefix: 'FBL-', preview: 'FBL-001501' });
    render(<EmployeeNumberingCard />);
    expect(screen.queryByText(/Also change existing employees/)).toBeNull();
    fireEvent.change(await screen.findByLabelText(/Prefix/), { target: { value: 'FBL-' } });
    expect(screen.getByText(/MCL-000123 becomes FBL-000123/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Also change existing employees/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveEmployeeNumbering).toHaveBeenCalled());
    expect(renumberEmployees).toHaveBeenCalledWith('MCL-', 'FBL-');
    expect(renumberEmployees.mock.invocationCallOrder[0]).toBeLessThan(saveEmployeeNumbering.mock.invocationCallOrder[0]);
  });

  it('left unticked, existing numbers stay', async () => {
    saveEmployeeNumbering.mockResolvedValue({ ...DEFAULTS, prefix: 'FBL-', preview: 'FBL-001501' });
    render(<EmployeeNumberingCard />);
    fireEvent.change(await screen.findByLabelText(/Prefix/), { target: { value: 'FBL-' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveEmployeeNumbering).toHaveBeenCalled());
    expect(renumberEmployees).not.toHaveBeenCalled();
  });

  it('a refused renumber saves nothing', async () => {
    renumberEmployees.mockRejectedValue(new Error('Nothing was changed'));
    render(<EmployeeNumberingCard />);
    fireEvent.change(await screen.findByLabelText(/Prefix/), { target: { value: 'FBL-' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Also change existing employees/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(renumberEmployees).toHaveBeenCalled());
    expect(saveEmployeeNumbering).not.toHaveBeenCalled();
  });

  it('only for administrators and Settings', async () => {
    state.canRenumber = false;
    render(<EmployeeNumberingCard />);
    fireEvent.change(await screen.findByLabelText(/Prefix/), { target: { value: 'FBL-' } });
    expect(screen.queryByText(/Also change existing employees/)).toBeNull();
  });
});
