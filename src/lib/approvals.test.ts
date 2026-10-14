import { describe, expect, it } from 'vitest';
import { chainPreview, stepError, stepLabel } from './approvals';

describe('approval workflow helpers', () => {
  it('names each step by its approver unless it has its own name', () => {
    expect(stepLabel({ approver_type: 'leave_approver' })).toBe('Leave approver');
    expect(stepLabel({ approver_type: 'reports_to' })).toBe('Line manager');
    expect(stepLabel({ approver_type: 'role', approver_role: 'HR' })).toBe('HR');
    expect(stepLabel({ approver_type: 'person', approver_name: 'Chris Cto' })).toBe('Chris Cto');
    expect(stepLabel({ approver_type: 'person', approver_name: 'Chris Cto', label: ' CTO ' })).toBe('CTO');
  });

  it('previews the chain', () => {
    expect(chainPreview('leave', [
      { approver_type: 'reports_to' }, { approver_type: 'role', approver_role: 'HR' }, { approver_type: 'person', label: 'CTO' },
    ])).toBe('Leave: Line manager → HR → CTO');
    expect(chainPreview('salary_advance', [])).toBe('Salary advance: no steps');
  });

  it('says what a step is missing', () => {
    expect(stepError({ approver_type: 'role' })).toBe('Choose the role');
    expect(stepError({ approver_type: 'person' })).toBe('Choose who approves');
    expect(stepError({ approver_type: 'reports_to', alternate_type: 'person' })).toBe('Choose the alternate');
    expect(stepError({ approver_type: 'reports_to', alternate_type: 'role', alternate_role: 'HR' })).toBeNull();
  });
});
