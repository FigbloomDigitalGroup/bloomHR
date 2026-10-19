import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type AuthListener = (event: string, session: unknown) => void;

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  setSession: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  listeners: [] as AuthListener[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => auth.getSession(...a),
      setSession: (...a: unknown[]) => auth.setSession(...a),
      verifyOtp: (...a: unknown[]) => auth.verifyOtp(...a),
      exchangeCodeForSession: (...a: unknown[]) => auth.exchangeCodeForSession(...a),
      resetPasswordForEmail: (...a: unknown[]) => auth.resetPasswordForEmail(...a),
      updateUser: (...a: unknown[]) => auth.updateUser(...a),
      signOut: (...a: unknown[]) => auth.signOut(...a),
      onAuthStateChange: (cb: AuthListener) => {
        auth.listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => { auth.listeners = auth.listeners.filter(l => l !== cb); } } } };
      },
    },
  },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() } }));

import UpdatePasswordPage from './UpdatePassword';

const session = { access_token: 'at', refresh_token: 'rt', user: { id: 'u1', email: 'jane@co.ke' } };

const openAt = (url: string, waitMs = 30) => {
  window.history.replaceState(null, '', url);
  return render(
    <MemoryRouter>
      <UpdatePasswordPage waitMs={waitMs} />
    </MemoryRouter>
  );
};

const formShown = () => screen.findByText('Set a new password');

beforeEach(() => {
  auth.listeners = [];
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('UpdatePassword: dashboard (implicit) links', () => {
  it('opens the form when the client announces the recovery session', async () => {
    openAt('/update-password#access_token=a1&refresh_token=r1&expires_in=3600&token_type=bearer&type=recovery', 5000);
    expect(screen.getByText('Checking your link')).toBeTruthy();
    await waitFor(() => expect(auth.listeners.length).toBeGreaterThan(0));
    act(() => auth.listeners.forEach(l => l('PASSWORD_RECOVERY', session)));
    await formShown();
    expect(auth.setSession).not.toHaveBeenCalled();
    // the tokens leave the address bar
    expect(window.location.hash).toBe('');
  });

  it('falls back to setSession with the tokens from the hash when no session appears', async () => {
    auth.setSession.mockResolvedValue({ data: { session }, error: null });
    openAt('/update-password#access_token=a2&refresh_token=r2&expires_in=3600&token_type=bearer&type=recovery');
    await formShown();
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'a2', refresh_token: 'r2' });
  });
});

describe('UpdatePassword: token hash links', () => {
  it('verifies the token hash as a recovery and shows the form', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session }, error: null });
    openAt('/update-password?token_hash=th1&type=recovery');
    await formShown();
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'th1', type: 'recovery' });
  });
});

describe('UpdatePassword: PKCE code links', () => {
  it('exchanges the code and shows the form', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });
    openAt('/update-password?code=c1');
    await formShown();
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('c1');
  });

  it('says the link was opened in another browser when the code verifier is missing', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: Object.assign(new Error('invalid request: both auth code and code verifier should be non-empty'), { code: 'validation_failed' }),
    });
    openAt('/update-password?code=c2');
    expect(await screen.findByText('Opened in another browser')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send me a new link' })).toBeTruthy();
  });
});

describe('UpdatePassword: links that failed', () => {
  it('explains an expired link and sends a new one that comes back here', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    openAt('/update-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    expect(await screen.findByText('Link expired')).toBeTruthy();
    expect(screen.getByText(/security scanners open links before you do/)).toBeTruthy();
    expect(screen.getByText(/open the new link in this same browser/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back to sign in/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'jane@co.ke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a new link' }));
    await waitFor(() =>
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('jane@co.ke', { redirectTo: `${window.location.origin}/update-password` })
    );
    expect(await screen.findByText(/a new link is on its way/)).toBeTruthy();
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it('pre-fills the email when the link carries it', async () => {
    openAt('/update-password?error_code=otp_expired&email=jane%40co.ke');
    await screen.findByText('Link expired');
    expect((screen.getByLabelText('Your email') as HTMLInputElement).value).toBe('jane@co.ke');
  });

  it('shows the failure screen after the wait when the page has no link at all', async () => {
    openAt('/update-password');
    expect(screen.getByText('Checking your link')).toBeTruthy();
    expect(await screen.findByText('Link expired')).toBeTruthy();
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe('UpdatePassword: after the link works', () => {
  it('updates the password, signs out and says so', async () => {
    auth.getSession.mockResolvedValue({ data: { session } });
    auth.updateUser.mockResolvedValue({ error: null });
    openAt('/update-password');
    await formShown();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Str0ng!pass' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Str0ng!pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Password updated')).toBeTruthy();
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'Str0ng!pass' });
    expect(auth.signOut).toHaveBeenCalled();
  });
});
