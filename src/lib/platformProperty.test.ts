import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { ApiError } from './adminApi';
import {
  filterWorkspaces, propertyActions, propertyProblem, propertyTotals, registered, statusOf, type PropertyWorkspace,
} from './platformProperty';

const workspace = (id: string, status: string | null, extra: Partial<PropertyWorkspace> = {}): PropertyWorkspace => ({
  id, name: `Workspace ${id}`, slug: id, property_active: true, created_at: null, creator_name: `Owner ${id}`, creator_email: `${id}@owner.co`,
  plan_name: 'Growth', plan_status: 'active', trial_ends_at: null, properties: 2, units: 10, occupied_units: 8, team_members: 2, tenants: 9,
  platform_organization_id: status ? `org-${id}` : null, platform_tenant_id: null, registered_at: null,
  in_property: true, organization_id: status ? `org-${id}` : null, status, status_reason: null,
  ...extra,
});

describe('Property workspaces', () => {
  it("shows the platform's status, an owner's own switch-off apart, else Property's own, else not on the platform yet", () => {
    expect(statusOf(workspace('a', 'suspended', { property_active: false }))).toBe('suspended');
    expect(statusOf(workspace('b', 'active', { property_active: false }))).toBe('deactivated');
    expect(statusOf(workspace('c', null))).toBe('active');
    expect(statusOf(workspace('d', null, { property_active: false }))).toBe('inactive');
    expect(statusOf(workspace('e', null, { property_active: null }))).toBe('unregistered');
  });

  it("suspends an active one (its owner's switch-off too), reactivates a suspended one, nothing before the platform knows it", () => {
    expect(propertyActions(workspace('a', 'active'))).toEqual(['suspend']);
    expect(propertyActions(workspace('b', 'active', { property_active: false }))).toEqual(['suspend']);
    expect(propertyActions(workspace('c', 'suspended'))).toEqual(['reactivate']);
    expect(propertyActions(workspace('d', null))).toEqual([]);
    expect(propertyActions(workspace('e', 'pending'))).toEqual([]);
    expect(registered(workspace('d', null))).toBe(false);
    expect(registered(workspace('f', null, { platform_organization_id: 'org-f' }))).toBe(true);
  });

  it('adds up the totals', () => {
    const t = propertyTotals([
      workspace('a', 'active'), workspace('b', 'suspended'), workspace('c', 'active', { property_active: false }), workspace('d', null, { units: null }),
    ]);
    expect(t).toEqual({ workspaces: 4, active: 2, suspended: 1, deactivated: 1, units: 30 });
  });

  it('filters by status and searches by name, slug, creator or the exact workspace ID', () => {
    const list = [workspace('acme', 'active'), workspace('beta', 'suspended', { creator_name: 'Wanjiru Kamau' }), workspace('cmx9', null)];
    expect(filterWorkspaces(list, { status: 'suspended', search: '' }).map((w) => w.id)).toEqual(['beta']);
    expect(filterWorkspaces(list, { status: 'all', search: 'wanjiru' }).map((w) => w.id)).toEqual(['beta']);
    expect(filterWorkspaces(list, { status: 'all', search: 'ACME' }).map((w) => w.id)).toEqual(['acme']);
    expect(filterWorkspaces(list, { status: 'all', search: 'cmx9@owner.co' }).map((w) => w.id)).toEqual(['cmx9']);
    expect(filterWorkspaces(list, { status: 'suspended', search: 'acme' })).toEqual([]);
  });

  it('tells not connected, unavailable and other problems apart', () => {
    expect(propertyProblem(new ApiError('x', 503, 'property_not_connected'))).toBe('not_connected');
    expect(propertyProblem(new ApiError('x', 502, 'property_unavailable'))).toBe('unavailable');
    expect(propertyProblem(new ApiError('x', 403, 'forbidden'))).toBe('other');
    expect(propertyProblem(new Error('x'))).toBe('other');
  });
});
