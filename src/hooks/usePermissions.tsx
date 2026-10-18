import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryClient';
import { fetchTrustedProfile } from '../lib/trustedRole';
import { moduleAllowedForBase } from '../lib/roles';
import FigbloomLoader from '../components/UI/FigbloomLoader';

interface UsePermissionsReturn {
    permissions: string[];
    hasPermission: (permission: string) => boolean;
    hasAnyPermission: (permissions: string[]) => boolean;
    hasAllPermissions: (permissions: string[]) => boolean;
    loading: boolean;
    userRole: string | null;
    /** the role as the company names it: their own role (FIG-827) or the renamed system role; null when not known */
    roleName: string | null;
}

interface MyPermissions {
    role: string | null;
    permissions: string[];
    roleName?: string | null;
}

const NOBODY: MyPermissions = { role: null, permissions: [] };

interface RoleRow {
    role_key: string;
    name: string;
    base_role: string;
    is_system: boolean;
}

/** One of the company's roles (by id, or a system role by its key), or null when it cannot be told. */
async function loadCompanyRole(column: 'id' | 'role_key', value: string): Promise<RoleRow | null> {
    try {
        const { data, error } = await supabase.from('company_roles').select('role_key, name, base_role, is_system').eq(column, value).maybeSingle();
        return error || !data ? null : (data as RoleRow);
    } catch {
        return null;
    }
}

async function loadMyPermissions(): Promise<MyPermissions> {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NOBODY;

    // The role in the company the person is working in, from user_profiles (user_metadata is editable by the
    // user and does not follow the company). Uppercase to match database role_name.
    const profile = await fetchTrustedProfile(user.id);
    if (!profile) return NOBODY;
    const { role } = profile;

    // a company's own role (FIG-827) gives its own modules, kept under its key; else the role's
    const custom = profile.companyRoleId ? await loadCompanyRole('id', profile.companyRoleId) : null;
    const useCustom = !!custom && !custom.is_system && custom.base_role === role;
    const roleName = useCustom ? custom!.name : (await loadCompanyRole('role_key', role))?.name ?? null;

    // Get role permissions from database
    const { data: rolePermData, error: permError } = await supabase
        .from('role_permissions')
        .select('permissions')
        .eq('role_name', useCustom ? custom!.role_key : role)
        .single();

    if (permError) {
        // fail closed: the role is known, but nothing is granted
        console.error('Error fetching permissions:', permError);
        return { role, permissions: [], roleName };
    }
    const granted: string[] = rolePermData?.permissions || [];
    return { role, permissions: useCustom ? granted.filter((m) => moduleAllowedForBase(role, m)) : granted, roleName };
}

/**
 * Hook to check user permissions dynamically.
 *
 * The permissions are held in the shared query cache (key: my-permissions), so every component that asks gets
 * the same answer from one request, and saving a role on the Role & Permissions page can refresh them
 * everywhere (see RolePermissions.tsx).
 *
 * @returns Object with permission checking utilities
 */
export function usePermissions(): UsePermissionsReturn {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: queryKeys.myPermissions,
        queryFn: loadMyPermissions,
    });

    // A different person signing in (or out) must never see the previous person's permissions
    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_OUT') {
                // reset (not remove): mounted components must drop the old answer and ask again straight away
                queryClient.resetQueries({ queryKey: queryKeys.myPermissions });
            } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
                queryClient.invalidateQueries({ queryKey: queryKeys.myPermissions });
            }
        });
        return () => subscription.unsubscribe();
    }, [queryClient]);

    // an error reading the user is treated like nobody being signed in (fail closed)
    const { role: userRole, permissions, roleName = null } = query.data ?? NOBODY;
    const loading = query.isLoading;

    const hasPermission = (permission: string): boolean => {
        if (userRole === 'ADMIN') return true;
        return permissions.includes(permission);
    };

    const hasAnyPermission = (requiredPermissions: string[]): boolean => {
        if (userRole === 'ADMIN') return true;
        return requiredPermissions.some(perm => permissions.includes(perm));
    };

    const hasAllPermissions = (requiredPermissions: string[]): boolean => {
        if (userRole === 'ADMIN') return true;
        return requiredPermissions.every(perm => permissions.includes(perm));
    };

    return {
        permissions,
        hasPermission,
        hasAnyPermission,
        hasAllPermissions,
        loading,
        userRole,
        roleName
    };
}

/**
 * Higher-order component to protect routes based on permissions
 */
export function withPermission<P extends object>(
    Component: React.ComponentType<P>,
    requiredPermission: string | string[],
    fallback?: React.ReactNode
) {
    return function PermissionProtectedComponent(props: P) {
        const { hasPermission, hasAnyPermission, loading } = usePermissions();

        if (loading) {
            return (
                <div className="flex items-center justify-center h-96">
                    <FigbloomLoader label="Checking permissions" />
                </div>
            );
        }

        const hasAccess = Array.isArray(requiredPermission)
            ? hasAnyPermission(requiredPermission)
            : hasPermission(requiredPermission);

        if (!hasAccess) {
            return fallback || (
                <div className="flex items-center justify-center h-96">
                    <div className="text-center max-w-md">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
                        <p className="text-sm text-gray-600">
                            You don't have permission to access this feature. Please contact your administrator.
                        </p>
                    </div>
                </div>
            );
        }

        return <Component {...props} />;
    };
}

/**
 * Component to conditionally render children based on permissions
 */
interface PermissionGateProps {
    permission: string | string[];
    fallback?: React.ReactNode;
    children: React.ReactNode;
    requireAll?: boolean; // If true and permission is array, requires all permissions
}

export function PermissionGate({
    permission,
    fallback = null,
    children,
    requireAll = false
}: PermissionGateProps) {
    const { hasPermission, hasAnyPermission, hasAllPermissions, loading } = usePermissions();

    if (loading) {
        return null; // Or a skeleton loader
    }

    let hasAccess = false;

    if (Array.isArray(permission)) {
        hasAccess = requireAll
            ? hasAllPermissions(permission)
            : hasAnyPermission(permission);
    } else {
        hasAccess = hasPermission(permission);
    }

    return hasAccess ? <>{children}</> : <>{fallback}</>;
}
