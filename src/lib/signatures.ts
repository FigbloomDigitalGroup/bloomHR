import { supabase } from './supabase';
import { currentUserAndTenant } from './privateFiles';

// Each person's drawn signature (migration 20261026000000): a PNG in the private "signatures" bucket under
// <company>/<login>/, and one user_signatures row pointing at it. Only its owner reads it; the letters they send carry
// it where the template says {{signature}}.

const fail = (error: { message?: string } | null, fallback: string): never => {
  throw new Error(error?.message || fallback);
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read your signature.'));
    reader.readAsDataURL(blob);
  });

/**
 * The signed-in person's signature as a data: URL (so it draws into a PDF without a cross-origin image), or null when
 * they have not drawn one.
 */
export async function loadMySignature(): Promise<string | null> {
  const { data, error } = await supabase.from('user_signatures').select('path').maybeSingle();
  if (error) fail(error, 'Could not load your signature.');
  if (!data?.path) return null;
  const { data: file, error: fileError } = await supabase.storage.from('signatures').download(data.path);
  if (fileError || !file) fail(fileError, 'Could not load your signature.');
  return blobToDataUrl(file as Blob);
}

/** Saves a newly drawn signature (a PNG) in place of the old one. Returns it as a data: URL. */
export async function saveMySignature(png: Blob): Promise<string> {
  const { userId, tenantId } = await currentUserAndTenant();
  const path = `${tenantId}/${userId}/signature-${crypto.randomUUID()}.png`;
  const { error: uploadError } = await supabase.storage.from('signatures').upload(path, png, { contentType: 'image/png', upsert: false });
  if (uploadError) fail(uploadError, 'Your signature was not saved.');

  const { data: old } = await supabase.from('user_signatures').select('path').maybeSingle();
  const { error } = old
    ? await supabase.from('user_signatures').update({ path }).eq('user_id', userId)
    : await supabase.from('user_signatures').insert({ path });
  if (error) {
    await supabase.storage.from('signatures').remove([path]);
    fail(error, 'Your signature was not saved.');
  }
  if (old?.path) await supabase.storage.from('signatures').remove([old.path]);
  return blobToDataUrl(png);
}

/** Removes the signature; letters then leave its place empty. */
export async function clearMySignature() {
  const { data, error: readError } = await supabase.from('user_signatures').select('path').maybeSingle();
  if (readError) fail(readError, 'Your signature was not removed.');
  if (!data) return;
  const { error } = await supabase.from('user_signatures').delete().eq('path', data.path);
  if (error) fail(error, 'Your signature was not removed.');
  await supabase.storage.from('signatures').remove([data.path]);
}
