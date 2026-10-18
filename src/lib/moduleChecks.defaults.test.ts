import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_MODULES_AFTER } from './__fixtures__/defaultRoleModules';
import { salaryWorkflowRole } from './salaryWorkflowRole';
import { canCreateChannels } from '../components/chat/lib/permissions';
import { canManageJobTitles } from '../components/Settings/JobTitles';

// The checks that replaced role names, against every system role's default modules: each must give the role exactly
// what the old check on its name gave it. ADMIN holds every module (usePermissions).
const ROLES = Object.keys(DEFAULT_ROLE_MODULES_AFTER);
const holds = (role: string) => (m: string) => role === 'ADMIN' || DEFAULT_ROLE_MODULES_AFTER[role].includes(m);
const any = (role: string, ms: string[]) => ms.some(holds(role));
const all = (role: string, ms: string[]) => ms.every(holds(role));
const who = (test: (role: string) => boolean) => ROLES.filter(test).sort();

describe('module checks keep the system roles as they were', () => {
  it('leave types and holidays, HR list tools, field access (hr-admin) = ADMIN, HR', () => {
    expect(who((r) => any(r, ['hr-admin']))).toEqual(['ADMIN', 'HR']);
  });
  it('Add employee / Manage (employee-edit) = ADMIN, HR, MANAGER, REGIONAL', () => {
    expect(who((r) => any(r, ['employee-edit']))).toEqual(['ADMIN', 'HR', 'MANAGER', 'REGIONAL']);
  });
  it('terminate and approve exits (approve-exits) = ADMIN, HR', () => {
    expect(who((r) => any(r, ['approve-exits']))).toEqual(['ADMIN', 'HR']);
    expect(who((r) => any(r, ['hr-admin', 'approve-exits']))).toEqual(['ADMIN', 'HR']);
  });
  it('terminate (with approval) on the record = ADMIN, HR, MANAGER; pending list = ADMIN, MANAGER', () => {
    expect(who((r) => any(r, ['approve-exits', 'team-work']))).toEqual(['ADMIN', 'HR', 'MANAGER']);
    expect(who((r) => any(r, ['team-work']))).toEqual(['ADMIN', 'MANAGER']);
  });
  it('pay on records, Bulk Edit, advance settings (hr-admin and payroll) = ADMIN only', () => {
    expect(who((r) => all(r, ['hr-admin', 'payroll']))).toEqual(['ADMIN']);
  });
  it('company set-up checklist (settings and invite-people) = ADMIN only', () => {
    expect(who((r) => all(r, ['settings', 'invite-people']))).toEqual(['ADMIN']);
  });
  it('assets (asset) = ADMIN only; M-Pesa results (mpesa-zap) = ADMIN, CHECKER', () => {
    expect(who((r) => any(r, ['asset']))).toEqual(['ADMIN']);
    expect(who((r) => any(r, ['mpesa-zap']))).toEqual(['ADMIN', 'CHECKER']);
  });
  it('staff loans (loans or payroll) = ADMIN, HR, CHECKER', () => {
    expect(who((r) => any(r, ['loans', 'payroll']))).toEqual(['ADMIN', 'CHECKER', 'HR']);
  });
  it('chat: create channels = ADMIN, HR, MANAGER; open employee records = everyone but STAFF', () => {
    expect(who((r) => canCreateChannels(holds(r)))).toEqual(['ADMIN', 'HR', 'MANAGER']);
    expect(who((r) => any(r, ['employees']))).toEqual(ROLES.filter((r) => r !== 'STAFF').sort());
  });
  it('job titles (employees or kpi-admin) = everyone but STAFF, as before', () => {
    expect(who((r) => canManageJobTitles(holds(r)))).toEqual(ROLES.filter((r) => r !== 'STAFF').sort());
  });
  it('salary workflow roles = the old ROLE_MAPPING', () => {
    expect(Object.fromEntries(ROLES.map((r) => [r, salaryWorkflowRole(r, holds(r))]))).toEqual({
      ADMIN: 'credit_analyst_officer',
      CHECKER: 'checker',
      OPERATIONS: 'maker',
      STAFF: 'maker',
      MANAGER: 'branch_manager',
      REGIONAL: 'regional_manager',
      HR: 'maker',
    });
  });
});
