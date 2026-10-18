// The salary advance / payment workflow's own roles (SalaryAdmin, and the payment modals that take its strings):
//   credit_analyst_officer  the company's system administrator (base role ADMIN): pays directly, may bypass approvals
//   checker                 whoever holds the Payroll module: approves payment requests (Checker by default)
//   branch_manager          base role MANAGER: recommends advances for their branch (a location scope)
//   regional_manager        base role REGIONAL: recommends advances for their region (a location scope)
//   maker                   everyone else: raises requests
// Only "checker" follows a module; the others are genuine base-role meanings (who the administrator is, and which
// location someone's approvals cover), so a company's own role keeps its base role's place in this workflow.

export type SalaryWorkflowRole = 'credit_analyst_officer' | 'checker' | 'branch_manager' | 'regional_manager' | 'maker';

export function salaryWorkflowRole(baseRole: string | null | undefined, hasPermission: (module: string) => boolean): SalaryWorkflowRole {
  const role = String(baseRole ?? '').toUpperCase();
  if (role === 'ADMIN') return 'credit_analyst_officer';
  if (hasPermission('payroll')) return 'checker';
  if (role === 'MANAGER') return 'branch_manager';
  if (role === 'REGIONAL') return 'regional_manager';
  return 'maker';
}
