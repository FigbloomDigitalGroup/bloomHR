// Offered in the employee forms whether or not anyone in the company has them yet; HR Lifecycle reads
// each of these (see the employees_sync_employment_status trigger). Types a company already uses are added after.
export const STANDARD_EMPLOYEE_TYPES = ['Permanent', 'Probation', 'Contract', 'Internship', 'Attachment'];

export const employeeTypeOptions = (existing: (string | null | undefined)[] = []) =>
  [...new Set([...STANDARD_EMPLOYEE_TYPES, ...existing.filter((t): t is string => !!t && !!t.trim())])];
