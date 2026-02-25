-- ============================================================
-- HR LIFECYCLE MODULE - Permission Registration
-- Run this AFTER hr_lifecycle_schema.sql
-- ============================================================

-- 1. Register the permission in the permissions table
INSERT INTO permissions (module_name, module_id, description, category)
VALUES (
  'HR Lifecycle',
  'hr-lifecycle',
  'Manage employment status, leave schedules, lifecycle history, payroll history, salary advances, suspensions and terminations',
  'people-hr'
) ON CONFLICT (module_id) DO NOTHING;

-- 2. Grant hr-lifecycle permission to ADMIN, HR, CHECKER, MANAGER roles
-- Uses text[] array - safe to run multiple times

UPDATE role_permissions
SET permissions = array_append(permissions, 'hr-lifecycle')
WHERE role_name IN ('ADMIN', 'HR', 'CHECKER', 'MANAGER')
  AND NOT ('hr-lifecycle' = ANY(permissions));

-- 3. If role rows don't exist yet, insert them
INSERT INTO role_permissions (role_name, permissions)
VALUES
  ('ADMIN',   ARRAY['hr-lifecycle']),
  ('HR',      ARRAY['hr-lifecycle']),
  ('CHECKER', ARRAY['hr-lifecycle']),
  ('MANAGER', ARRAY['hr-lifecycle'])
ON CONFLICT (role_name) DO NOTHING;
