import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ createCompany: vi.fn(), assign: vi.fn(), pending: vi.fn(), acceptMine: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../lib/companyApi', () => ({
  companyApi: {
    createCompany: (...a: unknown[]) => api.createCompany(...a),
    myPendingInvitations: () => api.pending(),
    acceptMyInvitation: (...a: unknown[]) => api.acceptMine(...a),
  },
}));

import toast from 'react-hot-toast';
import NoCompany from './NoCompany';
import { readPendingCompany, writePendingCompany } from '../lib/pendingCompany';

beforeEach(() => {
  localStorage.clear();
  api.createCompany.mockReset().mockResolvedValue('tenant-1');
  api.assign.mockReset();
  api.pending.mockReset().mockResolvedValue([]);
  api.acceptMine.mockReset().mockResolvedValue('tenant-9');
  vi.mocked(toast.error).mockClear();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: api.assign } });
});
afterEach(() => cleanup());

describe('NoCompany with invitations waiting', () => {
  const invited = [{ id: 'inv-1', company_name: 'Favor Farm', role: 'STAFF', expires_at: '2099-01-01' }];

  it('shows the invitations sent to this address, so nobody pastes a link from their email', async () => {
    api.pending.mockResolvedValue(invited);
    render(<NoCompany email="jane@gmail.com" />);
    expect(await screen.findByText('You have been invited')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join Favor Farm as Staff' })).toBeTruthy();
  });

  it('joins in one click and opens the workspace', async () => {
    api.pending.mockResolvedValue(invited);
    render(<NoCompany email="jane@gmail.com" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Join Favor Farm as Staff' }));
    await waitFor(() => expect(api.acceptMine).toHaveBeenCalledWith('inv-1'));
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith('/dashboard'));
  });

  it('lists several invitations (two companies invited the same address)', async () => {
    api.pending.mockResolvedValue([...invited, { id: 'inv-2', company_name: 'Beta Ltd', role: 'HR', expires_at: '2099-01-01' }]);
    render(<NoCompany email="jane@gmail.com" />);
    expect(await screen.findByRole('button', { name: 'Join Beta Ltd as Hr' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join Favor Farm as Staff' })).toBeTruthy();
  });

  it('shows why joining failed and stays on the page', async () => {
    api.pending.mockResolvedValue(invited);
    api.acceptMine.mockRejectedValue(new Error('This invitation is not valid any more'));
    render(<NoCompany email="jane@gmail.com" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Join Favor Farm as Staff' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This invitation is not valid any more'));
    expect(api.assign).not.toHaveBeenCalled();
  });

  it('still offers the create-company form when there are no invitations, or they cannot be loaded', async () => {
    api.pending.mockRejectedValue(new Error('network'));
    render(<NoCompany email="jane@gmail.com" />);
    expect(await screen.findByText('You are not in a company yet')).toBeTruthy();
    expect(screen.getByPlaceholderText('Company name')).toBeTruthy();
  });
});

describe('NoCompany', () => {
  it('without a waiting company name, asks what to call the company', () => {
    render(<NoCompany email="new@x.co" />);
    expect(screen.getByText('You are not in a company yet')).toBeTruthy();
    expect(api.createCompany).not.toHaveBeenCalled();
  });

  it('creates the company typed before the email was confirmed, once, and opens the dashboard', async () => {
    writePendingCompany('Acme Ltd');
    render(<NoCompany email="new@x.co" />);
    expect(screen.getByText('Setting up your company…')).toBeTruthy();
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith('/dashboard'));
    expect(api.createCompany).toHaveBeenCalledTimes(1);
    expect(api.createCompany).toHaveBeenCalledWith('Acme Ltd');
    expect(readPendingCompany()).toBeNull(); // used up, so a reload cannot create it again
  });

  it('if that fails, shows the reason and the form with the name filled in', async () => {
    writePendingCompany('Acme Ltd');
    api.createCompany.mockRejectedValue(new Error('You already administer 10 companies'));
    render(<NoCompany email="new@x.co" />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You already administer 10 companies'));
    const input = (await screen.findByPlaceholderText('Company name')) as HTMLInputElement;
    expect(input.value).toBe('Acme Ltd');
    expect(api.assign).not.toHaveBeenCalled();
  });
});
