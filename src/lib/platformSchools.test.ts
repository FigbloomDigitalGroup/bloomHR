import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { ApiError } from './adminApi';
import {
  filterSchools, schoolAction, schoolTotals, schoolsProblem, statusChangeError, statusFilters, statusLabel, type School,
  schoolHrRequestPending,
} from './platformSchools';
import type { HrState } from './platformSchoolHr';

const school = (id: string, status: string, students: number, name = id): School => ({
  id, name, slug: name.toLowerCase(), status, status_reason: null, organization: null, created_at: '2026-09-14T08:00:00Z',
  admin_email: null, students, teachers: 0, parents: 0, last_activity_at: null,
});

describe('platformSchools', () => {
  const list = [school('aaa', 'active', 10, 'Alpha'), school('bbb', 'suspended', 5, 'Beta'), school('ccc', 'pending_setup', 1, 'Gamma')];

  it('counts schools, active, suspended and students', () => {
    expect(schoolTotals(list)).toEqual({ schools: 3, active: 1, suspended: 1, students: 16 });
    expect(schoolTotals([])).toEqual({ schools: 0, active: 0, suspended: 0, students: 0 });
  });

  it('offers All, Active, Suspended, then any other status as it comes', () => {
    expect(statusFilters(list)).toEqual(['all', 'active', 'suspended', 'pending_setup']);
    expect(statusLabel('pending_setup')).toBe('Pending setup');
  });

  it('filters by status and searches name, slug or the start of the ID', () => {
    expect(filterSchools(list, { status: 'suspended', search: '' }).map((s) => s.id)).toEqual(['bbb']);
    expect(filterSchools(list, { status: 'all', search: 'gam' }).map((s) => s.id)).toEqual(['ccc']);
    expect(filterSchools(list, { status: 'all', search: 'AA' }).map((s) => s.id)).toEqual(['aaa']);
  });

  it('lists the schools asking for HR & Payroll that is still off, the longest waiting first', () => {
    const at = (id: string, status: string, when: string | null | undefined): School => ({ ...school(id, status, 0), hr_requested_at: when });
    const all = [
      at('new', 'active', '2026-11-22T09:00:00Z'),
      at('old', 'suspended', '2026-11-18T09:00:00Z'),
      at('done', 'active', '2026-11-10T09:00:00Z'),
      at('busy', 'active', '2026-11-11T09:00:00Z'),
      at('never', 'active', null),
      at('older-schools', 'active', undefined),
      at('unplatformed', 'active', '2026-11-23T09:00:00Z'),
    ];
    const states: Record<string, HrState> = { new: 'off', old: 'off', done: 'on', busy: 'enabling', never: 'off', 'older-schools': 'off' };
    const hrOf = (s: School) => (states[s.id] ? { state: states[s.id] } : null);
    expect(filterSchools(all, { status: 'all', search: '', hrRequested: true, hrOf }).map((s) => s.id)).toEqual(['old', 'new', 'unplatformed']);
    expect(filterSchools(all, { status: 'active', search: '', hrRequested: true, hrOf }).map((s) => s.id)).toEqual(['new', 'unplatformed']);
    expect(filterSchools(all, { status: 'all', search: '', hrOf }).map((s) => s.id)).toEqual(all.map((s) => s.id));
    expect(all.filter((s) => schoolHrRequestPending(s, hrOf))).toHaveLength(3);
  });

  it('tells "not connected" (503) from "did not answer" (502)', () => {
    expect(schoolsProblem(new ApiError('x', 503, 'schools_not_connected'))).toBe('not_connected');
    expect(schoolsProblem(new ApiError('x', 502, 'schools_unavailable'))).toBe('unavailable');
    expect(schoolsProblem(new ApiError('x', 403, 'forbidden'))).toBe('other');
    expect(schoolsProblem(new Error('x'))).toBe('other');
  });
});

describe('what the console offers for each school status', () => {
  it('suspend for active, trial and overdue; reactivate for suspended; nothing for onboarding, setup_stalled or others', () => {
    expect(['active', 'trial', 'overdue'].map(schoolAction)).toEqual(['suspended', 'suspended', 'suspended']);
    expect(schoolAction('suspended')).toBe('active');
    expect(['onboarding', 'setup_stalled', 'archived', ''].map(schoolAction)).toEqual([null, null, null, null]);
  });

  it("says plainly when Schools won't set that status yet (422 status_not_settable)", () => {
    const err = new ApiError('Status trial cannot be changed to suspended', 422, 'status_not_settable');
    expect(statusChangeError(err, { name: 'Ruiru Academy', status: 'trial' }, 'suspended')).toBe(
      "Figbloom Schools doesn't allow Ruiru Academy to be suspended while it is trial. (Status trial cannot be changed to suspended)"
    );
    expect(statusChangeError(new ApiError('Already suspended', 409, 'already_in_status'), { name: 'X', status: 'active' }, 'suspended')).toBe(
      'Already suspended'
    );
    expect(statusChangeError('weird', { name: 'X', status: 'active' }, 'active')).toBe('The school was not changed.');
  });
});
