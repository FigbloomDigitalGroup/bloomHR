import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

/** The signed-in person's email, `null` when signed out, `undefined` while we find out. */
export function useSessionEmail(): string | null | undefined {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setEmail(data.session?.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // never call supabase from inside this callback (it can deadlock); just record the result
      if (!cancelled) setEmail(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);
  return email;
}
