import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ settings: null as null | { minutes: number; can_edit: boolean } }));
const saveStaySignedIn = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/mfaApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/mfaApi')>()),
  loadStaySignedIn: () => Promise.resolve(state.settings),
  saveStaySignedIn,
}));

import StaySignedInCard from './StaySignedIn';

beforeEach(() => {
  state.settings = { minutes: 10080, can_edit: true };
  saveStaySignedIn.mockReset();
});
afterEach(() => cleanup());

describe('Stay signed in card', () => {
  it('starts on 7 days; an admin shortens it', async () => {
    saveStaySignedIn.mockResolvedValue({ minutes: 480, can_edit: true });
    render(<StaySignedInCard />);
    expect(await screen.findByText('Signed out after 7 days away')).toBeTruthy();
    expect((screen.getByRole('radio', { name: '7 days' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '8 hours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveStaySignedIn).toHaveBeenCalledWith(480));
    expect(await screen.findByText('Signed out after 8 hours away')).toBeTruthy();
  });

  it('shows others what is set, without the choices', async () => {
    state.settings = { minutes: 30, can_edit: false };
    render(<StaySignedInCard />);
    expect(await screen.findByText('Signed out after 30 minutes away')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows nothing when the setting cannot be read', async () => {
    state.settings = null;
    const { container } = render(<StaySignedInCard />);
    await Promise.resolve();
    expect(container.textContent).toBe('');
  });
});
