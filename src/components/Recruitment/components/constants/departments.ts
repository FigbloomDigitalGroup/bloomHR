import { useMemo } from 'react';
import { useDepartments } from '../../../../hooks/useDepartments';
import { departmentNames } from '../../../../lib/orgStructure';

// used when a company has not set up its departments yet (Settings → Departments)
export const departments = ['All Departments', 'Relationship Managemen', 'HR', 'Credit and Risk', 'Customer Service', 'Operations', 'Branch Management', 'Area Management', 'Regional Management'];

/** 'All Departments' and the company's active departments, or the list above if it has none. */
export function useRecruitmentDepartments(): string[] {
  const { departments: company } = useDepartments();
  return useMemo(() => {
    const names = departmentNames(company);
    return names.length ? ['All Departments', ...names] : departments;
  }, [company]);
}
