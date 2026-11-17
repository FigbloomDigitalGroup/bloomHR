import { supabase } from './supabase';

// What every sign-in checks once the person has a session: password sign-in (Login) and "Sign in with Figbloom"
// (FigbloomCallback) alike. A refused person is signed out again.
//   - the account is ACTIVE
//   - everyone but ADMIN still works there: not Inactive/Terminated, and their termination date hasn't come (an exit
//     approved for a later day keeps them signed in until then; it ends their access the day after their last day,
//     FIG-832)
export type SignInCheck = { ok: true; userData: any } | { ok: false; message: string };

export async function checkCanSignIn(userId: string, email: string): Promise<SignInCheck> {
  const { data: userData } = await supabase.from('users').select('*').eq('id', userId).single();
  if (!userData) return { ok: false, message: 'Your account could not be loaded. Please try again.' };

  if (userData.account_status && userData.account_status !== 'ACTIVE') {
    await supabase.auth.signOut();
    return { ok: false, message: `Your account is ${String(userData.account_status).toLowerCase()}. Please contact support.` };
  }

  if (userData.role !== 'ADMIN') {
    const { data: empData } = await supabase
      .from('employees')
      .select('Status, "Termination Date"')
      .eq('"Work Email"', email)
      .maybeSingle();
    const left = String(empData?.['Termination Date'] ?? '').slice(0, 10);
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (empData && (['inactive', 'terminated'].includes(String(empData.Status ?? '').toLowerCase()) || (left && left < todayStr))) {
      await supabase.auth.signOut();
      return { ok: false, message: 'Your employment account has been deactivated. Please contact HR for assistance.' };
    }
  }

  return { ok: true, userData };
}
