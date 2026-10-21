import { useEffect, useRef, useState } from 'react';

export type AutosaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Saves a form a moment after the person stops typing, like a document: `value` is what to save, and `save` saves it
 * (throwing with the reason when refused). Nothing is saved while `enabled` is false or the value is what was last
 * saved; a change made while a save is running is saved after it. The value when it is first enabled, or when
 * `generation` changes (the record was loaded again), is taken as saved.
 */
export function useAutosave<T>(value: T, save: (value: T) => Promise<void>, { enabled, generation = 0, delay = 1500 }: {
  enabled: boolean;
  generation?: number;
  delay?: number;
}) {
  const [state, setState] = useState<AutosaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  const base = useRef<number | null>(null);
  const running = useRef(false);
  const pending = useRef<T | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!enabled) return;
    // the starting point: what the form showed when it was loaded
    if (base.current !== generation || last.current === null) {
      base.current = generation;
      last.current = JSON.stringify(value);
      return;
    }
    if (JSON.stringify(value) === last.current) return;
    const run = async (v: T) => {
      if (running.current) {
        pending.current = v;
        return;
      }
      running.current = true;
      setState('saving');
      try {
        await saveRef.current(v);
        last.current = JSON.stringify(v);
        setSavedAt(Date.now());
        setError(null);
        setState('saved');
      } catch (e) {
        setError((e as Error).message);
        setState('error');
      } finally {
        running.current = false;
        const next = pending.current;
        pending.current = null;
        if (next !== null && JSON.stringify(next) !== last.current) void run(next);
      }
    };
    const timer = setTimeout(() => void run(value), delay);
    return () => clearTimeout(timer);
  }, [value, enabled, generation, delay]);

  return { state, savedAt, error };
}
