import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({ signIn: vi.fn(), from: vi.fn() }));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      signInWithPassword: (...a: unknown[]) => auth.signIn(...a),
      resetPasswordForEmail: vi.fn(),
    },
    from: (...a: unknown[]) => auth.from(...a),
  },
}));
vi.mock('../sw', () => ({ useAppUpdate: () => ({ checkForUpdates: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() } }));

import toast from 'react-hot-toast';
import Login from './Login';

afterEach(() => cleanup());

const open = (onLoginSuccess = vi.fn()) =>
  render(
    <MemoryRouter>
      <Login onLoginSuccess={onLoginSuccess} />
    </MemoryRouter>
  );

describe('Login', () => {
  it('is sign-in only: no town selector, no "apply for account", and no lookups before anyone is signed in', () => {
    open();
    expect(screen.getByText('Welcome Back')).toBeTruthy();
    expect(screen.queryByText(/Town office/i)).toBeNull();
    expect(screen.queryByText(/Apply/i)).toBeNull();
    expect(auth.from).not.toHaveBeenCalled();
  });

  it('points new companies to the create-company page', () => {
    open();
    expect(screen.getByRole('link', { name: /Create one/ }).getAttribute('href')).toBe('/create-company');
  });

  it('signs in with the email and password and reports a failure', async () => {
    auth.signIn.mockResolvedValue({ data: null, error: new Error('Invalid login credentials') });
    open();
    fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/ }));
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith({ email: 'a@b.co', password: 'secret123' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid login credentials'));
  });
});
