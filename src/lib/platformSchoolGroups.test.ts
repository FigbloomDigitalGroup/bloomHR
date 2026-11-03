import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { ApiError } from './adminApi';
import {
  actionPermission, filterGroups, groupActions, groupPeople, groupTotals, groupsProblem, needsReason, type SchoolGroup,
} from './platformSchoolGroups';
import type { School } from './platformSchools';

const group = (id: string, status: string, schools: [string, string, string | null][] = [], extra: Partial<SchoolGroup> = {}): SchoolGroup => ({
  id, name: `Group ${id}`, status, status_reason: null, owner_email: `${id}@owner.co`, created_at: '2026-10-01T08:00:00Z',
  local_organization_id: null, tenant_count: schools.length,
  schools: schools.map(([name, slug, local]) => ({ id: `p-${slug}`, name, status: 'active', local_tenant_id: local, local_slug: slug })),
  ...extra,
});
const school = (id: string, students: number, teachers: number, parents: number) =>
  ({ id, name: id, slug: id, status: 'active', status_reason: null, organization: null, created_at: '', admin_email: null, students, teachers, parents, last_activity_at: null }) as School;

describe('school groups', () => {
  it('offers approve and reject while pending, suspend when active, reactivate when suspended or rejected', () => {
    expect(groupActions('pending')).toEqual(['approve', 'reject']);
    expect(groupActions('active')).toEqual(['suspend']);
    expect(groupActions('suspended')).toEqual(['reactivate']);
    expect(groupActions('rejected')).toEqual(['reactivate']);
    expect(groupActions('archived')).toEqual([]);
  });

  it('approve and reject need approve_companies; suspend and reactivate suspend_companies; reasons for reject and suspend', () => {
    expect(['approve', 'reject', 'suspend', 'reactivate'].map((a) => actionPermission(a as never))).toEqual([
      'approve_companies', 'approve_companies', 'suspend_companies', 'suspend_companies',
    ]);
    expect(['approve', 'reject', 'suspend', 'reactivate'].map((a) => needsReason(a as never))).toEqual([false, true, true, false]);
  });

  it("adds up a group's people from Figbloom Schools by school ID, ignoring schools it doesn't know", () => {
    const g = group('a', 'active', [['One', 'one', 's1'], ['Two', 'two', 's2'], ['Three', 'three', null], ['Gone', 'gone', 's9']]);
    const byId = new Map([school('s1', 100, 10, 80), school('s2', 50, 5, 40)].map((s) => [s.id, s]));
    expect(groupPeople(g, byId)).toEqual({ students: 150, teachers: 15, parents: 120, matched: 2 });
    expect(groupPeople(g, new Map())).toEqual({ students: 0, teachers: 0, parents: 0, matched: 0 });
  });

  it('filters by status and searches group names, owners, school names and slugs', () => {
    const list = [group('a', 'pending', [['Hillside Primary', 'hillside-primary', 's1']]), group('b', 'active', [['Lakeview', 'lakeview-high', 's2']])];
    expect(filterGroups(list, { status: 'pending', search: '' }).map((g) => g.id)).toEqual(['a']);
    expect(filterGroups(list, { status: 'all', search: 'LAKEVIEW-h' }).map((g) => g.id)).toEqual(['b']);
    expect(filterGroups(list, { status: 'all', search: 'hillside primary' }).map((g) => g.id)).toEqual(['a']);
    expect(filterGroups(list, { status: 'all', search: 'group b' }).map((g) => g.id)).toEqual(['b']);
    expect(filterGroups(list, { status: 'all', search: 'a@owner' }).map((g) => g.id)).toEqual(['a']);
    expect(filterGroups(list, { status: 'active', search: 'hillside' })).toEqual([]);
  });

  it('totals: groups, waiting, active, suspended or rejected, and groups with no schools', () => {
    const list = [group('a', 'pending'), group('b', 'active', [['X', 'x', 's']]), group('c', 'suspended', [['Y', 'y', 't']]), group('d', 'rejected')];
    expect(groupTotals(list)).toEqual({ groups: 4, pending: 1, active: 1, suspended: 1, rejected: 1, suspendedOrRejected: 2, empty: 2 });
  });

  it('tells not connected (503) and unavailable (502) apart', () => {
    expect(groupsProblem(new ApiError('x', 503, 'platform_not_connected'))).toBe('not_connected');
    expect(groupsProblem(new ApiError('x', 502, 'platform_unavailable'))).toBe('unavailable');
    expect(groupsProblem(new ApiError('x', 403, 'forbidden'))).toBe('other');
    expect(groupsProblem(new Error('x'))).toBe('other');
  });
});
