import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { alsoToldSentence, chainSentence, roleName, stepText, type MyApprovalChain } from './staffCompany';

const chain = (steps: MyApprovalChain['steps'], also: string[] = []): MyApprovalChain => ({
  kind: 'leave', has_employee_record: true, steps, skipped: [], also_told: also, admin_fallback: false,
});

describe('the approval chain in words', () => {
  it('names people with what they are, and roles plainly', () => {
    expect(stepText({ position: 1, label: 'Line manager', approver_type: 'reports_to', who: 'Max Manager' })).toBe('Max Manager (line manager)');
    expect(stepText({ position: 1, label: 'Leave approver', approver_type: 'leave_approver', who: 'Lea A or Alt B' })).toBe('Lea A or Alt B (leave approver)');
    expect(stepText({ position: 1, label: 'HR', approver_type: 'role', approver_role: 'HR', who: 'HR' })).toBe('HR');
    expect(stepText({ position: 1, label: 'HR', approver_type: 'role', approver_role: 'HR', who: 'HR or CHECKER or Jane Doe' })).toBe('HR or Checker or Jane Doe');
    expect(stepText({ position: 1, label: 'Final sign-off', approver_type: 'role', approver_role: 'ADMIN', who: 'ADMIN' })).toBe('an admin (Final sign-off)');
    // a named person: the step is called by their name
    expect(stepText({ position: 1, label: 'Chris Cto', approver_type: 'person', who: 'Chris Cto' })).toBe('Chris Cto');
    expect(stepText({ position: 1, label: 'People lead', approver_type: 'person', who: 'Hana Hr' })).toBe('Hana Hr (People lead)');
  });

  it('makes the sentences', () => {
    const c = chain([
      { position: 1, label: 'Line manager', approver_type: 'reports_to', who: 'Max Manager' },
      { position: 2, label: 'HR', approver_type: 'role', approver_role: 'HR', who: 'HR' },
    ], ['HR', 'ADMIN']);
    expect(chainSentence(c)).toBe('Your leave goes to Max Manager (line manager), then HR.');
    expect(alsoToldSentence(c)).toBe('HR and an admin are also told when it is decided.');
    expect(alsoToldSentence(chain([]))).toBe('');
    expect(roleName('OPERATIONS')).toBe('Operations');
  });
});
