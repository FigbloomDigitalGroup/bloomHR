import { describe, expect, it } from 'vitest';
import { salaryWorkflowRole } from './salaryWorkflowRole';

const holding = (modules: string[]) => (m: string) => modules.includes(m);

describe('salaryWorkflowRole', () => {
  it('gives the system roles, with their default modules, the place they had (the old ROLE_MAPPING)', () => {
    expect(salaryWorkflowRole('ADMIN', () => true)).toBe('credit_analyst_officer');
    expect(salaryWorkflowRole('CHECKER', holding(['payroll', 'salaryadmin', 'settings']))).toBe('checker');
    expect(salaryWorkflowRole('MANAGER', holding(['salaryadmin', 'team-work']))).toBe('branch_manager');
    expect(salaryWorkflowRole('REGIONAL', holding(['salaryadmin']))).toBe('regional_manager');
    expect(salaryWorkflowRole('HR', holding(['hr-admin', 'loans']))).toBe('maker');
    expect(salaryWorkflowRole('OPERATIONS', holding(['expenses']))).toBe('maker');
    expect(salaryWorkflowRole('STAFF', holding(['dashboard']))).toBe('maker');
  });

  it('makes whoever holds Payroll a checker, whatever their role is called', () => {
    expect(salaryWorkflowRole('MANAGER', holding(['payroll']))).toBe('checker');
    expect(salaryWorkflowRole('HR', holding(['payroll']))).toBe('checker');
  });

  it('a Checker-based role without Payroll only raises requests', () => {
    expect(salaryWorkflowRole('CHECKER', holding(['salaryadmin']))).toBe('maker');
  });

  it('unknown or missing roles raise requests', () => {
    expect(salaryWorkflowRole(null, holding([]))).toBe('maker');
    expect(salaryWorkflowRole('', holding([]))).toBe('maker');
  });
});
