import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const load = vi.hoisted(() => ({ schedules: vi.fn(), week: vi.fn() }));
vi.mock('../../lib/attendanceApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/attendanceApi')>()),
  loadSchedules: load.schedules,
}));
vi.mock('../../lib/workWeek', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/workWeek')>()),
  loadCompanyWorkWeek: load.week,
}));
vi.mock('../../lib/branches', () => ({ loadBranches: () => Promise.resolve([{ id: 'b1', name: 'Dar' }]) }));
vi.mock('../../lib/orgStructure', () => ({ loadDepartments: () => Promise.resolve([]) }));

import WorkDaysMismatch from './WorkDaysMismatch';

const schedule = (branch_id: string | null, work_days: number[]) => ({
  id: branch_id ?? 'c', branch_id, work_days, start_time: '08:00', end_time: '17:00', grace_minutes: 30, updated_at: '',
});

beforeEach(() => {
  load.schedules.mockReset().mockResolvedValue([]);
  load.week.mockReset().mockResolvedValue([1, 1, 1, 1, 1, 0, 0]);
});
afterEach(cleanup);

describe('WorkDaysMismatch', () => {
  it('stays quiet when attendance and leave agree (the built-in Mon–Fri on both)', async () => {
    render(<WorkDaysMismatch fixHint="Fix it." />);
    await waitFor(() => expect(load.week).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns about a branch working Saturdays when leave and payroll don’t', async () => {
    load.schedules.mockResolvedValue([schedule(null, [1, 2, 3, 4, 5]), schedule('b1', [1, 2, 3, 4, 5, 6])]);
    render(<WorkDaysMismatch fixHint="Fix it." />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Working days don't match/);
    expect(alert.textContent).toMatch(/Dar's attendance schedule works Mon–Sat, but leave and payroll count Mon–Fri\./);
    expect(alert.textContent).toMatch(/Fix it\./);
  });

  it('says nothing when it can’t load', async () => {
    load.schedules.mockRejectedValue(new Error('offline'));
    render(<WorkDaysMismatch fixHint="Fix it." />);
    await waitFor(() => expect(load.schedules).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
