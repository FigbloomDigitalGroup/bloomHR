import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { InviteResult, PlatformAdminChange, PlatformStaffMember } from '../../lib/platformStaff';

const api = vi.hoisted(() => ({
  admin: true,
  staff: [] as PlatformStaffMember[],
  changes: [] as PlatformAdminChange[],
  invites: [] as unknown[][],
  inviteResult: null as InviteResult | null,
  inviteError: null as Error | null,
  removals: [] as unknown[][],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: (...a: unknown[]) => api.toastSuccess(...a), error: (...a: unknown[]) => api.toastError(...a) } }));
vi.mock('../../lib/platformRates', () => ({ isPlatformAdmin: () => Promise.resolve(api.admin) }));
vi.mock('../../lib/platformStaff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformStaff')>()),
  listPlatformStaff: () => Promise.resolve(api.staff),
  recentPlatformAdminChanges: () => Promise.resolve(api.changes),
  invitePlatformAdmin: (...args: unknown[]) => {
    api.invites.push(args);
    return api.inviteError ? Promise.reject(api.inviteError) : Promise.resolve(api.inviteResult);
  },
  removePlatformAdmin: (...args: unknown[]) => {
    api.removals.push(args);
    return Promise.resolve();
  },
}));

import StaffPage from './StaffPage';

const ME = 'u-ops';
const member = (user_id: string, email: string, extra: Partial<PlatformStaffMember> = {}): PlatformStaffMember => ({
  user_id, email, note: null, added_by: null, added_by_email: null, added_at: '2026-10-21T08:00:00Z', last_sign_in_at: null,
  in_company: false, companies: 0, ...extra,
});

afterEach(cleanup);
beforeEach(() => {
  api.admin = true;
  api.staff = [
    member(ME, 'ops@figbloom.org', { note: 'Figbloom ops', last_sign_in_at: '2026-11-01T08:00:00Z' }),
    member('u-mary', 'mary@figbloom.org', { added_by: ME, added_by_email: 'ops@figbloom.org', in_company: true, companies: 1 }),
    member('u-new', 'new@figbloom.org', { note: 'Support' }),
  ];
  api.changes = [
    { id: 'c2', user_id: 'u-old', email: 'old@figbloom.org', action: 'removed', note: 'Left Figbloom', changed_by: ME, changed_by_email: 'ops@figbloom.org', changed_at: '2026-10-30T08:00:00Z' },
    { id: 'c1', user_id: 'u-new', email: 'new@figbloom.org', action: 'added', note: 'Support', changed_by: ME, changed_by_email: 'ops@figbloom.org', changed_at: '2026-10-29T08:00:00Z' },
  ];
  api.invites = [];
  api.inviteResult = { ok: true, email: 'sam@figbloom.org', userId: 'u-sam', invited: true, alreadyAdmin: false };
  api.inviteError = null;
  api.removals = [];
  api.toastSuccess.mockReset();
  api.toastError.mockReset();
});

// the email also shows in the recent changes: the row is the one in the table
const rowOf = async (email: string) =>
  (await screen.findAllByText(email)).map((e) => e.closest('tr')).find(Boolean) as HTMLElement;

describe('the Staff page', () => {
  it('is for platform admins only', async () => {
    api.admin = false;
    render(<StaffPage currentUserId={ME} />);
    expect(await screen.findByText(/Only Figbloom platform admins can see and change the platform admins/)).toBeTruthy();
    expect(screen.queryByText('ops@figbloom.org')).toBeNull();
  });

  it('lists the platform admins: note, company or none, who added them and the last sign-in', async () => {
    render(<StaffPage currentUserId={ME} />);
    const ops = await rowOf('ops@figbloom.org');
    expect(within(ops).getByText('Figbloom ops')).toBeTruthy();
    expect(within(ops).getByText('No company')).toBeTruthy();
    expect(within(ops).getByText('(you)')).toBeTruthy();
    expect(within(ops).getByText(/set up directly/)).toBeTruthy();
    const mary = await rowOf('mary@figbloom.org');
    expect(within(mary).getByText('Also in a company')).toBeTruthy();
    expect(within(mary).getByText('by ops@figbloom.org')).toBeTruthy();
    expect(within(mary).getByText('Never')).toBeTruthy();
  });

  it('shows the recent changes, with the reason', async () => {
    render(<StaffPage currentUserId={ME} />);
    const list = await screen.findByRole('list', { name: 'Recent changes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Left Figbloom')).toBeTruthy();
  });

  it('offers Remove for others, never for yourself', async () => {
    render(<StaffPage currentUserId={ME} />);
    expect(within(await rowOf('ops@figbloom.org')).queryByText('Remove')).toBeNull();
    expect(within(await rowOf('mary@figbloom.org')).getByText('Remove')).toBeTruthy();
  });

  it('removes only with a reason, after confirming', async () => {
    render(<StaffPage currentUserId={ME} />);
    fireEvent.click(within(await rowOf('mary@figbloom.org')).getByText('Remove'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Remove mary@figbloom.org?')).toBeTruthy();
    const button = within(dialog).getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why\?/), { target: { value: '   ' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why\?/), { target: { value: 'Moved to payroll only' } });
    fireEvent.click(button);
    await waitFor(() => expect(api.removals).toEqual([['u-mary', 'Moved to payroll only']]));
  });

  it('cancelling the dialog removes nobody', async () => {
    render(<StaffPage currentUserId={ME} />);
    fireEvent.click(within(await rowOf('new@figbloom.org')).getByText('Remove'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.removals).toEqual([]);
  });

  it('warns what a platform admin can do before inviting', async () => {
    render(<StaffPage currentUserId={ME} />);
    await screen.findByText('ops@figbloom.org');
    expect(screen.getByRole('note').textContent).toMatch(/approve and suspend every company/);
  });

  it('invites by email with a note, only once the email looks right', async () => {
    render(<StaffPage currentUserId={ME} />);
    await screen.findByText('ops@figbloom.org');
    const invite = screen.getByRole('button', { name: 'Invite' }) as HTMLButtonElement;
    expect(invite.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not an email' } });
    expect(invite.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' sam@figbloom.org ' } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Support lead' } });
    fireEvent.click(invite);
    await waitFor(() => expect(api.invites).toEqual([['sam@figbloom.org', 'Support lead']]));
    await waitFor(() => expect(api.toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/emailed a link to set their password/)));
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('');
  });

  it('says when the person already had a login, and shows a refusal plainly', async () => {
    api.inviteResult = { ok: true, email: 'mary@figbloom.org', userId: 'u-mary', invited: false, alreadyAdmin: false };
    render(<StaffPage currentUserId={ME} />);
    await screen.findByText('ops@figbloom.org');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'mary@figbloom.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    await waitFor(() => expect(api.toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/existing login/)));

    api.inviteError = new Error('Only a Figbloom platform admin can do this');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@figbloom.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    await waitFor(() => expect(api.toastError).toHaveBeenCalledWith('Only a Figbloom platform admin can do this'));
  });
});
