// src/components/ProtectedRoutes/AuthRoute.tsx
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../hooks/usePermissions';
import { canOpenScreen } from '../../lib/routeModules';
import FigbloomLoader from '../UI/FigbloomLoader';

interface AuthRouteProps {
  children: React.ReactNode;
  /**
   * The screen (its path in routeModules.ts): it opens only for someone whose role holds one of its modules
   * (FIG-827). Without it, anyone signed in.
   */
  screen?: string;
}

/** What someone sees on a screen their role does not give them, instead of being sent somewhere else. */
export function NoAccess() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4" role="alert">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
          <Lock className="h-5 w-5 text-subtle" />
        </div>
        <h1 className="mb-1 text-lg font-bold text-ink">You don&apos;t have access to this page</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          Your role doesn&apos;t include it. An administrator can add it to your role under Role Permissions.
        </p>
        <Link to="/dashboard" className="text-xs font-bold text-brand hover:underline">
          Go to the dashboard
        </Link>
      </div>
    </div>
  );
}

/** The module check, apart from the sign-in check so it can be tested on its own. */
export function ScreenGate({ screen, children }: { screen: string; children: React.ReactNode }) {
  const { hasPermission, loading } = usePermissions();
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <FigbloomLoader label="Loading" />
      </div>
    );
  }
  return canOpenScreen(screen, hasPermission) ? <>{children}</> : <NoAccess />;
}

export default function AuthRoute({ children, screen }: AuthRouteProps) {
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      // If we are in the middle of password recovery, do NOT redirect to login
      const isPasswordRecovery = sessionStorage.getItem('isPasswordRecovery') === 'true';

      const { data: { user }, error } = await supabase.auth.getUser();

      if (error || !user) {
        if (isPasswordRecovery) return;
        navigate('/login');
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
  }, [navigate]);

  return screen ? <ScreenGate screen={screen}>{children}</ScreenGate> : <>{children}</>;
}
