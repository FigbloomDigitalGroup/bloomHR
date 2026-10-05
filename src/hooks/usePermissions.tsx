import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryClient';

interface UsePermissionsReturn {
    permissions: string[];
    hasPermission: (permission: string) => boolean;
    hasAnyPermission: (permissions: string[]) => boolean;
    hasAllPermissions: (permissions: string[]) => boolean;
    loading: boolean;
    userRole: string | null;
}

interface MyPermissions {
    role: string | null;
    permissions: string[];
}

const NOBODY: MyPermissions = { role: null, permissions: [] };

async function loadMyPermissions(): Promise<MyPermissions> {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NOBODY;

    // Get user's role from user_metadata (not from employees table)
    // Normalize to uppercase to match database role_name
    const rawRole = user.user_metadata?.role;
    const role = rawRole ? rawRole.toUpperCase() : null;
    if (!role) return NOBODY;

    // Get role permissions from database
    const { data: rolePermData, error: permError } = await supabase
        .from('role_permissions')
        .select('permissions')
        .eq('role_name', role)
        .single();

    if (permError) {
        // fail closed: the role is known, but nothing is granted
        console.error('Error fetching permissions:', permError);
        return { role, permissions: [] };
    }
    return { role, permissions: rolePermData?.permissions || [] };
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
    const { role: userRole, permissions } = query.data ?? NOBODY;
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
        userRole
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
                    <div className="text-center">
                        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                        <p className="text-sm text-gray-600">Checking permissions...</p>
                    </div>
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
