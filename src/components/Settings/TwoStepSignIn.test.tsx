import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ settings: null as null | { mode: string; method: string; can_edit: boolean } }));
const saveTwoStepSettings = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/mfaApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/mfaApi')>()),
  loadTwoStepSettings: () => Promise.resolve(state.settings),
  saveTwoStepSettings,
}));

import TwoStepSignInCard from './TwoStepSignIn';

beforeEach(() => {
  state.settings = { mode: 'off', method: 'email', can_edit: true };
  saveTwoStepSettings.mockReset();
});
afterEach(() => cleanup());

describe('Two-step sign-in card', () => {
  it('lets an admin turn it on for admins, HR and payroll by SMS', async () => {
    saveTwoStepSettings.mockResolvedValue({ mode: 'privileged', method: 'sms', can_edit: true });
    render(<TwoStepSignInCard />);
    expect(await screen.findByText('Off: password only')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /SMS/ })).toBeNull(); // the method only matters when it is on
    fireEvent.click(screen.getByRole('radio', { name: /Admins, HR and payroll/ }));
    fireEvent.click(screen.getByRole('radio', { name: /SMS/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveTwoStepSettings).toHaveBeenCalledWith('privileged', 'sms'));
    expect(await screen.findByText('On for admins, HR and payroll, by SMS')).toBeTruthy();
  });

  it('shows others what is set, without the choices', async () => {
    state.settings = { mode: 'everyone', method: 'email', can_edit: false };
    render(<TwoStepSignInCard />);
    expect(await screen.findByText('On for everyone, by email')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
