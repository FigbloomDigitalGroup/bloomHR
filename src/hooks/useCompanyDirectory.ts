import { useQuery } from '@tanstack/react-query';
import type { DirectoryEmployee } from '../lib/employeeDirectory';
import { describeLoadError } from '../lib/employeeDirectory';
import { loadCompanyDirectory } from '../lib/staffCompany';
import { queryKeys } from '../lib/queryClient';

const NONE: DirectoryEmployee[] = [];

/** The company's current employees with only what an organogram needs (the staff portal's Company area). */
export function useCompanyDirectory() {
  const query = useQuery({ queryKey: queryKeys.companyDirectory, queryFn: loadCompanyDirectory });
  return {
    employees: query.data ?? NONE,
    loading: query.isLoading,
    error: query.error ? describeLoadError(query.error) : null,
  };
}
