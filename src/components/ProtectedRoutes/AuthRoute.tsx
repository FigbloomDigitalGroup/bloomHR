// src/components/AuthRoute.tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface AuthRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export default function AuthRoute({ children, allowedRoles }: AuthRouteProps) {
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

      const userRole = user.user_metadata?.role || 'STAFF';

      if (allowedRoles && !allowedRoles.includes(userRole)) {
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
  }, [navigate, allowedRoles]);

  return <>{children}</>;
}