import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// A company's roles (FIG-827, migration 20261019700000). Every company has the seven system roles (rows with
// is_system, which it may rename) and roles of its own, each based on one of the seven. user_profiles.role is always
// the BASE role, so the app's checks on role names keep working; the company role decides the modules and the name
// shown. When the company's roles cannot be loaded, the seven system roles are used.

export const SYSTEM_ROLES = ['ADMIN', 'HR', 'CHECKER', 'MANAGER', 'REGIONAL', 'OPERATIONS', 'STAFF'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const isSystemRole = (role: unknown): role is SystemRole => SYSTEM_ROLES.includes(String(role) as SystemRole);

/** How the role screen has always named the system roles (a company may rename them). */
export const SYSTEM_ROLE_LABELS: Record<SystemRole, string> = {
  ADMIN: 'Administrator',
  HR: 'Human Resources',
  CHECKER: 'Checker',
  MANAGER: 'Manager',
  REGIONAL: 'Regional Manager',
  OPERATIONS: 'Operations',
  STAFF: 'Staff',
};

/** Only a role based on ADMIN may hold these (admin_only_modules()). */
export const ADMIN_ONLY_MODULES = ['settings', 'role-permissions'];
/** A role based on STAFF may not hold these either (staff_restricted_modules()); task modules are allowed. */
export const STAFF_RESTRICTED_MODULES = ['payroll', 'salaryadmin', 'mpesa-zap', 'adminconfirm', 'assign-managers', 'hr-lifecycle'];

/** May a role with this base role hold the module? The same rule as module_allowed_for_base() in the database. */
export const moduleAllowedForBase = (base: string, module: string) =>
  base === 'ADMIN' || (!ADMIN_ONLY_MODULES.includes(module) && (base !== 'STAFF' || !STAFF_RESTRICTED_MODULES.includes(module)));

export interface CompanyRole {
  /** null for a system role made up because the company's roles could not be loaded */
  id: string | null;
  /** role_permissions.role_name: the system role's name, or CR_<id> */
  role_key: string;
  name: string;
  description: string | null;
  base_role: SystemRole;
  is_system: boolean;
  active: boolean;
}

/** The seven system roles, as used when the company's own list is not available. */
export const fallbackRoles = (): CompanyRole[] =>
  SYSTEM_ROLES.map((r) => ({ id: null, role_key: r, name: SYSTEM_ROLE_LABELS[r], description: null, base_role: r, is_system: true, active: true }));

const asRole = (row: unknown): CompanyRole | null => {
  const r = row as Partial<CompanyRole> | null;
  if (!r || typeof r.role_key !== 'string' || typeof r.name !== 'string' || !isSystemRole(r.base_role)) return null;
  return {
    id: typeof r.id === 'string' ? r.id : null,
    role_key: r.role_key,
    name: r.name,
    description: r.description ?? null,
    base_role: r.base_role,
    is_system: !!r.is_system,
    active: r.active !== false,
  };
};

/**
 * The company's roles: system roles first (in the usual order, any the company is missing filled in), then its own
 * roles by name. Rows that are not roles are ignored.
 */
export function normaliseRoles(rows: unknown[] | null | undefined): CompanyRole[] {
  const roles = (rows ?? []).map(asRole).filter((r): r is CompanyRole => r !== null);
  const system = SYSTEM_ROLES.map((key) => roles.find((r) => r.is_system && r.role_key === key) ?? fallbackRoles().find((r) => r.role_key === key)!);
  const custom = roles.filter((r) => !r.is_system).sort((a, b) => a.name.localeCompare(b.name));
  return [...system, ...custom];
}

/** How to show someone's role: their company role's name, else the (renamed) system role, else the role tidied up. */
export function roleDisplayName(roles: CompanyRole[], role: string | null | undefined, companyRoleId?: string | null): string {
  const r = String(role ?? '');
  if (companyRoleId) {
    const custom = roles.find((x) => x.id === companyRoleId);
    if (custom) return custom.name;
  }
  const system = roles.find((x) => x.is_system && x.role_key === r);
  if (system) return system.name;
  if (isSystemRole(r)) return SYSTEM_ROLE_LABELS[r];
  return r ? r.charAt(0) + r.slice(1).toLowerCase() : '';
}

/** What to store when this role is picked: the base role, and the company role id for a custom role (else null). */
export const roleSelection = (role: CompanyRole) => ({ role: role.base_role, companyRoleId: role.is_system ? null : role.id });

/** The key a picker uses for a person's role: their custom role's key, else the system role. */
export function roleKeyFor(roles: CompanyRole[], role: string | null | undefined, companyRoleId?: string | null): string {
  const custom = companyRoleId ? roles.find((x) => x.id === companyRoleId && !x.is_system) : undefined;
  return custom ? custom.role_key : String(role ?? 'STAFF');
}

/**
 * The roles this person may give (inviting, assigning), as user_may_grant() decides in the database: an administrator
 * any active role; anyone else roles based on STAFF, and a custom one only when they hold all its modules.
 * `modulesOf` gives a custom role's modules (when known); without it, custom STAFF roles are offered and the database
 * has the last word.
 */
export function grantableRoles(
  roles: CompanyRole[],
  callerRole: string | null | undefined,
  callerModules: string[] = [],
  modulesOf?: (role: CompanyRole) => string[] | undefined
): CompanyRole[] {
  const active = roles.filter((r) => r.active);
  if (callerRole === 'ADMIN') return active;
  return active.filter((r) => {
    if (r.base_role !== 'STAFF') return false;
    if (r.is_system) return true;
    const theirs = modulesOf?.(r);
    return !theirs || theirs.every((m) => callerModules.includes(m));
  });
}

export interface RoleHolders {
  [roleKey: string]: number;
}

/** Calls the role functions (they check who may do what); errors come back as messages people can read. */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message || 'Something went wrong. Please try again.');
  return data as T;
}

export const rolesApi = {
  /** The company's roles; the system roles when they cannot be loaded (so screens always have something to offer). */
  async list(): Promise<CompanyRole[]> {
    try {
      const { data, error } = await supabase
        .from('company_roles')
        .select('id, role_key, name, description, base_role, is_system, active')
        .order('name');
      if (error) return fallbackRoles();
      return normaliseRoles(data as unknown[]);
    } catch {
      return fallbackRoles();
    }
  },

  /** How many people hold each role (by role key). Empty when it cannot be told. */
  async holders(): Promise<RoleHolders> {
    try {
      if (typeof supabase.rpc !== 'function') return {};
      const { data, error } = await supabase.rpc('company_role_holders');
      if (error || !Array.isArray(data)) return {};
      return Object.fromEntries((data as { role_key: string; people: number }[]).map((r) => [r.role_key, Number(r.people) || 0]));
    } catch {
      return {};
    }
  },

  create: (input: { name: string; baseRole: string; description?: string | null; modules?: string[] }) =>
    rpc<string>('create_company_role', {
      p_name: input.name,
      p_base_role: input.baseRole,
      p_description: input.description ?? null,
      p_modules: input.modules ?? [],
    }),

  update: (id: string, changes: { name?: string; description?: string; active?: boolean }) =>
    rpc<null>('update_company_role', {
      p_role: id,
      p_name: changes.name ?? null,
      p_description: changes.description ?? null,
      p_active: changes.active ?? null,
    }),

  setModules: (id: string, modules: string[]) => rpc<string[]>('set_company_role_modules', { p_role: id, p_modules: modules }),

  remove: (id: string) => rpc<null>('delete_company_role', { p_role: id }),

  /** Gives a member of the company one of its roles (their base role follows). */
  assign: (userId: string, roleId: string) => rpc<null>('assign_company_role', { p_user: userId, p_role: roleId }),
};

/** The company's roles for a screen, loaded once (the system roles until then, and if loading fails). */
export function useCompanyRoles() {
  const [roles, setRoles] = useState<CompanyRole[]>(fallbackRoles);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const next = await rolesApi.list();
    setRoles(next);
    setLoaded(true);
    return next;
  }, []);
  useEffect(() => {
    let cancelled = false;
    rolesApi.list().then((next) => {
      if (cancelled) return;
      setRoles(next);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { roles, loaded, reload };
}
