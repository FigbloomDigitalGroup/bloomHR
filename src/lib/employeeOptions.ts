import { fetchAllResult } from './fetchAll';
import { supabase } from './supabase';

// Offered in the employee forms' Department list alongside the departments the company already uses, so a new
// company is not starting from an empty list. Anything else can be typed in.
export const STARTER_DEPARTMENTS = [
  'Administration',
  'Customer Service',
  'Finance',
  'Human Resources',
  'IT',
  'Operations',
  'Procurement',
  'Sales & Marketing',
];

/** The company's own values (from its employees) followed by any starters it doesn't use yet, without blanks. */
export function optionsWithStarters(existing: (string | null | undefined)[] = [], starters: string[] = []): string[] {
  const own = [...new Set(existing.map((v) => (v || '').trim()).filter(Boolean))];
  const seen = new Set(own.map((v) => v.toLowerCase()));
  return [...own, ...starters.filter((s) => !seen.has(s.toLowerCase()))];
}

/** The values the company's employees already have in each field the employee forms offer a list for. */
export interface EmployeeFieldValues {
  employeeTypes: string[];
  branches: string[];
  jobLevels: string[];
  jobGroups: string[];
  towns: string[];
  jobTitles: string[];
  /** "First Last" of every employee, by first name. */
  supervisors: string[];
}

const FIELD_COLUMNS = '"Employee Number", "Employee Type", "Branch", "Job Level", "Job Group", "Town", "Job Title", "First Name", "Last Name"';

/** The non-blank values of `column` across `rows`, A-Z (repeats kept, as the lists dedupe them). */
const sortedValues = (rows: Record<string, unknown>[], column: string): string[] =>
  rows
    .map((r) => r[column])
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .sort((a, b) => a.localeCompare(b));

/** The field values from already-read employee rows. */
export function employeeFieldValues(rows: Record<string, unknown>[]): EmployeeFieldValues {
  // by first name, people without one last (as the database sorted them)
  const byFirstName = [...rows].sort((a, b) => {
    const x = a['First Name'];
    const y = b['First Name'];
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return String(x).localeCompare(String(y));
  });
  return {
    employeeTypes: sortedValues(rows, 'Employee Type'),
    branches: sortedValues(rows, 'Branch'),
    jobLevels: sortedValues(rows, 'Job Level'),
    jobGroups: sortedValues(rows, 'Job Group'),
    towns: sortedValues(rows, 'Town'),
    jobTitles: sortedValues(rows, 'Job Title'),
    supervisors: byFirstName.map((r) => `${r['First Name']} ${r['Last Name']}`),
  };
}

/**
 * The field values across the whole company, in one read of every employee a page at a time (one request is
 * capped at 1000 rows). A failed read gives empty lists, so the forms still work with their starter values.
 */
export async function loadEmployeeFieldValues(table: 'employees' | 'employee_directory'): Promise<EmployeeFieldValues> {
  const { data } = await fetchAllResult((from, to) =>
    supabase.from(table).select(FIELD_COLUMNS).order('Employee Number').range(from, to)
  );
  return employeeFieldValues((data || []) as unknown as Record<string, unknown>[]);
}

/**
 * A branch typed in on an employee also goes on the company's branch list (kenya_branches), which the top bar's
 * Region/Town filters read. Best effort: adding to that list needs the Settings permission, and the employee is
 * saved either way.
 */
export async function ensureBranchListed(branch: string | null | undefined, town?: string | null): Promise<void> {
  const name = (branch || '').trim();
  if (!name || name === 'all') return;
  try {
    const { data } = await supabase.from('kenya_branches').select('id').ilike('Branch Office', name).limit(1);
    if (data && data.length > 0) return;
    await supabase.from('kenya_branches').insert({ 'Branch Office': name, Town: (town || '').trim() || null });
  } catch {
    /* the employee is saved; the filter list just doesn't get this branch */
  }
}
