import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => ({ calls: [] as [string, unknown][], reply: { data: null as unknown, error: null as unknown } }));
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpc.calls.push([fn, args]);
      return Promise.resolve(rpc.reply);
    },
  },
}));

import { actionsFor, filterOrganisations, myCompanyStatus, setCompanyStatus, type Organisation } from './platformOrganisations';

const org = (name: string, status: Organisation['status']): Organisation => ({
  id: name, name, slug: name, plan: 'trial', status, created_at: '2026-10-01T00:00:00Z', owner_id: null, owner_name: null, owner_email: null,
  employees: 0, users: 1, payroll_runs: 0, last_activity: null, status_reason: null, status_changed_at: null, status_changed_by_email: null,
});

beforeEach(() => {
  rpc.calls = [];
  rpc.reply = { data: null, error: null };
});

describe('platform organisations', () => {
  it('offers the moves each status allows', () => {
    expect(actionsFor('pending')).toEqual(['approve', 'reject']);
    expect(actionsFor('rejected')).toEqual(['approve']);
    expect(actionsFor('active')).toEqual(['suspend']);
    expect(actionsFor('suspended')).toEqual(['reactivate']);
  });

  it('filters by status and searches by name', () => {
    const list = [org('Acme Ltd', 'pending'), org('Beta Co', 'active'), org('acme farms', 'active')];
    expect(filterOrganisations(list, { status: 'all', search: '' })).toHaveLength(3);
    expect(filterOrganisations(list, { status: 'active', search: '' }).map((o) => o.name)).toEqual(['Beta Co', 'acme farms']);
    expect(filterOrganisations(list, { status: 'all', search: '  ACME ' }).map((o) => o.name)).toEqual(['Acme Ltd', 'acme farms']);
    expect(filterOrganisations(list, { status: 'pending', search: 'beta' })).toEqual([]);
  });

  it('finds a company by its short name or the start of its ID', () => {
    const twins = [
      { ...org('Figbloom Digital Group', 'active'), id: '6f1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c10', slug: 'figbloom-digital-group' },
      { ...org('Figbloom Digital Group', 'active'), id: 'a0b1c2d3-0000-4000-8000-000000000000', slug: 'figbloom-digital-group-2' },
    ];
    expect(filterOrganisations(twins, { status: 'all', search: '6F1C2A4E' }).map((o) => o.id)).toEqual([twins[0].id]);
    expect(filterOrganisations(twins, { status: 'all', search: 'group-2' }).map((o) => o.id)).toEqual([twins[1].id]);
    // an ID matches from its start only, so a short number doesn't hit every company
    expect(filterOrganisations(twins, { status: 'all', search: '0000' })).toEqual([]);
  });

  it('sends a decision with its reason, and shows the database refusal', async () => {
    rpc.reply = { data: 'rejected', error: null };
    expect(await setCompanyStatus('t1', 'reject', '  Not a business ')).toBe('rejected');
    expect(rpc.calls).toEqual([['set_company_status', { p_tenant: 't1', p_action: 'reject', p_reason: 'Not a business' }]]);
    rpc.reply = { data: null, error: { message: 'Only a platform admin can approve or suspend companies' } };
    await expect(setCompanyStatus('t1', 'approve')).rejects.toThrow(/Only a platform admin/);
  });

  it("carries on when the company's status cannot be read", async () => {
    rpc.reply = { data: null, error: { message: 'function my_company_status does not exist' } };
    expect(await myCompanyStatus()).toBeNull();
    rpc.reply = { data: [{ tenant_id: 't', name: 'X', status: 'pending' }], error: null };
    expect(await myCompanyStatus()).toMatchObject({ status: 'pending' });
  });
});
