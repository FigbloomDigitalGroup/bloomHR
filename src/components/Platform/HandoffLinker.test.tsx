import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  pending: 'pending-id-0123456789abcdefghijklmnopqrstuvw' as string | null,
  preview: vi.fn(),
  link: vi.fn(),
  cleared: 0,
  signOut: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { signOut: api.signOut } } }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/platformHandoff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformHandoff')>()),
  loadPendingHandoff: () => api.pending,
  clearPendingHandoff: () => {
    api.cleared += 1;
    api.pending = null;
  },
  handoffApi: { preview: api.preview, link: api.link, unlink: vi.fn() },
}));

import HandoffLinker from './HandoffLinker';
import { ApiError } from '../../lib/adminApi';

const assign = vi.fn();
beforeEach(() => {
  api.pending = 'pending-id-0123456789abcdefghijklmnopqrstuvw';
  api.cleared = 0;
  api.preview.mockReset();
  api.link.mockReset();
  api.signOut.mockReset();
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HandoffLinker: connecting a Schools account after a normal sign-in', () => {
  it('waits while the person is still signing in', () => {
    render(<HandoffLinker userId="u1" email="head@school.ac.ke" pathname="/login" />);
    expect(api.preview).not.toHaveBeenCalled();
  });

  it('asks first, then connects and opens return_to', async () => {
    api.preview.mockResolvedValue({ outcome: 'ready', person_name: 'Mary Head', company_name: 'Hillside Primary' });
    api.link.mockResolvedValue({ ok: true, outcome: 'linked', company_name: 'Hillside Primary', return_to: '/payroll' });
    render(<HandoffLinker userId="u1" email="head@school.ac.ke" pathname="/dashboard" />);
    expect(await screen.findByText('Connect your Figbloom Schools account?')).toBeTruthy();
    expect(screen.getByText('Mary Head')).toBeTruthy();
    expect(screen.getByText('head@school.ac.ke')).toBeTruthy();
    expect(api.link).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/payroll'));
    expect(api.link).toHaveBeenCalledWith('pending-id-0123456789abcdefghijklmnopqrstuvw');
    expect(api.cleared).toBe(1);
  });

  it('"Not now" forgets it and links nothing', async () => {
    api.preview.mockResolvedValue({ outcome: 'ready', person_name: null, company_name: 'Hillside Primary' });
    render(<HandoffLinker userId="u1" email="head@school.ac.ke" pathname="/dashboard" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(api.link).not.toHaveBeenCalled();
    expect(api.cleared).toBe(1);
  });

  it('another company\'s login is told so, may sign in with another account, and nothing is linked', async () => {
    api.preview.mockRejectedValue(new ApiError('You\'re signed in as x@other.ac.ke, who isn\'t a member of Hillside Primary in Figbloom HR, so nothing was connected.', 409, 'wrong_company'));
    render(<HandoffLinker userId="u2" email="x@other.ac.ke" pathname="/dashboard" />);
    expect(await screen.findByText(/isn't a member of Hillside Primary/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with another account' }));
    await waitFor(() => expect(api.signOut).toHaveBeenCalled());
    expect(api.link).not.toHaveBeenCalled();
    expect(api.cleared).toBe(0); // the right login can still connect it
  });

  it('an expired or used one is forgotten with a message', async () => {
    api.preview.mockRejectedValue(new ApiError('This connection link has expired or was already used.', 410, 'expired'));
    render(<HandoffLinker userId="u1" email="head@school.ac.ke" pathname="/dashboard" />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This connection link has expired or was already used.'));
    expect(api.cleared).toBe(1);
  });
});
