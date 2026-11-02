import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { InviteResult, PlatformAdminChange, PlatformStaffMember } from '../../lib/platformStaff';

const api = vi.hoisted(() => ({
  admin: true,
  role: 'owner' as import('../../lib/platformRoles').PlatformRole,
  roleChanges: [] as unknown[][],
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
vi.mock('../../lib/platformRoles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformRoles')>()),
  myPlatformRole: () => Promise.resolve(api.admin ? api.role : null),
}));
vi.mock('../../lib/platformStaff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformStaff')>()),
  listPlatformStaff: () => Promise.resolve(api.staff),
  recentPlatformAdminChanges: () => Promise.resolve(api.changes),
  invitePlatformAdmin: (...args: unknown[]) => {
    api.invites.push(args);
    return api.inviteError ? Promise.reject(api.inviteError) : Promise.resolve(api.inviteResult);
  },
  setPlatformAdminRole: (...args: unknown[]) => {
    api.roleChanges.push(args);
    return Promise.resolve(args[1]);
  },
  removePlatformAdmin: (...args: unknown[]) => {
    api.removals.push(args);
    return Promise.resolve();
  },
}));

import StaffPage from './StaffPage';

const ME = 'u-ops';
const member = (user_id: string, email: string, extra: Partial<PlatformStaffMember> = {}): PlatformStaffMember => ({
  user_id, email, note: null, role: 'viewer', added_by: null, added_by_email: null, added_at: '2026-10-21T08:00:00Z', last_sign_in_at: null,
  in_company: false, companies: 0, ...extra,
});

afterEach(cleanup);
beforeEach(() => {
  api.admin = true;
  api.role = 'owner';
  api.roleChanges = [];
  api.staff = [
    member(ME, 'ops@figbloom.org', { note: 'Figbloom ops', role: 'owner', last_sign_in_at: '2026-11-01T08:00:00Z' }),
    member('u-mary', 'mary@figbloom.org', { role: 'support', added_by: ME, added_by_email: 'ops@figbloom.org', in_company: true, companies: 1 }),
    member('u-new', 'new@figbloom.org', { note: 'Support' }),
  ];
  api.changes = [
    { id: 'c2', user_id: 'u-old', email: 'old@figbloom.org', action: 'removed', note: 'Left Figbloom', old_role: 'viewer', new_role: null, changed_by: ME, changed_by_email: 'ops@figbloom.org', changed_at: '2026-10-30T08:00:00Z' },
    { id: 'c1', user_id: 'u-new', email: 'new@figbloom.org', action: 'added', note: 'Support', old_role: null, new_role: 'viewer', changed_by: ME, changed_by_email: 'ops@figbloom.org', changed_at: '2026-10-29T08:00:00Z' },
  ];
  api.invites = [];
  api.inviteResult = result('invited', 'sam@figbloom.org');
  api.inviteError = null;
  api.removals = [];
  api.toastSuccess.mockReset();
  api.toastError.mockReset();
});

// the email also shows in the recent changes: the row is the one in the table
const result = (outcome: InviteResult['result'], email: string, extra: Partial<InviteResult> = {}): InviteResult => ({
  ok: true, email, userId: 'u-x', origin: 'https://console.figbloom.org', result: outcome, invited: outcome === 'invited',
  notified: outcome === 'notified', alreadyAdmin: outcome === 'already_admin', ...extra,
});

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
    await waitFor(() => expect(api.invites).toEqual([['sam@figbloom.org', 'Support lead', 'viewer']]));
    await waitFor(() => expect(api.toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/^Invite sent to sam@figbloom.org/)));
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('');
  });

  const inviteAs = async (email: string) => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
  };

  it('says the invite was sent to a new login, and keeps the message on the page', async () => {
    render(<StaffPage currentUserId={ME} />);
    await screen.findByText('ops@figbloom.org');
    await inviteAs('sam@figbloom.org');
    expect((await screen.findByRole('status')).textContent).toMatch(/^Invite sent to sam@figbloom.org/);
  });

  it('says an existing login was emailed that they now have console access', async () => {
    api.inviteResult = result('notified', 'mary@figbloom.org');
    render(<StaffPage currentUserId={ME} />);
    await screen.findByText('ops@figbloom.org');
    await inviteAs('mary@figbloom.org');
    await waitFor(() =>
      expect(api.toastSuccess).toHaveBeenCalledWith('mary@figbloom.org already had a login; we emailed them that they now have console access.')
    );
    expect(screen.getByRole('status').textContent).toMatch(/now have console access/);
  });

  it('warns when the notification email failed, with where they can sign in', async () => {
    api.inviteResult = result('notify_failed', 'mary@figbloom.org', { origin: 'https://console-staging.figbloom.org', notifyError: 'Email is not set up (RESEND_API_KEY)' });
    render(<StaffPage currentUserId={ME} />);
    await screen.findByText('ops@figbloom.org');
    await inviteAs('mary@figbloom.org');
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/mary@figbloom.org is now an admin, but the notification email failed/);
    expect(status.textContent).toMatch(/RESEND_API_KEY/);
    expect(status.textContent).toMatch(/sign in at console-staging.figbloom.org with their usual password/);
    expect(api.toastError).toHaveBeenCalledWith(expect.stringMatching(/notification email failed/), { duration: 10000 });
    expect(api.toastSuccess).not.toHaveBeenCalled();
  });

  it('says when they already were an admin and only the note changed', async () => {
    api.inviteResult = result('already_admin', 'ops@figbloom.org');
    render(<StaffPage currentUserId={ME} />);
    await screen.findByText('ops@figbloom.org');
    await inviteAs('ops@figbloom.org');
    await waitFor(() =>
      expect(api.toastSuccess).toHaveBeenCalledWith('ops@figbloom.org was already an admin; note updated. Their role is unchanged: use Change role for that.')
    );
  });

  it('names the role they keep when they already were an admin', async () => {
    api.inviteResult = result('already_admin', 'mary@figbloom.org', { role: 'support' });
    render(<StaffPage currentUserId={ME} />);
    await screen.findByText('ops@figbloom.org');
    await inviteAs('mary@figbloom.org');
    await waitFor(() => expect(api.toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/^mary@figbloom.org was already an admin \(Support\)/)));
  });

  it('shows a refusal plainly', async () => {
    api.inviteError = new Error('Only a Figbloom platform admin can do this');
    render(<StaffPage currentUserId={ME} />);
    await screen.findByText('ops@figbloom.org');
    await inviteAs('x@figbloom.org');
    await waitFor(() => expect(api.toastError).toHaveBeenCalledWith('Only a Figbloom platform admin can do this'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('the Staff page: console roles', () => {
  const roleOptions = () => screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value);

  it('shows each person\'s role', async () => {
    render(<StaffPage currentUserId={ME} />);
    expect(within(await rowOf('ops@figbloom.org')).getByText('Owner')).toBeTruthy();
    expect(within(await rowOf('mary@figbloom.org')).getByText('Support')).toBeTruthy();
    expect(within(await rowOf('new@figbloom.org')).getByText('Viewer')).toBeTruthy();
  });

  it('an owner invites with any role, Viewer by default, each described', async () => {
    render(<StaffPage currentUserId={ME} />);
    await screen.findByText('ops@figbloom.org');
    expect(roleOptions()).toEqual(['owner', 'admin', 'support', 'viewer']);
    expect((screen.getByRole('radio', { name: /Viewer/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Sees everything, changes nothing.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Owner/ }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sam@figbloom.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    await waitFor(() => expect(api.invites).toEqual([['sam@figbloom.org', '', 'owner']]));
  });

  it('an admin never offers Owner, and cannot remove or change an owner', async () => {
    api.role = 'admin';
    api.staff = [
      member('u-boss', 'boss@figbloom.org', { role: 'owner' }),
      member(ME, 'ops@figbloom.org', { role: 'admin' }),
      member('u-mary', 'mary@figbloom.org', { role: 'support' }),
    ];
    render(<StaffPage currentUserId={ME} />);
    await screen.findByText('boss@figbloom.org');
    expect(roleOptions()).toEqual(['admin', 'support', 'viewer']);
    const boss = await rowOf('boss@figbloom.org');
    expect(within(boss).queryByText('Remove')).toBeNull();
    expect(within(boss).queryByText('Change role')).toBeNull();
    const mary = await rowOf('mary@figbloom.org');
    expect(within(mary).getByText('Remove')).toBeTruthy();
    fireEvent.click(within(mary).getByText('Change role'));
    const dialog = await screen.findByRole('dialog');
    const options = within(dialog).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['', 'admin', 'viewer']);
  });

  it('an admin may lower their own role, never remove themselves', async () => {
    api.role = 'admin';
    api.staff = [member(ME, 'ops@figbloom.org', { role: 'admin' }), member('u-boss', 'boss@figbloom.org', { role: 'owner' })];
    render(<StaffPage currentUserId={ME} />);
    const me = await rowOf('ops@figbloom.org');
    expect(within(me).queryByText('Remove')).toBeNull();
    fireEvent.click(within(me).getByText('Change role'));
    const options = within(await screen.findByRole('dialog')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['', 'support', 'viewer']);
  });

  it('changes a role only with a new role and a reason', async () => {
    render(<StaffPage currentUserId={ME} />);
    fireEvent.click(within(await rowOf('mary@figbloom.org')).getByText('Change role'));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Change role' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('New role'), { target: { value: 'viewer' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why\?/), { target: { value: 'Only needs to look' } });
    fireEvent.click(save);
    await waitFor(() => expect(api.roleChanges).toEqual([['u-mary', 'viewer', 'Only needs to look']]));
  });

  it('support and viewers see the staff and the changes, but cannot invite, remove or change roles', async () => {
    for (const role of ['support', 'viewer'] as const) {
      api.role = role;
      render(<StaffPage currentUserId={ME} />);
      await screen.findByText('mary@figbloom.org');
      expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull();
      expect(screen.queryByText('Remove')).toBeNull();
      expect(screen.queryByText('Change role')).toBeNull();
      expect(screen.getByRole('list', { name: 'Recent changes' })).toBeTruthy();
      cleanup();
    }
  });

  it('describes role changes in the recent changes', async () => {
    api.changes = [
      { id: 'c3', user_id: 'u-mary', email: 'mary@figbloom.org', action: 'role_changed', note: 'Handles tickets', old_role: 'viewer', new_role: 'support', changed_by: ME, changed_by_email: 'ops@figbloom.org', changed_at: '2026-10-31T08:00:00Z' },
    ];
    render(<StaffPage currentUserId={ME} />);
    const list = await screen.findByRole('list', { name: 'Recent changes' });
    expect(within(list).getByRole('listitem').textContent).toMatch(/mary@figbloom.org changed from Viewer to Support by ops@figbloom.org/);
  });
});
