# Role & Permissions Management System

## Overview
This system replaces hard-coded role permissions with a dynamic, database-driven approach that allows administrators to configure access rights through a user-friendly interface.

## Components Created

### 1. Database Schema (`migrations/create_role_permissions.sql`)
- **permissions** table: Stores all available system modules/features
- **role_permissions** table: Maps roles to their granted permissions
- Helper functions: `has_permission()` and `get_user_permissions()`
- Row Level Security (RLS) policies for secure access

### 2. Frontend Components

#### RolePermissions Component (`src/components/Settings/RolePermissions.tsx`)
A comprehensive admin portal featuring:
- Role selection sidebar with permission counts
- Search and filter capabilities
- Category-based permission grouping
- Bulk actions (Grant All, Clear All, Copy from another role)
- Real-time permission toggling
- Visual feedback for changes

#### usePermissions Hook (`src/hooks/usePermissions.tsx`)
Provides:
- `hasPermission(permission)`: Check single permission
- `hasAnyPermission([permissions])`: Check if user has any of the listed permissions
- `hasAllPermissions([permissions])`: Check if user has all listed permissions
- `withPermission()`: HOC for protecting components
- `<PermissionGate>`: Component for conditional rendering

### 3. Updated Sidebar (`src/components/Layout/Sidebar.tsx`)
- Removed hard-coded `allowedRoles` arrays
- Now uses `permission` property for each menu item
- Dynamically filters menu items based on user permissions
- Added "Role Permissions" menu item in System section

## Setup Instructions

### 1. Run Database Migration
```bash
# Connect to your Supabase database and run:
psql $DATABASE_URL -f migrations/create_role_permissions.sql
```

Or use Supabase SQL Editor to execute the migration script.

### 2. Verify Tables Created
The migration creates:
- `permissions` table with default system permissions
- `role_permissions` table with default role assignments
- Helper functions for permission checking

### 3. Access the Portal
Navigate to `/role-permissions` in your application (visible in Settings menu for admins).

## Usage Examples

### In Components
```tsx
import { usePermissions, PermissionGate } from '../hooks/usePermissions';

function MyComponent() {
  const { hasPermission, hasAnyPermission } = usePermissions();

  // Check single permission
  if (hasPermission('payroll')) {
    // Show payroll features
  }

  // Check multiple permissions (any)
  if (hasAnyPermission(['payroll', 'expenses'])) {
    // Show financial features
  }

  return (
    <div>
      {/* Conditional rendering */}
      <PermissionGate permission="payroll">
        <PayrollButton />
      </PermissionGate>

      {/* Require all permissions */}
      <PermissionGate permission={['admin', 'settings']} requireAll>
        <AdminSettings />
      </PermissionGate>
    </div>
  );
}
```

### Protecting Routes
```tsx
import { withPermission } from '../hooks/usePermissions';

const PayrollPage = () => {
  return <div>Payroll Content</div>;
};

// Wrap with permission check
export default withPermission(PayrollPage, 'payroll');

// Or with multiple permissions (any)
export default withPermission(PayrollPage, ['payroll', 'finance']);
```

## Default Permissions

### Modules
- **Overview**: dashboard, ai-assistant
- **Workspace**: task-manager, teams, sms, email-portal
- **People & HR**: employees, recruitment, leaves, performance, training, assign-managers, staffcheck
- **Finance**: payroll, expenses, salaryadmin, asset, mpesa-zap
- **System**: reports, phone-approvals, adminconfirm, incident-reports, settings, role-permissions

### Default Role Assignments
- **ADMIN**: All permissions
- **HR**: People & HR + some workspace and system
- **CHECKER**: Finance + some HR and system
- **MANAGER**: Team management + expenses
- **REGIONAL**: Similar to Manager with regional scope
- **OPERATIONS**: Operational modules
- **STAFF**: Basic access (dashboard, tasks, teams)

## Managing Permissions

### Adding New Permissions
```sql
INSERT INTO permissions (module_id, module_name, description, category) VALUES
  ('new-feature', 'New Feature', 'Description of new feature', 'category');
```

### Updating Role Permissions
Use the Role Permissions portal at `/role-permissions` to:
1. Select a role from the sidebar
2. Toggle permissions on/off
3. Use bulk actions for quick setup
4. Copy permissions from another role
5. Save changes

### Programmatic Updates
```sql
UPDATE role_permissions 
SET permissions = array_append(permissions, 'new-permission')
WHERE role_name = 'ADMIN';
```

## Security Features

1. **Row Level Security**: Only admins can modify permissions
2. **Real-time Updates**: Changes reflect immediately
3. **Audit Trail**: `updated_at` timestamp tracks changes
4. **Type Safety**: TypeScript interfaces ensure type safety
5. **Validation**: Frontend validates permission existence

## Migration from Hard-Coded Roles

The system automatically migrates existing hard-coded permissions to the database. All existing `allowedRoles` arrays have been replaced with `permission` properties that map to database entries.

## Troubleshooting

### Permissions Not Loading
- Check database connection
- Verify `permissions` and `role_permissions` tables exist
- Check browser console for errors

### User Can't See Menu Items
- Verify user's role in `employees` table
- Check `role_permissions` table for role's permissions
- Ensure permission IDs match between sidebar and database

### Changes Not Saving
- Verify user has ADMIN role
- Check RLS policies are enabled
- Review browser network tab for API errors

## Future Enhancements

- [ ] Permission groups/templates
- [ ] Audit log for permission changes
- [ ] Permission inheritance
- [ ] Time-based permissions
- [ ] Permission delegation
- [ ] Bulk user permission updates
- [ ] Export/Import permission configurations
