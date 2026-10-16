import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkWeekCard from './WorkWeek';

const state = vi.hoisted(() => ({ perms: ['leaves'] as string[] }));
const saveCompanyWorkWeek = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasAnyPermission: (ps: string[]) => ps.some((p) => state.perms.includes(p)) }),
}));
vi.mock('../../lib/workWeek', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/workWeek')>()),
  loadCompanyWorkWeek: () => Promise.resolve([1, 1, 1, 1, 1, 0, 0]),
  saveCompanyWorkWeek,
}));

beforeEach(() => {
  state.perms = ['leaves'];
  saveCompanyWorkWeek.mockReset();
});
afterEach(cleanup);

describe('Work week card', () => {
  it('shows Monday to Friday, and saves a half-day Saturday', async () => {
    saveCompanyWorkWeek.mockImplementation((w: number[]) => Promise.resolve(w));
    render(<WorkWeekCard />);
    expect(await screen.findByText('Mon–Fri: 5 working days a week')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Saturday'), { target: { value: '0.5' } });
    expect(screen.getByText('Mon–Sat (Sat half): 5.5 working days a week')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveCompanyWorkWeek).toHaveBeenCalledWith([1, 1, 1, 1, 1, 0.5, 0]));
  });

  it('will not save a week with no working day', async () => {
    render(<WorkWeekCard />);
    await screen.findByText('Mon–Fri: 5 working days a week');
    for (const d of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) fireEvent.change(screen.getByLabelText(d), { target: { value: '0' } });
    expect(screen.getByText('Choose at least one working day')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('is read-only without Leave or Settings', async () => {
    state.perms = ['dashboard'];
    render(<WorkWeekCard />);
    await screen.findByText('Mon–Fri: 5 working days a week');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect((screen.getByLabelText('Monday') as HTMLSelectElement).disabled).toBe(true);
  });
});
