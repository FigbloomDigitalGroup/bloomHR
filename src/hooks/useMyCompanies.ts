import { useEffect, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryClient, queryKeys } from '../lib/queryClient';
import { companyApi } from '../lib/companyApi';
import { clearCompanyChoice, markCompanyChosen } from '../lib/companyChoice';

/** The companies the signed-in person belongs to (and which one they are in now). Cached for the session. */
export function useMyCompanies() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.myCompanies, queryFn: companyApi.myCompanies });

  // a different person signing in (or out) must never see the previous person's companies
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        clearCompanyChoice();
        client.resetQueries({ queryKey: queryKeys.myCompanies });
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        client.invalidateQueries({ queryKey: queryKeys.myCompanies });
      }
    });
    return () => subscription.unsubscribe();
  }, [client]);

  return query;
}

/**
 * Work in another company: the database checks the person is a member, then the app reloads so every screen,
 * cache and permission starts again from the new company (nothing from the old one can linger on screen).
 */
export async function switchToCompany(userId: string, tenantId: string): Promise<void> {
  setSwitching(true);
  try {
    await companyApi.switchCompany(tenantId);
  } catch (err) {
    setSwitching(false);
    throw err;
  }
  markCompanyChosen(userId);
  queryClient.clear();
  window.location.assign('/dashboard');
}

// While a switch is under way the app shows its skeleton (not a blank page) until the new company has loaded.
let switching = false;
const switchingListeners = new Set<() => void>();

function setSwitching(value: boolean) {
  switching = value;
  switchingListeners.forEach((l) => l());
}

export function useCompanySwitching(): boolean {
  return useSyncExternalStore(
    (l) => {
      switchingListeners.add(l);
      return () => switchingListeners.delete(l);
    },
    () => switching
  );
}
