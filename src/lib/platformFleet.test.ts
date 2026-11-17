import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { ApiError } from './adminApi';
import { filterCompanies, fleetProblem, fleetTotals, statusOf, type FleetCompany } from './platformFleet';

const company = (id: string, status: FleetCompany['status'], extra: Partial<FleetCompany> = {}): FleetCompany => ({
  id, name: `Company ${id}`, fleet_status: null, plan: null, created_at: null, owner_name: `Owner ${id}`, owner_email: `${id}@owner.co`,
  vehicles: 2, drivers: 1, admins: 1, trips_last_30_days: 5, last_location_at: null, in_fleet: true,
  organization_id: status ? `org-${id}` : null, status, status_reason: null,
  ...extra,
});

describe('Fleet companies', () => {
  it('a company without a platform status is unregistered', () => {
    expect(statusOf(company('a', 'active'))).toBe('active');
    expect(statusOf(company('b', null))).toBe('unregistered');
  });

  it('adds up the totals, unknown counts as nothing', () => {
    const t = fleetTotals([company('a', 'pending'), company('b', 'active'), company('c', 'rejected'), company('d', null, { vehicles: null, trips_last_30_days: null })]);
    expect(t).toEqual({ companies: 4, pending: 1, active: 1, suspended: 0, rejected: 1, unregistered: 1, vehicles: 6, drivers: 4, trips: 15 });
  });

  it('filters by status and searches by name, owner or the exact Fleet ID', () => {
    const list = [company('cmp1', 'pending'), company('cmp2', 'active', { owner_name: 'Wanjiru Kamau' }), company('cmp3', null)];
    expect(filterCompanies(list, { status: 'unregistered', search: '' }).map((c) => c.id)).toEqual(['cmp3']);
    expect(filterCompanies(list, { status: 'all', search: 'wanjiru' }).map((c) => c.id)).toEqual(['cmp2']);
    expect(filterCompanies(list, { status: 'all', search: 'CMP1' }).map((c) => c.id)).toEqual(['cmp1']);
    expect(filterCompanies(list, { status: 'active', search: 'cmp1' })).toEqual([]);
  });

  it('tells not connected, unavailable and other problems apart', () => {
    expect(fleetProblem(new ApiError('x', 503, 'fleet_not_connected'))).toBe('not_connected');
    expect(fleetProblem(new ApiError('x', 502, 'fleet_unavailable'))).toBe('unavailable');
    expect(fleetProblem(new ApiError('x', 403, 'forbidden'))).toBe('other');
    expect(fleetProblem(new Error('x'))).toBe('other');
  });
});
