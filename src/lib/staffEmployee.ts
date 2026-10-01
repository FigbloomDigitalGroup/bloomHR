import type { SupabaseClient } from '@supabase/supabase-js';

// The Staff Portal resolves the employee with an exact match on "Work Email", so a STAFF
// login without a matching employees row can never load its data. Only STAFF logins land
// in the portal (see App.tsx), so other roles don't need a linked row.
// Use the same exact match as the portal: .ilike would treat '_' and '%' in an email as
// wildcards and could pass a row the portal then fails to find.
export async function assertEmployeeForStaffLogin(
  client: Pick<SupabaseClient, 'from'>,
  role: string,
  email: string
): Promise<void> {
  if (role !== 'STAFF') return;

  const { data: employee, error } = await client
    .from('employees')
    .select('"Employee Number"')
    .eq('"Work Email"', email)
    .maybeSingle();

  if (error) throw error;
  if (!employee) {
    throw new Error(
      `No employee has the Work Email ${email} (exact match, including letter case). Add or correct the employee first, then create their login.`
    );
  }
}
