import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ExitRecord, MyExitState } from '../../lib/exits';

const mocks = vi.hoisted(() => ({
  state: null as unknown as MyExitState,
  submit: vi.fn(),
  withdraw: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/exits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/exits')>();
  return {
    ...actual,
    loadMyExit: () => Promise.resolve(mocks.state),
    submitResignation: (...args: unknown[]) => mocks.submit(...args),
    withdrawResignation: (...args: unknown[]) => mocks.withdraw(...args),
  };
});

import MyResignation from './MyResignation';
import { addDays, today } from '../../lib/exits';

const exit = (over: Partial<ExitRecord>): ExitRecord => ({
  id: 'x1',
  employee_number: 'E1',
  kind: 'resignation',
  reason_category: 'resignation',
  reason: 'New job',
  notice_given_on: '2026-10-14',
  notice_days: 30,
  last_working_day: '2026-11-13',
  notice_pay: false,
  letter_path: null,
  status: 'requested',
  decision_note: null,
  requested_by: 'u1',
  decided_by: null,
  decided_at: null,
  access_ended_at: null,
  completed_at: null,
  created_at: '2026-10-14T08:00:00Z',
  ...over,
});

beforeEach(() => {
  mocks.state = { employeeNumber: 'E1', noticeDays: 30, exits: [] };
  mocks.submit.mockReset().mockResolvedValue(undefined);
  mocks.withdraw.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('MyResignation', () => {
  it('starts at the end of the notice period and refuses an earlier last day', async () => {
    render(<MyResignation />);
    const lastDay = (await screen.findByLabelText('Last working day')) as HTMLInputElement;
    expect(lastDay.value).toBe(addDays(today(), 30));
    expect(screen.getByText('30 days')).toBeTruthy();

    fireEvent.change(lastDay, { target: { value: addDays(today(), 10) } });
    expect(screen.getByText(/That is within your notice period/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect((screen.getByRole('button', { name: 'Send my resignation' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the resignation with the reason once confirmed', async () => {
    render(<MyResignation />);
    const lastDay = await screen.findByLabelText('Last working day');
    const day = addDays(today(), 45);
    fireEvent.change(lastDay, { target: { value: day } });
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Moving abroad' } });
    const send = screen.getByRole('button', { name: 'Send my resignation' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(send);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith('E1', { lastWorkingDay: day, reason: 'Moving abroad', letter: null }));
  });

  it('shows where a resignation stands, and lets them withdraw it while it waits', async () => {
    mocks.state = { employeeNumber: 'E1', noticeDays: 30, exits: [exit({})] };
    render(<MyResignation />);
    await screen.findByText('Awaiting approval');
    expect(screen.queryByLabelText('Last working day')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw my resignation' }));
    await waitFor(() => expect(mocks.withdraw).toHaveBeenCalledWith('x1'));
  });

  it('shows HR’s decision', async () => {
    mocks.state = { employeeNumber: 'E1', noticeDays: 30, exits: [exit({ status: 'approved', decision_note: 'Thank you for your service' })] };
    render(<MyResignation />);
    await screen.findByText('Approved');
    expect(screen.getByText('Thank you for your service')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Withdraw my resignation' })).toBeNull();
  });
});
