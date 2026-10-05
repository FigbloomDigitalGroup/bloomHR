import { useEffect, useState } from 'react';
import { DirectoryEmployee, loadEmployeeDirectory } from '../lib/employeeDirectory';

export function useEmployeeDirectory() {
  const [employees, setEmployees] = useState<DirectoryEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadEmployeeDirectory()
      .then((list) => {
        if (!cancelled) setEmployees(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load employees');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { employees, loading, error };
}
