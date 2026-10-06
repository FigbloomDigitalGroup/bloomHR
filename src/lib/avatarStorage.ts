import { supabase } from './supabase';

const BUCKET = 'employeeavatar';

/**
 * Saves an employee's profile picture and returns its public address.
 *
 * Pictures live in a folder per company (<company id>/profile_images/<employee number>.<ext>), which is what the
 * storage policies allow (see 20261006000400_employee_avatar_storage.sql): a person may save their own picture, HR
 * may save anyone's in the company, and two companies can both have an EMP-001 without touching each other.
 * The same path is replaced on each save, so the address carries a version to make browsers fetch the new one.
 */
export async function uploadEmployeeAvatar(file: File, employeeNumber: string): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You are not signed in');

  const { data: profile, error: profileError } = await supabase.from('user_profiles').select('tenant_id').eq('user_id', user.id).maybeSingle();
  if (profileError || !profile?.tenant_id) throw new Error('Could not find your company. Please sign in again.');

  const extension = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${profile.tenant_id}/profile_images/${String(employeeNumber).replace(/[\\/]/g, '-')}.${extension}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, cacheControl: '3600' });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${publicUrl}?v=${Date.now()}`;
}

/**
 * Saves the signed-in login's own picture (for people with no employee record, such as the person who set the company
 * up). Stored as <company id>/user_avatars/<login id>.<ext>; see 20261006000900_user_preferences.sql.
 */
export async function uploadUserAvatar(file: File): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You are not signed in');

  const { data: profile, error: profileError } = await supabase.from('user_profiles').select('tenant_id').eq('user_id', user.id).maybeSingle();
  if (profileError || !profile?.tenant_id) throw new Error('Could not find your company. Please sign in again.');

  const extension = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${profile.tenant_id}/user_avatars/${user.id}.${extension}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, cacheControl: '3600' });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${publicUrl}?v=${Date.now()}`;
}
