import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Branch, loadBranches } from '../lib/branches';
import { describeLoadError } from '../lib/employeeDirectory';
import { queryKeys } from '../lib/queryClient';

const NONE: Branch[] = [];

/** The company's branches (active and not), shared by every screen that needs them. */
export function useBranches() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.branches, queryFn: loadBranches });

  // after a change: branches, and the directory (whose "Branch" follows a rename or a move)
  const reload = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.branches }),
      client.invalidateQueries({ queryKey: queryKeys.employeeDirectory }),
    ]);
  }, [client]);

  return {
    branches: query.data ?? NONE,
    loading: query.isLoading,
    error: query.error ? describeLoadError(query.error) : null,
    reload,
  };
}
