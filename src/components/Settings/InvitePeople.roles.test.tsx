import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Inviting with the company's own roles (FIG-827): the picker offers the roles this person may give, by name.
const api = vi.hoisted(() => ({
  listInvitations: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  emailInvitation: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./EmployeeNumbering', () => ({ default: () => null }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/companyApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/companyApi')>();
  return { ...real, companyApi: { ...real.companyApi, ...api } };
});
vi.mock('../../lib/roles', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/roles')>();
  const roles = real.normaliseRoles([
    { id: 'r-hr', role_key: 'HR', name: 'People Team', description: null, base_role: 'HR', is_system: true, active: true },
    { id: 'r-op', role_key: 'CR_op', name: 'Operators', description: null, base_role: 'STAFF', is_system: false, active: true },
    { id: 'r-sup', role_key: 'CR_sup', name: 'Supervisors', description: null, base_role: 'MANAGER', is_system: false, active: true },
  ]);
  return { ...real, useCompanyRoles: () => ({ roles, loaded: true, reload: async () => roles }) };
});

import InvitePeople from './InvitePeople';

const future = new Date(Date.now() + 5 * 86_400_000).toISOString();

beforeEach(() => {
  api.listInvitations.mockReset().mockResolvedValue([
    { id: 'w', email: 'op@x.co', role: 'STAFF', company_role_id: 'r-op', status: 'pending', created_at: future, expires_at: future, accepted_at: null },
  ]);
  api.createInvitation.mockReset().mockResolvedValue({ invitation_id: 'i1', token: 'tok', expires_at: future });
  api.emailInvitation.mockReset().mockResolvedValue({ ok: true, sentTo: 'x' });
});
afterEach(() => cleanup());

describe('InvitePeople with company roles', () => {
  it('offers HR the roles based on Staff, an administrator every role, by the company’s names', async () => {
    const { unmount } = render(<InvitePeople callerRole="HR" />);
    await screen.findByText('op@x.co');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Staff', 'Operators']);
    unmount();
    render(<InvitePeople callerRole="ADMIN" />);
    await screen.findByText('op@x.co');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining(['People Team', 'Operators', 'Supervisors']));
  });

  it('invites with a custom role (its base role and its id) and lists invitations by role name', async () => {
    render(<InvitePeople callerRole="ADMIN" />);
    expect(await screen.findByText('Operators', { selector: 'td' })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('name@gmail.com'), { target: { value: 'sup@gmail.com' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'CR_sup' } });
    fireEvent.click(screen.getByRole('button', { name: /Create invitation/ }));
    await waitFor(() => expect(api.createInvitation).toHaveBeenCalledWith('sup@gmail.com', 'MANAGER', 'r-sup'));
  });

  it('a resent invitation keeps its custom role', async () => {
    render(<InvitePeople callerRole="ADMIN" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(api.createInvitation).toHaveBeenCalledWith('op@x.co', 'STAFF', 'r-op'));
  });
});
