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

/**
 * The person's role in the company they are working in, with the company's own role they hold (FIG-827), if any.
 * Null when they are in no company. `role` is always the base (system) role.
 */
export async function fetchTrustedProfile(userId: string): Promise<{ role: string; companyRoleId: string | null } | null> {
  let { data, error } = await supabase.from('user_profiles').select('role, company_role_id').eq('user_id', userId).maybeSingle();
  if (error) {
    // a database without company roles yet: the role alone
    ({ data, error } = await supabase.from('user_profiles').select('role').eq('user_id', userId).maybeSingle());
  }
  if (error || !data?.role) return null;
  const row = data as { role: string; company_role_id?: string | null };
  return { role: String(row.role).toUpperCase(), companyRoleId: row.company_role_id ?? null };
}
