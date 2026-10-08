import type { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { queryKeys } from './queryClient';

// What the app caches about the signed-in person: their role and permissions (the sidebar), and their companies.
const ACCOUNT_KEYS = [queryKeys.myPermissions, queryKeys.myCompanies];

/**
 * Forget the cached account answers whenever someone signs in or out, for the whole app. The hooks that use them
 * also listen, but only while a screen using them is open: after signing out, the sign-in page has none, so the
 * "no permissions" answer fetched during sign-out was kept and the next person's sidebar showed only Appearance
 * until a refresh.
 */
export function forgetAccountOnSignInOut(client: QueryClient): () => void {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      ACCOUNT_KEYS.forEach((queryKey) => client.removeQueries({ queryKey }));
    } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
      // stale now: a screen showing them reloads straight away, the next one to open loads fresh
      ACCOUNT_KEYS.forEach((queryKey) => client.invalidateQueries({ queryKey, refetchType: 'all' }));
    }
  });
  return () => subscription.unsubscribe();
}
