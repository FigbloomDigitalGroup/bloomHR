-- SIMPLIFIED VERSION: Role & Permissions Migration Script
-- Works with roles stored in auth.users metadata instead of employees table

-- Create permissions table
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  module_id VARCHAR(100) UNIQUE NOT NULL,
  module_name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create role_permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_name VARCHAR(50) UNIQUE NOT NULL,
  permissions TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default permissions
INSERT INTO permissions (module_id, module_name, description, category) VALUES
  ('dashboard', 'Dashboard', 'Access to main dashboard and analytics', 'overview'),
  ('ai-assistant', 'AI Assistant', 'Access to AI-powered assistant features', 'overview'),
  ('task-manager', 'Task Manager', 'Manage and assign tasks', 'workspace'),
  ('teams', 'Teams', 'View and manage team collaboration', 'workspace'),
  ('sms', 'SMS Center', 'Send and manage SMS communications', 'workspace'),
  ('email-portal', 'Email Portal', 'Access email management portal', 'workspace'),
  ('employees', 'Employees', 'View and manage employee records', 'people-hr'),
  ('recruitment', 'Recruitment', 'Manage recruitment and hiring process', 'people-hr'),
  ('leaves', 'Time Off', 'Manage leave requests and approvals', 'people-hr'),
  ('performance', 'Performance', 'Access performance management tools', 'people-hr'),
  ('training', 'Training', 'Manage employee training programs', 'people-hr'),
  ('assign-managers', 'Assign Managers', 'Assign and manage team managers', 'people-hr'),
  ('staffcheck', 'Disciplinary', 'Manage disciplinary actions and records', 'people-hr'),
  ('payroll', 'Payroll', 'Process and manage payroll', 'finance'),
  ('expenses', 'Expenses', 'Manage expense claims and approvals', 'finance'),
  ('salaryadmin', 'Salary Advance', 'Manage salary advance requests', 'finance'),
  ('asset', 'Assets', 'Track and manage company assets', 'finance'),
  ('mpesa-zap', 'Mpesa Zap', 'Manage M-Pesa transactions', 'finance'),
  ('reports', 'Reports', 'Generate and view system reports', 'system'),
  ('phone-approvals', 'Approvals', 'Manage phone and device approvals', 'system'),
  ('adminconfirm', 'Email Admin', 'Administrative email management', 'system'),
  ('incident-reports', 'Incidents', 'View and manage incident reports', 'system'),
  ('settings', 'Settings', 'Access system settings and configuration', 'system'),
  ('role-permissions', 'Role Permissions', 'Manage role-based access control', 'system')
ON CONFLICT (module_id) DO NOTHING;

-- Insert default role permissions
INSERT INTO role_permissions (role_name, permissions) VALUES
  ('ADMIN', ARRAY['dashboard', 'ai-assistant', 'task-manager', 'teams', 'sms', 'email-portal', 'employees', 'recruitment', 'leaves', 'performance', 'training', 'assign-managers', 'staffcheck', 'payroll', 'expenses', 'salaryadmin', 'asset', 'mpesa-zap', 'reports', 'phone-approvals', 'adminconfirm', 'incident-reports', 'settings', 'role-permissions']),
  ('HR', ARRAY['dashboard', 'ai-assistant', 'task-manager', 'teams', 'sms', 'email-portal', 'employees', 'recruitment', 'leaves', 'performance', 'training', 'assign-managers', 'staffcheck', 'reports', 'phone-approvals', 'adminconfirm']),
  ('CHECKER', ARRAY['dashboard', 'ai-assistant', 'task-manager', 'teams', 'email-portal', 'employees', 'recruitment', 'training', 'staffcheck', 'payroll', 'expenses', 'salaryadmin', 'mpesa-zap', 'reports', 'phone-approvals', 'adminconfirm', 'incident-reports', 'settings']),
  ('MANAGER', ARRAY['dashboard', 'ai-assistant', 'task-manager', 'teams', 'sms', 'email-portal', 'employees', 'leaves', 'performance', 'expenses', 'salaryadmin', 'reports', 'incident-reports']),
  ('REGIONAL', ARRAY['dashboard', 'ai-assistant', 'task-manager', 'teams', 'employees', 'leaves', 'performance', 'expenses', 'salaryadmin', 'reports']),
  ('OPERATIONS', ARRAY['dashboard', 'ai-assistant', 'task-manager', 'teams', 'sms', 'email-portal', 'employees', 'recruitment', 'leaves', 'training', 'staffcheck', 'expenses', 'reports']),
  ('STAFF', ARRAY['dashboard', 'task-manager', 'teams'])
ON CONFLICT (role_name) DO NOTHING;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);
CREATE INDEX IF NOT EXISTS idx_permissions_module_id ON permissions(module_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_name ON role_permissions(role_name);

-- Enable RLS
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (safe to run multiple times)
DROP POLICY IF EXISTS "Anyone can view permissions" ON permissions;
DROP POLICY IF EXISTS "Only admins can modify permissions" ON permissions;
DROP POLICY IF EXISTS "Anyone can view role permissions" ON role_permissions;
DROP POLICY IF EXISTS "Only admins can modify role permissions" ON role_permissions;

-- Create RLS policies (simplified - checking user_metadata role)
CREATE POLICY "Anyone can view permissions" ON permissions 
  FOR SELECT USING (true);

CREATE POLICY "Only admins can modify permissions" ON permissions 
  FOR ALL USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'ADMIN'
  );

CREATE POLICY "Anyone can view role permissions" ON role_permissions 
  FOR SELECT USING (true);

CREATE POLICY "Only admins can modify role permissions" ON role_permissions 
  FOR ALL USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'ADMIN'
  );

-- Create helper functions (using user_metadata instead of employees table)
CREATE OR REPLACE FUNCTION has_permission(user_id UUID, required_permission TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
  user_permissions TEXT[];
BEGIN
  -- Get user's role from auth.users metadata
  SELECT raw_user_meta_data->>'role' INTO user_role
  FROM auth.users
  WHERE id = user_id;
  
  IF user_role IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Get role's permissions
  SELECT permissions INTO user_permissions
  FROM role_permissions
  WHERE role_name = user_role;
  
  -- Check if permission exists in array
  RETURN required_permission = ANY(user_permissions);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_permissions(user_id UUID)
RETURNS TEXT[] AS $$
DECLARE
  user_role TEXT;
  user_permissions TEXT[];
BEGIN
  -- Get user's role from auth.users metadata
  SELECT raw_user_meta_data->>'role' INTO user_role
  FROM auth.users
  WHERE id = user_id;
  
  IF user_role IS NULL THEN
    RETURN ARRAY[]::TEXT[];
  END IF;
  
  -- Get role's permissions
  SELECT permissions INTO user_permissions
  FROM role_permissions
  WHERE role_name = user_role;
  
  RETURN COALESCE(user_permissions, ARRAY[]::TEXT[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments
COMMENT ON TABLE permissions IS 'Stores all available system permissions/modules';
COMMENT ON TABLE role_permissions IS 'Maps roles to their granted permissions';
COMMENT ON FUNCTION has_permission IS 'Check if a user has a specific permission based on their auth metadata role';
COMMENT ON FUNCTION get_user_permissions IS 'Get all permissions for a user based on their auth metadata role';
