import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const listResult = vi.hoisted(() => ({ value: { data: [] as unknown[], error: null as unknown } }));

vi.mock('./supabase', () => ({
  supabase: {
    rpc,
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        order: () => b,
        limit: () => Promise.resolve(listResult.value),
      };
      return b;
    },
  },
}));

import { companyApi, describeCompanyError, inviteLink } from './companyApi';

beforeEach(() => {
  rpc.mockReset();
  listResult.value = { data: [], error: null };
});

describe('companyApi', () => {
  it('creates a company through the database function', async () => {
    rpc.mockResolvedValue({ data: 'tenant-1', error: null });
    expect(await companyApi.createCompany('Acme')).toBe('tenant-1');
    expect(rpc).toHaveBeenCalledWith('create_company', { p_name: 'Acme' });
  });

  it('returns the invitation with its link token', async () => {
    rpc.mockResolvedValue({ data: [{ invitation_id: 'i1', token: 'abc', expires_at: 'soon' }], error: null });
    const inv = await companyApi.createInvitation('a@b.co', 'STAFF');
    expect(inv.token).toBe('abc');
    expect(rpc).toHaveBeenCalledWith('create_invitation', { p_email: 'a@b.co', p_role: 'STAFF' });
  });

  it('fails clearly when the database returns no invitation', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(companyApi.createInvitation('a@b.co', 'STAFF')).rejects.toThrow(/Could not create/);
  });

  it('previews an invitation, or null when the link is not valid', async () => {
    rpc.mockResolvedValueOnce({ data: [{ company_name: 'Acme', email: 'a@b.co', role: 'HR' }], error: null });
    expect(await companyApi.invitationPreview('tok')).toEqual({ company_name: 'Acme', email: 'a@b.co', role: 'HR' });
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await companyApi.invitationPreview('bad')).toBeNull();
  });

  it('turns database errors (plain objects) into readable messages', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'This invitation was sent to a different email address' } });
    await expect(companyApi.acceptInvitation('tok')).rejects.toThrow(/different email address\. Sign in/);
    rpc.mockResolvedValue({ data: null, error: { message: 'This invitation is not valid any more' } });
    await expect(companyApi.acceptInvitation('tok')).rejects.toThrow(/no longer valid/);
  });

  it('switches company and lists the choices', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await companyApi.switchCompany('t2');
    expect(rpc).toHaveBeenCalledWith('switch_company', { p_tenant_id: 't2' });
    rpc.mockResolvedValue({ data: [{ tenant_id: 't2', name: 'B', slug: 'b', role: 'HR', is_current: false }], error: null });
    expect((await companyApi.myCompanies())[0].name).toBe('B');
  });

  it('lists invitations and surfaces a failure', async () => {
    listResult.value = { data: [{ id: '1', email: 'a@b.co' }], error: null };
    expect(await companyApi.listInvitations()).toHaveLength(1);
    listResult.value = { data: [], error: { message: 'boom' } };
    await expect(companyApi.listInvitations()).rejects.toThrow('boom');
  });
});

describe('helpers', () => {
  it('builds the join link with the token safely encoded', () => {
    expect(inviteLink('a b&c', 'https://app.example')).toBe('https://app.example/join?token=a%20b%26c');
  });

  it('never shows an empty error', () => {
    expect(describeCompanyError({})).toMatch(/try again/);
    expect(describeCompanyError(null)).toMatch(/try again/);
  });
});
