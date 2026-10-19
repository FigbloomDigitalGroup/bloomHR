import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  exits: [] as Record<string, unknown>[],
  confirm: vi.fn(),
}));

vi.mock('../../lib/supabase', () => {
  const employee = { 'Employee Number': 'E1', 'First Name': 'Wanjiru', 'Last Name': 'Kamau' };
  const query: Record<string, unknown> = {
    select: () => query,
    eq: () => query,
    single: () => Promise.resolve({ data: employee, error: null }),
  };
  return {
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { email: 'wanjiru@farm.co.ke' } } }) },
      from: () => query,
    },
  };
});
vi.mock('../../lib/exits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/exits')>()),
  loadMyExit: () => Promise.resolve({ employeeNumber: 'E1', noticeDays: 30, exits: state.exits }),
}));
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: (...a: unknown[]) => state.confirm(...a) }));
vi.mock('../Settings/MyTwoStep', () => ({ default: () => null }));
vi.mock('./MyContributions', () => ({ default: () => null }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import Profile from './Profile';

const exit = (status: string, decision_note: string | null = null) => ({ id: 'x1', status, last_working_day: '2026-11-13', decision_note });

const renderProfile = () => {
  const onOpenResignation = vi.fn();
  render(<Profile onOpenResignation={onOpenResignation} />);
  return { onOpenResignation };
};

beforeEach(() => {
  state.exits = [];
  state.confirm.mockReset();
});
afterEach(cleanup);

describe('Profile: leaving the company', () => {
  it('has a quiet "Leaving the company" section at the bottom', async () => {
    renderProfile();
    expect(await screen.findByText('Leaving the company')).toBeTruthy();
    expect(screen.getByText(/Thinking of resigning\? Start here; HR will guide you through notice and clearance\./)).toBeTruthy();
    expect(screen.queryByText('Your resignation')).toBeNull();
  });

  it('asks before opening the resignation, and stays put when they cancel', async () => {
    state.confirm.mockResolvedValue(false);
    const { onOpenResignation } = renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Start a resignation' }));
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1));
    expect(state.confirm.mock.calls[0][0]).toMatchObject({
      title: 'Start a resignation?',
      message: 'This begins your notice period once HR receives it.',
    });
    expect(onOpenResignation).not.toHaveBeenCalled();
  });

  it('opens the resignation once they confirm', async () => {
    state.confirm.mockResolvedValue(true);
    const { onOpenResignation } = renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Start a resignation' }));
    await waitFor(() => expect(onOpenResignation).toHaveBeenCalledTimes(1));
  });

  it('shows a resignation under way at the top: its state, last day and HR’s response', async () => {
    state.exits = [exit('approved', 'Thank you for your service')];
    const { onOpenResignation } = renderProfile();
    expect(await screen.findByText('Your resignation')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText('13 Nov 2026')).toBeTruthy();
    expect(screen.getByText('Thank you for your service')).toBeTruthy();
    expect(screen.queryByText('Leaving the company')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View my resignation' }));
    expect(onOpenResignation).toHaveBeenCalledTimes(1);
  });

  it('says HR has not answered yet while it waits for review', async () => {
    state.exits = [exit('requested')];
    renderProfile();
    expect(await screen.findByText('Waiting for HR to review it')).toBeTruthy();
  });

  it('does not show a withdrawn, declined or completed one', async () => {
    state.exits = [exit('cancelled'), exit('declined'), exit('completed')];
    renderProfile();
    expect(await screen.findByText('Leaving the company')).toBeTruthy();
    expect(screen.queryByText('Your resignation')).toBeNull();
  });
});
