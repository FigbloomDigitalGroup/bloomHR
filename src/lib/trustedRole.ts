import { supabase } from './supabase';

/**
 * The person's role in the company they are working in, from user_profiles: the row only the backend and the
 * company functions can write. The role in auth user_metadata is editable by the user and does not follow the
 * company, so it must never decide what someone may see or do. Returns null when the person is in no company
 * (or the lookup failed), which callers treat as "no access".
 */
export async function fetchTrustedRole(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('user_profiles').select('role').eq('user_id', userId).maybeSingle();
  if (error || !data?.role) return null;
  return String(data.role).toUpperCase();
}
