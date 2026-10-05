import { useEffect, useState } from 'react';
import { DirectoryEmployee, describeLoadError, loadEmployeeDirectory } from '../lib/employeeDirectory';

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
        console.error('Could not load employees for the picker:', err);
        if (!cancelled) setError(describeLoadError(err));
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
