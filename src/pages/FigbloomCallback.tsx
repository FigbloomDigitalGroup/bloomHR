import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import AuthShell, { authLinkClass } from '../components/Company/AuthShell';
import { LoaderBlock } from '../components/UI/FigbloomLoader';
import { exchangeFigbloomCode, readFigbloomReturn, startFigbloomSignIn, type FigbloomPool } from '../lib/figbloomSignIn';
import { checkCanSignIn } from '../lib/signInChecks';

interface Props {
  pool: FigbloomPool;
  // the app's usual next step after a sign-in (App: two-step code if the company asks for it, then the dashboard).
  // The console (staff) checks access itself once the session exists (ConsoleApp: platform admin, two-step code), so
  // it gets null and none of the company checks.
  onLoginSuccess: (userData: any) => void;
}

/**
 * Where Figbloom's sign-in page sends the browser back (lib/figbloomSignIn.ts): the API swaps the code for a one-time
 * sign-in token, verifying it gives the person's usual Supabase session, and then everything runs as after a
 * password sign-in: account status and employment (lib/signInChecks.ts), the company's two-step code, the dashboard.
 */
export default function FigbloomCallback({ pool, onLoginSuccess }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // the code is single use: never sent twice (React runs effects twice in development)
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const back = readFigbloomReturn(pool, new URLSearchParams(window.location.search));
    // the code must not stay in the address bar or the history
    window.history.replaceState(null, '', window.location.pathname);
    const signIn = async () => {
      if ('error' in back) throw new Error(back.error);
      const { tokenHash } = await exchangeFigbloomCode(back);
      const { data, error: otpError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
      if (otpError || !data.user) throw new Error('Sign-in failed. Please try again.');
      if (pool === 'staff') {
        onLoginSuccess(null);
        return;
      }
      const check = await checkCanSignIn(data.user.id, data.user.email ?? '');
      if (!check.ok) throw new Error(check.message);
      onLoginSuccess(check.userData);
    };
    signIn().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.'));
  }, [pool, onLoginSuccess]);

  const again = () => {
    setRetrying(true);
    startFigbloomSignIn(pool).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Please try again.');
      setRetrying(false);
    });
  };

  if (error) {
    return (
      <AuthShell title="Sign-in didn't finish" subtitle={error}>
        <button type="button" onClick={again} disabled={retrying} className={authLinkClass}>
          {retrying ? 'Opening Figbloom sign-in…' : 'Try again'}
        </button>
        <a href={pool === 'staff' ? '/' : '/login'} className={`${authLinkClass} ml-4`}>
          Back to sign in
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Signing you in…">
      <LoaderBlock label="Signing you in" compact />
    </AuthShell>
  );
}
