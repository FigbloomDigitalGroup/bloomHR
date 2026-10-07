import { supabase } from './supabase';

// Files in private storage buckets (staff documents, expense receipts, CVs). They have no public address: each view
// asks storage for a short-lived signed link, which it only gives to someone the bucket's policies allow (see
// 20261007000100_private_files_storage.sql). Records store the file's path in the bucket; older records stored the
// file's public link, which still works here because the path is read back out of it.

export type PrivateBucket = 'documents' | 'expense-receipts' | 'resumes';

const SIGNED_LINK_SECONDS = 60 * 60;

/** The signed-in login and its company, which name the folders files are saved in. */
export async function currentUserAndTenant(): Promise<{ userId: string; tenantId: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You are not signed in');
  const { data: profile, error } = await supabase.from('user_profiles').select('tenant_id').eq('user_id', user.id).maybeSingle();
  if (error || !profile?.tenant_id) throw new Error('Could not find your company. Please sign in again.');
  return { userId: user.id, tenantId: profile.tenant_id };
}

/** A file's path in the bucket, from either a stored path or an old public/signed link to it. */
export function storagePathFrom(bucket: PrivateBucket, stored: string): string {
  const value = stored.trim();
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, '');
  const marker = `/${bucket}/`;
  const url = new URL(value);
  const at = url.pathname.indexOf(marker);
  if (!/\/storage\/v1\/object\//.test(url.pathname) || at < 0) throw new Error('Not a link to this storage bucket');
  return decodeURIComponent(url.pathname.slice(at + marker.length));
}

/** A short-lived link to view or download the file. */
export async function signedFileUrl(bucket: PrivateBucket, stored: string, seconds = SIGNED_LINK_SECONDS): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePathFrom(bucket, stored), seconds);
  if (error || !data?.signedUrl) throw new Error('You cannot open this file, or it no longer exists');
  return data.signedUrl;
}

/**
 * Opens the file in a new tab. The tab is opened before the link is fetched, because browsers block tabs opened after
 * waiting on the network.
 */
export async function openPrivateFile(bucket: PrivateBucket, stored: string): Promise<void> {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const url = await signedFileUrl(bucket, stored);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/** A file name safe to use in a storage path: a random id plus the original extension. */
export function randomFileName(original: string): string {
  const extension = (original.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${crypto.randomUUID()}${extension ? `.${extension}` : ''}`;
}
