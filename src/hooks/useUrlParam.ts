import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { onOverlayEntry } from './useBackToClose';

/**
 * A view kept in the address (e.g. the My team tab, ?view=kpis), so the phone's Back returns to the previous view
 * and a refresh keeps it. The default value is left out of the address. Other parameters are kept.
 */
export function useUrlParam(name: string, fallback: string): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(name) || fallback;

  const setValue = useCallback(
    (next: string) => {
      if (next === value) return;
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === fallback) p.delete(name);
          else p.set(name, next);
          return p;
        },
        { replace: onOverlayEntry() },
      );
    },
    [name, fallback, value, setParams],
  );

  return [value, setValue];
}
