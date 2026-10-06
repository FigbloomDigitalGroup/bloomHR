import { supabase } from './supabase';
import { sanitizeChoice, type ThemeChoice } from '../theme/themes';
import { applyTheme, loadStoredTheme, saveStoredTheme } from '../theme/applyTheme';

// The per-login preferences in 20261006000900_user_preferences.sql. Everything here is best effort: if the table is
// not there yet or the network is down, the theme and picture still work on this device, so nothing throws.

export interface MyPreferences {
  theme: ThemeChoice | null;
  avatarUrl: string | null;
}

export async function fetchMyPreferences(): Promise<MyPreferences | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;
    const { data, error } = await supabase.from('user_preferences').select('theme, avatar_url').eq('user_id', auth.user.id).maybeSingle();
    if (error) return null;
    return { theme: data?.theme ? sanitizeChoice(data.theme) : null, avatarUrl: data?.avatar_url ?? null };
  } catch {
    return null;
  }
}

async function savePreferences(patch: { theme?: ThemeChoice | null; avatar_url?: string | null }): Promise<boolean> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return false;
    const { error } = await supabase.from('user_preferences').upsert({ user_id: auth.user.id, ...patch, updated_at: new Date().toISOString() });
    return !error;
  } catch {
    return false;
  }
}

export const saveMyTheme = (theme: ThemeChoice | null) => savePreferences({ theme });
export const saveMyAvatar = (avatarUrl: string | null) => savePreferences({ avatar_url: avatarUrl });

/**
 * After sign-in: the account's saved theme wins (so a new device looks like the others). A person who has only a
 * local choice (made before this existed, or while signed out) has it saved to the account instead.
 */
export async function syncThemeWithAccount(): Promise<void> {
  const mine = await fetchMyPreferences();
  if (!mine) return;
  const local = loadStoredTheme();
  if (mine.theme) {
    if (JSON.stringify(mine.theme) !== JSON.stringify(local) && applyTheme(mine.theme)) saveStoredTheme(mine.theme);
  } else if (local) {
    await saveMyTheme(local);
  }
}
