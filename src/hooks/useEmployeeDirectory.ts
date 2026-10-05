import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DirectoryEmployee, describeLoadError, loadEmployeeDirectory } from '../lib/employeeDirectory';
import { queryKeys } from '../lib/queryClient';

const NO_EMPLOYEES: DirectoryEmployee[] = [];

/** The company staff directory, shared by every screen that needs it (one request, cached for five minutes). */
export function useEmployeeDirectory() {
  const query = useQuery({
    queryKey: queryKeys.employeeDirectory,
    queryFn: loadEmployeeDirectory,
  });

  useEffect(() => {
    if (query.error) console.error('Could not load employees for the picker:', query.error);
  }, [query.error]);

  return {
    employees: query.data ?? NO_EMPLOYEES,
    loading: query.isLoading,
    error: query.error ? describeLoadError(query.error) : null,
  };
}
