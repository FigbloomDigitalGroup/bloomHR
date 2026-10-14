import { useCallback, useEffect, useState } from 'react';
import { EmployeeNumbering, loadEmployeeNumbering } from '../lib/employeeNumbering';

/**
 * How the company's employee numbers are given, read when the page opens. `numbering` is null while loading or when
 * the person may not see it; pages then behave as for system numbers.
 */
export function useEmployeeNumbering() {
  const [numbering, setNumbering] = useState<EmployeeNumbering | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const next = await loadEmployeeNumbering();
    setNumbering(next);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    let live = true;
    loadEmployeeNumbering().then((next) => {
      if (!live) return;
      setNumbering(next);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  return { numbering, loading, ownNumbers: numbering?.mode === 'own', reload };
}
