import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  createAccountAndJoin: vi.fn(),
  acceptInvitation: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  sessionEmail: null as string | null,
  assign: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: mocks.sessionEmail ? { user: { email: mocks.sessionEmail } } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: (...a: unknown[]) => mocks.signIn(...a),
      signOut: () => mocks.signOut(),
    },
  },
}));
vi.mock('../lib/companyApi', () => ({
  companyApi: {
    invitationPreview: (...a: unknown[]) => mocks.preview(...a),
    createAccountAndJoin: (...a: unknown[]) => mocks.createAccountAndJoin(...a),
    acceptInvitation: (...a: unknown[]) => mocks.acceptInvitation(...a),
  },
}));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import toast from 'react-hot-toast';
import { ApiError } from '../lib/adminApi';
import JoinCompany from './JoinCompany';

const open = (token = 'tok-123') =>
  render(
    <MemoryRouter initialEntries={[`/join?token=${token}`]}>
      <JoinCompany />
    </MemoryRouter>
  );

beforeEach(() => {
  Object.values(mocks).forEach((m) => typeof m === 'function' && 'mockReset' in m && (m as ReturnType<typeof vi.fn>).mockReset());
  mocks.sessionEmail = null;
  mocks.preview.mockResolvedValue({ company_name: 'Favor Farm', email: 'jane@gmail.com', role: 'STAFF' });
  mocks.createAccountAndJoin.mockResolvedValue({ ok: true, email: 'jane@gmail.com' });
  mocks.acceptInvitation.mockResolvedValue('tenant-1');
  mocks.signIn.mockResolvedValue({ error: null });
  vi.mocked(toast.error).mockClear();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: mocks.assign } });
});
afterEach(() => cleanup());

describe('JoinCompany', () => {
  it('asks a new person only for their name and a password, with the invited email filled in', async () => {
    open();
    expect(await screen.findByText('Join Favor Farm')).toBeTruthy();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('jane@gmail.com');
    expect((screen.getByLabelText('Email') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByLabelText('Your full name')).toBeTruthy();
    expect(screen.getByLabelText('Choose a password')).toBeTruthy();
  });

  it('creates the account, signs them in and opens the workspace: no confirmation email, nothing to paste', async () => {
    open();
    await screen.findByText('Join Favor Farm');
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: 'a-good-password' } });
    fireEvent.click(screen.getByRole('button', { name: /Create account and join Favor Farm/ }));

    await waitFor(() => expect(mocks.createAccountAndJoin).toHaveBeenCalledWith('tok-123', 'a-good-password', 'Jane Doe'));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith({ email: 'jane@gmail.com', password: 'a-good-password' }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/dashboard'));
  });

  it('if the address already has an account (another company, or two invitations at once), switches to sign in', async () => {
    mocks.createAccountAndJoin.mockRejectedValue(new ApiError('You already have an account with this email. Sign in to join.', 409, 'account_exists'));
    open();
    await screen.findByText('Join Favor Farm');
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: 'whatever-123' } });
    fireEvent.click(screen.getByRole('button', { name: /Create account and join/ }));

    expect(await screen.findByRole('button', { name: /Sign in and join Favor Farm/ })).toBeTruthy();
    expect(screen.queryByLabelText('Your full name')).toBeNull();
    expect(mocks.assign).not.toHaveBeenCalled();

    // they sign in with their existing password, and the company is added to their account
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'my-existing-password' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign in and join Favor Farm/ }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith({ email: 'jane@gmail.com', password: 'my-existing-password' }));
    await waitFor(() => expect(mocks.acceptInvitation).toHaveBeenCalledWith('tok-123'));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/dashboard'));
  });

  it('a wrong password on sign-in joins nothing', async () => {
    mocks.signIn.mockResolvedValue({ error: new Error('Invalid login credentials') });
    open();
    await screen.findByText('Join Favor Farm');
    fireEvent.click(screen.getByText('I already have an account'));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign in and join/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid login credentials'));
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it('refuses a short password before calling the server', async () => {
    open();
    await screen.findByText('Join Favor Farm');
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /Create account and join/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Password must be at least 8 characters.'));
    expect(mocks.createAccountAndJoin).not.toHaveBeenCalled();
  });

  it('shows a clear page for an invalid, used or expired link', async () => {
    mocks.preview.mockResolvedValue(null);
    open('old-token');
    expect(await screen.findByText('This invitation is not valid')).toBeTruthy();
  });

  it('someone already signed in with the invited address joins with one click', async () => {
    mocks.sessionEmail = 'Jane@Gmail.com';
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Join Favor Farm' }));
    await waitFor(() => expect(mocks.acceptInvitation).toHaveBeenCalledWith('tok-123'));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/dashboard'));
  });

  it('someone signed in with a different address is told, and can sign out', async () => {
    mocks.sessionEmail = 'other@gmail.com';
    open();
    expect(await screen.findByText(/this invitation was sent to/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Sign out and use jane@gmail.com/ }));
    expect(mocks.signOut).toHaveBeenCalled();
  });
});
