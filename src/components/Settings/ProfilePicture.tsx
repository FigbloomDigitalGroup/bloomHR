import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '../UI';
import { supabase } from '../../lib/supabase';
import { uploadUserAvatar } from '../../lib/avatarStorage';
import { saveMyAvatar } from '../../lib/preferences';
import { MY_PREFERENCES_KEY, useMyPreferences } from '../../hooks/useMyPreferences';

const MAX_BYTES = 3 * 1024 * 1024;

/** Lets the signed-in person set the picture shown for them (works for an admin or owner with no employee record). */
export default function ProfilePicture() {
  const qc = useQueryClient();
  const [who, setWho] = useState<{ id?: string; email?: string }>({});
  useEffect(() => {
    supabase.auth.getUser().then(({ data: auth }) => setWho({ id: auth.user?.id, email: auth.user?.email }));
  }, []);
  const { data } = useMyPreferences(who.email);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const url = data?.avatarUrl ?? null;
  const initial = (who.email || '?')[0].toUpperCase();

  const refresh = () => qc.invalidateQueries({ queryKey: MY_PREFERENCES_KEY });

  const onPick = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return void toast.error('Please choose an image file.');
    if (file.size > MAX_BYTES) return void toast.error('That picture is over 3 MB. Please choose a smaller one.');
    setBusy(true);
    try {
      const publicUrl = await uploadUserAvatar(file);
      if (!(await saveMyAvatar(publicUrl))) throw new Error('Your picture uploaded but could not be saved to your account.');
      await refresh();
      toast.success('Profile picture updated');
    } catch (e) {
      toast.error((e as Error).message || 'Could not upload the picture');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      if (!(await saveMyAvatar(null))) throw new Error('Could not remove the picture');
      // best effort: the file itself may have any extension
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user && url) {
        const path = decodeURIComponent(url.split('/employeeavatar/')[1]?.split('?')[0] ?? '');
        if (path) await supabase.storage.from('employeeavatar').remove([path]);
      }
      await refresh();
      toast.success('Profile picture removed');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4">
      <h2 className="m-0 text-[14px] font-bold text-ink">Profile picture</h2>
      <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">Shown next to your name for you and your colleagues.</p>
      <div className="flex items-center gap-4">
        {url ? (
          <img src={url} alt="Your profile" className="h-16 w-16 rounded-full object-cover ring-1 ring-border" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-tint text-[22px] font-bold text-brand" aria-hidden>
            {initial}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/*" className="sr-only" aria-label="Choose a profile picture" onChange={(e) => onPick(e.target.files?.[0])} />
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-tile bg-brand px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
            {busy ? 'Saving…' : url ? 'Change picture' : 'Upload picture'}
          </button>
          {url && (
            <button type="button" disabled={busy} onClick={onRemove} className="rounded-tile border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold text-ink hover:bg-secondary disabled:opacity-60">
              Remove
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
