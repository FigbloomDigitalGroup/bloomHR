import { useCallback, useEffect, useRef, useState } from 'react';
import { readFormDraft, removeFormDraft, writeFormDraft } from '../lib/formDraft';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Keeps a form's unsaved edits in this tab (lib/formDraft) and brings them back after a refresh.
 *
 * - key: whose form this is (e.g. `onboarding:<employee number>`); null until the record is loaded.
 * - current: what the form shows now. saved: the record as the server has it; nothing is kept while they are the same.
 * - apply: puts a restored draft back into the form.
 *
 * Returns when the restored draft was typed (null when nothing was restored), discard() (back to saved), dismiss()
 * (hide the note, keep the edits) and clear() (after a save).
 */
export function useFormDraft<T>(key: string | null, current: T, saved: T, apply: (data: T) => void) {
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const checked = useRef<string | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // once per record: put back what was typed before the refresh
  useEffect(() => {
    if (!key || checked.current === key) return;
    checked.current = key;
    const draft = readFormDraft<T>(key);
    if (draft && !same(draft.data, saved)) {
      applyRef.current(draft.data);
      setRestoredAt(draft.at);
    } else {
      removeFormDraft(key);
    }
  }, [key, saved]);

  // then keep what is typed, as it is typed
  useEffect(() => {
    if (!key || checked.current !== key) return;
    if (same(current, saved)) {
      removeFormDraft(key);
    } else {
      writeFormDraft(key, current);
    }
  }, [key, current, saved]);

  const discard = useCallback(() => {
    if (key) removeFormDraft(key);
    setRestoredAt(null);
    applyRef.current(saved);
  }, [key, saved]);

  const dismiss = useCallback(() => setRestoredAt(null), []);

  /** after saving by hand: nothing left to keep */
  const clear = useCallback(() => {
    if (key) removeFormDraft(key);
    setRestoredAt(null);
  }, [key]);

  return { restoredAt, discard, dismiss, clear };
}
