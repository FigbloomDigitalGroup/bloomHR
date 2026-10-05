import { supabase } from './supabase';

/**
 * Colleague lookups for pickers. Reads employee_directory (non-sensitive columns, tenant-scoped) rather than
 * the employees table, so it works for every signed-in role, including ones that cannot read other staff rows.
 */
export interface DirectoryEmployee {
  employeeNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  jobTitle: string;
  branch: string;
  town: string;
  email: string;
}

type DirectoryRow = Record<string, string | null>;

const COLUMNS = '"Employee Number", "First Name", "Middle Name", "Last Name", "Job Title", "Branch", "Town", "Work Email"';

export const toDirectoryEmployee = (row: DirectoryRow): DirectoryEmployee => {
  const firstName = (row['First Name'] || '').trim();
  const middleName = (row['Middle Name'] || '').trim();
  const lastName = (row['Last Name'] || '').trim();
  return {
    employeeNumber: String(row['Employee Number'] ?? '').trim(),
    firstName,
    middleName,
    lastName,
    fullName: [firstName, middleName, lastName].filter(Boolean).join(' ') || 'Unknown employee',
    jobTitle: (row['Job Title'] || '').trim(),
    branch: (row['Branch'] || '').trim(),
    town: (row['Town'] || '').trim(),
    email: (row['Work Email'] || '').trim(),
  };
};

/** "Mike Otieno (005)" - the form several screens store as a display string. */
export const employeeLabel = (e: Pick<DirectoryEmployee, 'fullName' | 'employeeNumber'>) =>
  `${e.fullName} (${e.employeeNumber})`;

/** Second line of a picker row: "005 · Accountant · Nairobi". */
export const employeeDetail = (e: DirectoryEmployee) =>
  [e.employeeNumber, e.jobTitle, e.town || e.branch].filter(Boolean).join(' · ');

/**
 * Every whitespace-separated word of the query must appear somewhere in the employee's name, number, job
 * title, branch, town or email, so "mike 005" and "otieno accountant" both work. Name matches that start a
 * word rank first, then the rest alphabetically.
 */
export const matchEmployees = (list: DirectoryEmployee[], query: string): DirectoryEmployee[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return list;

  const scored: { e: DirectoryEmployee; score: number }[] = [];
  for (const e of list) {
    const name = e.fullName.toLowerCase();
    const haystack = [name, e.employeeNumber, e.jobTitle, e.branch, e.town, e.email].join(' ').toLowerCase();
    if (!words.every((w) => haystack.includes(w))) continue;

    let score = 0;
    for (const w of words) {
      if (name.startsWith(w) || name.includes(` ${w}`)) score += 2;
      else if (e.employeeNumber.toLowerCase() === w) score += 3;
    }
    scored.push({ e, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.e.fullName.localeCompare(b.e.fullName))
    .map((s) => s.e);
};

/**
 * Fetches the directory. Caching and sharing between screens is done by React Query
 * (see src/hooks/useEmployeeDirectory.ts and src/lib/queryClient.ts), so this stays a plain request.
 */
export const loadEmployeeDirectory = async (): Promise<DirectoryEmployee[]> => {
  // employee_directory is the intended source (any role, tenant-scoped). If this database does not have it
  // yet, or the request fails, fall back to the employees table, which roles that manage staff can read.
  const read = (table: string) =>
    supabase.from(table).select(COLUMNS).order('First Name', { ascending: true }).limit(5000);

  let { data, error } = await read('employee_directory');
  if (error) {
    console.warn('employee_directory could not be read, trying employees:', error);
    ({ data, error } = await read('employees'));
  }
  if (error) throw error;

  return ((data || []) as unknown as DirectoryRow[])
    .map(toDirectoryEmployee)
    .filter((e) => e.employeeNumber);
};

/** Supabase errors are plain objects, not Error instances, so pull out the useful text. */
export const describeLoadError = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    return [e.message, e.details, e.hint, e.code && `(${e.code})`].filter(Boolean).join(' - ') || 'Unknown error';
  }
  return typeof err === 'string' ? err : 'Unknown error';
};

