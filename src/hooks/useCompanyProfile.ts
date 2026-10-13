import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface CompanyProfile {
  /** whose profile this is (a page can briefly still hold the previous login's after switching accounts) */
  userId: string;
  role: string;
  tenantId: string;
  accountStatus: string;
}

export type CompanyProfileState =
  | { status: 'loading' }
  | { status: 'none' } // signed in, but not a member of any company yet
  | { status: 'ready'; profile: CompanyProfile }
  | { status: 'error'; message: string };

/**
 * The signed-in person's role in the company they are working in, read from user_profiles: the row only the
 * backend and the company functions write. The role in user_metadata is editable by the user themselves and
 * knows nothing about companies, so it must not decide what a person is shown.
 */
export function useCompanyProfile(userId: string | undefined, reloadKey: number = 0): CompanyProfileState {
  const [state, setState] = useState<CompanyProfileState>({ status: 'loading' });

  useEffect(() => {
    if (!userId) {
      setState({ status: 'loading' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    supabase
      .from('user_profiles')
      .select('role, tenant_id, account_status')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setState({ status: 'error', message: error.message || 'Could not load your account' });
        else if (!data?.tenant_id) setState({ status: 'none' });
        else setState({ status: 'ready', profile: { userId, role: data.role || 'STAFF', tenantId: data.tenant_id, accountStatus: data.account_status || 'ACTIVE' } });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, reloadKey]);

  return state;
}

/**
 * The signed-in user as the app should see them: same person, but with the role from the trusted company profile
 * once it is known. (The auth session only carries the role in user_metadata, which is editable and not per company.)
 */
/** Where a person lands after signing in: the staff portal for staff, the HR dashboard for everyone else. */
export const landingPathFor = (role: string) => (role === 'STAFF' ? '/staff' : '/dashboard');

/**
 * Where to send the login that just signed in, or null to wait: until its company profile has loaded (not the
 * previous login's). With no company, or one that could not be loaded, the main route shows what to do.
 */
export function landingTarget(state: CompanyProfileState, userId: string | undefined): string | null {
  if (state.status === 'loading') return null;
  if (state.status === 'ready') return state.profile.userId === userId ? landingPathFor(state.profile.role) : null;
  return '/dashboard';
}

export function withProfileRole<U extends { role: string }>(user: U | null, state: CompanyProfileState): U | null {
  if (!user || state.status !== 'ready' || user.role === state.profile.role) return user;
  return { ...user, role: state.profile.role };
}
