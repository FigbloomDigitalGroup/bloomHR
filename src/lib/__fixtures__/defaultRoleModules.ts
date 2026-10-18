// The modules each system role has in a company that never changed them: the default company's roles
// (20261006000160_reference_data.sql), plus "invite-people" (ADMIN, HR; 20261019700000) and "task-projects" (every
// role but STAFF; 20261020000000). The role matrix test (roleMatrix.test.tsx) compares what each role sees with these.
export const DEFAULT_ROLE_MODULES: Record<string, string[]> = {
  ADMIN: ['dashboard', 'ai-assistant', 'task-manager', 'teams', 'sms', 'email-portal', 'employees', 'recruitment', 'leaves', 'performance', 'training', 'assign-managers', 'staffcheck', 'payroll', 'expenses', 'salaryadmin', 'asset', 'mpesa-zap', 'reports', 'phone-approvals', 'adminconfirm', 'incident-reports', 'settings', 'role-permissions', 'invite-people', 'task-projects'],
  HR: ['dashboard', 'ai-assistant', 'task-manager', 'teams', 'sms', 'email-portal', 'employees', 'recruitment', 'leaves', 'performance', 'training', 'assign-managers', 'staffcheck', 'reports', 'phone-approvals', 'adminconfirm', 'invite-people', 'task-projects'],
  CHECKER: ['dashboard', 'ai-assistant', 'task-manager', 'teams', 'email-portal', 'employees', 'recruitment', 'training', 'staffcheck', 'payroll', 'expenses', 'salaryadmin', 'mpesa-zap', 'reports', 'phone-approvals', 'adminconfirm', 'incident-reports', 'settings', 'task-projects'],
  MANAGER: ['dashboard', 'ai-assistant', 'task-manager', 'teams', 'sms', 'email-portal', 'employees', 'leaves', 'performance', 'expenses', 'salaryadmin', 'reports', 'incident-reports', 'task-projects'],
  REGIONAL: ['dashboard', 'ai-assistant', 'task-manager', 'teams', 'employees', 'leaves', 'performance', 'expenses', 'salaryadmin', 'reports', 'task-projects'],
  OPERATIONS: ['dashboard', 'ai-assistant', 'task-manager', 'teams', 'sms', 'email-portal', 'employees', 'recruitment', 'leaves', 'training', 'staffcheck', 'expenses', 'reports', 'task-projects'],
  STAFF: ['dashboard', 'task-manager', 'teams'],
};

/**
 * The same roles after 20261021200000_roles_everywhere.sql: the modules that replaced checks on role names, given to the
 * roles that had the access by name.
 */
const ADDED: Record<string, string[]> = {
  ADMIN: ['task-oversight', 'kpi-admin', 'loans', 'team-work', 'casual-overtime', 'approve-exits', 'chat-channels', 'chat-admin', 'sign-in-security', 'hr-lifecycle', 'employee-edit', 'hr-admin'],
  HR: ['task-oversight', 'kpi-admin', 'loans', 'casual-overtime', 'approve-exits', 'chat-channels', 'employee-edit', 'hr-admin'],
  CHECKER: [],
  MANAGER: ['team-work', 'chat-channels', 'employee-edit'],
  REGIONAL: ['employee-edit'],
  OPERATIONS: [],
  STAFF: [],
};
export const DEFAULT_ROLE_MODULES_AFTER: Record<string, string[]> = Object.fromEntries(
  Object.entries(DEFAULT_ROLE_MODULES).map(([role, mods]) => [role, [...mods, ...ADDED[role]]])
);
