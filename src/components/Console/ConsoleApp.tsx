import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { isPlatformAdmin } from '../../lib/platformRates';
import ConsoleLogin from './ConsoleLogin';
import MFAVerification from '../../pages/MFAverification';
import UpdatePasswordPage from '../../pages/UpdatePassword';
import AuthShell, { AuthButton } from '../Company/AuthShell';
import FigbloomLoader from '../UI/FigbloomLoader';
import OrganisationsPage from '../Platform/OrganisationsPage';
import PlatformRatesPage from '../Payroll/PlatformRatesPage';
import ConsoleLayout from './ConsoleLayout';

// The Figbloom console (src/lib/console.ts): what App shows on console.figbloom.org instead of the company app. Only
// signing in, two-step sign-in and Figbloom's own pages: no company is loaded, so a platform admin who is staff in their
// company, or in no company at all, gets the same console. is_platform_admin() decides who gets in; the database
// refuses anyone else on every platform call anyway.

const HOME = '/platform/organisations';

const Loader = () => <FigbloomLoader fullScreen />;

/** Whether this sign-in still needs a two-step code (the company app asks the same; false without a company). */
async function mfaRequired(): Promise<boolean> {
  const { data, error } = await supabase.rpc('mfa_required');
  return !error && data === true; // as in the company app, a failed check does not lock anyone out
}

interface Access {
  userId: string;
  admin: boolean;
  mfa: boolean;
}

function NoConsoleAccess({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <AuthShell
      title="No console access"
      subtitle={<>You are signed in as <span className="font-semibold">{email}</span>, which is not a Figbloom platform admin.</>}
    >
      <AuthButton variant="secondary" onClick={onSignOut}>
        Sign out
      </AuthButton>
    </AuthShell>
  );
}

export default function ConsoleApp() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // undefined until the stored sign-in has been read
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [access, setAccess] = useState<Access | null>(null);

  useEffect(() => {
    let live = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (live) setSession(data.session);
    });
    // only note the session here: supabase holds its auth lock until this callback returns (see App.tsx)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => {
      live = false;
      subscription.unsubscribe();
    };
  }, []);

  // Asked once per sign-in, and again on each page while a two-step code is still due (MFAVerification moves on
  // to another page once the code is right).
  const userId = session?.user?.id;
  const known = !!userId && access?.userId === userId;
  const cleared = known && !access?.mfa;
  useEffect(() => {
    if (!userId || cleared || (known && pathname === '/mfa')) return;
    let live = true;
    setAccess(null);
    void Promise.all([isPlatformAdmin(), mfaRequired()]).then(([admin, mfa]) => {
      if (live) setAccess({ userId, admin, mfa });
    });
    return () => {
      live = false;
    };
  }, [userId, known, cleared, pathname]);

  const signOut = useCallback(async () => {
    sessionStorage.removeItem('isMFAProcess');
    sessionStorage.removeItem('mfaCompleted');
    // this browser only, as in the company app
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) toast.error('Error signing out: ' + error.message);
    navigate('/', { replace: true });
  }, [navigate]);

  // the password reset link works signed in (the link's own session) or not
  if (pathname === '/update-password') return <UpdatePasswordPage />;
  if (session === undefined) return <Loader />;
  // signing in moves on by itself: the session change above picks it up
  if (!session) return <ConsoleLogin />;
  if (!known || !access) return <Loader />;
  if (access.mfa) return pathname === '/mfa' ? <MFAVerification /> : <Navigate to="/mfa" replace />;

  const email = session.user.email ?? '';
  if (!access.admin) return <NoConsoleAccess email={email} onSignOut={() => void signOut()} />;

  return (
    <ConsoleLayout email={email} onSignOut={() => void signOut()}>
      <Routes>
        <Route path="/platform/organisations" element={<OrganisationsPage />} />
        <Route path="/platform/rates" element={<PlatformRatesPage />} />
        <Route path="*" element={<Navigate to={HOME} replace />} />
      </Routes>
    </ConsoleLayout>
  );
}
