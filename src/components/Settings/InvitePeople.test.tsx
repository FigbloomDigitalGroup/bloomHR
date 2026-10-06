import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  listInvitations: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/companyApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/companyApi')>();
  return { ...real, companyApi: { ...real.companyApi, ...api } };
});

import toast from 'react-hot-toast';
import InvitePeople from './InvitePeople';

const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

beforeEach(() => {
  api.listInvitations.mockReset().mockResolvedValue([]);
  api.createInvitation.mockReset();
  api.revokeInvitation.mockReset().mockResolvedValue(undefined);
  vi.mocked(toast.error).mockClear();
});
afterEach(() => cleanup());

describe('InvitePeople', () => {
  it('creates an invitation and shows a link to send, containing the token', async () => {
    api.createInvitation.mockResolvedValue({ invitation_id: 'i1', token: 'tok123', expires_at: future });
    render(<InvitePeople />);
    await screen.findByText('No invitations yet');

    fireEvent.change(screen.getByPlaceholderText('name@gmail.com'), { target: { value: 'New.Person@Gmail.com' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'HR' } });
    fireEvent.click(screen.getByRole('button', { name: /Create invitation/ }));

    await waitFor(() => expect(api.createInvitation).toHaveBeenCalledWith('New.Person@Gmail.com', 'HR'));
    const link = (await screen.findByLabelText('Invitation link')) as HTMLInputElement;
    expect(link.value).toMatch(/\/join\?token=tok123$/);
    expect(screen.getByText('new.person@gmail.com')).toBeTruthy();
  });

  it('shows the person why it failed', async () => {
    api.createInvitation.mockRejectedValue(new Error('That person is already in this company.'));
    render(<InvitePeople />);
    await screen.findByText('No invitations yet');
    fireEvent.change(screen.getByPlaceholderText('name@gmail.com'), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: /Create invitation/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That person is already in this company.'));
    expect(screen.queryByLabelText('Invitation link')).toBeNull();
  });

  it('lists invitations with their real status and lets you cancel only the waiting ones', async () => {
    api.listInvitations.mockResolvedValue([
      { id: 'w', email: 'waiting@x.co', role: 'STAFF', status: 'pending', created_at: past, expires_at: future, accepted_at: null },
      { id: 'e', email: 'expired@x.co', role: 'STAFF', status: 'pending', created_at: past, expires_at: past, accepted_at: null },
      { id: 'j', email: 'joined@x.co', role: 'HR', status: 'accepted', created_at: past, expires_at: future, accepted_at: past },
    ]);
    render(<InvitePeople />);
    await screen.findByText('waiting@x.co');
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.getByText('Joined')).toBeTruthy();

    const cancels = screen.getAllByRole('button', { name: 'Cancel' });
    expect(cancels).toHaveLength(1);
    fireEvent.click(cancels[0]);
    await waitFor(() => expect(api.revokeInvitation).toHaveBeenCalledWith('w'));
  });

  it('offers HR only the staff role, and administrators every role', async () => {
    const { unmount } = render(<InvitePeople callerRole="HR" />);
    await screen.findByText('No invitations yet');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Staff']);
    unmount();
    render(<InvitePeople callerRole="ADMIN" />);
    await screen.findByText('No invitations yet');
    expect(screen.getAllByRole('option').length).toBe(7);
  });

  it('says so when the list cannot be loaded', async () => {
    api.listInvitations.mockRejectedValue(new Error('boom'));
    render(<InvitePeople />);
    expect(await screen.findByText(/Could not load invitations: boom/)).toBeTruthy();
  });
});
