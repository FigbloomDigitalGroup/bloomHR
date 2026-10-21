import { supabase } from './supabase';

// What someone has typed into a form of their own details and not saved yet, kept in this browser tab so a refresh
// (or the browser restoring the tab) doesn't lose it. sessionStorage, not localStorage: it holds ID, tax and bank
// numbers, so it goes when the tab is closed, and on signing out, rather than staying on a shared computer.

const PREFIX = 'formDraft:';

export interface FormDraft<T> {
  /** when it was last typed in (ms) */
  at: number;
  data: T;
}

export function readFormDraft<T>(key: string): FormDraft<T> | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as FormDraft<T>;
    return draft && typeof draft.at === 'number' && 'data' in draft ? draft : null;
  } catch {
    return null;
  }
}

export function writeFormDraft<T>(key: string, data: T, at = Date.now()): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ at, data }));
  } catch {
    // storage full or blocked: the form still works, a refresh just loses what wasn't saved
  }
}

export function removeFormDraft(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    // nothing to remove
  }
}

export function clearFormDrafts(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    // nothing to clear
  }
}

/** Forget every draft when someone signs out (the next person on this tab must not see them). */
export function forgetFormDraftsOnSignOut(): () => void {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') clearFormDrafts();
  });
  return () => subscription.unsubscribe();
}
