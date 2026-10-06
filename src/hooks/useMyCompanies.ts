import { useEffect } from 'react';
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
  await companyApi.switchCompany(tenantId);
  markCompanyChosen(userId);
  queryClient.clear();
  window.location.assign('/dashboard');
}
