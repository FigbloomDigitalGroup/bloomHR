import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Department, loadDepartments } from '../lib/orgStructure';
import { describeLoadError } from '../lib/employeeDirectory';
import { queryKeys } from '../lib/queryClient';

const NONE: Department[] = [];

/** The company's departments (active and not), shared by every screen that needs them. */
export function useDepartments() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.departments, queryFn: loadDepartments });

  // after a change: departments, and the directory (whose `Job Level` follows a rename)
  const reload = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.departments }),
      client.invalidateQueries({ queryKey: queryKeys.employeeDirectory }),
    ]);
  }, [client]);

  return {
    departments: query.data ?? NONE,
    loading: query.isLoading,
    error: query.error ? describeLoadError(query.error) : null,
    reload,
  };
}
