import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../hooks/usePermissions';
import { CompanyRole, grantableRoles, roleSelection, useCompanyRoles } from '../../lib/roles';

export interface RolePick {
  /** the base role (one of the seven) */
  role: string;
  /** the company's own role, or null for a standard role */
  companyRoleId: string | null;
}

export const STAFF_PICK: RolePick = { role: 'STAFF', companyRoleId: null };

/** Each role's modules (by role key), to know which custom roles the person may give; empty when it can't be read. */
function useRoleModules() {
  const [modules, setModules] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data, error } = await supabase.from('role_permissions').select('role_name, permissions');
        if (!live || error || !Array.isArray(data)) return;
        setModules(Object.fromEntries((data as { role_name: string; permissions: string[] | null }[]).map((r) => [r.role_name, r.permissions ?? []])));
      } catch {
        // the database still has the last word on what may be given
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return modules;
}

interface CompanyRolePickerProps {
  value: RolePick;
  onChange: (pick: RolePick) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Picks one of the company's roles to give someone (inviting, adding a login): only the roles this person may give,
 * as the database decides (user_may_grant): an administrator any role; anyone else with "Invite people" roles based on
 * Staff, and a company's own role only when they hold all its modules.
 */
export default function CompanyRolePicker({ value, onChange, label = 'Role in the app', id = 'company-role', disabled, className = '' }: CompanyRolePickerProps) {
  const { roles } = useCompanyRoles();
  const { userRole, permissions } = usePermissions();
  const roleModules = useRoleModules();
  const options = useMemo(
    () => grantableRoles(roles, userRole, permissions, (r: CompanyRole) => roleModules[r.role_key]),
    [roles, userRole, permissions, roleModules]
  );
  const selectedKey = value.companyRoleId
    ? roles.find((r) => r.id === value.companyRoleId)?.role_key ?? ''
    : value.role;

  return (
    <label htmlFor={id} className={`block ${className}`}>
      <span className="block text-[11.5px] font-semibold text-muted-foreground mb-1">{label}</span>
      <select
        id={id}
        disabled={disabled || options.length === 0}
        value={options.some((o) => o.role_key === selectedKey) ? selectedKey : ''}
        onChange={(e) => {
          const picked = options.find((o) => o.role_key === e.target.value);
          if (picked) onChange(roleSelection(picked));
        }}
        className="w-full rounded-tile border border-border bg-white px-3 py-2 text-xs text-ink outline-none focus:border-brand"
      >
        {options.length === 0 && <option value="">No role you can give</option>}
        {!options.some((o) => o.role_key === selectedKey) && options.length > 0 && <option value="">Choose a role</option>}
        {options.map((r) => (
          <option key={r.role_key} value={r.role_key}>
            {r.name}
            {r.is_system ? '' : ` (based on ${roles.find((s) => s.is_system && s.role_key === r.base_role)?.name ?? r.base_role})`}
          </option>
        ))}
      </select>
    </label>
  );
}
