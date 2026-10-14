// src/components/AuthRoute.tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { fetchTrustedRole } from '../../lib/trustedRole';

interface AuthRouteProps {
  children: React.ReactNode;
  /** Roles let in by name. */
  allowedRoles?: string[];
  /**
   * Or: modules, any one of which lets a role in (ADMIN always), so a company's own roles (FIG-827) reach the pages
   * their modules are for. Where allowedRoles is given too, the seven fixed roles are decided by it alone, exactly as
   * before, and STAFF (the staff portal's role) is never let in by a module.
   */
  modules?: string[];
}

const FIXED_ROLES = ['ADMIN', 'HR', 'CHECKER', 'MANAGER', 'REGIONAL', 'OPERATIONS', 'STAFF'];

/** Does the role have one of the modules? Its permissions are read from the person's own company (RLS). */
async function roleHasModule(role: string, modules: string[]): Promise<boolean> {
  if (role === 'ADMIN') return true;
  if (role === 'STAFF') return false;
  const { data, error } = await supabase.from('role_permissions').select('permissions').eq('role_name', role).maybeSingle();
  if (error || !Array.isArray(data?.permissions)) return false;
  return modules.some((m) => (data.permissions as string[]).includes(m));
}

export default function AuthRoute({ children, allowedRoles, modules }: AuthRouteProps) {
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      // If we are in the middle of password recovery, do NOT redirect to login
      const isPasswordRecovery = sessionStorage.getItem('isPasswordRecovery') === 'true';

      const { data: { user }, error } = await supabase.auth.getUser();

      if (error || !user) {
        if (isPasswordRecovery) {
          console.log('AuthRoute skipping login redirect during recovery');
          return;
        }
        navigate('/login');
        return;
      }

      const userRole = (await fetchTrustedRole(user.id)) || 'STAFF';

      const restricted = !!allowedRoles || !!modules;
      const byModule = !!modules && !(allowedRoles && FIXED_ROLES.includes(userRole));
      const allowed =
        !restricted || !!allowedRoles?.includes(userRole) || (byModule && (await roleHasModule(userRole, modules ?? [])));

      if (!allowed) {
        // Redirect based on role
        if (isPasswordRecovery) return;

        switch (userRole) {
          case 'ADMIN':
            navigate('/dashboard');
            break;
          case 'MANAGER':
            navigate('/manager-dashboard');
            break;
          case 'REGIONAL':
            navigate('/regional-dashboard');
            break;
          case 'OPERATIONS':
            navigate('/operations-dashboard');
            break;
          case 'CHECKER':
            navigate('/checker-dashboard');
            break;
          case 'HR':
            navigate('/hr-dashboard');
            break;
          default:
            navigate('/staff');
        }
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        const isPasswordRecovery = sessionStorage.getItem('isPasswordRecovery') === 'true';
        if (isPasswordRecovery) return;

        navigate('/login');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, allowedRoles, modules]);

  return <>{children}</>;
}