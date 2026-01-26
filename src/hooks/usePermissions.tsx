import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface UsePermissionsReturn {
    permissions: string[];
    hasPermission: (permission: string) => boolean;
    hasAnyPermission: (permissions: string[]) => boolean;
    hasAllPermissions: (permissions: string[]) => boolean;
    loading: boolean;
    userRole: string | null;
}

/**
 * Hook to check user permissions dynamically
 * @returns Object with permission checking utilities
 */
export function usePermissions(): UsePermissionsReturn {
    const [permissions, setPermissions] = useState<string[]>([]);
    const [userRole, setUserRole] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchUserPermissions();
    }, []);

    const fetchUserPermissions = async () => {
        try {
            setLoading(true);

            // Get current user
            const { data: { user } } = await supabase.auth.getUser();
            if (!user?.email) {
                setPermissions([]);
                setUserRole(null);
                return;
            }

            // Get user's role from employees table
            const { data: employeeData, error: employeeError } = await supabase
                .from('employees')
                .select('"Role"')
                .eq('"Work Email"', user.email)
                .single();

            if (employeeError) throw employeeError;

            const role = employeeData?.Role;
            setUserRole(role);

            if (!role) {
                setPermissions([]);
                return;
            }

            // Get role permissions
            const { data: rolePermData, error: permError } = await supabase
                .from('role_permissions')
                .select('permissions')
                .eq('role_name', role)
                .single();

            if (permError) {
                console.error('Error fetching permissions:', permError);
                setPermissions([]);
                return;
            }

            setPermissions(rolePermData?.permissions || []);
        } catch (error) {
            console.error('Error in fetchUserPermissions:', error);
            setPermissions([]);
            setUserRole(null);
        } finally {
            setLoading(false);
        }
    };

    const hasPermission = (permission: string): boolean => {
        return permissions.includes(permission);
    };

    const hasAnyPermission = (requiredPermissions: string[]): boolean => {
        return requiredPermissions.some(perm => permissions.includes(perm));
    };

    const hasAllPermissions = (requiredPermissions: string[]): boolean => {
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
