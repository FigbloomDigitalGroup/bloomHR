import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  signIn: vi.fn(),
  reset: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => state.signIn(...args),
      resetPasswordForEmail: (...args: unknown[]) => state.reset(...args),
    },
  },
}));
vi.mock('react-hot-toast', () => ({ default: { error: (...args: unknown[]) => state.toastError(...args), success: vi.fn() } }));

import ConsoleLogin from './ConsoleLogin';

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(cleanup);
beforeEach(() => {
  state.signIn.mockReset().mockResolvedValue({ error: null });
  state.reset.mockReset().mockResolvedValue({ error: null });
  state.toastError.mockReset();
});

describe('the console sign-in', () => {
  it('is for Figbloom staff: no way to create a company, and customers are sent to the company app', () => {
    render(<ConsoleLogin />);
    expect(screen.getByRole('heading', { name: 'Console' })).toBeTruthy();
    expect(screen.queryByText(/create/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'hr.figbloom.org' }).getAttribute('href')).toBe('https://hr.figbloom.org');
  });

  it('signs in with the email and password', async () => {
    render(<ConsoleLogin />);
    type('Email', ' admin@figbloom.org ');
    type('Password', 'secret password');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(state.signIn).toHaveBeenCalledWith({ email: 'admin@figbloom.org', password: 'secret password' }));
    expect(state.toastError).not.toHaveBeenCalled();
  });

  it('says plainly when the email or password is wrong', async () => {
    state.signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<ConsoleLogin />);
    type('Email', 'admin@figbloom.org');
    type('Password', 'nope');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith('Wrong email or password.'));
  });

  it('sends a reset link that comes back to the console', async () => {
    render(<ConsoleLogin />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    type('Email', 'admin@figbloom.org');
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() =>
      expect(state.reset).toHaveBeenCalledWith('admin@figbloom.org', { redirectTo: `${window.location.origin}/update-password` })
    );
    expect(await screen.findByText(/a link to set a new password is on its way/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});
