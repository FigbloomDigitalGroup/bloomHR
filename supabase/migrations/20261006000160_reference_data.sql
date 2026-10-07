-- Reference data a fresh project needs (the baseline is structure only). Every insert skips rows that already exist,
-- so on the live project this changes nothing.
--
--   permissions          the module catalogue the role screens list
--   tenants              the default company (00000000-...-0001)
--   role_permissions     the default company's roles, which every new company copies when it signs up
--                        (create_company_for_current_user)
-- Values as on the live project, 2026-10-07.

insert into public.permissions (module_id, module_name, description, category) values
  ('adminconfirm', 'Email Admin', 'Administrative email management', 'system'),
  ('ai-assistant', 'AI Assistant', 'Access to AI-powered assistant features', 'overview'),
  ('asset', 'Assets', 'Track and manage company assets', 'finance'),
  ('assign-managers', 'Assign Managers', 'Assign and manage team managers', 'people-hr'),
  ('dashboard', 'Dashboard', 'Access to main dashboard and analytics', 'overview'),
  ('email-portal', 'Email Portal', 'Access email management portal', 'workspace'),
  ('employees', 'Employees', 'View and manage employee records', 'people-hr'),
  ('expenses', 'Expenses', 'Manage expense claims and approvals', 'finance'),
  ('incident-reports', 'Incidents', 'View and manage incident reports', 'system'),
  ('leaves', 'Time Off', 'Manage leave requests and approvals', 'people-hr'),
  ('mpesa-zap', 'Mpesa Zap', 'Manage M-Pesa transactions', 'finance'),
  ('payroll', 'Payroll', 'Process and manage payroll', 'finance'),
  ('performance', 'Performance', 'Access performance management tools', 'people-hr'),
  ('phone-approvals', 'Approvals', 'Manage phone and device approvals', 'system'),
  ('recruitment', 'Recruitment', 'Manage recruitment and hiring process', 'people-hr'),
  ('reports', 'Reports', 'Generate and view system reports', 'system'),
  ('role-permissions', 'Role Permissions', 'Manage role-based access control', 'system'),
  ('salaryadmin', 'Salary Advance', 'Manage salary advance requests', 'finance'),
  ('settings', 'Settings', 'Access system settings and configuration', 'system'),
  ('sms', 'SMS Center', 'Send and manage SMS communications', 'workspace'),
  ('staffcheck', 'Disciplinary', 'Manage disciplinary actions and records', 'people-hr'),
  ('task-manager', 'Task Manager', 'Manage and assign tasks', 'workspace'),
  ('teams', 'Teams', 'View and manage team collaboration', 'workspace'),
  ('training', 'Training', 'Manage employee training programs', 'people-hr')
on conflict (module_id) do nothing;

insert into public.tenants (id, name, slug, plan)
values ('00000000-0000-0000-0000-000000000001', 'Figbloom HR', 'figbloom', 'internal')
on conflict (id) do nothing;

insert into public.role_permissions (tenant_id, role_name, permissions) values
  ('00000000-0000-0000-0000-000000000001', 'ADMIN', array['dashboard', 'ai-assistant', 'task-manager', 'teams', 'sms', 'email-portal', 'employees', 'recruitment', 'leaves', 'performance', 'training', 'assign-managers', 'staffcheck', 'payroll', 'expenses', 'salaryadmin', 'asset', 'mpesa-zap', 'reports', 'phone-approvals', 'adminconfirm', 'incident-reports', 'settings', 'role-permissions']),
  ('00000000-0000-0000-0000-000000000001', 'CHECKER', array['dashboard', 'ai-assistant', 'task-manager', 'teams', 'email-portal', 'employees', 'recruitment', 'training', 'staffcheck', 'payroll', 'expenses', 'salaryadmin', 'mpesa-zap', 'reports', 'phone-approvals', 'adminconfirm', 'incident-reports', 'settings']),
  ('00000000-0000-0000-0000-000000000001', 'HR', array['dashboard', 'ai-assistant', 'task-manager', 'teams', 'sms', 'email-portal', 'employees', 'recruitment', 'leaves', 'performance', 'training', 'assign-managers', 'staffcheck', 'reports', 'phone-approvals', 'adminconfirm']),
  ('00000000-0000-0000-0000-000000000001', 'MANAGER', array['dashboard', 'ai-assistant', 'task-manager', 'teams', 'sms', 'email-portal', 'employees', 'leaves', 'performance', 'expenses', 'salaryadmin', 'reports', 'incident-reports']),
  ('00000000-0000-0000-0000-000000000001', 'OPERATIONS', array['dashboard', 'ai-assistant', 'task-manager', 'teams', 'sms', 'email-portal', 'employees', 'recruitment', 'leaves', 'training', 'staffcheck', 'expenses', 'reports']),
  ('00000000-0000-0000-0000-000000000001', 'REGIONAL', array['dashboard', 'ai-assistant', 'task-manager', 'teams', 'employees', 'leaves', 'performance', 'expenses', 'salaryadmin', 'reports']),
  ('00000000-0000-0000-0000-000000000001', 'STAFF', array['dashboard', 'task-manager', 'teams'])
on conflict (tenant_id, role_name) do nothing;
