import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { ApiError } from './adminApi';
import {
  crmActions, crmProblem, crmTotals, fieldErrorsByPath, filterOrganisations, registered, statusOf, type CrmOrganisation,
} from './platformCrm';

const organisation = (id: string, status: string | null, extra: Partial<CrmOrganisation> = {}): CrmOrganisation => ({
  id, name: `Org ${id}`, slug: id, crm_status: 'active', created_at: null, admin_name: `Admin ${id}`, admin_email: `${id}@admin.co`,
  active_members: 3, pending_invitations: 0, leads: 10, open_deals: 2, companies: 5, last_activity_at: null,
  platform_organization_id: status ? `org-${id}` : null, in_crm: true, organization_id: status ? `org-${id}` : null, status, status_reason: null,
  ...extra,
});

describe('CRM organisations', () => {
  it("shows the platform's status, else CRM's own, else not on the platform yet", () => {
    expect(statusOf(organisation('a', 'suspended'))).toBe('suspended');
    expect(statusOf(organisation('b', null))).toBe('active');
    expect(statusOf(organisation('c', null, { crm_status: null }))).toBe('unregistered');
  });

  it('suspends an active one, reactivates a suspended one, nothing before the platform knows it', () => {
    expect(crmActions(organisation('a', 'active'))).toEqual(['suspend']);
    expect(crmActions(organisation('b', 'suspended'))).toEqual(['reactivate']);
    expect(crmActions(organisation('c', null))).toEqual([]);
    expect(crmActions(organisation('d', 'pending'))).toEqual([]);
    expect(registered(organisation('c', null))).toBe(false);
    expect(registered(organisation('e', null, { organization_id: 'org-e' }))).toBe(true);
  });

  it('adds up the totals', () => {
    const t = crmTotals([organisation('a', 'active'), organisation('b', 'suspended'), organisation('c', null, { active_members: null })]);
    expect(t).toEqual({ organisations: 3, active: 2, suspended: 1, members: 6 });
  });

  it('filters by status and searches by name, slug, admin or the exact CRM ID', () => {
    const list = [organisation('acme', 'active'), organisation('beta', 'suspended', { admin_name: 'Wanjiru Kamau' }), organisation('cmx9', null)];
    expect(filterOrganisations(list, { status: 'suspended', search: '' }).map((o) => o.id)).toEqual(['beta']);
    expect(filterOrganisations(list, { status: 'all', search: 'wanjiru' }).map((o) => o.id)).toEqual(['beta']);
    expect(filterOrganisations(list, { status: 'all', search: 'ACME' }).map((o) => o.id)).toEqual(['acme']);
    expect(filterOrganisations(list, { status: 'suspended', search: 'acme' })).toEqual([]);
  });

  it('tells not connected, unavailable and other problems apart', () => {
    expect(crmProblem(new ApiError('x', 503, 'crm_not_connected'))).toBe('not_connected');
    expect(crmProblem(new ApiError('x', 502, 'crm_unavailable'))).toBe('unavailable');
    expect(crmProblem(new ApiError('x', 403, 'forbidden'))).toBe('other');
    expect(crmProblem(new Error('x'))).toBe('other');
  });

  it("reads the API's field errors by field", () => {
    const err = new ApiError('Taken', 409, 'slug_taken', [{ path: 'slug', message: 'That slug is taken' }, { path: 'slug', message: 'second' }]);
    expect(fieldErrorsByPath(err)).toEqual({ slug: 'That slug is taken' });
    expect(fieldErrorsByPath(new Error('x'))).toEqual({});
  });
});
